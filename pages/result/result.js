// pages/result/result.js
Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 用户上传的原图
    originalImage: '',
    // 生成的结果图
    resultImage: '',

    // 对比滑块位置 (0-100)
    sliderValue: 50,

    // 遮罩显示控制
    overlayVisible: false,

    // 图片加载状态
    isImgLoaded: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (options.imageUrl) {
      this.setData({
        originalImage: decodeURIComponent(options.imageUrl)
      });
    }

    // 优先从缓存读取分析数据（analyzing.js 存入）
    try {
      const cached = wx.getStorageSync('analysisData');
      if (cached) {
        this.setData({
          originalImage: cached.photoUrl || this.data.originalImage,
          resultImage: cached.resultUrl || ''
        });
        // 清除缓存，避免重复读取
        wx.removeStorageSync('analysisData');
      }
    } catch (_) { }
  },

  /**
   * 图片加载完成回调
   */
  onImageLoad() {
    this.setData({ isImgLoaded: true });
  },

  /**
   * 滑块拖动事件
   */
  onSliderMove(e) {
    const query = wx.createSelectorQuery();
    query.select('.compare-container').boundingClientRect((rect) => {
      if (rect) {
        let touchX = e.touches[0].clientX - rect.left;
        let percentage = (touchX / rect.width) * 100;

        // 限制范围 0-100
        percentage = Math.max(0, Math.min(100, percentage));

        this.setData({
          sliderValue: percentage
        });
      }
    }).exec();
  },

  /**
   * 点击保存图片
   */
  saveImage() {
    if (!this.data.resultImage) return;

    wx.showLoading({ title: '保存中...' });

    // 如果是临时文件或云文件，直接保存；如果是网络链接需先下载
    // 这里简化处理，直接尝试保存
    wx.cloud.downloadFile({
      fileID: this.data.resultImage,
      success: res => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: (err) => {
            wx.hideLoading();
            // 处理权限拒绝
            if (err.errMsg.indexOf('auth') !== -1) {
              wx.showModal({
                title: '权限提示',
                content: '需要保存图片到相册的权限，请在设置中开启',
                confirmText: '去设置',
                success: res => {
                  if (res.confirm) wx.openSetting();
                }
              });
            } else {
              wx.showToast({ title: '保存失败', icon: 'none' });
            }
          }
        });
      },
      fail: () => {
        // 如果不是云文件，尝试直接下载普通链接
        wx.downloadFile({
          url: this.data.resultImage,
          success: (res) => {
            if (res.statusCode === 200) {
              wx.saveImageToPhotosAlbum({
                filePath: res.tempFilePath,
                success: () => {
                  wx.hideLoading();
                  wx.showToast({ title: '已保存', icon: 'success' });
                },
                fail: () => {
                  wx.hideLoading();
                  wx.showToast({ title: '保存失败', icon: 'none' });
                }
              });
            } else {
              wx.hideLoading();
              wx.showToast({ title: '下载失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        });
      }
    });
  },

  /**
   * 返回首页
   */
  goHome() {
    wx.switchTab({
      url: '/pages/makeup/makeup'
    });
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '看看我的AI上妆效果！',
      path: '/pages/makeup/makeup',
      imageUrl: this.data.resultImage //如果支持的话
    };
  }
})