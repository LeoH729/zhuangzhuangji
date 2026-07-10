const AD_CONFIG = require('./ad-config.js')

function getAdUnitId(scene = '') {
  const ids = AD_CONFIG.rewardedVideoAdUnitIds || {}
  return String(ids[scene] || AD_CONFIG.rewardedVideoAdUnitId || '').trim()
}

function showVideoLoading() {
  wx.showLoading({
    title: '视频加载中...',
    mask: true
  })
}

function hideVideoLoading() {
  wx.hideLoading()
}

function showRewardedVideo(options = {}) {
  const scene = options.scene || ''
  const adUnitId = getAdUnitId(scene)

  return new Promise((resolve, reject) => {
    if (!adUnitId) {
      reject({ code: 'NO_AD_UNIT', message: '激励视频广告位未配置', scene })
      return
    }
    if (typeof wx === 'undefined' || typeof wx.createRewardedVideoAd !== 'function') {
      reject({ code: 'UNAVAILABLE', message: '当前微信版本不支持激励视频广告', scene })
      return
    }

    // 广告实例不能跨页面复用；在用户点击的当前页面创建并展示。
    const rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId })
    let settled = false

    const cleanup = () => {
      if (rewardedVideoAd.offClose) rewardedVideoAd.offClose(onClose)
      if (rewardedVideoAd.offError) rewardedVideoAd.offError(onError)
    }
    const finish = (value, isReject) => {
      if (settled) return
      settled = true
      hideVideoLoading()
      cleanup()
      if (isReject) {
        reject(value)
      } else {
        resolve(value)
      }
    }
    const onClose = (res = {}) => {
      const completed = res && (res.isEnded === true || res.isEnded === undefined)
      finish({ completed, scene })
    }
    const onError = (err) => {
      finish({
        code: 'AD_ERROR',
        message: (err && (err.errMsg || err.message)) || '激励视频广告加载失败',
        scene
      }, true)
    }
    const show = () => rewardedVideoAd.show().then(() => hideVideoLoading())

    rewardedVideoAd.onClose(onClose)
    rewardedVideoAd.onError(onError)
    showVideoLoading()
    show().catch(() => {
      rewardedVideoAd.load()
        .then(show)
        .catch(onError)
    })
  })
}

module.exports = {
  showRewardedVideo
}
