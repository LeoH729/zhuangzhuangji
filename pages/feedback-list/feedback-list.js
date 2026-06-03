// pages/feedback-list/feedback-list.js
Page({
  data: {
    feedbackList: [],
    loading: false,
    showDetail: false,
    currentFeedback: {}
  },

  onLoad() {
    this.loadFeedbackList()
  },

  onShow() {
    this.loadFeedbackList()
  },

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
          const contact = item.contact || item.email || ''
          return Object.assign({}, item, {
            contact,
            contactDisplay: contact || '-',
            createTime: this.formatTime(item.createTime),
            updateTime: item.updateTime ? this.formatTime(item.updateTime) : ''
          })
        })
        this.setData({ feedbackList: list })
      } else {
        wx.showToast({
          title: (res.result && res.result.message) || '加载失败',
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

  onFeedbackDetail(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbackList.find(item => item._id === id)

    if (feedback) {
      this.setData({
        showDetail: true,
        currentFeedback: feedback
      })
    }
  },

  onCloseDetail() {
    this.setData({
      showDetail: false,
      currentFeedback: {}
    })
  },

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
  }
})
