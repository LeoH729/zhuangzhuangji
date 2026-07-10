const app = getApp()
const { report } = require('../../utils/analytics.js')

const STAR_TASK_CACHE_KEY_PREFIX = 'star_tasks_cache_v1_'

function normalizeStarTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map(item => Object.assign({}, item, {
    displayReward: item.totalReward || item.reward || 0
  }))
}

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
    },
    starTasks: [],
    starTasksLoading: true,
    starTasksLoadFailed: false,
    starTaskSkeletonRows: [0, 1]
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

      const nextData = {
        userInfo,
        hasUserInfo: true,
        registerDate
      }
      if (shouldResetAvatar) {
        nextData.avatarLoaded = false
      }
      this.setData(nextData)
      this.fetchPoints()
      this.fetchStarTasks()
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

    const nextData = {
      userInfo,
      hasUserInfo: true,
      registerDate
    }
    if (shouldResetAvatar) {
      nextData.avatarLoaded = false
    }
    this.setData(nextData)

    wx.cloud.callFunction({
      name: 'login',
      data: { userInfo }
    }).then(loginRes => {
      if (loginRes.result && loginRes.result.points !== undefined) {
        this.setData({ points: loginRes.result.points })
      } else {
        this.fetchPoints()
      }
      this.fetchStarTasks()
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
        const task = Object.assign({}, res.result.data, {
          title: '生成图片分享给好友/朋友圈可得20星光'
        })
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

  getStarTaskCacheKey() {
    const userInfo = this.data.userInfo || wx.getStorageSync('userInfo') || {}
    const openid = (app.globalData && app.globalData.openid) || userInfo.openid || 'anonymous'
    return `${STAR_TASK_CACHE_KEY_PREFIX}${openid}`
  },

  getCachedStarTasks() {
    const cache = wx.getStorageSync(this.getStarTaskCacheKey())
    if (!cache || !Array.isArray(cache.tasks)) return []
    return normalizeStarTasks(cache.tasks)
  },

  applyStarTasks(tasks, options = {}) {
    const normalizedTasks = normalizeStarTasks(tasks)
    this.setData({
      starTasks: normalizedTasks,
      starTasksLoading: options.loading === true,
      starTasksLoadFailed: false
    })

    const shareTask = normalizedTasks.find(item => item.taskId === 'result_share')
    if (shareTask) {
      this.setData({ shareTask })
      report('star_task_status', {
        task_id: shareTask.taskId,
        completed_count: shareTask.completedCount,
        limit: shareTask.limit,
        completed: shareTask.completed ? 1 : 0
      })
    }
  },

  fetchStarTasks() {
    const requestId = (this.starTaskRequestId || 0) + 1
    this.starTaskRequestId = requestId
    const cachedTasks = this.getCachedStarTasks()

    if (this.data.starTasks.length === 0 && cachedTasks.length > 0) {
      this.applyStarTasks(cachedTasks, { loading: true })
    } else {
      this.setData({ starTasksLoading: true, starTasksLoadFailed: false })
    }

    return wx.cloud.callFunction({
      name: 'points',
      data: { action: 'getStarTasks' }
    }).then(res => {
      if (requestId !== this.starTaskRequestId) return
      if (!res.result || !res.result.success || !res.result.data) {
        throw new Error((res.result && res.result.message) || '获取星光任务失败')
      }

      const tasks = normalizeStarTasks(res.result.data.tasks)
      this.applyStarTasks(tasks)
      wx.setStorageSync(this.getStarTaskCacheKey(), {
        tasks,
        savedAt: Date.now()
      })
    }).catch(err => {
      if (requestId !== this.starTaskRequestId) return
      console.error('[profile] 获取星光任务失败', err)
      const fallbackTasks = this.data.starTasks.length > 0 ? this.data.starTasks : cachedTasks
      if (fallbackTasks.length > 0) {
        this.applyStarTasks(fallbackTasks)
        return
      }
      this.setData({ starTasksLoading: false, starTasksLoadFailed: true })
    })
  },

  async onStarTaskTap(e) {
    const taskId = e.currentTarget.dataset.taskId
    const task = (this.data.starTasks || []).find(item => item.taskId === taskId)
    if (!task || task.completed) return

    if (taskId === 'new_user_gift') {
      const res = await app.claimNewUserGift('profile')
      if (res && res.success) {
        this.fetchPoints()
        this.fetchStarTasks()
      }
      return
    }

    if (taskId === 'result_share') {
      this.goToHomeFromTask()
    }
  },

  goToHomeFromTask() {
    wx.switchTab({ url: '/pages/boss-zone/boss-zone' })
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
  },

  showAbout() {
    const version = (app.globalData && app.globalData.version) || '1.4.5'
    wx.showModal({
      title: '关于我们',
      content: `作者：厦门超级独奏\n版本号：${version}\n联系邮箱：419126495@qq.com`,
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
