// pages/result/result.js
Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 用户上传的原图
    originalImage: '',
    
    // 妆妆蛋资源点数量
    points: 0,
    
    // 分析结果数据（预留接口字段）
    analysisResult: {
      // 面容分析
      face: '面容：脸型为椭圆形，轮廓线条柔和，面部比例协调。五官中等大小适宜，眼睛大小适中，眼神舒缓，眉形自然，鼻梁挺直，嘴唇饱满，整体面部特征协调统一。',
      
      // 皮肤分析
      skin: '优点：肌肤底色干净，原生状态好，无明显大瑕疵；缺点：存在少量暗沉，色泽沉着及小瑕疵，肤色均匀度欠佳。',
      
      // 妆容分析
      makeup: '优点：整体为自然裸妆感，底妆轻薄贴合，保留肌肤真实质感，呈现干净清爽的状态，高级感与不做作，缺点：缺饰修饰眼妆，缺乏遮瑕，眼部无强化，精致度不足。',
      
      // 发型分析
      hairstyle: '优点：黑色长发自然顺滑，发质看起来健康有光泽，能很好托面部轮廓，传达温柔亲和气质；缺点：设计简单，缺乏层次感与造型感，风格单调，时尚表现力不足。',
      
      // 优化建议
      suggestions: '25-30岁女性可适度提升妆教，保留自然底妆用轻薄粉底液进行遮瑕，局部提亮；眼妆选择大地色系，眼影设计大地色眼影及棕睫毛膏及眼线，唇妆选择'
    },
    // 来自上一工作流的image_prompt与可用图片URL
    imagePrompt: '',
    photoUrl: '',
    
    // 生成参考图遮罩
    overlayVisible: false,
    _genTimeoutTimer: null,
    generateCost: 5
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取上级页面传递的图片数据
    if (options.imageUrl) {
      this.setData({
        originalImage: decodeURIComponent(options.imageUrl)
      });
    }

    // 通过事件通道接收分析结果（来自妆容页）
    try {
      const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (eventChannel && eventChannel.on) {
        eventChannel.on('analysisData', (data) => {
          // 将数据映射到页面展示结构
          this.setData({
            analysisResult: {
              face: data.face || '',
              skin: data.skin || '',
              makeup: data.makeup || '',
              hairstyle: data.hairstyle || '',
              suggestions: data.suggestions || ''
            }
          });
          console.log('接收到分析结果并已渲染到页面', this.data.analysisResult);
        });
      }
    } catch (e) {
      console.warn('事件通道不可用，使用预设数据', e);
    }
    
    // 通过事件通道接收分析结果（来自妆容页）
    try {
      const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (eventChannel && eventChannel.on) {
        eventChannel.on('analysisData', (data) => {
          // 数据映射到页面展示结构
          this.setData({
            analysisResult: {
              face: data.face || '',
              skin: data.skin || '',
              makeup: data.makeup || '',
              hairstyle: data.hairstyle || '',
              suggestions: data.suggestions || ''
            },
            imagePrompt: data.imagePrompt || '',
            photoUrl: data.photoUrl || ''
          });
          this.logEvent('result-analysis-received', { hasPrompt: !!data.imagePrompt, hasPhotoUrl: !!data.photoUrl });
        });
      }
    } catch (e) {
      console.warn('事件通道不可用，使用预设数据', e);
    }

    // 获取全局积分数据
    this.loadUserPoints();
    // 读取运营配置与开启积分监听
    this.loadPointsConfig();
    this.startPointsWatcher();
    // 开启配置实时监听，确保 generate_cost 动态更新
    this.startConfigWatcher();
    
    // TODO: 调用分析接口获取真实数据
    this.loadAnalysisResult();
  },

  /**
   * 显示/隐藏遮罩
   */
  showOverlay() { this.setData({ overlayVisible: true }); },
  hideOverlay() { this.setData({ overlayVisible: false }); },
  preventTouchMove() {},
  blockTap() {},

  /**
   * 生成妆容参考：调用扣子工作流
   * 输入参数：photo（临时URL优先，其次原图），prompt（上一工作流的image_prompt）
   * 超时：120秒
   */
  async generateMakeupReference() {
    // 避免重复触发
    if (this.data.overlayVisible) return;

    // 校验必要参数
    const photo = this.data.photoUrl || this.data.originalImage;
    const prompt = this.data.imagePrompt || '';
    if (!photo) {
      wx.showToast({ title: '图片不可用', icon: 'none' });
      return;
    }

    // 显示遮罩
    this.showOverlay();

    // 仅检查积分是否足够；实际扣减在成功后执行
    const need = this.data.generateCost || 5;
    if (this.data.points < need) {
      this.hideOverlay();
      wx.showModal({ title: '妆妆蛋不足', content: `生成参考图需要消耗${need}点，当前点数不足。`, showCancel: false });
      return;
    }

    // 设置超时定时器
    if (this.data._genTimeoutTimer) clearTimeout(this.data._genTimeoutTimer);
    this.data._genTimeoutTimer = setTimeout(() => {
      this.hideOverlay();
      this.logEvent('generate-timeout', { timeoutMs: 120000 });
      wx.showModal({ title: '超时', content: '生成超时，请稍后重试', showCancel: false });
    }, 120000);

    const start = Date.now();
    this.logEvent('generate-start', { alias: 'generate_reference', hasPhotoUrl: !!this.data.photoUrl, hasPrompt: !!prompt });

    try {
      const res = await require('../../docs/coze_workflow_api_reference.js').callCozeWorkflow({
        alias: 'generate_reference',
        parameters: { photo, prompt }
      });
      const parsed = require('../../docs/coze_workflow_api_reference.js').parseWorkflowResponse(res);
      const outputUrl = parsed.output || parsed.image || parsed.url || '';
      const durationMs = Date.now() - start;
      this.logEvent('generate-success', { durationMs, outputUrlLen: outputUrl.length });

      // 清理定时器与遮罩
      clearTimeout(this.data._genTimeoutTimer);
      this.hideOverlay();

      if (!outputUrl) {
        wx.showModal({ title: '生成失败', content: '未获取到参考图地址', showCancel: false });
        return;
      }

      // 成功后扣减资源点（后付费），不阻塞后续跳转
      this.postConsumePointsAfterSuccess(need, 'generate');

      // 跳转到参考页并传递参考图URL
      wx.navigateTo({
        url: `/pages/reference/reference?originalImage=${encodeURIComponent(this.data.originalImage)}`,
        success: (resNav) => {
          const ec = resNav.eventChannel;
          ec && ec.emit('referenceData', { referenceImage: outputUrl });
        }
      });
    } catch (err) {
      clearTimeout(this.data._genTimeoutTimer);
      this.hideOverlay();
      this.logEvent('generate-fail', { errMsg: err && err.errMsg, error: err });
      wx.showModal({
        title: '生成失败',
        content: (err && err.errMsg) ? err.errMsg : '网络或服务异常，请稍后重试',
        showCancel: false
      });
    }
  },

  // 成功后执行资源点扣减（带一次重试），不阻塞用户流程
  async postConsumePointsAfterSuccess(amount, reason) {
    try {
      const app = getApp();
      const tryConsume = async () => {
        return await wx.cloud.callFunction({ name: 'points', data: { action: 'consume', amount, reason } });
      };
      let res = await tryConsume();
      if (!(res.result && res.result.success)) {
        await new Promise(r => setTimeout(r, 500));
        res = await tryConsume();
      }
      if (res.result && res.result.success) {
        const newPoints = (res.result.data && res.result.data.points);
        if (typeof newPoints === 'number') {
          this.setData({ points: newPoints });
          if (app.globalData) { app.globalData.userPoints = newPoints }
          wx.setStorageSync('userPoints', newPoints);
        }
      } else {
        throw new Error(res.result && res.result.message || '扣减失败');
      }
    } catch (e) {
      this.logEvent('post-consume-fail', { reason, errMsg: e && e.message });
      wx.showToast({ title: '扣减失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 轻量日志
   */
  logEvent(type, payload = {}) {
    const ts = new Date();
    const stamp = `${ts.getFullYear()}-${(ts.getMonth()+1).toString().padStart(2,'0')}-${ts.getDate().toString().padStart(2,'0')} ${ts.getHours().toString().padStart(2,'0')}:${ts.getMinutes().toString().padStart(2,'0')}:${ts.getSeconds().toString().padStart(2,'0')}.${ts.getMilliseconds().toString().padStart(3,'0')}`;
    console.log(`[result][${stamp}] ${type}`, payload);
  },

  /**
   * 加载用户积分数据
   */
  loadUserPoints() {
    const stored = wx.getStorageSync('userPoints');
    const app = getApp();
    if (stored !== '' && stored !== null && stored !== undefined) {
      this.setData({ points: stored });
      if (app.globalData) app.globalData.userPoints = stored;
      return;
    }

    const gp = app.globalData && app.globalData.userPoints;
    if (gp !== undefined && gp !== null) {
      this.setData({ points: gp });
      wx.setStorageSync('userPoints', gp);
      return;
    }

    // 默认值以配置为准（如不可用则回退 100）
    const cfg = app.globalData && app.globalData.pointsConfig;
    const defaultPoints = (cfg && typeof cfg.initial_points === 'number') ? cfg.initial_points : 100;
    this.setData({ points: defaultPoints });
    wx.setStorageSync('userPoints', defaultPoints);
    if (app.globalData) app.globalData.userPoints = defaultPoints;
  },

  // 读取运营配置
  async loadPointsConfig() {
    try {
      const app = getApp();
      if (app.globalData && app.globalData.pointsConfig) {
        this.setData({ generateCost: app.globalData.pointsConfig.generate_cost || 5 });
        return;
      }
      const cfgRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } });
      if (cfgRes.result && cfgRes.result.success) {
        const cfg = cfgRes.result.data;
        this.setData({ generateCost: cfg.generate_cost || 5 });
        if (app.globalData) app.globalData.pointsConfig = cfg;
      }
    } catch (e) {
      console.warn('加载配置失败，使用默认', e);
    }
  },

  // —— 积分实时监听 ——
  startPointsWatcher() {
    try {
      const app = getApp();
      const openid = app.globalData && app.globalData.openid;
      if (!openid) return;
      const db = wx.cloud.database();
      if (this._pointsWatcher && this._pointsWatcher.close) {
        try { this._pointsWatcher.close(); } catch (_) {}
      }
      this._pointsWatcher = db.collection('user_points').doc(openid).watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null;
          if (doc && typeof doc.points === 'number') {
            this.setData({ points: doc.points });
          }
        },
        onError: err => {
          console.error('result 积分监听错误', err);
        }
      });
    } catch (e) {
      console.error('result 开启积分监听失败', e);
    }
  },
  stopPointsWatcher() {
    if (this._pointsWatcher && this._pointsWatcher.close) {
      try { this._pointsWatcher.close(); } catch (_) {}
      this._pointsWatcher = null;
    }
  },

  /**
   * 加载分析结果（预留接口）
   */
  loadAnalysisResult() {
    // TODO: 替换为真实的API调用
    console.log('加载分析结果 - 当前使用模拟数据');
    
    // 模拟API调用
    // wx.request({
    //   url: 'https://your-api.com/analyze',
    //   method: 'POST',
    //   data: {
    //     imageUrl: this.data.originalImage
    //   },
    //   success: (res) => {
    //     this.setData({
    //       analysisResult: res.data
    //     });
    //   }
    // });
  },

  // 删除旧的generateMakeupReference实现（已在前文替换为异步工作流调用版）

  // —— 配置实时监听（points_config/global） ——
  startConfigWatcher() {
    try {
      if (this._configWatchDisabled) return; // 若已判定不可用则不再尝试
      const db = wx.cloud.database();
      if (this._configWatcher && this._configWatcher.close) {
        try { this._configWatcher.close(); } catch (_) {}
      }
      this._configWatcher = db.collection('points_config').doc('global').watch({
        onChange: snapshot => {
          const doc = (snapshot && snapshot.docs && snapshot.docs[0]) || null;
          if (doc) {
            const gc = (typeof doc.generate_cost === 'number') ? doc.generate_cost : this.data.generateCost;
            if (gc !== this.data.generateCost) {
              this.setData({ generateCost: gc });
            }
          }
        },
        onError: err => {
          console.error('result 配置监听错误', err);
          this._configWatchDisabled = true;
          // 监听失败时降级为轮询
          this.startConfigPolling();
        }
      });
      this._configWatchActive = true;
    } catch (e) {
      console.error('result 开启配置监听失败', e);
      this._configWatchDisabled = true;
      this._configWatchActive = false;
      // watch 初始化失败，启用轮询
      this.startConfigPolling();
    }
  },
  stopConfigWatcher() {
    if (this._configWatcher && this._configWatcher.close) {
      try { this._configWatcher.close(); } catch (_) {}
      this._configWatcher = null;
    }
    this._configWatchActive = false;
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
          const gc = (typeof cfg.generate_cost === 'number') ? cfg.generate_cost : this.data.generateCost;
          if (gc !== this.data.generateCost) {
            this.setData({ generateCost: gc });
          }
          if (app.globalData) app.globalData.pointsConfig = cfg;
        }
      } catch (err) {
        // 静默失败，下一轮继续
      }
    }, 10000);
  },
  stopConfigPolling() {
    if (this._configPollingTimer) {
      try { clearInterval(this._configPollingTimer); } catch (_) {}
      this._configPollingTimer = null;
    }
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
    // 每次页面显示时同步积分数据
    this.loadUserPoints();
    // 同步最新配置
    this.loadPointsConfig();
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
    if (this.data.overlayVisible) {
      wx.stopPullDownRefresh();
      return;
    }
    wx.stopPullDownRefresh();
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

  }
})