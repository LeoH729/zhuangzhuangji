const app = getApp()
const {
  IMAGE_STYLES,
  createImageState,
  markImageLoaded,
  cacheImage,
  getNextRetryState,
  getRetryDelay
} = require('../../utils/image-loader.js')

const GROUPS_CACHE_KEY = 'index_feature_groups_cache'
const FEATURES_CACHE_PREFIX = 'index_features_cache_'

Page({
  data: {
    generationNotice: { visible: false, taskId: '', message: '' },
    groups: [],
    currentGroup: '全部',
    leftList: [],
    rightList: [],
    isLoading: true
  },

  onLoad() {
    this.fetchGroups()
  },

  onUnload() {
    this.clearImageRetryTimers()
  },

  onShow() {
    app.syncGenerationNoticeToPage(this)
    this.fetchFeatures()
  },

  updateGenerationNotice(notice) {
    this.setData({ generationNotice: notice || { visible: false, taskId: '', message: '' } })
  },

  onGenerationNoticeTap() {
    app.goToGenerationHistoryFromNotice()
  },

  onPullDownRefresh() {
    this.fetchGroups()
    this.fetchFeatures().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  fetchGroups() {
    const cachedGroups = wx.getStorageSync(GROUPS_CACHE_KEY)
    if (cachedGroups && Array.isArray(cachedGroups)) {
      this.setData({ groups: cachedGroups })
    }

    wx.cloud.callFunction({
      name: 'featureConfig',
      data: { action: 'getGroups' }
    }).then(res => {
      if (res.result && res.result.success) {
        const groups = res.result.data || []
        this.setData({ groups })
        wx.setStorageSync(GROUPS_CACHE_KEY, groups)
      }
    }).catch(console.error)
  },

  fetchFeatures() {
    const cacheKey = `${FEATURES_CACHE_PREFIX}${this.data.currentGroup}`
    const cachedList = wx.getStorageSync(cacheKey)
    if (cachedList && Array.isArray(cachedList) && cachedList.length > 0) {
      this.splitWaterfall(cachedList)
      this.setData({ isLoading: false })
    } else {
      this.setData({ isLoading: true })
    }

    return wx.cloud.callFunction({
      name: 'featureConfig',
      data: {
        action: 'getList',
        payload: { group: this.data.currentGroup }
      }
    }).then(res => {
      if (res.result && res.result.success) {
        const list = res.result.data || []
        wx.setStorageSync(cacheKey, list)
        this.splitWaterfall(list)
      }
    }).catch(err => {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }).finally(() => {
      this.setData({ isLoading: false })
    })
  },

  splitWaterfall(list) {
    // 构建老数据的 ID→状态 映射，用于智能保留已加载图片的状态
    const oldMap = {}
    this.data.leftList.forEach(item => {
      oldMap[item._id] = item
    })
    this.data.rightList.forEach(item => {
      oldMap[item._id] = item
    })

    const leftList = []
    const rightList = []
    list.forEach((item, index) => {
      const oldItem = oldMap[item._id]
      const image = createImageState(
        item.home_banner,
        IMAGE_STYLES.HOME_CARD,
        oldItem && oldItem.image
      )

      const processedItem = {
        ...item,
        image
      }
      if (index % 2 === 0) {
        leftList.push(processedItem)
      } else {
        rightList.push(processedItem)
      }
    })
    this.setData({ leftList, rightList })
  },

  onImageLoad(e) {
    const { id, col } = e.currentTarget.dataset
    const listName = col === 'left' ? 'leftList' : 'rightList'
    const list = this.data[listName].map(item => {
      if (item._id === id) {
        cacheImage(item.image)
        item.image = markImageLoaded(item.image)
      }
      return item
    })
    this.setData({ [listName]: list })
  },

  onImageError(e) {
    const { id, col } = e.currentTarget.dataset
    const listName = col === 'left' ? 'leftList' : 'rightList'
    const item = this.data[listName].find(card => card._id === id)
    if (!item || !item.image) return

    const nextImage = getNextRetryState(item.image)
    const update = () => {
      const list = this.data[listName].map(card => {
        if (card._id === id) {
          card.image = nextImage
        }
        return card
      })
      this.setData({ [listName]: list })
    }

    if (nextImage.error) {
      update()
      return
    }

    this.scheduleImageRetry(`${listName}_${id}`, update, getRetryDelay(nextImage.retryCount))
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

  onTabClick(e) {
    const group = e.currentTarget.dataset.group
    if (this.data.currentGroup === group) return
    this.setData({
      currentGroup: group,
      leftList: [],
      rightList: []
    })
    this.fetchFeatures()
  },

  goToFeature(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/feature/feature?id=${id}`
    })
  }
})
