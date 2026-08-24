const AD_UNIT_ID = 'adunit-9f57538c945944b6'

function createId() {
  return `interstitial_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function createAnalyzingInterstitial(page) {
  let ad = null
  let diagnostic = null
  let closeTimer = null
  let started = false
  let showing = false

  function record(result) {
    if (!diagnostic || !wx.cloud) return
    const payload = Object.assign({}, diagnostic, { result, clientTime: Date.now() })
    diagnostic = null
    wx.cloud.callFunction({
      name: 'adTelemetry',
      data: { action: 'recordInterstitialAttempt', record: payload }
    }).catch(() => {})
  }

  function destroy(result = '') {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    if (result) record(result)
    if (ad) {
      if (typeof ad.destroy === 'function') ad.destroy()
      ad = null
    }
    showing = false
  }

  async function start(taskId = '') {
    if (started || !taskId) return
    started = true
    try {
      const configRes = await wx.cloud.callFunction({ name: 'adTelemetry', data: { action: 'getExperimentConfig' } })
      const config = configRes && configRes.result && configRes.result.data || {}
      if (config.analyzingInterstitialEnabled === false || typeof wx.createInterstitialAd !== 'function') return
      const startedAt = Date.now()
      diagnostic = {
        requestId: createId(),
        pageSessionId: createId(),
        taskId,
        route: 'pages/analyzing/analyzing',
        loaded: false,
        showCalled: false,
        loadMs: 0,
        errCode: '',
        errMsg: ''
      }
      ad = wx.createInterstitialAd({ adUnitId: AD_UNIT_ID })
      if (ad.onLoad) ad.onLoad(() => {
        if (!diagnostic) return
        diagnostic.loaded = true
        diagnostic.loadMs = Date.now() - startedAt
      })
      if (ad.onError) ad.onError(error => {
        if (!diagnostic) return
        diagnostic.errCode = String(error && (error.errCode || error.code) || '')
        diagnostic.errMsg = String(error && (error.errMsg || error.message) || '').slice(0, 300)
      })
      if (ad.onClose) ad.onClose(() => destroy('shown'))
      await ad.load()
      if (!page.analyzingPageVisible || page.data.resultReady) return destroy('page_left')
      diagnostic.loaded = true
      diagnostic.loadMs = Date.now() - startedAt
      diagnostic.showCalled = true
      showing = true
      await ad.show()
      closeTimer = setTimeout(() => destroy('shown'), 5 * 60 * 1000)
    } catch (error) {
      if (diagnostic) {
        diagnostic.errCode = String(error && (error.errCode || error.code) || '')
        diagnostic.errMsg = String(error && (error.errMsg || error.message) || '').slice(0, 300)
      }
      destroy(diagnostic && diagnostic.loaded ? 'show_failed' : 'load_failed')
    }
  }

  return {
    start,
    onPageHide() { if (!showing) destroy('page_left') },
    destroy() { destroy('page_left') }
  }
}

module.exports = { createAnalyzingInterstitial }
