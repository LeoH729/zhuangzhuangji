// pages/reference/reference.js
const app = getApp()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    originalImage: '', // 原图路径
    referenceImage: '', // 参考图路径，初始为空，在onLoad中设置
    points: 0 // 妆妆蛋积分
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
    
    // 如果未通过事件通道设置参考图，则加载静态图片作为兜底
    if (!this.data.referenceImage) {
      this.loadReferenceImage()
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    // 每次显示页面时同步积分数据
    this.loadUserPoints()
    this.startPointsWatcher()
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
      referenceImage: '/images/img_zhaugnrongcankaoshili.png'
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