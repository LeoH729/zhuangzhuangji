const coze = require('../../docs/coze_workflow_api_reference.js')
Page({
  data: {
    imageUrl: '',
    need: 0,
    allLines: ['肤质分析中...', '脸型分析中...', '五官分析中...', '妆容分析中...', '发型分析中...'],
    playing: true,
    _analysisTimeoutTimer: null
  },
  onLoad(options) {
    const url = options && options.imageUrl ? decodeURIComponent(options.imageUrl) : ''
    const need = options && options.need ? parseInt(options.need, 10) : 0
    this.setData({ imageUrl: url, need })
    this.startAnalysisFlow()
  },
  onShow() {
    this.setData({ playing: true })
  },
  startAnalysisFlow() {
    if (!this.data.imageUrl) {
      wx.showToast({ title: '图片不可用', icon: 'none' })
      return
    }
    if (this._analysisTimeoutTimer) clearTimeout(this._analysisTimeoutTimer)
    this._analysisTimeoutTimer = setTimeout(() => {
      wx.showToast({ title: '网络超时，请重试', icon: 'none' })
    }, 120000)
    const localPath = this.data.imageUrl
    const extIndex = localPath.lastIndexOf('.')
    const ext = extIndex !== -1 ? localPath.substring(extIndex + 1).toLowerCase() : 'jpg'
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const cloudPath = `user_makeup_uploads/${uniqueId}.${ext}`
    wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
      success: (res) => {
        const fileID = res.fileID
        wx.cloud.getTempFileURL({ fileList: [fileID] }).then((urlRes) => {
          const info = urlRes.fileList && urlRes.fileList[0] ? urlRes.fileList[0] : null
          const tempFileURL = info ? info.tempFileURL : ''
          return this.callMakeupWorkflow(tempFileURL).then((outputs) => {
            clearTimeout(this._analysisTimeoutTimer)
            const mapped = {
              face: outputs.facial_features,
              skin: outputs.skin,
              makeup: outputs.makeup,
              hairstyle: outputs.hairstyle,
              suggestions: outputs.improve,
              imagePrompt: outputs.image_prompt,
              photoUrl: tempFileURL
            }
            const need = this.data.need || 0
            this.postConsumePointsAfterSuccess(need, 'analyze')
            wx.setStorageSync('analysisData', mapped)
            wx.redirectTo({
              url: `/pages/result/result?imageUrl=${encodeURIComponent(this.data.imageUrl)}`
            })
          })
        }).catch((err) => {
          clearTimeout(this._analysisTimeoutTimer)
          this.handleFail(err)
        })
      },
      fail: (err) => {
        clearTimeout(this._analysisTimeoutTimer)
        this.handleFail(err)
      }
    })
  },
  callMakeupWorkflow(photoUrl) {
    if (!photoUrl) return Promise.reject(new Error('empty photoUrl'))
    return coze.callCozeWorkflow({ alias: 'analyze', parameters: { photo: photoUrl } }).then((res) => {
      const parsed = coze.parseWorkflowResponse(res)
      return {
        facial_features: parsed.facial_features || '',
        skin: parsed.skin || '',
        makeup: parsed.makeup || '',
        hairstyle: parsed.hairstyle || '',
        improve: parsed.improve || '',
        image_prompt: parsed.image_prompt || ''
      }
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
  handleFail(err) {
    wx.switchTab({
      url: '/pages/makeup/makeup',
      success: () => {
        wx.showToast({ title: '分析失败，请重试', icon: 'none', duration: 2000 })
      }
    })
  },
  onHide() {
    this.setData({ playing: false })
    if (this._analysisTimeoutTimer) { try { clearTimeout(this._analysisTimeoutTimer) } catch (_) {} this._analysisTimeoutTimer = null }
  },
  onUnload() {
    this.setData({ playing: false })
    if (this._analysisTimeoutTimer) { try { clearTimeout(this._analysisTimeoutTimer) } catch (_) {} this._analysisTimeoutTimer = null }
  }
})