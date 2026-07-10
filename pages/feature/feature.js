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
  FEATURE_TIMELINE_TITLES,
  fillTemplate,
  pickRandom
} = require('../../utils/share.js')
const { report, reportGenerationFailed } = require('../../utils/analytics.js')
const { showRewardedVideo } = require('../../utils/rewarded-video.js')

const FEATURE_DETAIL_CACHE_PREFIX = 'feature_detail_cache_'

Page({
  data: {
    boostModalVisible: false,
    boostTaskId: '',
    generationNotice: { visible: false, taskId: '', message: '' },
    id: '',
    sourceZone: '',
    feature: null,
    images: [],
    inputFields: [],
    inputValues: {},
    isTextToImage: false,
    canSubmit: false,
    isGenerating: false,
    bannerImage: createImageState('', IMAGE_STYLES.DETAIL_BANNER)
  },

  async onLoad(options) {
    app.syncGenerationNoticeToPage(this)
    const sceneId = await this.parseFeatureScene(options.scene)
    const id = options.id ? decodeURIComponent(options.id) : sceneId
    const sourceZone = options.sourceZone === 'boss' || options.sourceZone === 'play'
      ? options.sourceZone
      : ''
    if (id) {
      this.setData({ id, sourceZone })
      this.fetchDetail(id)
    } else {
      this.goToUnavailable()
    }
  },

  async parseFeatureScene(scene) {
    if (!scene) return ''
    const decodedScene = decodeURIComponent(scene)
    if (decodedScene.indexOf('feature_') === 0) {
      return decodedScene.replace('feature_', '')
    }
    if (
      decodedScene.indexOf('f_') === 0 ||
      decodedScene.indexOf('a_') === 0 ||
      decodedScene.indexOf('u_') === 0 ||
      decodedScene.indexOf('x_') === 0
    ) {
      const code = decodedScene.replace(/^[a-z]_/, '')
      try {
        const res = await wx.cloud.callFunction({
          name: 'share',
          data: {
            action: 'resolveFeatureScene',
            code
          }
        })
        return res.result && res.result.success ? (res.result.featureId || '') : ''
      } catch (err) {
        console.error('[Feature] 解析分享短码失败:', err)
        return ''
      }
    }
    return decodedScene
  },

  onShow() {
    app.syncGenerationNoticeToPage(this)
  },

  updateGenerationNotice(notice) {
    this.setData({ generationNotice: notice || { visible: false, taskId: '', message: '' } })
  },

  onGenerationNoticeTap() {
    app.goToGenerationHistoryFromNotice()
  },

  onUnload() {
    this.clearImageRetryTimers()
  },

  onBannerLoad() {
    cacheImage(this.data.bannerImage)
    this.setData({ bannerImage: markImageLoaded(this.data.bannerImage) })
  },

  onBannerError() {
    const nextImage = getNextRetryState(this.data.bannerImage)
    const update = () => this.setData({ bannerImage: nextImage })
    if (nextImage.error) {
      update()
      return
    }
    this.scheduleImageRetry('detail_banner', update, getRetryDelay(nextImage.retryCount))
  },

  fetchDetail(id) {
    const cacheKey = `${FEATURE_DETAIL_CACHE_PREFIX}${id}`
    const cachedFeature = wx.getStorageSync(cacheKey)
    if (cachedFeature && cachedFeature._id && cachedFeature.status === 1) {
      this.applyFeature(cachedFeature)
    } else {
      wx.showLoading({ title: '加载中' })
    }

    wx.cloud.callFunction({
      name: 'featureConfig',
      data: {
        action: 'getDetail',
        payload: { id }
      }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success && res.result.data && res.result.data.status === 1) {
        wx.setStorageSync(cacheKey, res.result.data)
        this.applyFeature(res.result.data)
        wx.setNavigationBarTitle({
          title: res.result.data.name || '功能详情'
        })
      } else {
        this.goToUnavailable()
      }
    }).catch(err => {
      wx.hideLoading()
      console.error(err)
      this.goToUnavailable()
    })
  },

  applyFeature(feature) {
    const oldBanner = this.data.bannerImage
    const templateType = feature.template_type === 'text_to_image' ? 'text_to_image' : 'image_to_image'
    const inputFields = this.normalizeInputFields(feature.input_fields)
    const inputValues = {}
    inputFields.forEach(field => {
      inputValues[field.key] = ''
    })
    this.setData({
      feature,
      inputFields,
      inputValues,
      isTextToImage: templateType === 'text_to_image',
      canSubmit: templateType === 'text_to_image' ? this.canSubmitTextForm(inputFields, inputValues) : this.data.images.length > 0,
      bannerImage: createImageState(
        feature.detail_banner,
        IMAGE_STYLES.DETAIL_BANNER,
        oldBanner
      )
    })
    this.reportFeatureDetailView(feature)
  },

  normalizeInputFields(fields) {
    if (!Array.isArray(fields)) return []
    return fields
      .map((field, index) => {
        const key = String(field && field.key || '').trim()
        const title = String(field && (field.title || field.label) || '').trim()
        const placeholder = String(field && field.placeholder || '').trim() || `请输入${title || key}`
        return {
          key,
          title,
          placeholder,
          value: '',
          maxLength: Number(field && (field.maxLength || field.max_length || field.limit)) || 0,
          required: field && field.required !== false,
          sort: Number(field && field.sort) || index
        }
      })
      .filter(field => field.key)
      .sort((a, b) => a.sort - b.sort)
  },

  canSubmitTextForm(inputFields, inputValues) {
    const fields = inputFields || this.data.inputFields || []
    const values = inputValues || this.data.inputValues || {}
    if (fields.length === 0) return false
    return fields.every(field => !field.required || String(values[field.key] || '').trim())
  },

  updateCanSubmit(nextData = {}) {
    const isTextToImage = Object.prototype.hasOwnProperty.call(nextData, 'isTextToImage') ? nextData.isTextToImage : this.data.isTextToImage
    const images = nextData.images || this.data.images || []
    const inputFields = nextData.inputFields || this.data.inputFields || []
    const inputValues = nextData.inputValues || this.data.inputValues || {}
    return isTextToImage ? this.canSubmitTextForm(inputFields, inputValues) : images.length > 0
  },

  onInputFieldChange(e) {
    const key = e.currentTarget.dataset.key
    const index = Number(e.currentTarget.dataset.index)
    const maxLength = Number(e.currentTarget.dataset.maxLength || 0)
    let value = e.detail && e.detail.value ? e.detail.value : ''
    if (maxLength > 0 && value.length > maxLength) {
      value = value.slice(0, maxLength)
    }
    const inputValues = { ...(this.data.inputValues || {}), [key]: value }
    const inputFields = (this.data.inputFields || []).slice()
    if (inputFields[index]) {
      inputFields[index] = { ...inputFields[index], value }
    }
    this.setData({
      inputFields,
      inputValues,
      canSubmit: this.updateCanSubmit({ inputFields, inputValues })
    })
  },

  reportFeatureDetailView(feature) {
    if (!feature || this.reportedDetailViewId === feature._id) return
    this.reportedDetailViewId = feature._id
    report('feature_detail_view', {
      feature_id: feature._id || this.data.id,
      feature_name: feature.name || '',
      feature_group: feature.group || '',
      source: 'detail'
    })
  },

  goToUnavailable() {
    wx.redirectTo({
      url: '/pages/feature-unavailable/feature-unavailable'
    })
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

  chooseImage() {
    const maxCount = this.data.feature ? (this.data.feature.upload_count || 1) : 1
    const currentCount = this.data.images.length
    if (currentCount >= maxCount) return

    wx.chooseMedia({
      count: maxCount - currentCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = res.tempFiles.map(f => f.tempFilePath)
        const images = (this.data.images || []).concat(tempFiles)
        this.setData({
          images,
          canSubmit: this.updateCanSubmit({ images })
        })
      }
    })
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index
    const images = (this.data.images || []).slice()
    images.splice(index, 1)
    this.setData({
      images,
      canSubmit: this.updateCanSubmit({ images })
    })
  },

  validateTextInputs() {
    const fields = this.data.inputFields || []
    const values = this.data.inputValues || {}
    if (fields.length === 0) {
      wx.showToast({ title: '模板字段未配置', icon: 'none' })
      return false
    }
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i]
      const value = String(values[field.key] || '').trim()
      if (field.required && !value) {
        wx.showToast({ title: `请填写${field.title || field.key}`, icon: 'none' })
        return false
      }
      if (field.maxLength > 0 && value.length > field.maxLength) {
        wx.showToast({ title: `${field.title || field.key}超出字数限制`, icon: 'none' })
        return false
      }
    }
    return true
  },

  async submitGenerate() {
    if (this.data.isGenerating) return
    const feature = this.data.feature || {}
    report('generate_click', {
      feature_id: this.data.id,
      feature_name: feature.name || '',
      feature_group: feature.group || '',
      image_count: this.data.images.length,
      template_type: this.data.isTextToImage ? 'text_to_image' : 'image_to_image'
    })
    if (this.data.isTextToImage) {
      if (!this.validateTextInputs()) return
    } else if (this.data.images.length === 0) {
      return wx.showToast({ title: '请上传图片', icon: 'none' })
    }
    
    const hasEnoughPoints = await this.ensureEnoughPointsBeforeGenerate(feature)
    if (!hasEnoughPoints) return

    this.setData({ isGenerating: true })
    
    try {
      const fileIDs = []
      if (!this.data.isTextToImage) {
        wx.showLoading({ title: '上传图片中...' })
      } else {
        wx.showLoading({ title: '提交任务中...' })
      }
      const uploadTasks = this.data.isTextToImage ? [] : this.data.images.map((filePath, index) => {
        // Use a simple random name, in a real app might need stronger ID
        const extMatch = filePath.match(/\.[^.]+?$/)
        const cloudPath = `uploads/${Date.now()}_${Math.floor(Math.random()*1000)}${extMatch ? extMatch[0] : '.jpg'}`
        return wx.cloud.uploadFile({
          cloudPath,
          filePath,
        }).then(res => res.fileID)
      })
      
      if (uploadTasks.length > 0) {
        fileIDs.push(...await Promise.all(uploadTasks))
      }
      report('generation_submit', {
        feature_id: this.data.id,
        feature_name: feature.name || '',
        feature_group: feature.group || '',
        image_count: fileIDs.length,
        template_type: this.data.isTextToImage ? 'text_to_image' : 'image_to_image'
      })
      
      const createRes = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'createTask',
          featureId: this.data.id,
          imageUrls: fileIDs,
          inputValues: this.data.inputValues || {}
        }
      })
      const result = createRes.result
      if (!result || !result.success || !result.taskId) {
        report('generation_submit_failed', {
          feature_id: this.data.id,
          feature_name: feature.name || '',
          feature_group: feature.group || '',
          template_type: this.data.isTextToImage ? 'text_to_image' : 'image_to_image',
          source: 'feature',
          error_type: 'create_task',
          error_msg: (result && (result.error || result.message)) || 'create task failed'
        })
        wx.hideLoading()
        this.setData({ isGenerating: false })
        wx.showToast({ title: (result && (result.error || result.message)) || '提交任务失败', icon: 'none' })
        return
      }

      wx.hideLoading()
      this.setData({ isGenerating: false })
      // 弹窗或激励视频期间由当前页面负责跳转，避免 watcher 抢先显示完成横幅。
      app.trackGenerationTask(result.taskId, { suppressBanner: true })
      this.showGenerationBoostModal(result.taskId)
      
    } catch (err) {
      wx.hideLoading()
      this.setData({ isGenerating: false })
      console.error(err)
      report('generation_submit_failed', {
        feature_id: this.data.id,
        feature_name: feature.name || '',
        feature_group: feature.group || '',
        template_type: this.data.isTextToImage ? 'text_to_image' : 'image_to_image',
        source: 'feature',
        error_type: 'upload_or_submit',
        error_msg: err && (err.errMsg || err.message) || ''
      })
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  showGenerationBoostModal(taskId) {
    this.setData({
      boostModalVisible: true,
      boostTaskId: taskId
    })
  },

  async onBoostModalConfirm() {
    const taskId = this.data.boostTaskId
    if (!taskId) return
    this.setData({ boostModalVisible: false })
    await this.handleBoostGeneration(taskId)
  },

  onBoostModalCancel() {
    const taskId = this.data.boostTaskId
    this.setData({ boostModalVisible: false })
    if (taskId) {
      this.goToAnalyzingWithTask(taskId, false)
    }
  },

  async handleBoostGeneration(taskId) {
    try {
      const adRes = await showRewardedVideo({ scene: 'generation_boost' })
      if (!adRes || !adRes.completed) {
        wx.showToast({ title: '完整观看后可加速生成', icon: 'none' })
        this.goToAnalyzingWithTask(taskId, false)
        return
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '广告加载失败，继续生成中', icon: 'none' })
      this.goToAnalyzingWithTask(taskId, false)
      return
    }

    wx.showLoading({ title: '检查结果中...', mask: true })
    try {
      const statusRes = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'getTaskStatus',
          taskId
        }
      })
      wx.hideLoading()
      const task = statusRes && statusRes.result && statusRes.result.task
      if (task && task.status === 'succeeded' && task.historyId) {
        app.finishTrackedGenerationTask(taskId, { silent: true })
        wx.navigateTo({
          url: `/pages/result/result?id=${encodeURIComponent(task.historyId)}&featureId=${encodeURIComponent(task.featureId || this.data.id)}${this.data.sourceZone ? `&sourceZone=${this.data.sourceZone}` : ''}`
        })
        return
      }
      if (task && task.status === 'failed') {
        reportGenerationFailed(Object.assign({}, task, { taskId: taskId }), 'analyzing')
        app.finishTrackedGenerationTask(taskId, { silent: true })
        wx.showModal({
          title: '生图失败',
          content: '因网络原因导致生图失败，您的星光已返还，请返回重试',
          showCancel: false,
          confirmText: '确认'
        })
        return
      }
      this.goToAnalyzingWithTask(taskId, true)
    } catch (err) {
      wx.hideLoading()
      console.error('[Feature] boost status check failed:', err)
      this.goToAnalyzingWithTask(taskId, true)
    }
  },

  goToAnalyzingWithTask(taskId, boosted) {
    // 已进入生成中页后恢复默认提醒：用户之后离开该页面仍可收到完成横幅。
    app.setGenerationTaskBannerSuppressed(taskId, false)
    wx.navigateTo({
      url: `/pages/analyzing/analyzing?featureId=${encodeURIComponent(this.data.id)}&taskId=${encodeURIComponent(taskId)}&boosted=${boosted ? '1' : '0'}${this.data.sourceZone ? `&sourceZone=${this.data.sourceZone}` : ''}`
    })
  },

  async ensureEnoughPointsBeforeGenerate(feature) {
    const pointsCost = Number(feature.points_cost || 0)
    if (!pointsCost || pointsCost <= 0) return true

    try {
      wx.showLoading({ title: '校验星光中...' })
      const res = await wx.cloud.callFunction({
        name: 'points',
        data: { action: 'getUserPoints' }
      })
      wx.hideLoading()

      const currentPoints = Number(res.result && res.result.data && res.result.data.points || 0)
      app.globalData.userPoints = currentPoints
      wx.setStorageSync('userPoints', currentPoints)

      if (currentPoints >= pointsCost) return true

      wx.showModal({
        title: '提示',
        content: '您的星光已经不足，前往补充星光吧',
        cancelText: '取消',
        confirmText: '前往',
        success: modalRes => {
          if (modalRes.confirm) {
            wx.navigateTo({ url: '/pages/points/points' })
          }
        }
      })
      return false
    } catch (err) {
      wx.hideLoading()
      console.error('[Feature] 星光校验失败:', err)
      wx.showToast({ title: '星光校验失败', icon: 'none' })
      return false
    }
  },

  onShareAppMessage() {
    const featureName = (this.data.feature && this.data.feature.name) || 'AI生图玩法'
    return {
      title: `我发现了一个好玩的AI生图玩法：${featureName}`,
      path: `/pages/feature/feature?id=${encodeURIComponent(this.data.id)}`
    }
  },

  onShareTimeline() {
    const featureName = (this.data.feature && this.data.feature.name) || 'AI生图玩法'
    return {
      title: fillTemplate(pickRandom(FEATURE_TIMELINE_TITLES), { name: featureName }),
      query: `id=${encodeURIComponent(this.data.id)}`,
      imageUrl: this.data.bannerImage.displayUrl || this.data.bannerImage.rawUrl || ''
    }
  }
})
