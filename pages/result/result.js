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

const POSTER_CANVAS_ID = 'sharePosterCanvas'
const POSTER_WIDTH = 750
const POSTER_HEIGHT = 940
const POSTER_STEP_TIMEOUT_MS = 12000

Page({
  data: {
    id: '',
    featureId: '',
    featureName: 'AI生图魔法',
    resultUrl: '',
    previewImage: createImageState('', IMAGE_STYLES.RESULT_PREVIEW),
    rating: '', // 'hang' | 'la' | ''
    isSavingPoster: false
  },

  onLoad(options) {
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

  onUnload() {
    this.clearImageRetryTimers()
  },

  async fetchHistoryDetail(id) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('generation_history').doc(id).get()
      if (res.data) {
        this.setResultUrl(res.data.resultUrl || this.data.resultUrl, {
          rating: res.data.rating || '',
          featureId: res.data.featureId || '',
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
        wx.showToast({ title: res.result?.error || '评价失败', icon: 'none' })
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
    
    wx.showLoading({ title: '保存中...' })
    if (this.data.resultUrl.startsWith('cloud://')) {
      wx.cloud.downloadFile({
        fileID: this.data.resultUrl,
        success: (res) => this.saveTempFileToAlbum(res.tempFilePath, '保存成功'),
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      })
      return
    }

    wx.downloadFile({
      url: this.data.resultUrl,
      success: (res) => {
        if (res.statusCode === 200) {
          this.saveTempFileToAlbum(res.tempFilePath, '保存成功')
        } else {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  saveTempFileToAlbum(filePath, successTitle = '保存成功') {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: successTitle, icon: 'success' })
      },
      fail: (err) => {
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

  async saveSharePoster() {
    if (!this.data.resultUrl || this.data.isSavingPoster) return
    if (!this.data.featureId) {
      wx.showToast({ title: '缺少模板信息', icon: 'none' })
      return
    }

    this.setData({ isSavingPoster: true })
    wx.showLoading({ title: '生成海报中...', mask: true })

    try {
      const [resultImagePath, qrCodePath] = await Promise.all([
        this.withTimeout(this.getPosterBaseImagePath(), POSTER_STEP_TIMEOUT_MS, '图片准备超时'),
        this.withTimeout(this.getFeatureQrCodePath(this.data.featureId), POSTER_STEP_TIMEOUT_MS, '小程序码生成超时')
      ])
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

            const dpr = wx.getSystemInfoSync().pixelRatio || 1
            canvas.width = POSTER_WIDTH * dpr
            canvas.height = POSTER_HEIGHT * dpr

            const ctx = canvas.getContext('2d')
            ctx.scale(dpr, dpr)

            const [resultImage, qrImage] = await Promise.all([
              this.loadCanvasImage(canvas, resultImagePath),
              this.loadCanvasImage(canvas, qrCodePath)
            ])

            const cardX = 76
            const cardY = 66
            const cardW = POSTER_WIDTH - cardX * 2
            const cardH = POSTER_HEIGHT - cardY * 2
            const innerPadding = 28
            const footerH = 148
            const imageX = cardX + innerPadding
            const imageY = cardY + innerPadding
            const imageW = cardW - innerPadding * 2
            const imageH = cardH - footerH - innerPadding * 2
            const qrSize = 108
            const qrX = cardX + cardW - innerPadding - qrSize
            const qrY = cardY + cardH - innerPadding - qrSize
            const textX = imageX
            const textY = cardY + cardH - footerH + 36
            const textMaxW = qrX - textX - 30
            const imageRatio = resultImage.width / resultImage.height
            const posterRatio = imageW / imageH
            let sx = 0
            let sy = 0
            let sw = resultImage.width
            let sh = resultImage.height

            if (imageRatio > posterRatio) {
              sw = resultImage.height * posterRatio
              sx = (resultImage.width - sw) / 2
            } else {
              sh = resultImage.width / posterRatio
              sy = (resultImage.height - sh) / 2
            }

            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

            ctx.save()
            ctx.shadowColor = 'rgba(32,32,32,0.12)'
            ctx.shadowBlur = 24
            ctx.shadowOffsetY = 10
            ctx.fillStyle = '#ffffff'
            this.drawRoundRect(ctx, cardX, cardY, cardW, cardH, 46)
            ctx.fill()
            ctx.restore()

            ctx.save()
            this.drawRoundRect(ctx, imageX, imageY, imageW, imageH, 34)
            ctx.fillStyle = '#eeeeee'
            ctx.fill()
            ctx.clip()
            ctx.drawImage(resultImage, sx, sy, sw, sh, imageX, imageY, imageW, imageH)
            ctx.restore()

            ctx.fillStyle = '#121212'
            ctx.font = 'normal 700 31px sans-serif'
            ctx.textBaseline = 'top'
            this.drawTextLine(ctx, this.data.featureName || 'AI生图魔法', textX, textY, textMaxW)

            ctx.fillStyle = '#777777'
            ctx.font = 'normal 400 22px sans-serif'
            this.drawTextLine(ctx, '长按识别小程序码体验同款魔法', textX, textY + 46, textMaxW)

            ctx.fillStyle = '#ffffff'
            this.drawRoundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 22)
            ctx.fill()
            ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)

            wx.canvasToTempFilePath({
              canvas,
              width: POSTER_WIDTH,
              height: POSTER_HEIGHT,
              destWidth: POSTER_WIDTH * dpr,
              destHeight: POSTER_HEIGHT * dpr,
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
    this.setData({
      ...extra,
      resultUrl: resultUrl || '',
      previewImage: createImageState(
        resultUrl,
        IMAGE_STYLES.RESULT_PREVIEW,
        oldPreview
      )
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

  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    })
  },

  buildResultShareQuery() {
    const params = []
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
    return {
      title: '我用Ai造梦生成了一张神奇的图片',
      path: this.buildResultSharePath(),
      imageUrl: this.data.previewImage.displayUrl || this.data.resultUrl || ''
    }
  },

  onShareTimeline() {
    return {
      title: pickRandom(RESULT_TIMELINE_TITLES),
      query: this.buildResultShareQuery(),
      imageUrl: this.data.previewImage.displayUrl || this.data.resultUrl || ''
    }
  }
})
