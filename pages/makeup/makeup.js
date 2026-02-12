const StyleManager = require('../../utils/styleManager');

Page({

  /**
   * 页面的初始数据
   */
  data: {
    imageUrl: '', // 上传的图片路径
    points: 0,   // 妆妆蛋资源点数量
    tryonCost: 0, // 每次虚拟试妆消耗点数（读取 tryon_cost）
    configAvailable: true,
    isUploading: false, // 图片上传状态
    isAdmin: false, // 管理员身份标识
    // 新增：妆妆蛋资源点区域显示控制（默认显示）
    showPointsSection: true,
    // 云端运营图片（移除本地兜底，默认空，由云端下发）
    bannerImageUrl: '',
    tipsImageUrl: '/images/img_tips_default.png',
    // 虚拟试妆风格列表 (默认空，等待配置加载)
    styles: [],
    selectedStyleId: '',
    isTipsShow: false,
    debugInfo: 'Init...'
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    console.log('[DEBUG-Lifecycle] onLoad');
    // 强制清除旧缓存，确保读取最新配置
    wx.removeStorageSync('pointsConfig');

    // 初始化页面数据
    this.initializeData();
    this._assetUrlCache = {};
  },

  /**
   * 初始化页面数据
   */
  initializeData() {
    console.log('[DEBUG-Lifecycle] initializeData - start');
    const app = getApp();
    // —— 同步积分：优先全局，其次本地存储（保留 0 值）——
    const gp = app.globalData && app.globalData.userPoints;
    if (gp !== undefined && gp !== null) {
      this.setData({ points: gp });
    } else {
      const lp = wx.getStorageSync('userPoints');
      if (lp !== '' && lp !== null && lp !== undefined) {
        this.setData({ points: lp });
      }
    }

    // 读取配置（如存在），否则主动请求
    // DEBUG: 暂时绕过全局缓存，强制拉取最新配置
    // if (app.globalData && app.globalData.pointsConfig) {
    //   this._applyConfig(app.globalData.pointsConfig);
    // } else {
    this.loadPointsConfig();
    // }

    this.startPointsWatcher();
    // 开启配置实时监听
    this.startConfigWatcher();

    // 同步管理员身份
    const isAdminStored = wx.getStorageSync('isAdmin')
    const isAdminGlobal = app.globalData && app.globalData.isAdmin
    this.setData({ isAdmin: !!(isAdminGlobal || isAdminStored) })
    // 若暂未鉴权完成，稍后再同步一次
    setTimeout(() => {
      const isAdminLater = (getApp().globalData && getApp().globalData.isAdmin) || wx.getStorageSync('isAdmin')
      if (typeof isAdminLater === 'boolean' && isAdminLater !== this.data.isAdmin) {
        this.setData({ isAdmin: isAdminLater })
      }
    }, 800)
    console.log('[DEBUG-Lifecycle] initializeData - end');
  },

  // 统一应用配置（处理缓存图片路径）
  // 统一应用配置（处理缓存图片路径）
  _applyConfig(cfg) {
    if (!cfg) return;

    const updateData = {};

    // 1. 处理通用配置
    if (typeof cfg.tryon_cost === 'number') updateData.tryonCost = cfg.tryon_cost;
    if (typeof cfg.show_points_section === 'number') updateData.showPointsSection = (cfg.show_points_section > 0);

    // 2. 处理风格列表（通过 StyleManager 获取缓存路径）
    if (cfg.styles && Array.isArray(cfg.styles)) {
      updateData.styles = StyleManager.getStyles(cfg.styles);
    }

    // 3. 处理通用图片（banner/tips）
    const DEFAULT_TIPS_IMG = '/images/img_tips_default.png';

    if (cfg.banner_image_url) {
      updateData.bannerImageUrl = StyleManager.getAssetPath(String(cfg.banner_image_url));
    }

    // 强制刷新 Tips 图片逻辑：优先用配置，无配置用兜底
    let tipsRaw = cfg.tips_image_url;
    if (!tipsRaw) tipsRaw = DEFAULT_TIPS_IMG;
    tipsRaw = String(tipsRaw); // 确保是字符串

    updateData.tipsImageUrl = StyleManager.getAssetPath(tipsRaw);
    updateData.configAvailable = true;

    this.setData(updateData);
  },

  // —— 云端图片解析辅助：fileID -> 临时URL，或直接返回HTTP(S) ——
  async resolveAssetUrl(maybeUrlOrFileId) {
    try {
      if (!maybeUrlOrFileId || typeof maybeUrlOrFileId !== 'string') return '';
      if (/^https?:\/\//i.test(maybeUrlOrFileId)) return maybeUrlOrFileId; // 直接URL
      if (/^cloud:\/\//i.test(maybeUrlOrFileId)) {
        const cache = this._assetUrlCache && this._assetUrlCache[maybeUrlOrFileId];
        if (cache) return cache;
        const res = await wx.cloud.getTempFileURL({ fileList: [maybeUrlOrFileId] });
        const item = res && res.fileList && res.fileList[0];
        const url = (item && item.tempFileURL) || '';
        if (url) {
          this._assetUrlCache[maybeUrlOrFileId] = url;
        }
        return url;
      }
      return maybeUrlOrFileId; // 其他情况按URL处理
    } catch (e) {
      console.warn('解析云端图片失败', e);
      return '';
    }
  },

  // 读取运营配置（tryon_cost）
  async loadPointsConfig() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('points_config').doc('global').get();
      const data = res.data || {};
      const hasStyles = data.styles && Array.isArray(data.styles) && data.styles.length > 0;

      if (hasStyles) {
        this._applyConfig(data);

        // 同步资源
        StyleManager.syncResources(data).then(hasUpdate => {
          if (hasUpdate) this._applyConfig(data);
        });

        const app = getApp();
        if (app.globalData) app.globalData.pointsConfig = data;
        wx.setStorageSync('pointsConfig', data);
      } else {
        // 显式调用云函数修复
        const cfgRes = await wx.cloud.callFunction({
          name: 'points',
          data: { action: 'getConfig' }
        });

        if (cfgRes.result && cfgRes.result.success) {
          const cfg = cfgRes.result.data;
          this._applyConfig(cfg);

          const app = getApp();
          if (app.globalData) app.globalData.pointsConfig = cfg;
          wx.setStorageSync('pointsConfig', cfg);
        } else {
          this.startConfigPolling();
        }
      }
    } catch (e) {
      console.error('[Config] Load failed:', e);
      this.startConfigPolling();
    }
  },

  // 管理员入口导航
  goAdminPage() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  /**
   * 验证文件格式
   */
  validateFileFormat(filePath) {
    const allowedFormats = ['.jpg', '.jpeg', '.png'];
    const fileExtension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    return allowedFormats.includes(fileExtension);
  },

  /**
   * 验证文件大小
   */
  validateFileSize(fileSize) {
    const maxSize = 5 * 1024 * 1024; // 5MB
    return fileSize <= maxSize;
  },

  /**
   * 选择图片
   */
  chooseImage() {
    // 防止重复点击
    if (this.data.isUploading) {
      return;
    }

    const that = this;

    // 设置加载状态
    this.setData({
      isUploading: true
    });

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      maxDuration: 30,
      camera: 'back',
      success(res) {
        const tempFile = res.tempFiles[0];
        const tempFilePath = tempFile.tempFilePath;
        const fileSize = tempFile.size;

        // 文件格式验证
        if (!that.validateFileFormat(tempFilePath)) {
          wx.showToast({
            title: '仅支持JPG、PNG格式',
            icon: 'none',
            duration: 2000
          });

          that.setData({
            imageUrl: '',
            isUploading: false
          });

          console.log('文件格式不支持:', tempFilePath);
          return;
        }

        // 文件大小验证
        if (!that.validateFileSize(fileSize)) {
          wx.showToast({
            title: '图片过大（5M），请重新选择',
            icon: 'none',
            duration: 2000
          });

          that.setData({
            imageUrl: '',
            isUploading: false
          });

          console.log(`文件大小超限: ${(fileSize / 1024 / 1024).toFixed(2)}MB > 5MB`);
          return;
        }

        // 验证通过，设置图片
        that.setData({
          imageUrl: tempFilePath,
          isUploading: false
        });

        console.log(`文件验证通过: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

        // 显示成功提示
        wx.showToast({
          title: '图片选择成功',
          icon: 'success',
          duration: 1500
        });

        // 上传逻辑改为由【立即分析】按钮触发
      },
      fail(err) {
        console.error('选择图片失败:', err);

        that.setData({
          isUploading: false
        });

        wx.showToast({
          title: '选择图片失败',
          icon: 'none',
          duration: 2000
        });
      }
    });
  },

  /**
   * 删除图片
   */
  deleteImage() {
    console.log('deleteImage 函数被调用');

    // 直接删除图片，不需要确认弹窗
    this.setData({
      imageUrl: ''
    });
    console.log('图片删除完成');
  },



  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.fetchPointsQuickOnce();
    this.initializeData();
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    this.stopPointsWatcher();
    this.stopConfigWatcher();
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    // 正常刷新页面数据
    this.initializeData();
    wx.stopPullDownRefresh();
  },

  // —— 积分实时监听 ——
  startPointsWatcher() {
    try {
      const app = getApp();
      const openid = app.globalData && app.globalData.openid;
      if (!openid) {
        const c = (this._watchRetryCount || 0);
        const delays = [600, 1200, 2400, 4800];
        if (c >= delays.length) { this.startPointsQuickPolling(); return; }
        const d = delays[c];
        this._watchRetryCount = c + 1;
        if (this._watchRetryTimer) { try { clearTimeout(this._watchRetryTimer) } catch (_) { } }
        this._watchRetryTimer = setTimeout(() => this.startPointsWatcher(), d);
        return;
      }
      const db = wx.cloud.database();
      if (this._pointsWatcher && this._pointsWatcher.close) {
        try { this._pointsWatcher.close(); } catch (_) { }
      }
      this._pointsWatcher = db.collection('user_points').doc(openid).watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null;
          if (doc && typeof doc.points === 'number') {
            this.setData({ points: doc.points });
          }
        },
        onError: err => {
          this.startPointsQuickPolling();
        }
      });
    } catch (e) {
      this.startPointsQuickPolling();
    }
  },
  async fetchPointsQuickOnce() {
    try {
      const res = await wx.cloud.callFunction({ name: 'points', data: { action: 'getUserPoints' } });
      if (res.result && res.result.success) {
        const pts = res.result.data && res.result.data.points;
        if (typeof pts === 'number') {
          this.setData({ points: pts });
          const app = getApp();
          if (app.globalData) { app.globalData.userPoints = pts }
          wx.setStorageSync('userPoints', pts);
          return true;
        }
      }
    } catch (_) { }
    return false;
  },
  startPointsQuickPolling() {
    if (this._quickPollingTimer) return;
    this._quickPollingAttempts = 0;
    this._quickPollingTimer = setInterval(async () => {
      this._quickPollingAttempts = (this._quickPollingAttempts || 0) + 1;
      try {
        const res = await wx.cloud.callFunction({ name: 'points', data: { action: 'getUserPoints' } });
        if (res.result && res.result.success) {
          const pts = res.result.data && res.result.data.points;
          if (typeof pts === 'number') {
            this.setData({ points: pts });
            const app = getApp();
            if (app.globalData) { app.globalData.userPoints = pts }
            wx.setStorageSync('userPoints', pts);
            this.stopPointsQuickPolling();
            this.startPointsPolling();
            return;
          }
        }
      } catch (_) { }
      if (this._quickPollingAttempts >= 5) {
        this.stopPointsQuickPolling();
        this.startPointsPolling();
      }
    }, 1000);
  },
  stopPointsQuickPolling() {
    if (this._quickPollingTimer) {
      try { clearInterval(this._quickPollingTimer) } catch (_) { }
      this._quickPollingTimer = null;
    }
  },
  stopPointsWatcher() {
    if (this._pointsWatcher && this._pointsWatcher.close) {
      try { this._pointsWatcher.close(); } catch (_) { }
      this._pointsWatcher = null;
    }
    this.stopPointsPolling();
    this.stopPointsQuickPolling();
  },

  // —— 积分轮询降级 ——
  startPointsPolling() {
    if (this._pointsPollingTimer) return;
    // 每10秒拉取一次用户积分
    this._pointsPollingTimer = setInterval(async () => {
      try {
        const res = await wx.cloud.callFunction({ name: 'points', data: { action: 'getUserPoints' } });
        if (res.result && res.result.success) {
          const pts = res.result.data && res.result.data.points;
          if (typeof pts === 'number' && pts !== this.data.points) {
            this.setData({ points: pts });
          }
        }
      } catch (_) { /* 静默失败，下一轮继续 */ }
    }, 10000);
  },
  stopPointsPolling() {
    if (this._pointsPollingTimer) {
      try { clearInterval(this._pointsPollingTimer); } catch (_) { }
      this._pointsPollingTimer = null;
    }
  },

  // —— 配置实时监听（points_config/global） ——
  // —— 应用配置到页面数据 ——
  _applyConfigOld(doc) {
    const tc = (typeof doc.tryon_cost === 'number') ? doc.tryon_cost : this.data.tryonCost;
    const show = (typeof doc.show_points_section === 'number') ? (doc.show_points_section > 0) : this.data.showPointsSection;

    // 更新风格列表
    const styles = StyleManager.getStyles(doc.styles); // 从 StyleManager 获取处理过的风格列表
    if (styles && Array.isArray(styles)) {
      this.setData({ styles: styles });
    }

    this.setData({ tryonCost: tc, showPointsSection: show, configAvailable: true });
  },

  // —— 实时配置监听 ——
  startConfigWatcher() {
    const db = wx.cloud.database();
    if (this._configWatcher && this._configWatcher.close) {
      try { this._configWatcher.close(); } catch (_) { }
    }
    this._configWatcher = db.collection('points_config').doc('global')
      .watch({
        onChange: async snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null;
          if (doc) {
            const app = getApp(); // Define app here
            // 1. 先应用当前配置（可能是旧图或缓存图）
            this._applyConfig(doc);

            // 2. 后台静默同步资源（下载新图）
            const hasUpdate = await StyleManager.syncResources(doc);

            // 3. 如果资源有更新（下载了新图），再次刷新 UI 以显示新图
            if (hasUpdate) {
              this._applyConfig(doc);
            }

            if (app.globalData) app.globalData.pointsConfig = doc;
            wx.setStorageSync('pointsConfig', doc);
          }
        },
        onError: err => {
          console.error('[Config] watch error', err);
          this.startConfigPolling();
        }
      });
  },
  stopConfigWatcher() {
    if (this._configWatcher && this._configWatcher.close) {
      try { this._configWatcher.close(); } catch (_) { }
      this._configWatcher = null;
    }
    this.stopConfigPolling();
  },

  // —— 配置轮询降级 ——
  startConfigPolling() {
    if (this._configPollingTimer) return;
    // 每10秒拉取一次配置，确保按钮消耗点数保持最新
    this._configPollingTimer = setInterval(async () => {
      try {
        const app = getApp();
        const cfgRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } });
        if (cfgRes.result && cfgRes.result.success) {
          const cfg = cfgRes.result.data;

          // 1. 应用配置
          this._applyConfig(cfg);

          // 2. 静默同步资源
          const hasUpdate = await StyleManager.syncResources(cfg);

          // 3. 资源更新后刷新
          if (hasUpdate) {
            this._applyConfig(cfg);
          }

          if (app.globalData) app.globalData.pointsConfig = cfg;
          wx.setStorageSync('pointsConfig', cfg);
        }
      } catch (err) {
        // 静默失败，下一轮继续
      }
    }, 10000);
  },
  stopConfigPolling() {
    if (this._configPollingTimer) {
      try { clearInterval(this._configPollingTimer); } catch (_) { }
      this._configPollingTimer = null;
    }
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '化妆品日期记录器 - 妆容分析',
      path: '/pages/makeup/makeup'
    };
  },

  /**
   * 选择风格
   */
  onSelectStyle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedStyleId: id });
  },

  /**
   * 分析图片
   */
  analyzeImage() {
    if (this.data.isUploading) return;
    if (!this.data.imageUrl) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }
    // 校验风格是否选择
    if (!this.data.selectedStyleId) {
      wx.showToast({ title: '请选择一种妆容风格', icon: 'none' });
      return;
    }

    if (!this.data.configAvailable) { wx.showToast({ title: '消耗点数失败，请稍后重试', icon: 'none' }); return; }

    const need = this.data.tryonCost;
    if (this.data.points < need) {
      wx.showModal({ title: '妆妆蛋不足', content: `立即试妆需要消耗${need}点，当前点数不足。`, showCancel: false });
      return;
    }
    // 传递 imageUrl、styleId 和 styleName
    const selectedStyle = this.data.styles.find(s => s.id === this.data.selectedStyleId);
    const styleName = selectedStyle ? selectedStyle.name : '';
    const url = `/pages/analyzing/analyzing?imageUrl=${encodeURIComponent(this.data.imageUrl)}&need=${need}&styleId=${this.data.selectedStyleId}&styleName=${encodeURIComponent(styleName)}`;
    wx.navigateTo({ url });
  },

  onShowTips() {
    this.setData({ isTipsShow: true });
  },

  onHideTips() {
    this.setData({ isTipsShow: false });
  },

  goPointsPage() {
    wx.navigateTo({
      url: '/pages/points/points'
    });
  }
})