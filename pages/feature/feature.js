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
const { report } = require('../../utils/analytics.js')

const FEATURE_DETAIL_CACHE_PREFIX = 'feature_detail_cache_'

Page({
  data: {
    generationNotice: { visible: false, taskId: '', message: '' },
    id: '',
    feature: null,
    images: [],
    isGenerating: false,
    bannerImage: createImageState('', IMAGE_STYLES.DETAIL_BANNER)
  },

  async onLoad(options) {
    app.syncGenerationNoticeToPage(this)
    const sceneId = await this.parseFeatureScene(options.scene)
    const id = options.id ? decodeURIComponent(options.id) : sceneId
    if (id) {
      this.setData({ id })
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
    this.setData({
      feature,
      bannerImage: createImageState(
        feature.detail_banner,
        IMAGE_STYLES.DETAIL_BANNER,
        oldBanner
      )
    })
    this.reportFeatureDetailView(feature)
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
        this.setData({
          images: [...this.data.images, ...tempFiles]
        })
      }
    })
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index
    const images = [...this.data.images]
    images.splice(index, 1)
    this.setData({ images })
  },

  async submitGenerate() {
    const feature = this.data.feature || {}
    report('generate_click', {
      feature_id: this.data.id,
      feature_name: feature.name || '',
      feature_group: feature.group || '',
      image_count: this.data.images.length
    })
    if (this.data.images.length === 0) {
      return wx.showToast({ title: '请上传图片', icon: 'none' })
    }
    
    this.setData({ isGenerating: true })
    
    try {
      // 1. Upload images to cloud storage
      wx.showLoading({ title: '上传图片中...' })
      const uploadTasks = this.data.images.map((filePath, index) => {
        // Use a simple random name, in a real app might need stronger ID
        const cloudPath = `uploads/${Date.now()}_${Math.floor(Math.random()*1000)}${filePath.match(/\.[^.]+?$/)?.[0] || '.jpg'}`
        return wx.cloud.uploadFile({
          cloudPath,
          filePath,
        }).then(res => res.fileID)
      })
      
      const fileIDs = await Promise.all(uploadTasks)
      report('generation_submit', {
        feature_id: this.data.id,
        feature_name: feature.name || '',
        feature_group: feature.group || '',
        image_count: fileIDs.length
      })
      
      // 2. Go to generating page (analyzing)
      wx.hideLoading()
      this.setData({ isGenerating: false })
      
      const encodedFileIDs = encodeURIComponent(JSON.stringify(fileIDs))
      wx.navigateTo({
        url: `/pages/analyzing/analyzing?featureId=${this.data.id}&images=${encodedFileIDs}`
      })
      
    } catch (err) {
      wx.hideLoading()
      this.setData({ isGenerating: false })
      console.error(err)
      wx.showToast({ title: '上传失败', icon: 'none' })
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
