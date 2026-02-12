// pages/feedback-list/feedback-list.js
Page({
  data: {
    feedbackList: [],
    loading: false,
    showDetail: false,
    currentFeedback: {},
    replyContent: ''
  },

  onLoad() {
    this.loadFeedbackList()
  },

  onShow() {
    // 每次显示页面时刷新列表
    this.loadFeedbackList()
  },

  // 加载反馈列表
  loadFeedbackList() {
    this.setData({ loading: true })
    
    wx.cloud.callFunction({
      name: 'feedback',
      data: {
        action: 'list'
      }
    }).then(res => {
      console.log('反馈列表：', res)
      if (res.result && res.result.success) {
        const list = res.result.data.map(item => {
          return {
            ...item,
            createTime: this.formatTime(item.createTime),
            updateTime: item.updateTime ? this.formatTime(item.updateTime) : ''
          }
        })
        this.setData({ feedbackList: list })
      } else {
        wx.showToast({
          title: res.result?.message || '加载失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      console.error('加载反馈列表失败：', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }).finally(() => {
      this.setData({ loading: false })
    })
  },

  // 格式化时间为纯数字格式（YYYY-MM-DD HH:mm:ss）
  formatTime(timestamp) {
    if (!timestamp) return ''
    
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  },

  // 查看反馈详情
  onFeedbackDetail(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbackList.find(item => item._id === id)
    
    if (feedback) {
      this.setData({
        showDetail: true,
        currentFeedback: feedback,
        replyContent: feedback.reply || ''
      })
    }
  },

  // 关闭详情弹窗
  onCloseDetail() {
    this.setData({
      showDetail: false,
      currentFeedback: {},
      replyContent: ''
    })
  },

  // 回复内容输入
  onReplyInput(e) {
    this.setData({
      replyContent: e.detail.value
    })
  },

  // 复制OpenID
  onCopyOpenid(e) {
    const openid = e.currentTarget.dataset.openid
    
    if (!openid) {
      wx.showToast({
        title: 'OpenID不存在',
        icon: 'none'
      })
      return
    }

    wx.setClipboardData({
      data: openid,
      success: () => {
        wx.showToast({
          title: '已复制到剪贴板',
          icon: 'success'
        })
      },
      fail: () => {
        wx.showToast({
          title: '复制失败',
          icon: 'none'
        })
      }
    })
  },

  // 更新反馈
  onUpdateFeedback() {
    const { currentFeedback, replyContent } = this.data
    
    if (!currentFeedback._id) {
      wx.showToast({
        title: '反馈信息无效',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '保存中...' })

    wx.cloud.callFunction({
      name: 'feedback',
      data: {
        action: 'updateStatus',
        feedbackId: currentFeedback._id,
        reply: replyContent
      }
    }).then(res => {
      console.log('更新反馈：', res)
      if (res.result && res.result.success) {
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        })
        this.onCloseDetail()
        this.loadFeedbackList()
      } else {
        wx.showToast({
          title: res.result?.message || '保存失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      console.error('更新反馈失败：', err)
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }).finally(() => {
      wx.hideLoading()
    })
  }
})