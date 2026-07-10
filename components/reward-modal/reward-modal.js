Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    variant: {
      type: String,
      value: 'gift'
    }
  },

  methods: {
    noop() {},

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
