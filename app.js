// 应用入口文件
App({
  // 全局数据存储
  globalData: {
    cosmetics: [], // 存储化妆品记录的数组
    reminderDays: 30, // 默认提前30天提醒
    currentDate: new Date().toISOString().split('T')[0], // 当前日期
    dataLoaded: false, // 数据是否已加载
    lastSaveTime: 0, // 上次保存时间戳
    userInfo: null, // 用户信息
    openid: null, // 用户openid
    // 妆妆蛋积分系统
    userPoints: 0,
    pointsConfig: {
      name: '妆妆蛋',
      initial_points: 100,
      analyze_cost: 3,
      generate_cost: 5
    },
    _pointsWatcher: null
  },

  // 应用初始化
  onLaunch() {
    // 初始化云开发
    this.initCloud();

    // 初始化数据（异步加载云端数据，完成后会自动检查提醒）
    this.initializeData();
  },

  // 初始化云开发
  initCloud() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    
    // 初始化云开发环境
    wx.cloud.init({
      env: 'cloudbase-5gmfinom29f48930', // 您的云开发环境ID
      traceUser: true
    });
    
    console.log('云开发环境初始化成功');
    
    // 触发用户积分初始化（云端通过上下文识别OPENID）
    try {
      wx.cloud.callFunction({ name: 'points', data: { action: 'ensureUserPoints' } })
        .then(res => {
          console.log('[points] ensureUserPoints result', res)
          const pts = res && res.result && res.result.data && res.result.data.points
          if (typeof pts === 'number') {
            this.globalData.userPoints = pts
            wx.setStorageSync('userPoints', pts)
          }
        })
        .catch(err => {
          console.warn('ensureUserPoints 调用失败', err)
        })
    } catch (e) {
      console.warn('调用 ensureUserPoints 异常', e)
    }
    
    // 获取用户openid
    this.getUserOpenId();
  },

  // 获取用户openid
  getUserOpenId() {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        console.log('获取openid成功:', res.result.openid);
        this.globalData.openid = res.result.openid;
        
        // 保存用户信息到本地存储
        const userInfo = {
          openid: res.result.openid,
          loginTime: new Date().getTime()
        };
        
        try {
          wx.setStorageSync('userInfo', userInfo);
          this.globalData.userInfo = userInfo;
          console.log('用户信息已保存到本地存储');
        } catch (error) {
          console.error('保存用户信息失败:', error);
        }

        // 初始化妆妆蛋积分系统
        this.initPointsSystem();
      },
      fail: err => {
        console.error('获取openid失败:', err);
      }
    });
  },

  // 初始化妆妆蛋积分系统：加载配置与用户积分，并开启监听
  async initPointsSystem() {
    try {
      // 读取可运营配置（初始、扣减）
      const cfgRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } })
      if (cfgRes.result && cfgRes.result.success) {
        this.globalData.pointsConfig = cfgRes.result.data
      }

      // 确保用户积分文档存在并取最新值
      const upRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'ensureUserPoints' } })
      if (upRes.result && upRes.result.success) {
        const pts = (upRes.result.data && upRes.result.data.points) || this.globalData.pointsConfig.initial_points
        this.globalData.userPoints = pts
        wx.setStorageSync('userPoints', pts)
      }

      // 启动全局监听（页面也可自行监听）
      this.startPointsWatcher()
    } catch (e) {
      console.error('初始化妆妆蛋系统失败', e)
    }
  },

  // 开启用户积分实时监听
  startPointsWatcher() {
    try {
      const openid = this.globalData.openid
      if (!openid) return
      const db = wx.cloud.database()
      // 关闭旧监听
      if (this.globalData._pointsWatcher && this.globalData._pointsWatcher.close) {
        try { this.globalData._pointsWatcher.close() } catch (_) {}
      }
      this.globalData._pointsWatcher = db.collection('user_points').doc(openid).watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null
          if (doc && typeof doc.points === 'number') {
            this.globalData.userPoints = doc.points
            wx.setStorageSync('userPoints', doc.points)
          }
        },
        onError: err => {
          console.error('用户积分监听错误', err)
        }
      })
    } catch (e) {
      console.error('开启积分监听失败', e)
    }
  },

  // 关闭用户积分实时监听
  stopPointsWatcher() {
    if (this.globalData._pointsWatcher && this.globalData._pointsWatcher.close) {
      try { this.globalData._pointsWatcher.close() } catch (_) {}
      this.globalData._pointsWatcher = null
    }
  },

  // 初始化数据 - 异步从云端获取
  async initializeData() {
    try {
      // 调用云函数获取数据
      const res = await wx.cloud.callFunction({
        name: 'cosmetics',
        data: { action: 'list' }
      });
      
      if (res.result.success) {
        this.globalData.cosmetics = res.result.data;
        this.globalData.dataLoaded = true;
        console.log('云端数据加载成功:', res.result.data.length);
        
        // 数据加载完成后检查提醒
        this.checkReminders();
      } else {
        console.error('加载云端数据失败:', res.result.message);
        // 降级到本地数据
        this.loadLocalDataAsFallback();
      }
    } catch (error) {
      console.error('云函数调用失败:', error);
      // 降级到本地数据
      this.loadLocalDataAsFallback();
    }
  },

  // 本地数据降级方法
  loadLocalDataAsFallback() {
    try {
      const localData = wx.getStorageSync('cosmetics');
      if (localData && Array.isArray(localData)) {
        this.globalData.cosmetics = localData;
        this.globalData.dataLoaded = true;
        console.log('使用本地数据作为降级方案:', localData.length);
        this.checkReminders();
      } else {
        this.globalData.cosmetics = [];
        this.globalData.dataLoaded = true;
        console.log('本地无数据，初始化为空数组');
      }
    } catch (error) {
      console.error('本地数据加载失败:', error);
      this.globalData.cosmetics = [];
      this.globalData.dataLoaded = true;
    }
  },

  // 检查过期提醒
  checkReminders() {
    const { cosmetics, reminderDays } = this.globalData;
    const today = new Date();
    const reminders = [];

    cosmetics.forEach(item => {
      if (item.expiryDate) {
        const expiryDate = new Date(item.expiryDate);
        const timeDiff = expiryDate - today;
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        // 过期或即将过期（提前reminderDays天）
        if (daysDiff <= reminderDays && daysDiff >= 0) {
          reminders.push({
            ...item,
            daysLeft: daysDiff
          });
        } else if (daysDiff < 0) {
          reminders.push({
            ...item,
            daysLeft: daysDiff,
            isExpired: true
          });
        }
      }
    });

    // 如果有提醒，发送本地通知
    if (reminders.length > 0) {
      this.sendReminderNotification(reminders);
    }
  },

  // 发送提醒通知
  sendReminderNotification(reminders) {
    // 微信小程序通知需要用户授权
    wx.getSetting({
      withSubscriptions: true,
      success(res) {
        // 检查是否有通知授权
        if (res.subscriptionsSetting.mainSwitch) {
          // 构建通知内容
          const expiredCount = reminders.filter(r => r.isExpired).length;
          const soonExpiredCount = reminders.length - expiredCount;
          let title = '妆妆记 - 过期提醒';
          let content = '';

          if (expiredCount > 0 && soonExpiredCount > 0) {
            content = `${expiredCount}个已过期，${soonExpiredCount}个即将过期`;
          } else if (expiredCount > 0) {
            content = `${expiredCount}个化妆品已过期`;
          } else {
            content = `${soonExpiredCount}个化妆品即将过期`;
          }

          // 显示本地通知
          wx.showModal({
            title: title,
            content: content,
            confirmText: '查看详情',
            success(res) {
              // 只有点击确定按钮时才跳转
              if (res.confirm) {
                // 使用switchTab跳转到tabBar页面
                wx.switchTab({
                  url: '/pages/cosmetics/cosmetics'
                });
              }
            }
          });
        }
      }
    });
  },

  // 保存化妆品数据到本地存储
  saveCosmeticsData() {
    wx.setStorageSync('cosmetics', this.globalData.cosmetics);
  },

  // 添加新的化妆品记录
  addCosmetic(item) {
    // 生成唯一ID
    item.id = Date.now().toString();
    // 添加创建时间
    item.createTime = new Date().toISOString();
    // 添加到数组
    this.globalData.cosmetics.unshift(item);
    // 保存到本地存储
    this.saveCosmeticsData();
    // 检查提醒
    this.checkReminders();
    return item;
  },

  // 删除化妆品记录
  deleteCosmetic(id) {
    this.globalData.cosmetics = this.globalData.cosmetics.filter(item => item.id !== id);
    this.saveCosmeticsData();
  },

  // 更新化妆品记录
  updateCosmetic(updatedItem) {
    const index = this.globalData.cosmetics.findIndex(item => item.id === updatedItem.id);
    if (index !== -1) {
      this.globalData.cosmetics[index] = { ...this.globalData.cosmetics[index], ...updatedItem };
      this.saveCosmeticsData();
      this.checkReminders();
      return true;
    }
    return false;
  }
});