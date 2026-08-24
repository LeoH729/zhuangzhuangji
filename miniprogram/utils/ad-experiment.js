const DEFAULT_CONFIG = Object.freeze({
  externalDiagnosticBannerEnabled: true,
  internalDiagnosticBannerEnabled: true,
  analyzingInterstitialEnabled: true,
  newUserGiftPreloadEnabled: false,
  generationBoostPreloadEnabled: true
})

let memoryConfig = null
let refreshPromise = null

function normalizeConfig(raw = {}) {
  return {
    externalDiagnosticBannerEnabled: raw.externalDiagnosticBannerEnabled !== false,
    internalDiagnosticBannerEnabled: raw.internalDiagnosticBannerEnabled !== false,
    analyzingInterstitialEnabled: raw.analyzingInterstitialEnabled !== false,
    newUserGiftPreloadEnabled: false,
    generationBoostPreloadEnabled: raw.generationBoostPreloadEnabled !== false
  }
}

function getAdExperimentConfig() {
  if (memoryConfig) return memoryConfig
  memoryConfig = normalizeConfig(DEFAULT_CONFIG)
  return memoryConfig
}

function refreshAdExperimentConfig() {
  if (refreshPromise) return refreshPromise
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    return Promise.resolve(getAdExperimentConfig())
  }
  refreshPromise = wx.cloud.callFunction({
    name: 'adTelemetry',
    data: { action: 'getExperimentConfig' }
  }).then((res) => {
    const remote = res && res.result && res.result.success && res.result.data
    if (remote) {
      memoryConfig = normalizeConfig(Object.assign({}, DEFAULT_CONFIG, remote))
    }
    return getAdExperimentConfig()
  }).catch((error) => {
    console.warn('[adExperiment] refresh failed', error)
    return getAdExperimentConfig()
  }).finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

module.exports = {
  DEFAULT_CONFIG,
  getAdExperimentConfig,
  refreshAdExperimentConfig
}
