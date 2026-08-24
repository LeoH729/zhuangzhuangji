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
const AD_CONFIG = require('./ad-config.js')
const { getAdExperimentConfig, refreshAdExperimentConfig } = require('./ad-experiment.js')

const HOME_CACHE_TTL_MS = 5 * 60 * 1000
const FIRST_RENDER_COUNT = 8
const inFlightRequests = {}

function getStorage(key) {
  return new Promise(resolve => {
    wx.getStorage({ key, success: res => resolve(res.data || null), fail: () => resolve(null) })
  })
}

function setStorage(key, data) {
  wx.setStorage({ key, data, fail: () => {} })
}

function createZonePage(options = {}) {
  const zone = options.zone || 'play'
  const source = options.source || `${zone}_zone`
  const cachePrefix = `home_cache_v2_${zone}_`

  return {
    data: {
      generationNotice: { visible: false, taskId: '', message: '' },
      groups: [],
      currentGroup: '',
      leftList: [],
      rightList: [],
      isLoading: true,
      diagnosticBannerEnabled: false,
      diagnosticBannerAdUnitId: ''
    },

    onLoad() {
      if (zone === 'play') this.initDiagnosticBanner()
      this.loadHome('', { initial: true })
    },

    onShow() {
      app.syncGenerationNoticeToPage(this)
      app.syncNewUserGiftModalToCurrentPage()
    },

    onUnload() {
      this.zonePageUnloaded = true
      this.clearImageRetryTimers()
      if (this.featureObserver) this.featureObserver.disconnect()
    },

    updateGenerationNotice(notice) {
      this.setData({ generationNotice: notice || { visible: false, taskId: '', message: '' } })
    },

    onGenerationNoticeTap() {
      app.goToGenerationHistoryFromNotice()
    },

    onPullDownRefresh() {
      this.loadHome(this.data.currentGroup, { force: true }).finally(() => wx.stopPullDownRefresh())
    },

    initDiagnosticBanner() {
      const applyConfig = (config = {}) => {
        if (this.zonePageUnloaded) return
        let launchOptions = {}
        try {
          launchOptions = typeof wx.getLaunchOptionsSync === 'function' ? wx.getLaunchOptionsSync() || {} : {}
        } catch (_) { }
        const isExternal = Number(launchOptions.scene || 0) === 1069
        const bannerKey = isExternal ? 'play_top_external_1069' : 'play_top_internal'
        const enabled = isExternal
          ? config.externalDiagnosticBannerEnabled !== false
          : config.internalDiagnosticBannerEnabled !== false
        const adUnitId = String(AD_CONFIG.diagnosticBannerAdUnitIds && AD_CONFIG.diagnosticBannerAdUnitIds[bannerKey] || '').trim()
        this.setData({
          diagnosticBannerEnabled: Boolean(enabled && adUnitId),
          diagnosticBannerAdUnitId: enabled ? adUnitId : ''
        })
      }

      applyConfig(getAdExperimentConfig())
      refreshAdExperimentConfig().then(applyConfig)
    },

    onDiagnosticBannerError(event = {}) {
      const detail = event.detail || {}
      console.warn('[diagnosticBanner] load failed', detail.errCode || detail.code || '', detail.errMsg || detail.message || '')
    },

    async loadHome(group = '', loadOptions = {}) {
      const requestedGroup = group || ''
      const cacheKey = `${cachePrefix}${requestedGroup || 'default'}`
      const cached = await getStorage(cacheKey)
      const cacheValid = cached && cached.expiresAt > Date.now() && Array.isArray(cached.items)

      if (cached && Array.isArray(cached.items)) {
        this.applyHome(cached, { fromCache: true })
      } else {
        this.setData({ isLoading: true })
      }
      if (cacheValid && !loadOptions.force) return cached

      const requestKey = `${zone}:${requestedGroup}`
      if (!inFlightRequests[requestKey]) {
        inFlightRequests[requestKey] = wx.cloud.callFunction({
          name: 'featureConfig',
          data: { action: 'getHome', payload: { zone, category: requestedGroup } }
        }).finally(() => { delete inFlightRequests[requestKey] })
      }

      try {
        const res = await inFlightRequests[requestKey]
        const home = res && res.result && res.result.success ? res.result.data : null
        if (!home) throw new Error('invalid home response')
        const payload = {
          groups: Array.isArray(home.groups) ? home.groups : [],
          currentGroup: home.current_group || requestedGroup,
          items: Array.isArray(home.items) ? home.items : [],
          updatedAt: home.updated_at || Date.now(),
          expiresAt: Date.now() + HOME_CACHE_TTL_MS
        }
        setStorage(`${cachePrefix}${payload.currentGroup || 'default'}`, payload)
        if (!requestedGroup) setStorage(cacheKey, payload)
        this.applyHome(payload)
        return payload
      } catch (err) {
        console.error('[zone-page] load home failed', err)
        if (!cached) wx.showToast({ title: '加载失败', icon: 'none' })
        return null
      } finally {
        this.setData({ isLoading: false })
      }
    },

    applyHome(home = {}) {
      const groups = [...new Set((home.groups || []).filter(Boolean))]
      const currentGroup = home.currentGroup || groups[0] || ''
      const list = Array.isArray(home.items) ? home.items : []
      this.setData({ groups, currentGroup })
      this.renderCards(list)
    },

    renderCards(list = []) {
      const firstItems = list.slice(0, FIRST_RENDER_COUNT)
      this.splitWaterfall(firstItems, () => {
        this.setData({ isLoading: false })
        app.onHomeContentReady()
        this.observeFeatureExposure()
        if (list.length > FIRST_RENDER_COUNT) {
          const renderRest = () => this.splitWaterfall(list, () => {
            if (this.featureObserver) this.featureObserver.disconnect()
            this.featureObserver = null
            this.observeFeatureExposure()
          })
          if (typeof wx.nextTick === 'function') wx.nextTick(renderRest)
          else setTimeout(renderRest, 16)
        }
      })
    },

    splitWaterfall(list, callback) {
      const oldMap = {}
      this.data.leftList.concat(this.data.rightList).forEach(item => { oldMap[item._id] = item })
      const leftList = []
      const rightList = []
      list.forEach((item, index) => {
        const oldItem = oldMap[item._id]
        const processedItem = Object.assign({}, item, {
          homeIndex: index,
          image: createImageState(item.home_banner, IMAGE_STYLES.HOME_CARD, oldItem && oldItem.image)
        })
        if (index % 2 === 0) leftList.push(processedItem)
        else rightList.push(processedItem)
      })
      this.setData({ leftList, rightList }, callback)
    },

    observeFeatureExposure() {
      if (this.featureObserver || typeof this.createIntersectionObserver !== 'function') return
      this.reportedExposureKeys = this.reportedExposureKeys || {}
      this.featureObserver = this.createIntersectionObserver({ observeAll: true })
      this.featureObserver.relativeToViewport().observe('.js-feature-card', res => {
        if (!res || res.intersectionRatio <= 0 || !res.dataset) return
        const id = res.dataset.id || ''
        const group = res.dataset.group || this.data.currentGroup
        const key = `${zone}_${group}_${id}`
        if (!id || this.reportedExposureKeys[key]) return
        this.reportedExposureKeys[key] = true
        report('feature_exposure', {
          feature_id: id,
          feature_name: res.dataset.name || '',
          feature_group: group,
          feature_zone: zone,
          position: Number(res.dataset.position || 0),
          source
        })
      })
    },

    onImageLoad(e) {
      const { id, col } = e.currentTarget.dataset
      const listName = col === 'left' ? 'leftList' : 'rightList'
      const index = this.data[listName].findIndex(item => item._id === id)
      if (index < 0) return
      const image = markImageLoaded(this.data[listName][index].image)
      cacheImage(image)
      this.setData({ [`${listName}[${index}].image`]: image })
    },

    onImageError(e) {
      const { id, col } = e.currentTarget.dataset
      const listName = col === 'left' ? 'leftList' : 'rightList'
      const index = this.data[listName].findIndex(item => item._id === id)
      if (index < 0 || !this.data[listName][index].image) return
      const nextImage = getNextRetryState(this.data[listName][index].image)
      const update = () => this.setData({ [`${listName}[${index}].image`]: nextImage })
      if (nextImage.error) return update()
      this.scheduleImageRetry(`${listName}_${id}`, update, getRetryDelay(nextImage.retryCount))
    },

    scheduleImageRetry(key, callback, delay) {
      this.imageRetryTimers = this.imageRetryTimers || {}
      if (this.imageRetryTimers[key]) clearTimeout(this.imageRetryTimers[key])
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
      if (this.featureObserver) {
        this.featureObserver.disconnect()
        this.featureObserver = null
      }
      this.setData({ currentGroup: group, leftList: [], rightList: [], isLoading: true })
      this.loadHome(group)
    },

    goToFeature(e) {
      const id = e.currentTarget.dataset.id
      const item = this.data.leftList.concat(this.data.rightList).find(feature => feature._id === id) || {}
      report('feature_click', {
        feature_id: id,
        feature_name: item.name || '',
        feature_group: this.data.currentGroup,
        feature_zone: zone,
        position: typeof item.homeIndex === 'number' ? item.homeIndex + 1 : 0,
        source
      })
      wx.navigateTo({
        url: `/pages/feature/feature?id=${id}&sourceZone=${zone}&sourceGroup=${encodeURIComponent(this.data.currentGroup || '')}`
      })
    }
  }
}

module.exports = { createZonePage }
