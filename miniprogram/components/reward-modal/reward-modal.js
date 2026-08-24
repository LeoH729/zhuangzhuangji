const { getRewardAssetPath, preloadRewardAsset } = require('../../utils/reward-assets.js')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        this.syncVisibility(Boolean(value))
      }
    },
    variant: {
      type: String,
      value: 'gift',
      observer() {
        if (this.data.visible) this.syncVisibility(true)
      }
    }
  },

  data: {
    displayVisible: false,
    backgroundPath: '',
    usingFallback: false
  },

  methods: {
    noop() {},

    syncVisibility(visible) {
      if (!visible) {
        this.setData({ displayVisible: false, backgroundPath: '', usingFallback: false })
        return
      }
      const variant = this.data.variant === 'boost' ? 'boost' : 'gift'
      const backgroundPath = getRewardAssetPath(variant)
      this.setData({
        displayVisible: true,
        backgroundPath,
        usingFallback: !backgroundPath
      })
      if (!backgroundPath) preloadRewardAsset(variant).catch(() => {})
    },

    onPrimaryTap() {
      if (this.data.variant === 'gift') {
        getApp().claimNewUserGift('modal')
        return
      }
      this.triggerEvent('confirm')
    },

    onSecondaryTap() {
      if (this.data.variant === 'gift') {
        getApp().dismissNewUserGiftModal()
        return
      }
      this.triggerEvent('cancel')
    }
  }
})
