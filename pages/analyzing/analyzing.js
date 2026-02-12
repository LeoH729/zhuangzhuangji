const coze = require('../../docs/coze_workflow_api_reference.js')
Page({
  data: {
    imageUrl: '',
    need: 0,
    styleId: '', // 选定的妆容风格 ID
    styleName: '', // 风格名称（用于流水记录）
    allLines: ['面部特征提取中...', '正在匹配妆容风格...', '光影融合渲染中...', '生成专属妆容...', '即将完成...'],
    playing: true,
    _analysisTimeoutTimer: null
  },
  onLoad(options) {
    const url = options && options.imageUrl ? decodeURIComponent(options.imageUrl) : ''
    const need = options && options.need ? parseInt(options.need, 10) : 0
    const styleId = options && options.styleId ? options.styleId : ''
    const styleName = options && options.styleName ? decodeURIComponent(options.styleName) : ''

    this.setData({ imageUrl: url, need, styleId, styleName })
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
    if (!this.data.styleId) {
      wx.showToast({ title: '未选择风格', icon: 'none' })
      return
    }

    // 设置超时保护 (120秒)
    if (this._analysisTimeoutTimer) clearTimeout(this._analysisTimeoutTimer)
    this._analysisTimeoutTimer = setTimeout(() => {
      wx.showToast({ title: '生成超时，请重试', icon: 'none' })
      setTimeout(() => this.handleFail({ message: 'timeout' }), 1500)
    }, 120000)

    // Step 1: 上传图片到云存储
    const localPath = this.data.imageUrl
    const extIndex = localPath.lastIndexOf('.')
    const ext = extIndex !== -1 ? localPath.substring(extIndex + 1).toLowerCase() : 'jpg'
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const cloudPath = `user_makeup_uploads/${uniqueId}.${ext}`

    wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
      success: (uploadRes) => {
        const fileID = uploadRes.fileID
        // Step 2: 获取临时访问 URL
        wx.cloud.getTempFileURL({ fileList: [fileID] }).then((urlRes) => {
          const info = urlRes.fileList && urlRes.fileList[0] ? urlRes.fileList[0] : null
          const tempFileURL = info ? info.tempFileURL : ''

          if (!tempFileURL) {
            clearTimeout(this._analysisTimeoutTimer)
            this.handleFail({ message: '获取图片链接失败' })
            return
          }

          // Step 3: 调用 Coze 工作流（使用 styleId 作为 alias，云函数会自动添加 Style_ 前缀查找）
          const alias = this.data.styleId
          const params = { photo: tempFileURL }

          console.log('[Coze] 调用工作流, alias:', alias, ', photo:', tempFileURL)

          coze.callCozeWorkflow({ alias, parameters: params }).then(async (res) => {
            clearTimeout(this._analysisTimeoutTimer)

            // 调试：打印云函数/Coze 原始返回
            console.log('[Coze] 云函数原始返回:', JSON.stringify(res))

            // 检查 Coze API 层面的错误
            if (res && res.code && res.code !== 0) {
              console.error('[Coze] API 返回错误码:', res.code, ', msg:', res.msg || res.message)
              this.handleFail({ message: `Coze错误: ${res.msg || res.message || res.code}` })
              return
            }

            // 检查云函数层面的错误
            if (res && res.success === false) {
              console.error('[Coze] 云函数返回失败:', res.code, res.message)
              this.handleFail({ message: res.message || '云函数调用失败' })
              return
            }

            // Step 4: 解析响应
            let parsed
            try {
              parsed = coze.parseWorkflowResponse(res)
            } catch (parseErr) {
              console.error('[Coze] 解析失败, 原始数据:', JSON.stringify(res))
              console.error('[Coze] 解析错误:', parseErr)
              this.handleFail({ message: '解析生成结果失败' })
              return
            }
            console.log('[Coze] 工作流返回解析结果:', parsed)

            const mapped = {
              photoUrl: tempFileURL,
              resultUrl: parsed.output_image || parsed.image || parsed.url || parsed.output || '',
              styleId: this.data.styleId
            }

            if (!mapped.resultUrl) {
              console.error('[Coze] 未能从返回中提取生成图 URL, parsed:', JSON.stringify(parsed))
              this.handleFail({ message: '未获取到生成图片' })
              return
            }

            // Step 4.5: 将外部图片转存到云存储（避免域名白名单问题）
            try {
              const cloudResultUrl = await this.transferImageToCloud(mapped.resultUrl)
              if (cloudResultUrl) {
                mapped.resultUrl = cloudResultUrl
                console.log('[Transfer] 图片已转存到云存储:', cloudResultUrl)
              }
            } catch (transferErr) {
              console.warn('[Transfer] 转存失败，将使用原始 URL:', transferErr)
            }

            // Step 5: 扣费
            const need = this.data.need || 0
            if (need > 0) {
              const displayTitle = '虚拟试妆-' + (this.data.styleName || this.data.styleId)
              this.postConsumePointsAfterSuccess(need, 'virtual_tryon_' + this.data.styleId, displayTitle)
            }

            // Step 5.5: 保存生成记录到数据库
            this.saveGenerationRecord(mapped)

            // Step 6: 存储结果并跳转结果页
            wx.setStorageSync('analysisData', mapped)
            wx.redirectTo({
              url: `/pages/result/result?imageUrl=${encodeURIComponent(this.data.imageUrl)}`
            })
          }).catch((err) => {
            clearTimeout(this._analysisTimeoutTimer)
            console.error('[Coze] 工作流调用失败:', err)
            this.handleFail(err)
          })
        }).catch((err) => {
          clearTimeout(this._analysisTimeoutTimer)
          console.error('[Upload] 获取临时URL失败:', err)
          this.handleFail(err)
        })
      },
      fail: (err) => {
        clearTimeout(this._analysisTimeoutTimer)
        console.error('[Upload] 上传图片失败:', err)
        this.handleFail(err)
      }
    })
  },
  // 将外部图片通过云函数转存到云存储（绕过前端域名白名单限制）
  async transferImageToCloud(externalUrl) {
    const res = await wx.cloud.callFunction({
      name: 'cozeWorkflow',
      data: { action: 'transferImage', imageUrl: externalUrl }
    })
    if (res.result && res.result.success && res.result.fileID) {
      return res.result.fileID
    }
    throw new Error((res.result && res.result.message) || '图片转存失败')
  },
  // 保存生成记录到数据库
  async saveGenerationRecord(mapped) {
    try {
      const db = wx.cloud.database()
      await db.collection('generation_history').add({
        data: {
          styleId: this.data.styleId,
          styleName: this.data.styleName || this.data.styleId,
          resultUrl: mapped.resultUrl,
          photoUrl: mapped.photoUrl,
          createdAt: db.serverDate()
        }
      })
      console.log('[Record] 生成记录保存成功')
    } catch (e) {
      console.error('[Record] 保存生成记录失败:', e)
    }
  },
  async postConsumePointsAfterSuccess(amount, reason, title) {
    try {
      const app = getApp()
      const tryConsume = async () => {
        return await wx.cloud.callFunction({ name: 'points', data: { action: 'consume', amount, reason, title } })
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
    } catch (_) { }
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
    if (this._analysisTimeoutTimer) { try { clearTimeout(this._analysisTimeoutTimer) } catch (_) { } this._analysisTimeoutTimer = null }
  },
  onUnload() {
    this.setData({ playing: false })
    if (this._analysisTimeoutTimer) { try { clearTimeout(this._analysisTimeoutTimer) } catch (_) { } this._analysisTimeoutTimer = null }
  }
})