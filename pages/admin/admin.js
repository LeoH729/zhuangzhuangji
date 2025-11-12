// pages/admin/admin.js
Page({
  data: {
    activityName: '',
    activityContent: '',
    activityLink: ''
  },

  onLoad() {},

  onNameChange(e) {
    this.setData({ activityName: (e && e.detail && e.detail.value) || '' })
  },

  onContentChange(e) {
    this.setData({ activityContent: (e && e.detail && e.detail.value) || '' })
  },

  onLinkChange(e) {
    this.setData({ activityLink: (e && e.detail && e.detail.value) || '' })
  },

  onPublishTap() {
    // 仅 UI 占位：不做真实发布
    const nameEmpty = !this.data.activityName.trim()
    const contentEmpty = !this.data.activityContent.trim()
    if (nameEmpty || contentEmpty) {
      wx.showToast({ title: '请填写活动名称和内容', icon: 'none' })
    } else {
      wx.showToast({ title: '已提交（UI占位）', icon: 'success' })
    }
  }
})