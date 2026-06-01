const app = getApp()
const { report } = require('../../utils/analytics.js')

Page({
  data: {
    generationNotice: { visible: false, taskId: '', message: '' },
    userInfo: {},
    hasUserInfo: false,
    points: 0,
    registerDate: '',
    avatarLoaded: false,
    shareTask: {
      title: '生成图片分享给好友/朋友圈可得20星光',
      completedCount: 0,
      limit: 2,
      completed: false
    }
  },

  onShow() {
    app.syncGenerationNoticeToPage(this)
    this.checkLoginStatus()
  },

  updateGenerationNotice(notice) {
    this.setData({ generationNotice: notice || { visible: false, taskId: '', message: '' } })
  },

  onGenerationNoticeTap() {
    app.goToGenerationHistoryFromNotice()
  },

  onAvatarLoad() {
    this.setData({ avatarLoaded: true })
  },

  onAvatarError() {
    this.setData({ avatarLoaded: true })
  },

  checkLoginStatus() {
    let userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.nickName) {
      const app = getApp()
      if (app.globalData.userInfo && app.globalData.userInfo.nickName) {
        userInfo = app.globalData.userInfo
      }
    }

    if (userInfo && userInfo.nickName) {
      const d = new Date(userInfo.loginTime || Date.now())
      const registerDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const avatarUrlChanged = this.data.userInfo.avatarUrl !== userInfo.avatarUrl
      const shouldResetAvatar = !this.data.hasUserInfo || avatarUrlChanged

      this.setData({
        userInfo,
        hasUserInfo: true,
        registerDate,
        ...(shouldResetAvatar ? { avatarLoaded: false } : {})
      })
      this.fetchPoints()
      this.fetchShareTask()
    }
  },

  getUserProfile() {
    let userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.nickName) {
      const adjectives = ['沉默的', '快乐的', '忧郁的', '机智的', '勇敢的', '迷茫的', '温柔的', '暴躁的', '内向的', '开朗的', '神秘的', '调皮的', '冷静的', '热情的', '慵懒的', '勤奋的', '傲娇的', '佛系的', '认真的', '随性的', '元气的', '呆萌的', '文艺的', '硬核的']
      const nouns = ['矿泉水', '打字机', '键盘', '鼠标', '显示器', '耳机', '咖啡杯', '保温杯', '双肩包', '笔记本', '铅笔', '橡皮擦', '计算器', '台灯', '沙发', '抱枕', '盆栽', '仙人掌', '多肉', '橘猫', '柴犬', '修勾', '大橘', '柯基', '充电宝']
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
      const noun = nouns[Math.floor(Math.random() * nouns.length)]
      const suffix = Math.floor(Math.random() * 9000 + 1000)

      userInfo.nickName = `${adj}${noun}${suffix}`
      userInfo.avatarUrl = '/images/default_avatar.png'
      userInfo.loginTime = new Date().getTime()
      wx.setStorageSync('userInfo', userInfo)
    }

    const d = new Date(userInfo.loginTime || Date.now())
    const registerDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const avatarUrlChanged = this.data.userInfo.avatarUrl !== userInfo.avatarUrl
    const shouldResetAvatar = !this.data.hasUserInfo || avatarUrlChanged

    this.setData({
      userInfo,
      hasUserInfo: true,
      registerDate,
      ...(shouldResetAvatar ? { avatarLoaded: false } : {})
    })

    wx.cloud.callFunction({
      name: 'login',
      data: { userInfo }
    }).then(loginRes => {
      if (loginRes.result && loginRes.result.points !== undefined) {
        this.setData({ points: loginRes.result.points })
      } else {
        this.fetchPoints()
      }
      this.fetchShareTask()
    }).catch(console.error)
  },

  fetchPoints() {
    wx.cloud.callFunction({
      name: 'points',
      data: { action: 'getUserPoints' }
    }).then(res => {
      if (res.result && res.result.success && res.result.data) {
        const points = res.result.data.points || 0
        app.globalData.userPoints = points
        wx.setStorageSync('userPoints', points)
        this.setData({ points })
      }
    }).catch(console.error)
  },

  fetchShareTask() {
    wx.cloud.callFunction({
      name: 'points',
      data: { action: 'getShareTask' }
    }).then(res => {
      if (res.result && res.result.success && res.result.data) {
        const task = {
          ...res.result.data,
          title: '生成图片分享给好友/朋友圈可得20星光'
        }
        this.setData({ shareTask: task })
        report('star_task_status', {
          task_id: task.taskId,
          completed_count: task.completedCount,
          limit: task.limit,
          completed: task.completed ? 1 : 0
        })
      }
    }).catch(console.error)
  },

  goToHomeFromTask() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  goToPoints() {
    if (!this.data.hasUserInfo) return this.getUserProfile()
    wx.navigateTo({ url: '/pages/points/points' })
  },

  goToHistory() {
    if (!this.data.hasUserInfo) return this.getUserProfile()
    wx.navigateTo({ url: '/pages/generation-history/generation-history' })
  },

  goToFeedback() {
    if (!this.data.hasUserInfo) return this.getUserProfile()
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  }
})
