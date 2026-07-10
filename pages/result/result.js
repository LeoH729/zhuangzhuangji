const app = getApp()
const {
  IMAGE_STYLES,
  createImageState,
  markImageLoaded,
  cacheImage,
  getNextRetryState,
  getRetryDelay
} = require('../../utils/image-loader.js')
const {
  HOME_PATH,
  RESULT_TIMELINE_TITLES,
  pickRandom
} = require('../../utils/share.js')
const { report } = require('../../utils/analytics.js')

const POSTER_CANVAS_ID = 'sharePosterCanvas'
const POSTER_WIDTH = 750
const POSTER_HEIGHT = 940
const POSTER_STEP_TIMEOUT_MS = 12000

Page({
  data: {
    id: '',
    featureId: '',
    sourceZone: 'play',
    featureName: 'AI生图魔法',
    resultUrl: '',
    previewImage: createImageState('', IMAGE_STYLES.RESULT_PREVIEW),
    rating: '', // 'hang' | 'la' | ''
    isSavingPoster: false,
    showSavePanel: false,
    isSavingImage: false,
    isUpscaling: false,
    enableUpscalePrint: false,
    upscaledUrl: '',
    upscaleTaskId: '',
    upscalePointsCost: 10,
    isSharedResult: false,
    showSharePanel: false,
    shareTask: {
      completedCount: 0,
      limit: 2,
      reward: 10,
      completed: false
    }
  },

  onShow() {
    this.fetchShareTask()
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({
        menus: ['shareAppMessage', 'shareTimeline']
      })
    }
  },

  onLoad(options) {
    this.reportResultView(options)
    const isSharedResult = options.shared === '1' && !!options.featureId
    const sourceZone = !isSharedResult && (options.sourceZone === 'boss' || options.sourceZone === 'play')
      ? options.sourceZone
      : 'play'
    this.setData({ isSharedResult, sourceZone })
    if (options.id) {
      const resultUrl = options.url ? decodeURIComponent(options.url) : ''
      this.setResultUrl(resultUrl, {
        id: decodeURIComponent(options.id),
        featureId: options.featureId ? decodeURIComponent(options.featureId) : '',
        featureName: options.featureName ? decodeURIComponent(options.featureName) : this.data.featureName
      })
      this.fetchHistoryDetail(decodeURIComponent(options.id))
    } else if (options.url) {
      this.setResultUrl(decodeURIComponent(options.url), { id: options.id || '' })
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
    }
  },

  reportResultView(options) {
    report('result_view', {
      history_id: options.id ? decodeURIComponent(options.id) : '',
      feature_id: options.featureId ? decodeURIComponent(options.featureId) : '',
      source: options.id ? 'history_or_generation' : 'url'
    })
  },

  onUnload() {
    this.clearImageRetryTimers()
    this.clearShareRewardTimers()
    this.clearUpscalePollTimer()
  },

  fetchShareTask() {
    wx.cloud.callFunction({
      name: 'points',
      data: { action: 'getShareTask' }
    }).then(res => {
      if (res.result && res.result.success && res.result.data) {
        this.setData({ shareTask: res.result.data })
      }
    }).catch(err => {
      console.warn('[Result] fetch share task failed:', err)
    })
  },

  openSharePanel() {
    if (this.data.isSharedResult) {
      this.goGenerateSame()
      return
    }
    report('result_share_button_click', {
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    this.setData({ showSharePanel: true })
  },

  closeSharePanel() {
    this.setData({ showSharePanel: false })
  },

  noop() {},

  goGenerateSame() {
    if (!this.data.featureId) {
      wx.switchTab({ url: '/pages/boss-zone/boss-zone' })
      return
    }
    report('result_generate_same_click', {
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    wx.navigateTo({
      url: `/pages/feature/feature?id=${encodeURIComponent(this.data.featureId)}`
    })
  },

  prepareFriendShare() {
    this.pendingShareChannel = 'friend'
    report('result_share_option_click', {
      channel: 'friend',
      action: 'open_share_sheet',
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
  },

  shareToTimeline() {
    this.pendingShareChannel = ''
    this.setData({ showSharePanel: false })
    report('result_share_option_click', {
      channel: 'timeline_guide',
      action: 'show_top_menu_guide',
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({
        menus: ['shareTimeline']
      })
    }
    wx.showModal({
      title: '分享到朋友圈',
      content: '请点击右上角三点菜单，选择“分享到朋友圈”。触发后会自动发放星光奖励。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  sharePosterFromPanel() {
    if (this.data.isSavingPoster) return
    this.setData({ showSharePanel: false })
    report('result_share_option_click', {
      channel: 'poster',
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    this.saveSharePoster()
  },

  scheduleShareReward(channel) {
    const historyId = this.data.id || ''
    const claimKey = `${channel || 'unknown'}:${historyId}`
    if (!this.shareRewardTimers) {
      this.shareRewardTimers = []
    }
    if (!this.shareRewardScheduledKeys) {
      this.shareRewardScheduledKeys = {}
    }
    if (this.shareRewardScheduledKeys[claimKey]) {
      return
    }
    this.shareRewardScheduledKeys[claimKey] = true
    const timer = setTimeout(() => {
      delete this.shareRewardScheduledKeys[claimKey]
      this.claimShareReward(channel)
    }, 2000)
    this.shareRewardTimers.push(timer)
  },

  clearShareRewardTimers() {
    if (!this.shareRewardTimers) return
    this.shareRewardTimers.forEach(timer => clearTimeout(timer))
    this.shareRewardTimers = []
    this.shareRewardScheduledKeys = {}
  },

  async claimShareReward(channel) {
    const historyId = this.data.id || ''
    const claimKey = `${channel || 'unknown'}:${historyId}`
    const now = Date.now()
    if (this.shareRewardClaimingKey === claimKey) {
      return
    }
    if (this.lastShareRewardClaim && this.lastShareRewardClaim.key === claimKey && now - this.lastShareRewardClaim.at < 5000) {
      return
    }
    this.shareRewardClaimingKey = claimKey
    try {
      console.log('[Result] claimShareReward start', {
        channel,
        historyId
      })
      const res = await wx.cloud.callFunction({
        name: 'points',
        data: {
          action: 'claimShareReward',
          channel,
          historyId
        }
      })
      console.log('[Result] claimShareReward result', res && res.result)
      const data = res.result && res.result.data
      if (!res.result || !res.result.success || !data) {
        wx.showToast({ title: (res.result && res.result.message) || '奖励领取失败', icon: 'none' })
        return
      }

      this.setData({ shareTask: data })
      if (typeof data.points === 'number') {
        app.globalData.userPoints = data.points
        wx.setStorageSync('userPoints', data.points)
      }
      report('star_task_progress', {
        task_id: data.taskId,
        completed_count: data.completedCount,
        limit: data.limit,
        completed: data.completed ? 1 : 0,
        channel
      })
      if (data.rewarded) {
        this.lastShareRewardClaim = { key: claimKey, at: Date.now() }
        wx.showToast({ title: `星光 +${data.reward}`, icon: 'success' })
      }
    } catch (err) {
      console.error('[Result] claim share reward failed:', err)
    } finally {
      if (this.shareRewardClaimingKey === claimKey) {
        this.shareRewardClaimingKey = ''
      }
    }
  },

  async fetchHistoryDetail(id) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('generation_history').doc(id).get()
      if (res.data) {
        let enableUpscalePrint = res.data.enableUpscalePrint === true
        if (typeof res.data.enableUpscalePrint !== 'boolean' && res.data.featureId) {
          const featureRes = await wx.cloud.callFunction({
            name: 'featureConfig',
            data: {
              action: 'getDetail',
              payload: { id: res.data.featureId }
            }
          }).catch(() => null)
          enableUpscalePrint = !!(featureRes && featureRes.result && featureRes.result.success && featureRes.result.data && featureRes.result.data.enable_upscale_print)
        }
        this.setResultUrl(res.data.resultUrl || this.data.resultUrl, {
          rating: res.data.rating || '',
          featureId: res.data.featureId || '',
          enableUpscalePrint,
          upscaledUrl: res.data.upscaledUrl || '',
          upscaleTaskId: res.data.upscaleTaskId || '',
          upscalePointsCost: Number(res.data.upscalePointsCost || 10),
          featureName: res.data.featureName || res.data.featureNameSnapshot || 'AI生图魔法'
        })
      }
    } catch (err) {
      console.warn('获取生图评价详情失败（可能为刚生成的临时数据）:', err)
    }
  },

  async onRate(e) {
    if (this.data.rating) return // 置灰锁定
    
    const value = e.currentTarget.dataset.value
    if (value !== 'hang' && value !== 'la') return

    wx.showLoading({ title: '提交中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'rateTask',
          historyId: this.data.id,
          rating: value
        }
      })

      wx.hideLoading()
      if (res.result && res.result.success) {
        this.setData({ rating: value })
        wx.showToast({ title: '评价成功', icon: 'success' })
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '评价失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('[Result] 评价失败:', err)
      wx.showToast({ title: '网络错误，请重试', icon: 'none' })
    }
  },

  onImageLoad() {
    cacheImage(this.data.previewImage)
    this.setData({ previewImage: markImageLoaded(this.data.previewImage) })
  },

  onImageError() {
    const nextImage = getNextRetryState(this.data.previewImage)
    const update = () => this.setData({ previewImage: nextImage })
    if (nextImage.error) {
      update()
      return
    }
    this.scheduleImageRetry('result_preview', update, getRetryDelay(nextImage.retryCount))
  },

  onPreviewImage() {
    if (!this.data.resultUrl) return
    wx.previewImage({
      urls: [this.data.resultUrl]
    })
  },

  saveImage() {
    if (!this.data.resultUrl) return
    report('result_save_click', {
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })

    if (this.data.enableUpscalePrint) {
      this.setData({ showSavePanel: true })
      return
    }

    this.saveOriginalImage()
  },

  closeSavePanel() {
    if (this.data.isUpscaling || this.data.isSavingImage) return
    this.setData({ showSavePanel: false })
  },

  saveOriginalFromPanel() {
    this.setData({ showSavePanel: false })
    this.saveOriginalImage()
  },

  saveOriginalImage() {
    this.saveImageUrlToAlbum(this.data.resultUrl, '保存成功')
  },

  saveImageUrlToAlbum(imageUrl, successTitle = '保存成功') {
    if (!imageUrl || this.data.isSavingImage) return
    this.setData({ isSavingImage: true })
    wx.showLoading({ title: '保存中...' })
    if (imageUrl.startsWith('cloud://')) {
      wx.cloud.downloadFile({
        fileID: imageUrl,
        success: (res) => this.saveTempFileToAlbum(res.tempFilePath, successTitle),
        fail: () => {
          this.setData({ isSavingImage: false })
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      })
      return
    }

    wx.downloadFile({
      url: imageUrl,
      success: (res) => {
        if (res.statusCode === 200) {
          this.saveTempFileToAlbum(res.tempFilePath, successTitle)
        } else {
          this.setData({ isSavingImage: false })
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      },
      fail: () => {
        this.setData({ isSavingImage: false })
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  saveTempFileToAlbum(filePath, successTitle = '保存成功') {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        this.setData({ isSavingImage: false })
        wx.hideLoading()
        wx.showToast({ title: successTitle, icon: 'success' })
      },
      fail: (err) => {
        this.setData({ isSavingImage: false })
        wx.hideLoading()
        if (err.errMsg.indexOf('auth deny') > -1 || err.errMsg.indexOf('auth denied') > -1) {
          wx.showModal({
            title: '权限提示',
            content: '请允许小程序保存图片到相册',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting()
              }
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  normalizeUpscaleErrorMessage(message = '') {
    const text = String(message || '')
    if (/insufficient credit/i.test(text)) {
      return '\u9ad8\u6e05\u670d\u52a1\u4f59\u989d\u4e0d\u8db3\uff0c\u672c\u6b21\u661f\u5149\u5df2\u9000\u56de\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
    }
    if (/REPLICATE_API_TOKEN|unauthorized|forbidden/i.test(text)) {
      return '\u9ad8\u6e05\u670d\u52a1\u672a\u914d\u7f6e\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
    }
    return text || '\u9ad8\u6e05\u7248\u751f\u6210\u5931\u8d25'
  },

  showUpscaleError(message) {
    const content = this.normalizeUpscaleErrorMessage(message)
    wx.showModal({
      title: '\u9ad8\u6e05\u7248\u751f\u6210\u5931\u8d25',
      content,
      showCancel: false,
      confirmText: '\u77e5\u9053\u4e86'
    })
  },

  saveUpscaledFromPanel() {
    if (this.data.isUpscaling || this.data.isSavingImage) return
    if (this.data.upscaledUrl) {
      this.setData({ showSavePanel: false })
      this.saveImageUrlToAlbum(this.data.upscaledUrl, '高清版已保存')
      return
    }
    if (!this.data.id) {
      wx.showToast({ title: '缺少生成记录', icon: 'none' })
      return
    }
    this.createUpscaleTask()
  },

  async createUpscaleTask() {
    this.clearUpscalePollTimer()
    this.setData({ isUpscaling: true })
    wx.showLoading({
      title: '\u9ad8\u6e05\u56fe\u52aa\u529b\u751f\u6210\u4e2d\uff0c\u53ef\u80fd\u82b1\u8d391-3\u5206\u949f\uff0c\u6548\u679c\u7edd\u5bf9\u503c\u5f97\u60a8\u7b49\u5f85...',
      mask: true
    })
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'createUpscaleTask',
          historyId: this.data.id
        }
      })
      const result = res.result || {}
      if (!result.success) {
        wx.hideLoading()
        this.setData({ isUpscaling: false })
        this.showUpscaleError(result.error)
        return
        wx.showToast({ title: result.error || '高清版生成失败', icon: 'none' })
        return
      }
      if (result.resultUrl) {
        this.setData({
          showSavePanel: false,
          isUpscaling: false,
          upscaledUrl: result.resultUrl
        })
        wx.hideLoading()
        this.saveImageUrlToAlbum(result.resultUrl, '高清版已保存')
        return
      }
      const task = result.task || {}
      if (task.resultUrl) {
        this.setData({
          showSavePanel: false,
          isUpscaling: false,
          upscaledUrl: task.resultUrl,
          upscaleTaskId: task.upscaleTaskId || this.data.upscaleTaskId
        })
        wx.hideLoading()
        this.saveImageUrlToAlbum(task.resultUrl, '高清版已保存')
        return
      }
      if (!task.upscaleTaskId) {
        wx.hideLoading()
        this.setData({ isUpscaling: false })
        wx.showToast({ title: '高清任务创建失败', icon: 'none' })
        return
      }
      this.setData({
        upscaleTaskId: task.upscaleTaskId,
        upscalePointsCost: Number(task.pointsCost || this.data.upscalePointsCost || 10)
      })
      this.pollUpscaleTask(task.upscaleTaskId, true)
    } catch (err) {
      wx.hideLoading()
      this.setData({ isUpscaling: false })
      console.error('[Result] create upscale task failed:', err)
      wx.showToast({ title: '高清版生成失败', icon: 'none' })
    }
  },

  pollUpscaleTask(upscaleTaskId, immediate = false) {
    this.clearUpscalePollTimer()
    const run = () => this.fetchUpscaleTaskStatus(upscaleTaskId)
    if (immediate) {
      run()
      return
    }
    this.upscalePollTimer = setTimeout(run, 3000)
  },

  async fetchUpscaleTaskStatus(upscaleTaskId) {
    if (!upscaleTaskId) return
    try {
      await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'ensureUpscaleWorker',
          upscaleTaskId
        }
      }).catch(() => null)

      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'getUpscaleTaskStatus',
          upscaleTaskId
        }
      })
      const result = res.result || {}
      const task = result.task || {}
      if (!result.success) {
        wx.hideLoading()
        this.setData({ isUpscaling: false })
        this.showUpscaleError(result.error)
        return
        wx.showToast({ title: result.error || '高清版生成失败', icon: 'none' })
        return
      }
      if (task.status === 'succeeded' && task.resultUrl) {
        wx.hideLoading()
        this.setData({
          showSavePanel: false,
          isUpscaling: false,
          upscaledUrl: task.resultUrl,
          upscaleTaskId: task.upscaleTaskId || upscaleTaskId
        })
        this.saveImageUrlToAlbum(task.resultUrl, '高清版已保存')
        return
      }
      if (task.status === 'failed') {
        wx.hideLoading()
        this.setData({ isUpscaling: false })
        this.showUpscaleError(task.errorMessage)
        return
        wx.showToast({ title: task.errorMessage || '高清版生成失败', icon: 'none' })
        return
      }
      this.pollUpscaleTask(upscaleTaskId)
    } catch (err) {
      console.error('[Result] poll upscale failed:', err)
      this.pollUpscaleTask(upscaleTaskId)
    }
  },

  clearUpscalePollTimer() {
    if (this.upscalePollTimer) {
      clearTimeout(this.upscalePollTimer)
      this.upscalePollTimer = null
    }
  },

  async saveSharePoster() {
    if (!this.data.resultUrl || this.data.isSavingPoster) return
    if (!this.data.featureId) {
      wx.showToast({ title: '缺少模板信息', icon: 'none' })
      return
    }

    this.setData({ isSavingPoster: true })
    wx.showLoading({ title: '生成海报中...', mask: true })

    try {
      const posterAssets = await Promise.all([
        this.withTimeout(this.getPosterBaseImagePath(), POSTER_STEP_TIMEOUT_MS, '图片准备超时'),
        this.withTimeout(this.getFeatureQrCodePath(this.data.featureId), POSTER_STEP_TIMEOUT_MS, '小程序码生成超时')
      ])
      const resultImagePath = posterAssets[0]
      const qrCodePath = posterAssets[1]
      const posterPath = await this.withTimeout(
        this.drawSharePoster(resultImagePath, qrCodePath),
        POSTER_STEP_TIMEOUT_MS,
        '海报绘制超时'
      )
      wx.hideLoading()
      this.openShareImageMenu(posterPath)
    } catch (err) {
      wx.hideLoading()
      console.error('[Result] 生成分享海报失败:', err)
      wx.showToast({ title: '海报生成失败', icon: 'none' })
    } finally {
      this.setData({ isSavingPoster: false })
    }
  },

  openShareImageMenu(posterPath) {
    const entrancePath = this.data.featureId
      ? `/pages/feature/feature?id=${this.data.featureId}`
      : HOME_PATH

    if (typeof wx.showShareImageMenu === 'function') {
      wx.showShareImageMenu({
        path: posterPath,
        style: 'v2',
        needShowEntrance: true,
        entrancePath,
        fail: (err) => {
          console.warn('[Result] showShareImageMenu failed:', err)
        }
      })
      return
    }

    wx.showToast({ title: '当前环境不支持分享菜单', icon: 'none' })
  },

  withTimeout(promise, timeoutMs, message) {
    let timer = null
    const timeoutPromise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message || '操作超时'))
      }, timeoutMs)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  },

  async getPosterBaseImagePath() {
    const candidates = [
      this.data.previewImage.displayUrl,
      this.data.previewImage.rawUrl,
      this.data.resultUrl
    ].filter(Boolean)

    let lastError = null
    for (let i = 0; i < candidates.length; i += 1) {
      try {
        return await this.getDrawableImagePath(candidates[i])
      } catch (err) {
        lastError = err
        console.warn('[Result] 海报底图准备失败，尝试下一个来源:', candidates[i], err)
      }
    }
    throw lastError || new Error('海报底图准备失败')
  },

  getDrawableImagePath(url) {
    if (!url) return Promise.reject(new Error('empty image url'))
    if (url.startsWith('cloud://')) {
      return this.withTimeout(
        wx.cloud.downloadFile({ fileID: url }).then(res => res.tempFilePath),
        POSTER_STEP_TIMEOUT_MS,
        '云图片下载超时'
      )
    }
    if (url.startsWith('wxfile://') || url.startsWith('http://tmp/') || url.startsWith('/')) {
      return Promise.resolve(url)
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return this.withTimeout(new Promise((resolve, reject) => {
        wx.downloadFile({
          url,
          success: (res) => {
            if (res.statusCode === 200 && res.tempFilePath) {
              resolve(res.tempFilePath)
            } else {
              reject(new Error(`download image failed: ${res.statusCode || 'unknown'}`))
            }
          },
          fail: reject
        })
      }), POSTER_STEP_TIMEOUT_MS, '网络图片下载超时')
    }
    return this.withTimeout(new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: url,
        success: res => resolve(res.path),
        fail: reject
      })
    }), POSTER_STEP_TIMEOUT_MS, '图片信息读取超时')
  },

  async getFeatureQrCodePath(featureId) {
    console.log('[Result] 生成模板小程序码 featureId:', featureId)
    const res = await wx.cloud.callFunction({
      name: 'share',
      data: {
        action: 'getFeatureQrCode',
        featureId
      }
    })
    if (!res.result || !res.result.success || !res.result.fileID) {
      throw new Error(res.result && res.result.error || 'get qr code failed')
    }
    const downloadRes = await wx.cloud.downloadFile({ fileID: res.result.fileID })
    return downloadRes.tempFilePath
  },

  drawSharePoster(resultImagePath, qrCodePath) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select(`#${POSTER_CANVAS_ID}`)
        .fields({ node: true, size: true })
        .exec(async (res) => {
          try {
            const canvas = res && res[0] && res[0].node
            if (!canvas) {
              reject(new Error('canvas node not found'))
              return
            }

            const posterImages = await Promise.all([
              this.loadCanvasImage(canvas, resultImagePath),
              this.loadCanvasImage(canvas, qrCodePath)
            ])
            const resultImage = posterImages[0]
            const qrImage = posterImages[1]

            const pagePadding = 30
            const imageW = resultImage.width
            const imageH = resultImage.height
            const posterW = imageW + pagePadding * 2
            const posterH = imageH + pagePadding * 2
            const imageX = pagePadding
            const imageY = pagePadding
            const qrSize = Math.max(96, Math.min(180, Math.round(Math.min(imageW, imageH) * 0.22)))
            const qrPadding = 16
            const qrTextGap = 10
            const qrTextLineH = Math.max(24, Math.round(qrSize * 0.18))
            const qrCardW = qrSize + qrPadding * 2
            const qrCardH = qrPadding + qrSize + qrTextGap + qrTextLineH * 2 + qrPadding
            const qrMargin = 0
            const qrCardX = Math.max(pagePadding, pagePadding + imageW - qrCardW - qrMargin)
            const qrCardY = Math.max(pagePadding, pagePadding + imageH - qrCardH - qrMargin)
            const qrX = qrCardX + qrPadding
            const qrY = qrCardY + qrPadding
            const textCenterX = qrCardX + qrCardW / 2
            const textStartY = qrY + qrSize + qrTextGap + qrTextLineH / 2

            canvas.width = posterW
            canvas.height = posterH

            const ctx = canvas.getContext('2d')
            const textX = 0
            const textY = posterH + 100
            const textMaxW = 0

            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, posterW, posterH)

            ctx.drawImage(resultImage, imageX, imageY, imageW, imageH)

            ctx.fillStyle = '#121212'
            ctx.font = 'normal 700 31px sans-serif'
            ctx.textBaseline = 'top'
            this.drawTextLine(ctx, this.data.featureName || 'AI生图魔法', textX, textY, textMaxW)

            ctx.fillStyle = '#777777'
            ctx.font = 'normal 400 22px sans-serif'
            this.drawTextLine(ctx, '长按识别小程序码体验同款魔法', textX, textY + 46, textMaxW)

            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.moveTo(qrCardX + 18, qrCardY)
            ctx.lineTo(qrCardX + qrCardW, qrCardY)
            ctx.lineTo(qrCardX + qrCardW, qrCardY + qrCardH)
            ctx.lineTo(qrCardX, qrCardY + qrCardH)
            ctx.lineTo(qrCardX, qrCardY + 18)
            ctx.arcTo(qrCardX, qrCardY, qrCardX + 18, qrCardY, 18)
            ctx.closePath()
            ctx.fill()
            ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)

            ctx.fillStyle = '#111111'
            ctx.font = `normal 500 ${qrTextLineH}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('长按体验同款', textCenterX, textStartY)
            ctx.fillText('生图模板', textCenterX, textStartY + qrTextLineH)

            wx.canvasToTempFilePath({
              canvas,
              width: posterW,
              height: posterH,
              destWidth: posterW,
              destHeight: posterH,
              success: res => resolve(res.tempFilePath),
              fail: reject
            })
          } catch (err) {
            reject(err)
          }
        })
    })
  },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const image = canvas.createImage()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
  },

  drawRoundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.arcTo(x + width, y, x + width, y + r, r)
    ctx.lineTo(x + width, y + height - r)
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
    ctx.lineTo(x + r, y + height)
    ctx.arcTo(x, y + height, x, y + height - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
  },

  drawTextLine(ctx, text, x, y, maxWidth) {
    const source = String(text || '')
    let output = ''
    for (let i = 0; i < source.length; i += 1) {
      const next = output + source[i]
      if (ctx.measureText(next).width > maxWidth) {
        output += '...'
        break
      }
      output = next
    }
    ctx.fillText(output, x, y)
  },

  setResultUrl(resultUrl, extra = {}) {
    const oldPreview = this.data.previewImage
    this.setData(Object.assign({}, extra, {
      resultUrl: resultUrl || '',
      previewImage: createImageState(
        resultUrl,
        IMAGE_STYLES.RESULT_PREVIEW,
        oldPreview
      )
    }))
  },

  scheduleImageRetry(key, callback, delay) {
    this.imageRetryTimers = this.imageRetryTimers || {}
    if (this.imageRetryTimers[key]) {
      clearTimeout(this.imageRetryTimers[key])
    }
    this.imageRetryTimers[key] = setTimeout(() => {
      delete this.imageRetryTimers[key]
      callback()
    }, delay)
  },

  clearImageRetryTimers() {
    const timers = this.imageRetryTimers || {}
    Object.keys(timers).forEach(key => clearTimeout(timers[key]))
    this.imageRetryTimers = {}
  },

  goHome() {
    const targetZone = !this.data.isSharedResult && this.data.sourceZone === 'boss' ? 'boss' : 'play'
    wx.switchTab({
      url: targetZone === 'boss' ? '/pages/boss-zone/boss-zone' : '/pages/play-zone/play-zone'
    })
  },

  buildResultShareQuery() {
    const params = []
    if (this.data.featureId) {
      params.push('shared=1')
    }
    if (this.data.id) {
      params.push(`id=${encodeURIComponent(this.data.id)}`)
    }
    if (this.data.resultUrl) {
      params.push(`url=${encodeURIComponent(this.data.resultUrl)}`)
    }
    if (this.data.featureId) {
      params.push(`featureId=${encodeURIComponent(this.data.featureId)}`)
    }
    if (this.data.featureName) {
      params.push(`featureName=${encodeURIComponent(this.data.featureName)}`)
    }
    return params.join('&')
  },

  buildResultSharePath() {
    const query = this.buildResultShareQuery()
    return query ? `/pages/result/result?${query}` : HOME_PATH
  },

  onShareAppMessage() {
    const channel = this.pendingShareChannel || 'friend'
    this.pendingShareChannel = ''
    this.setData({ showSharePanel: false })
    report('result_share_invoke', {
      channel,
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    this.scheduleShareReward(channel)
    return {
      title: '我用Ai造梦生成了一张神奇的图片',
      path: this.buildResultSharePath(),
      imageUrl: this.data.previewImage.displayUrl || this.data.resultUrl || ''
    }
  },

  onShareTimeline() {
    this.setData({ showSharePanel: false })
    report('result_share_invoke', {
      channel: 'timeline',
      history_id: this.data.id || '',
      feature_id: this.data.featureId || ''
    })
    this.scheduleShareReward('timeline')
    return {
      title: pickRandom(RESULT_TIMELINE_TITLES),
      query: this.buildResultShareQuery(),
      imageUrl: this.data.previewImage.displayUrl || this.data.resultUrl || ''
    }
  }
})
