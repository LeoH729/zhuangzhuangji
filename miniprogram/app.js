// 全局分享能力注入（必须在所有 Page 之前执行）
require('./utils/page-share-mixin');

const {
  report,
  reportGenerationFailed,
  setAnalyticsContext,
  createLaunchContext,
  markAnalyticsReady,
  flushAnalyticsOnHide
} = require('./utils/analytics.js')

const ANALYTICS_TEST_OPENID = 'obLo_1_UleSf8eX83HwIT_GGq8mA'
const ANALYTICS_TEST_STORAGE_KEY = 'analytics_generation_submit_failed_manual_test_v1'

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
    version: '1.4.8',
    pointsConfig: {
      name: '星光',
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
  onLaunch(options = {}) {
    this.initCloud();
    setAnalyticsContext(createLaunchContext(options, this.globalData.version))
    report('app_open', { source_page: 'app' })
    this.analyticsReadyFallbackTimer = setTimeout(() => markAnalyticsReady(), 3000)
  },

  onHide() {
    flushAnalyticsOnHide()
    try {
      require('./utils/image-cache.js').flushImageCacheMeta()
    } catch (_) { }
    if (this.generationWatchTimer) {
      clearInterval(this.generationWatchTimer)
      this.generationWatchTimer = null
    }
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

  onShow() {
    if (this.deferredBootstrapStarted) this.startGenerationWatcher()
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
  },

  // 获取用户openid
  getUserOpenId() {
    if (this.loginPromise) return this.loginPromise
    this.loginPromise = wx.cloud.callFunction({
      name: 'login',
      success: res => {
        console.log('获取openid成功:', res.result.openid);
        this.globalData.openid = res.result.openid;
        this.reportGenerationSubmitFailedTest(res.result.openid)

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

      },
      fail: err => {
        console.error('获取openid失败:', err);
        this.loginPromise = null
      }
    });
    return this.loginPromise
  },

  onHomeContentReady() {
    if (this.homeContentReady) return
    this.homeContentReady = true
    if (this.analyticsReadyFallbackTimer) {
      clearTimeout(this.analyticsReadyFallbackTimer)
      this.analyticsReadyFallbackTimer = null
    }
    markAnalyticsReady()
    try {
      require('./utils/image-cache.js').initializeImageCache()
    } catch (_) { }
    this.startDeferredBootstrap()
    setTimeout(() => this.preloadFeaturePackage(), 300)
  },

  startDeferredBootstrap() {
    if (this.deferredBootstrapStarted) return this.loginPromise
    this.deferredBootstrapStarted = true
    const loginPromise = this.getUserOpenId()
    this.restoreGenerationWatcher()
    setTimeout(() => this.checkNewUserGiftModal(), 3000)
    return loginPromise
  },

  preloadFeaturePackage() {
    if (this.featurePackagePreloaded || typeof wx.loadSubpackage !== 'function') return
    this.featurePackagePreloaded = true
    wx.loadSubpackage({ name: 'feature', fail: () => { this.featurePackagePreloaded = false } })
  },

  reportGenerationSubmitFailedTest(openid) {
    if (openid !== ANALYTICS_TEST_OPENID || wx.getStorageSync(ANALYTICS_TEST_STORAGE_KEY)) return

    wx.setStorageSync(ANALYTICS_TEST_STORAGE_KEY, Date.now())
    report('generation_submit_failed', {
      feature_id: 'analytics_manual_test',
      feature_name: '生图提交失败埋点测试',
      feature_group: 'system_test',
      template_type: 'image_to_image',
      source: 'manual_test',
      error_type: 'manual_test',
      error_msg: 'manual analytics verification'
    })
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
    const storedTasks = wx.getStorageSync('generationWatchTasks') || {}
    const expiry = Date.now() - 24 * 60 * 60 * 1000
    this.generationWatchTasks = Object.keys(storedTasks).reduce((result, taskId) => {
      const task = storedTasks[taskId] || {}
      if (!task.createdAt || task.createdAt >= expiry) result[taskId] = task
      return result
    }, {})
    const retainedTaskIds = Object.keys(this.generationWatchTasks)
      .sort((left, right) => Number(this.generationWatchTasks[right].createdAt || 0) - Number(this.generationWatchTasks[left].createdAt || 0))
      .slice(0, 20)
    this.generationWatchTasks = retainedTaskIds.reduce((result, taskId) => {
      result[taskId] = this.generationWatchTasks[taskId]
      return result
    }, {})
    wx.setStorageSync('generationWatchTasks', this.generationWatchTasks)
    const notice = wx.getStorageSync('generationNotice')
    if (notice && notice.visible) {
      this.globalData.generationNotice = notice
    }
    this.startGenerationWatcher()
  },

  trackGenerationTask(taskId, options = {}) {
    if (!taskId) return
    this.generationWatchTasks = this.generationWatchTasks || {}
    const existingTask = this.generationWatchTasks[taskId] || {}
    this.generationWatchTasks[taskId] = Object.assign({}, existingTask, options, {
      taskId,
      createdAt: existingTask.createdAt || Date.now()
    })
    const taskIds = Object.keys(this.generationWatchTasks)
    if (taskIds.length > 20) {
      taskIds.sort((left, right) => Number(this.generationWatchTasks[left].createdAt || 0) - Number(this.generationWatchTasks[right].createdAt || 0))
      delete this.generationWatchTasks[taskIds[0]]
    }
    wx.setStorageSync('generationWatchTasks', this.generationWatchTasks)
    this.startGenerationWatcher()
  },

  setGenerationTaskBannerSuppressed(taskId, suppressBanner) {
    if (!taskId || !this.generationWatchTasks || !this.generationWatchTasks[taskId]) return
    this.trackGenerationTask(taskId, { suppressBanner: !!suppressBanner })
  },

  finishTrackedGenerationTask(taskId, options = {}) {
    if (taskId && this.generationWatchTasks) {
      delete this.generationWatchTasks[taskId]
      wx.setStorageSync('generationWatchTasks', this.generationWatchTasks)
    }
    if (!options.silent) {
      this.showGenerationNotice(taskId, options.task)
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
      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: { action: 'getTaskStatuses', taskIds: taskIds.slice(0, 20) }
      })
      const resultTasks = res && res.result && Array.isArray(res.result.tasks) ? res.result.tasks : []
      for (let i = 0; i < resultTasks.length; i += 1) {
        const task = resultTasks[i]
        const taskId = task.taskId
        if (!taskId) continue
        if (task.status === 'succeeded') {
          report('generation_success', {
            feature_id: task.featureId || '',
            template_version_id: task.templateVersionId || '',
            task_id: taskId,
            history_id: task.historyId || '',
            source: 'watcher'
          })
          const taskMeta = tasks[taskId] || {}
          this.finishTrackedGenerationTask(taskId, {
            task,
            silent: taskMeta.suppressBanner === true
          })
        } else if (task.status === 'failed') {
          reportGenerationFailed(Object.assign({}, task, { taskId }), 'watcher')
          this.finishTrackedGenerationTask(taskId, { silent: true })
        }
      }
    } catch (e) {
      console.warn('生成任务监听失败，稍后重试', e)
    } finally {
      this.isPollingGenerationWatchTasks = false
    }
  },

  showGenerationNotice(taskId = '', task = {}) {
    const currentPage = getTopPage()
    const hiddenRoutes = ['pages/analyzing/analyzing', 'pages/result/result', 'pages/generation-history/generation-history']
    if (currentPage && hiddenRoutes.includes(currentPage.route)) {
      return
    }

    const notice = {
      visible: true,
      taskId,
      message: task.featureNameSnapshot || task.featureName || task.name || 'AI生图模板'
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

  async checkNewUserGiftModal() {
    if (this.checkingNewUserGift || this.showingNewUserGiftModal) return

    this.checkingNewUserGift = true
    try {
      const res = await wx.cloud.callFunction({
        name: 'points',
        data: { action: 'getNewUserGiftTask' }
      })
      const task = res && res.result && res.result.data
      if (!task || task.completed) return
      try {
        const { preloadRewardAsset } = require('./utils/reward-assets.js')
        await Promise.race([
          preloadRewardAsset('gift'),
          new Promise(resolve => setTimeout(() => resolve(''), 1200))
        ])
      } catch (_) { }
      this.showNewUserGiftModal()
    } catch (err) {
      console.warn('[app] check new user gift failed', err)
    } finally {
      this.checkingNewUserGift = false
    }
  },

  showNewUserGiftModal() {
    if (this.showingNewUserGiftModal) return
    this.showingNewUserGiftModal = true
    this.syncNewUserGiftModalToCurrentPage()
  },

  syncNewUserGiftModalToCurrentPage() {
    const currentPage = getTopPage()
    if (currentPage && typeof currentPage.setData === 'function') {
      currentPage.setData({ newUserGiftModalVisible: !!this.showingNewUserGiftModal })
    }
  },

  dismissNewUserGiftModal() {
    this.showingNewUserGiftModal = false
    this.syncNewUserGiftModalToCurrentPage()
  },

  async claimNewUserGift(source = 'unknown') {
    this.showingNewUserGiftModal = false
    this.syncNewUserGiftModalToCurrentPage()
    try {
      const { showRewardedVideo } = require('./utils/rewarded-video.js')
      const adRes = await showRewardedVideo({ scene: 'new_user_gift' })
      if (!adRes || !adRes.completed) {
        wx.showToast({ title: '完整观看后可领取奖励', icon: 'none' })
        return { success: false, canceled: true }
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '广告加载失败，请稍后重试', icon: 'none' })
      return { success: false, error: err }
    }

    try {
      wx.showLoading({ title: '领取中...', mask: true })
      const res = await wx.cloud.callFunction({
        name: 'points',
        data: { action: 'claimNewUserGift', source }
      })
      wx.hideLoading()
      if (res.result && res.result.success && res.result.data) {
        const points = Number(res.result.data.points || 0)
        this.globalData.userPoints = points
        wx.setStorageSync('userPoints', points)
        wx.showToast({ title: '奖励已到账', icon: 'success' })
        return { success: true, data: res.result.data }
      }
      wx.showToast({ title: (res.result && res.result.message) || '领取失败', icon: 'none' })
      return { success: false, result: res.result }
    } catch (err) {
      wx.hideLoading()
      console.error('[app] claim new user gift failed', err)
      wx.showToast({ title: '领取失败，请稍后重试', icon: 'none' })
      return { success: false, error: err }
    }
  },

  async checkAdminRole() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'isAdmin' } })
      const isAdmin = !!(res && res.result && res.result.isAdmin)
      this.globalData.isAdmin = isAdmin
      wx.setStorageSync('isAdmin', isAdmin)
      return isAdmin
    } catch (e) {
      console.warn('管理员鉴权失败，按普通用户处理', e)
      this.globalData.isAdmin = false
      wx.setStorageSync('isAdmin', false)
      return false
    }
  }
});
