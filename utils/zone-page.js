const app = getApp()
const {
  IMAGE_STYLES,
  createImageState,
  markImageLoaded,
  cacheImage,
  getNextRetryState,
  getRetryDelay
} = require('./image-loader.js')
const { report } = require('./analytics.js')

function createZonePage(options = {}) {
  const zone = options.zone || 'play'
  const source = options.source || `${zone}_zone`
  const groupsCacheKey = `${zone}_feature_groups_cache`
  const featuresCachePrefix = `${zone}_features_cache_`

  return {
    data: {
      generationNotice: { visible: false, taskId: '', message: '' },
      groups: [],
      currentGroup: '',
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
      this.fetchGroups({ refreshFeatures: true }).finally(() => {
        wx.stopPullDownRefresh()
      })
    },

    fetchGroups(options = {}) {
      const cachedGroups = wx.getStorageSync(groupsCacheKey)
      if (cachedGroups && Array.isArray(cachedGroups)) {
        this.applyGroups(cachedGroups)
      }

      return wx.cloud.callFunction({
        name: 'featureConfig',
        data: { action: 'getGroups', payload: { zone } }
      }).then(res => {
        if (res.result && res.result.success) {
          const groups = res.result.data || []
          this.applyGroups(groups)
          wx.setStorageSync(groupsCacheKey, groups)
          if (options.refreshFeatures) {
            return this.fetchFeatures()
          }
        }
        return null
      }).catch(console.error)
    },

    applyGroups(groups = []) {
      const nextGroups = [...new Set((groups || []).filter(Boolean))]
      const currentGroup = nextGroups.includes(this.data.currentGroup)
        ? this.data.currentGroup
        : (nextGroups[0] || '')
      const groupChanged = currentGroup !== this.data.currentGroup
      this.setData({
        groups: nextGroups,
        currentGroup,
        leftList: groupChanged ? [] : this.data.leftList,
        rightList: groupChanged ? [] : this.data.rightList
      })
      if (groupChanged && currentGroup) {
        this.fetchFeatures()
      }
      if (!currentGroup) {
        this.setData({ isLoading: false, leftList: [], rightList: [] })
      }
    },

    fetchFeatures() {
      if (!this.data.currentGroup) {
        this.setData({ isLoading: false, leftList: [], rightList: [] })
        return Promise.resolve()
      }

      const cacheKey = `${featuresCachePrefix}${this.data.currentGroup}`
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
          payload: { zone, group: this.data.currentGroup }
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

        const processedItem = Object.assign({}, item, {
          homeIndex: index,
          image
        })
        if (index % 2 === 0) {
          leftList.push(processedItem)
        } else {
          rightList.push(processedItem)
        }
      })
      this.setData({ leftList, rightList })
      this.reportFeatureExposures(list)
    },

    reportFeatureExposures(list) {
      this.reportedExposureKeys = this.reportedExposureKeys || {}
      list.forEach((item, index) => {
        const key = `${zone}_${this.data.currentGroup}_${item._id}`
        if (this.reportedExposureKeys[key]) return
        this.reportedExposureKeys[key] = true
        report('feature_exposure', {
          feature_id: item._id,
          feature_name: item.name || '',
          feature_group: this.data.currentGroup,
          feature_zone: zone,
          position: index + 1,
          source
        })
      })
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

    onGroupSelect(e) {
      const group = e.currentTarget.dataset.group || ''
      if (!group || this.data.currentGroup === group) return
      this.setData({
        currentGroup: group,
        leftList: [],
        rightList: []
      })
      this.fetchFeatures()
    },

    goToFeature(e) {
      const id = e.currentTarget.dataset.id
      const list = this.data.leftList.concat(this.data.rightList)
      const item = list.find(feature => feature._id === id) || {}
      report('feature_click', {
        feature_id: id,
        feature_name: item.name || '',
        feature_group: this.data.currentGroup,
        feature_zone: zone,
        position: typeof item.homeIndex === 'number' ? item.homeIndex + 1 : 0,
        source
      })
      wx.navigateTo({
        url: `/pages/feature/feature?id=${id}&sourceZone=${zone}`
      })
    }
  }
}

module.exports = {
  createZonePage
}
