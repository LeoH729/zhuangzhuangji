const coze = require('../../docs/coze_workflow_api_reference.js')
Page({
  data: {
    originalImage: '',
    photo: '',
    prompt: '',
    need: 0,
    allLines: ['读取用户图片', '分析用户图片', '获取妆容风格', '分析妆容关键词', '为图片上妆中'],
    playing: true,
    _genTimeoutTimer: null
  },
  onLoad(options) {
    try {
      const params = wx.getStorageSync('generateParams')
      if (params) {
        this.setData({
          originalImage: params.originalImage || '',
          photo: params.photo || '',
          prompt: params.prompt || '',
          need: typeof params.need === 'number' ? params.need : 5
        })
        wx.removeStorageSync('generateParams')
      }
    } catch (_) {}
    this.startGeneratingFlow()
  },
  onShow() { this.setData({ playing: true }) },
  startGeneratingFlow() {
    if (!this.data.photo) {
      wx.showToast({ title: '图片不可用', icon: 'none' })
      wx.navigateBack({ delta: 1 })
      return
    }
    if (this._genTimeoutTimer) clearTimeout(this._genTimeoutTimer)
    this._genTimeoutTimer = setTimeout(() => {
      wx.showModal({ title: '超时', content: '生成超时，请稍后重试', showCancel: false })
      wx.navigateBack({ delta: 1 })
    }, 120000)
    coze.callCozeWorkflow({ alias: 'generate_reference', parameters: { photo: this.data.photo, prompt: this.data.prompt } }).then((res) => {
      const parsed = coze.parseWorkflowResponse(res)
      const outputUrl = parsed.output || parsed.image || parsed.url || ''
      clearTimeout(this._genTimeoutTimer)
      if (!outputUrl) {
        wx.showModal({ title: '生成失败', content: '未获取到参考图地址', showCancel: false })
        wx.navigateBack({ delta: 1 })
        return
      }
      const need = this.data.need || 0
      this.postConsumePointsAfterSuccess(need, 'generate')
      try { wx.setStorageSync('referenceData', { referenceImage: outputUrl }) } catch (_) {}
      wx.redirectTo({ url: `/pages/reference/reference?originalImage=${encodeURIComponent(this.data.originalImage)}` })
    }).catch((err) => {
      clearTimeout(this._genTimeoutTimer)
      wx.showModal({ title: '生成失败', content: (err && err.errMsg) ? err.errMsg : '网络或服务异常，请稍后重试', showCancel: false })
      wx.navigateBack({ delta: 1 })
    })
  },
  async postConsumePointsAfterSuccess(amount, reason) {
    try {
      const app = getApp()
      const tryConsume = async () => {
        return await wx.cloud.callFunction({ name: 'points', data: { action: 'consume', amount, reason } })
      }
      let res = await tryConsume()
      if (!(res.result && res.result.success)) {
        await new Promise(r => setTimeout(r, 500))
        res = await tryConsume()
      }
      if (res.result && res.result.success) {
        const newPoints = (res.result.data && res.result.data.points)
        if (typeof newPoints === 'number') {
          if (app.globalData) { app.globalData.userPoints = newPoints }
          wx.setStorageSync('userPoints', newPoints)
        }
      }
    } catch (_) {}
  },
  onHide() {
    this.setData({ playing: false })
    if (this._genTimeoutTimer) { try { clearTimeout(this._genTimeoutTimer) } catch (_) {} this._genTimeoutTimer = null }
  },
  onUnload() {
    this.setData({ playing: false })
    if (this._genTimeoutTimer) { try { clearTimeout(this._genTimeoutTimer) } catch (_) {} this._genTimeoutTimer = null }
  }
})