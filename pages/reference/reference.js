// pages/reference/reference.js
const app = getApp()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    originalImage: '', // 原图路径
    referenceImage: '', // 参考图路径，初始为空，在onLoad中设置
    points: 0, // 妆妆蛋积分
    // 新增：妆妆蛋资源点区域显示控制（默认显示）
    showPointsSection: true,
    // 新增：云端默认参考图兜底（可由 assets_config 配置覆盖）
    defaultReferenceImageUrl: '/images/img_zhaugnrongcankaoshili.png'
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function (options) {
    // 获取上级页面传递的原图路径
    if (options.originalImage) {
      this.setData({
        originalImage: decodeURIComponent(options.originalImage)
      })
    }
    
    // 通过事件通道接收参考图（来自结果页生成）
    try {
      const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (eventChannel && eventChannel.on) {
        eventChannel.on('referenceData', (data) => {
          if (data && data.referenceImage) {
            this.setData({ referenceImage: data.referenceImage })
            console.log('接收参考图URL:', data.referenceImage)
          }
        })
      }
    } catch (e) {
      console.warn('参考图事件通道不可用', e)
    }
    
    // 加载用户积分
    this.loadUserPoints()

    // 读取运营配置中的显示开关
    try {
      const cfg = app.globalData && app.globalData.pointsConfig
      if (cfg) {
        const show = (typeof cfg.show_points_section === 'number') ? (cfg.show_points_section > 0) : true
        this.setData({ showPointsSection: show })
      } else {
        // 若全局未加载，主动请求一次配置
        wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } })
          .then(res => {
            if (res.result && res.result.success) {
              const data = res.result.data
              const show2 = (typeof data.show_points_section === 'number') ? (data.show_points_section > 0) : true
              this.setData({ showPointsSection: show2 })
              if (app.globalData) app.globalData.pointsConfig = data
            }
          })
          .catch(() => {/* 静默失败，保持默认显示 */})
      }
    } catch (_) { /* 静默失败，保持默认显示 */ }
    
    // 如果未通过事件通道设置参考图，则加载云端默认参考图作为兜底
    if (!this.data.referenceImage) {
      this.loadDefaultReferenceFromAssets()
    }

    // 启动运营配置监听（默认参考图可实时更新）
    this.startAssetsWatcher()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    // 每次显示页面时同步积分数据
    this.loadUserPoints()
    this.startPointsWatcher()
    this.startConfigWatcher()
  },

  /**
   * 加载用户积分
   */
  loadUserPoints: function() {
    try {
      // 优先使用全局数据（保留 0 值），否则读取本地存储，最后默认 100
      const gp = app.globalData && app.globalData.userPoints
      if (gp !== undefined && gp !== null) {
        this.setData({ points: gp })
        return
      }
      const stored = wx.getStorageSync('userPoints')
      if (stored !== '' && stored !== null && stored !== undefined) {
        this.setData({ points: stored })
        return
      }
      this.setData({ points: 100 })
    } catch (e) {
      console.warn('加载用户积分失败，使用默认', e)
      this.setData({ points: 100 })
    }
  },

  /**
   * 加载参考图片 - 接口预留
   * TODO: 后续对接AI生成妆容参考图片接口
   */
  loadReferenceImage: function() {
    // 预留接口调用位置
    // 示例接口结构：
    // wx.request({
    //   url: 'https://your-api-domain.com/api/generate-makeup-reference',
    //   method: 'POST',
    //   data: {
    //     originalImage: this.data.originalImage,
    //     userId: app.globalData.userId,
    //     analysisResult: this.data.analysisResult
    //   },
    //   success: (res) => {
    //     if (res.data.success) {
    //       this.setData({
    //         referenceImage: res.data.referenceImageUrl
    //       })
    //     }
    //   },
    //   fail: (err) => {
    //     console.error('加载参考图片失败:', err)
    //   }
    // })
    
    // 当前使用静态图片
    console.log('使用静态参考图片，待接口对接')
    this.setData({
      referenceImage: this.data.defaultReferenceImageUrl
    })
  },

  /**
   * 保存参考图片 - 接口预留
   * TODO: 后续对接保存用户生成的参考图片接口
   */
  saveReferenceImage: function() {
    // 预留接口调用位置
    // wx.request({
    //   url: 'https://your-api-domain.com/api/save-reference',
    //   method: 'POST',
    //   data: {
    //     userId: app.globalData.userId,
    //     originalImage: this.data.originalImage,
    //     referenceImage: this.data.referenceImage,
    //     timestamp: Date.now()
    //   },
    //   success: (res) => {
    //     wx.showToast({
    //       title: '保存成功',
    //       icon: 'success'
    //     })
    //   }
    // })
    
    console.log('保存参考图片功能待开发')
  },

  /**
   * 预览原图
   */
  previewOriginalImage: function() {
    if (this.data.originalImage) {
      console.log('预览原图路径:', this.data.originalImage)
      wx.previewImage({
        current: this.data.originalImage,
        urls: [this.data.originalImage],
        success: function(res) {
          console.log('预览原图成功', res)
        },
        fail: function(err) {
          console.error('预览原图失败', err)
          wx.showToast({
            title: '图片预览失败',
            icon: 'none',
            duration: 2000
          })
        }
      })
    } else {
      wx.showToast({
        title: '暂无原图',
        icon: 'none',
        duration: 2000
      })
    }
  },

  /**
   * 预览参考图
   */
  previewReferenceImage: function() {
    console.log('点击预览参考图')
    console.log('当前参考图路径:', this.data.referenceImage)
    
    if (this.data.referenceImage) {
      // 尝试使用绝对路径
      const imagePath = this.data.referenceImage
      console.log('准备预览图片:', imagePath)
      
      wx.previewImage({
        current: imagePath,
        urls: [imagePath],
        success: function(res) {
          console.log('预览参考图成功', res)
        },
        fail: function(err) {
          console.error('预览参考图失败', err)
          // 如果预览失败，尝试使用wx.showModal显示错误信息
          wx.showModal({
            title: '图片预览失败',
            content: '错误信息: ' + (err.errMsg || '未知错误'),
            showCancel: false,
            confirmText: '确定'
          })
        }
      })
    } else {
      wx.showToast({
        title: '暂无参考图',
        icon: 'none',
        duration: 2000
      })
    }
  },

  /**
   * 参考图加载成功事件
   */
  onReferenceImageLoad: function(e) {
    console.log('参考图加载成功', e.detail)
  },

  /**
   * 参考图加载失败事件
   */
  onReferenceImageError: function(e) {
    console.error('参考图加载失败', e.detail)
    wx.showToast({
      title: '参考图加载失败',
      icon: 'none',
      duration: 2000
    })
  },

  /**
   * 返回首页按钮点击事件
   */
  onBackToHome: function() {
    wx.switchTab({
      url: '/pages/makeup/makeup'
    })
  },

  /**
   * 开启积分实时监听
   */
  startPointsWatcher: function() {
    try {
      const openid = app.globalData && app.globalData.openid
      if (!openid) return
      const db = wx.cloud.database()
      if (this._pointsWatcher && this._pointsWatcher.close) {
        try { this._pointsWatcher.close() } catch (_) {}
      }
      this._pointsWatcher = db.collection('user_points').doc(openid).watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null
          if (doc && typeof doc.points === 'number') {
            this.setData({ points: doc.points })
          }
        },
        onError: err => {
          console.error('reference 积分监听错误', err)
        }
      })
    } catch (e) {
      console.error('reference 开启积分监听失败', e)
    }
  },

  /**
   * 关闭积分实时监听
   */
  stopPointsWatcher: function() {
    try {
      if (this._pointsWatcher && this._pointsWatcher.close) {
        try { this._pointsWatcher.close() } catch (e) { console.warn('reference 积分监听关闭异常', e) }
        this._pointsWatcher = null
      }
    } catch (e) {
      console.error('reference 关闭积分监听失败', e)
    }
  },

  // —— 配置实时监听（points_config/global） ——
  startConfigWatcher: function () {
    try {
      const db = wx.cloud.database()
      if (this._configWatcher && this._configWatcher.close) {
        try { this._configWatcher.close() } catch (_) {}
      }
      this._configWatcher = db.collection('points_config').doc('global').watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null
          if (doc) {
            const show = (typeof doc.show_points_section === 'number') ? (doc.show_points_section > 0) : this.data.showPointsSection
            this.setData({ showPointsSection: show })
            if (app.globalData) app.globalData.pointsConfig = doc
          }
        },
        onError: err => {
          console.error('reference 配置监听错误', err)
        }
      })
    } catch (e) {
      console.error('reference 开启配置监听失败', e)
    }
  },
  stopConfigWatcher: function () {
    if (this._configWatcher && this._configWatcher.close) {
      try { this._configWatcher.close() } catch (_) {}
      this._configWatcher = null
    }
  },

  // —— 云端默认参考图解析辅助：fileID -> 临时URL，或直接返回HTTP(S) ——
  async resolveAssetUrl(maybeUrlOrFileId) {
    try {
      if (!maybeUrlOrFileId || typeof maybeUrlOrFileId !== 'string') return ''
      if (/^https?:\/\//i.test(maybeUrlOrFileId)) return maybeUrlOrFileId
      if (/^cloud:\/\//i.test(maybeUrlOrFileId)) {
        const res = await wx.cloud.getTempFileURL({ fileList: [maybeUrlOrFileId] })
        const item = res && res.fileList && res.fileList[0]
        return (item && item.tempFileURL) || ''
      }
      return maybeUrlOrFileId
    } catch (e) {
      console.warn('解析云端默认参考图失败', e)
      return ''
    }
  },

  // —— 读取云端默认参考图配置（assets_config/global） ——
  async loadDefaultReferenceFromAssets() {
    try {
      const db = wx.cloud.database()
      const coll = db.collection('assets_config')
      let data
      try {
        const doc = await coll.doc('global').get()
        data = doc && doc.data
      } catch (errDoc) {
        console.warn('assets_config doc("global") 读取失败，尝试集合兜底', errDoc)
        try {
          const list = await coll.limit(1).get()
          data = list && list.data && list.data[0]
        } catch (errList) {
          console.warn('assets_config 集合兜底读取失败', errList)
        }
      }
      if (data) {
        const raw = data.reference_default_url || data.reference_default_fileid || data.reference_default || ''
        const url = await this.resolveAssetUrl(raw)
        if (url) {
          // 仅在当前仍为空时设置参考图，避免覆盖已生成的参考图
          const patch = { defaultReferenceImageUrl: url }
          if (!this.data.referenceImage) patch.referenceImage = url
          this.setData(patch)
          return
        }
      }
      // 若云端未配置，保持本地兜底
      if (!this.data.referenceImage) {
        this.setData({ referenceImage: this.data.defaultReferenceImageUrl })
      }
    } catch (e) {
      console.warn('加载云端默认参考图失败，使用本地兜底', e)
      if (!this.data.referenceImage) {
        this.setData({ referenceImage: this.data.defaultReferenceImageUrl })
      }
    }
  },

  // —— 运营默认参考图实时监听 ——
  startAssetsWatcher: function() {
    try {
      if (this._assetsWatcher && this._assetsWatcher.close) {
        try { this._assetsWatcher.close() } catch (_) {}
      }
      const db = wx.cloud.database()
      const coll = db.collection('assets_config')
      this._assetsWatcher = coll.doc('global').watch({
        onChange: async snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null
          if (doc) {
            const raw = doc.reference_default_url || doc.reference_default_fileid || doc.reference_default || ''
            const url = await this.resolveAssetUrl(raw)
            if (url) {
              const finalUrl = this.data.referenceImage ? this.data.referenceImage : url
              this.setData({ defaultReferenceImageUrl: url, referenceImage: finalUrl })
            }
          }
        },
        onError: err => {
          console.error('reference 默认参考图监听错误（doc global），尝试集合监听兜底', err)
          try {
            if (this._assetsWatcher && this._assetsWatcher.close) {
              try { this._assetsWatcher.close() } catch (_) {}
            }
            this._assetsWatcher = coll.where({}).watch({
              onChange: async snap => {
                const d = (snap && snap.docs && snap.docs[0]) || null
                if (d) {
                  const raw = d.reference_default_url || d.reference_default_fileid || d.reference_default || ''
                  const url = await this.resolveAssetUrl(raw)
                  if (url) {
                    const finalUrl = this.data.referenceImage ? this.data.referenceImage : url
                    this.setData({ defaultReferenceImageUrl: url, referenceImage: finalUrl })
                  }
                }
              },
              onError: e2 => console.error('reference 集合监听兜底失败', e2)
            })
          } catch (e2) {
            console.error('reference 启动集合监听兜底异常', e2)
          }
        }
      })
    } catch (e) {
      console.error('reference 开启默认参考图监听失败', e)
    }
  },
  stopAssetsWatcher: function() {
    if (this._assetsWatcher && this._assetsWatcher.close) {
      try { this._assetsWatcher.close() } catch (_) {}
      this._assetsWatcher = null
    }
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady: function () {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide: function () {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload: function () {
    // 页面卸载时关闭积分监听，避免资源泄漏
    if (typeof this.stopPointsWatcher === 'function') {
      this.stopPointsWatcher()
    }
    // 同时关闭配置监听
    if (typeof this.stopConfigWatcher === 'function') {
      this.stopConfigWatcher()
    }
    // 关闭默认参考图监听
    if (typeof this.stopAssetsWatcher === 'function') {
      this.stopAssetsWatcher()
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh: function () {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom: function () {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage: function () {

  }
})