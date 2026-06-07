// 全局分享能力注入（必须在所有 Page 之前执行）
require('./utils/page-share-mixin');

const { report } = require('./utils/analytics.js')

function getTopPage() {
  const pages = getCurrentPages()
  return pages && pages.length ? pages[pages.length - 1] : null
}

// 应用入口文件
App({
  // 全局数据存储
  globalData: {
    userInfo: null,
    openid: null,
    userPoints: 0,
    version: '1.4.1.1',
    pointsConfig: {
      name: '妆妆蛋',
      initial_points: 100,
      analyze_cost: 0,
      generate_cost: 0
    },
    pointsConfigReady: false,
    isAdmin: false,
    generationNotice: {
      visible: false,
      taskId: '',
      message: '生成已完成，可前往生成列表查看'
    }
  },

  // 应用初始化
  onLaunch() {
    this.initCloud();
    this.restoreGenerationWatcher();
  },

  onHide() {
    const currentPage = getTopPage()
    if (currentPage && currentPage.route === 'pages/analyzing/analyzing') {
      currentPage.hasReportedLeave = true
      report('generation_wait_leave', {
        feature_id: currentPage.data && currentPage.data.featureId || '',
        task_id: currentPage.data && currentPage.data.taskId || '',
        action: 'app_hide',
        wait_seconds: Math.max(0, Math.round((Date.now() - (currentPage.pollStartedAt || Date.now())) / 1000))
      })
    }
  },

  // 初始化云开发
  initCloud() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    });

    console.log('云开发环境初始化成功');
    this.getUserOpenId();
  },

  // 获取用户openid
  getUserOpenId() {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        console.log('获取openid成功:', res.result.openid);
        this.globalData.openid = res.result.openid;

        // 提取或初始化 userInfo
        let userInfo = wx.getStorageSync('userInfo') || {};
        
        if (!userInfo.nickName) {
          const adjectives = ['沉默的', '快乐的', '忧郁的', '机智的', '勇敢的', '迷茫的', '温柔的', '暴躁的', '内向的', '开朗的', '神秘的', '调皮的', '冷静的', '热情的', '慵懒的', '勤奋的', '傲娇的', '佛系的', '认真的', '随性的', '元气的', '呆萌的', '文艺的', '硬核的'];
          const nouns = ['矿泉水', '打字机', '键盘', '鼠标', '显示器', '耳机', '咖啡杯', '保温杯', '双肩包', '笔记本', '铅笔', '橡皮擦', '计算器', '台灯', '沙发', '抱枕', '盆栽', '仙人掌', '多肉', '橘猫', '柴犬', '修勾', '大橘', '柯基', '充电宝'];
          const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
          const noun = nouns[Math.floor(Math.random() * nouns.length)];
          const suffix = Math.floor(Math.random() * 9000 + 1000);
          
          userInfo.nickName = `${adj}${noun}${suffix}`;
          userInfo.avatarUrl = '/images/default_avatar.png';
        }

        userInfo.openid = res.result.openid;
        userInfo.loginTime = new Date().getTime();

        try {
          wx.setStorageSync('userInfo', userInfo);
          this.globalData.userInfo = userInfo;
        } catch (error) {
          console.error('保存用户信息失败:', error);
        }

        // login 成功后，串行初始化积分和管理员身份
        this.initPointsData();
        this.checkAdminRole();
      },
      fail: err => {
        console.error('获取openid失败:', err);
      }
    });
  },

  // 拉取积分配置和用户当前积分（一次性，不开监听）
  async initPointsData() {
    try {
      const cfgRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } })
      if (cfgRes.result && cfgRes.result.success) {
        this.globalData.pointsConfig = cfgRes.result.data
        this.globalData.pointsConfigReady = true
      }

      const upRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'ensureUserPoints' } })
      if (upRes.result && upRes.result.success) {
        const pts = (upRes.result.data && upRes.result.data.points) || this.globalData.pointsConfig.initial_points
        this.globalData.userPoints = pts
        wx.setStorageSync('userPoints', pts)
      }
    } catch (e) {
      console.error('初始化积分数据失败', e)
    }
  },

  // 恢复未完成生成任务监听
  restoreGenerationWatcher() {
    this.generationWatchTasks = wx.getStorageSync('generationWatchTasks') || {}
    const notice = wx.getStorageSync('generationNotice')
    if (notice && notice.visible) {
      this.globalData.generationNotice = notice
    }
    this.startGenerationWatcher()
  },

  trackGenerationTask(taskId) {
    if (!taskId) return
    this.generationWatchTasks = this.generationWatchTasks || {}
    this.generationWatchTasks[taskId] = { taskId, createdAt: Date.now() }
    wx.setStorageSync('generationWatchTasks', this.generationWatchTasks)
    this.startGenerationWatcher()
  },

  finishTrackedGenerationTask(taskId, options = {}) {
    if (taskId && this.generationWatchTasks) {
      delete this.generationWatchTasks[taskId]
      wx.setStorageSync('generationWatchTasks', this.generationWatchTasks)
    }
    if (!options.silent) {
      this.showGenerationNotice(taskId)
    }
    this.stopGenerationWatcherIfIdle()
  },

  startGenerationWatcher() {
    const tasks = this.generationWatchTasks || {}
    if (this.generationWatchTimer || Object.keys(tasks).length === 0) return
    this.generationWatchTimer = setInterval(() => {
      this.pollGenerationWatchTasks()
    }, 8000)
    this.pollGenerationWatchTasks()
  },

  stopGenerationWatcherIfIdle() {
    const tasks = this.generationWatchTasks || {}
    if (Object.keys(tasks).length > 0 || !this.generationWatchTimer) return
    clearInterval(this.generationWatchTimer)
    this.generationWatchTimer = null
  },

  async pollGenerationWatchTasks() {
    if (this.isPollingGenerationWatchTasks) return
    const tasks = this.generationWatchTasks || {}
    const taskIds = Object.keys(tasks)
    if (taskIds.length === 0) {
      this.stopGenerationWatcherIfIdle()
      return
    }

    this.isPollingGenerationWatchTasks = true
    try {
      for (let i = 0; i < taskIds.length; i += 1) {
        const taskId = taskIds[i]
        const res = await wx.cloud.callFunction({
          name: 'aiGenerate',
          data: { action: 'getTaskStatus', taskId }
        })
        const task = res && res.result && res.result.task
        if (!task) continue
        if (task.status === 'succeeded') {
          report('generation_success', {
            feature_id: task.featureId || '',
            task_id: taskId,
            history_id: task.historyId || '',
            source: 'watcher'
          })
          this.finishTrackedGenerationTask(taskId)
        } else if (task.status === 'failed') {
          this.finishTrackedGenerationTask(taskId, { silent: true })
        }
      }
    } catch (e) {
      console.warn('生成任务监听失败，稍后重试', e)
    } finally {
      this.isPollingGenerationWatchTasks = false
    }
  },

  showGenerationNotice(taskId = '') {
    const currentPage = getTopPage()
    const hiddenRoutes = ['pages/analyzing/analyzing', 'pages/result/result', 'pages/generation-history/generation-history']
    if (currentPage && hiddenRoutes.includes(currentPage.route)) {
      return
    }

    const notice = {
      visible: true,
      taskId,
      message: '生成已完成，可前往生成列表查看'
    }
    this.globalData.generationNotice = notice
    wx.setStorageSync('generationNotice', notice)
    this.syncGenerationNoticeToCurrentPage()
  },

  clearGenerationNotice() {
    const notice = { visible: false, taskId: '', message: '' }
    this.globalData.generationNotice = notice
    wx.removeStorageSync('generationNotice')
    this.syncGenerationNoticeToCurrentPage()
  },

  syncGenerationNoticeToCurrentPage() {
    const page = getTopPage()
    if (page && typeof page.updateGenerationNotice === 'function') {
      page.updateGenerationNotice(this.globalData.generationNotice)
    }
  },

  syncGenerationNoticeToPage(page) {
    if (page && typeof page.updateGenerationNotice === 'function') {
      const hiddenRoutes = ['pages/analyzing/analyzing', 'pages/result/result', 'pages/generation-history/generation-history']
      const notice = hiddenRoutes.includes(page.route)
        ? { visible: false, taskId: '', message: '' }
        : this.globalData.generationNotice
      page.updateGenerationNotice(notice)
    }
  },

  goToGenerationHistoryFromNotice() {
    this.clearGenerationNotice()
    wx.navigateTo({ url: '/pages/generation-history/generation-history' })
  },

  // 管理员身份校验
  async checkAdminRole() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'isAdmin' } })
      const isAdmin = !!(res && res.result && res.result.isAdmin)
      this.globalData.isAdmin = isAdmin
      wx.setStorageSync('isAdmin', isAdmin)
    } catch (e) {
      console.warn('管理员鉴权失败，按普通用户处理', e)
      this.globalData.isAdmin = false
      wx.setStorageSync('isAdmin', false)
    }
  }
});
