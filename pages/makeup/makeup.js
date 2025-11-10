// pages/makeup/makeup.js
const coze = require('../../docs/coze_workflow_api_reference.js');
Page({

  /**
   * 页面的初始数据
   */
  data: {
    imageUrl: '', // 上传的图片路径
    points: 0,   // 妆妆蛋资源点数量
    analyzeCost: 3, // 每次分析消耗点数（可配置）
    isUploading: false, // 图片上传状态
    uploadedFileId: '', // 云存储fileID
    uploadedTempFileUrl: '', // 云存储临时URL
    overlayVisible: false // 全屏遮罩显示状态
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 初始化页面数据
    this.initializeData();
  },

  /**
   * 初始化页面数据
   */
  initializeData() {
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
    if (app.globalData && app.globalData.pointsConfig) {
      this.setData({ analyzeCost: app.globalData.pointsConfig.analyze_cost || 3 });
    } else {
      this.loadPointsConfig();
    }

    // 尝试开启监听；如果 openid 尚未就绪，稍后重试一次
    this.startPointsWatcher();
    if (!(app.globalData && app.globalData.openid)) {
      setTimeout(() => this.startPointsWatcher(), 600);
    }
    // 开启配置实时监听
    this.startConfigWatcher();
  },

  // 读取运营配置（analyze_cost）
  async loadPointsConfig() {
    try {
      const app = getApp();
      if (app.globalData && app.globalData.pointsConfig) {
        this.setData({ analyzeCost: app.globalData.pointsConfig.analyze_cost || 3 });
        return;
      }
      const cfgRes = await wx.cloud.callFunction({ name: 'points', data: { action: 'getConfig' } });
      if (cfgRes.result && cfgRes.result.success) {
        const cfg = cfgRes.result.data;
        this.setData({ analyzeCost: cfg.analyze_cost || 3 });
        if (app.globalData) app.globalData.pointsConfig = cfg;
      }
    } catch (e) {
      console.warn('加载配置失败，使用默认 analyzeCost', e);
    }
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
   * 上传图片到云存储并获取URL
   */
  uploadImageToCloud(filePath) {
    const extIndex = filePath.lastIndexOf('.');
    const ext = extIndex !== -1 ? filePath.substring(extIndex + 1).toLowerCase() : 'jpg';
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const cloudPath = `user_makeup_uploads/${uniqueId}.${ext}`;

    this.setData({ isUploading: true });
    wx.showLoading({ title: '上传中...' });

    this.logEvent('upload-start', { cloudPath, filePath });

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        const fileID = res.fileID;
        this.logEvent('upload-success', { cloudPath, fileID });

      wx.cloud.getTempFileURL({
          fileList: [fileID]
        }).then((urlRes) => {
          const info = urlRes.fileList && urlRes.fileList[0] ? urlRes.fileList[0] : null;
          const tempFileURL = info ? info.tempFileURL : '';

          this.setData({
            uploadedFileId: fileID,
            uploadedTempFileUrl: tempFileURL
          });

          this.logEvent('url-fetched', { fileID, tempFileURL });
          // 获取到临时URL后，调用Coze图片分析工作流
          this.callMakeupWorkflow(tempFileURL);
        // 上传成功提示留给整体流程完成后再统一提示
        }).catch((err) => {
          this.logEvent('url-fetch-fail', { error: err });
          wx.showToast({ title: '获取URL失败', icon: 'none' });
        }).finally(() => {
          this.setData({ isUploading: false });
          // 由整体流程控制遮罩显示/隐藏
        });
      },
      fail: (err) => {
        this.logEvent('upload-fail', { cloudPath, error: err });
        wx.showToast({ title: '上传失败', icon: 'none' });
        this.setData({ isUploading: false });
        this.hideOverlay();
      },
      complete: () => {
        // 仅用于标记流程结束，详细处理在success/fail中
      }
    });
  },

  /**
   * 调用Coze图片分析工作流
   * 使用占位符的API Key与workflow_id，参数仅包含photo（图片URL）
   * 输出参数：facial_features, skin, makeup, hairstyle, improve, image_prompt
   */
  callMakeupWorkflow(photoUrl) {
    if (!photoUrl) {
      this.logEvent('coze-call-skip', { reason: 'empty photoUrl' });
      return Promise.reject(new Error('empty photoUrl'));
    }
    // 遮罩层已显示，这里不再使用系统loading
    this.logEvent('coze-call-start', {
      alias: 'analyze',
      photo: photoUrl
    });

    return coze.callCozeWorkflow({
      alias: 'analyze',
      parameters: { photo: photoUrl }
    })
      .then((res) => {
        let parsed;
        try {
          parsed = coze.parseWorkflowResponse(res);
        } catch (e) {
          this.logEvent('coze-parse-fail', { error: e && e.message });
          wx.showToast({ title: '结果解析失败', icon: 'none' });
          throw e;
        }

        const outputs = {
          facial_features: parsed.facial_features || '',
          skin: parsed.skin || '',
          makeup: parsed.makeup || '',
          hairstyle: parsed.hairstyle || '',
          improve: parsed.improve || '',
          image_prompt: parsed.image_prompt || ''
        };

        // 打印到调试台
        this.logEvent('coze-result', outputs);
        return outputs;
      })
      .catch((err) => {
        // 仅记录并传播错误，由上层统一提示，避免重复弹窗
        const wfErr = (err instanceof Error)
          ? err
          : new Error((err && err.errMsg) ? err.errMsg : String(err));
        // 标记错误类型供上层识别
        // @ts-ignore
        wfErr.code = 'WORKFLOW_FAILED';
        this.logEvent('coze-call-fail', { error: wfErr && wfErr.message });
        throw wfErr;
      });
  },

  /**
   * 显示/隐藏遮罩
   */
  showOverlay() {
    this.setData({ overlayVisible: true });
  },
  hideOverlay() {
    this.setData({ overlayVisible: false });
  },
  preventTouchMove() {},
  blockTap() {},

  /**
   * 统一流程：显示遮罩 -> 上传图片 -> 调用工作流 -> 跳转结果
   * 包含120秒超时与错误处理
   */
  startAnalysisFlow() {
    if (!this.data.imageUrl) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }

    // 显示遮罩并设置超时
    this.showOverlay();
    if (this._analysisTimeoutTimer) {
      clearTimeout(this._analysisTimeoutTimer);
    }
    this._analysisTimeoutTimer = setTimeout(() => {
      this.logEvent('analysis-timeout', { timeoutMs: 120000 });
      this.hideOverlay();
      wx.showToast({ title: '网络超时，请重试', icon: 'none' });
    }, 120000);

    // 先上传，再调用工作流
    const localPath = this.data.imageUrl;
    const extIndex = localPath.lastIndexOf('.');
    const ext = extIndex !== -1 ? localPath.substring(extIndex + 1).toLowerCase() : 'jpg';
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const cloudPath = `user_makeup_uploads/${uniqueId}.${ext}`;

    this.setData({ isUploading: true });
    wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
      success: (res) => {
        const fileID = res.fileID;
        wx.cloud.getTempFileURL({ fileList: [fileID] })
          .then((urlRes) => {
            const info = urlRes.fileList && urlRes.fileList[0] ? urlRes.fileList[0] : null;
            const tempFileURL = info ? info.tempFileURL : '';
            this.setData({ uploadedFileId: fileID, uploadedTempFileUrl: tempFileURL });
            this.logEvent('url-fetched', { fileID, tempFileURL });

            // 调用工作流
            return this.callMakeupWorkflow(tempFileURL);
          })
          .then((outputs) => {
            // 成功，隐藏遮罩并跳转
            clearTimeout(this._analysisTimeoutTimer);
            this.hideOverlay();

            // 跳转到结果页，携带原图与分析结果
            const mapped = {
              face: outputs.facial_features,
              skin: outputs.skin,
              makeup: outputs.makeup,
              hairstyle: outputs.hairstyle,
              suggestions: outputs.improve,
              imagePrompt: outputs.image_prompt,
              photoUrl: this.data.uploadedTempFileUrl
            };

            // 成功后执行扣减（后付费），不阻塞跳转
            const need = this.data.analyzeCost || 3;
            this.postConsumePointsAfterSuccess(need, 'analyze');

            wx.navigateTo({
              url: `/pages/result/result?imageUrl=${encodeURIComponent(this.data.imageUrl)}`,
              success: (resNav) => {
                const ec = resNav.eventChannel;
                ec && ec.emit('analysisData', mapped);
              }
            });
          })
          .catch((err) => {
            // 失败，隐藏遮罩并提示
            clearTimeout(this._analysisTimeoutTimer);
            this.hideOverlay();
            this.logEvent('analysis-fail', { error: err });
            const isWorkflowErr = err && (err.code === 'WORKFLOW_FAILED');
            wx.showModal({
              title: isWorkflowErr ? '工作流调用失败' : '分析失败',
              content: isWorkflowErr
                ? '工作流调用失败'
                : ((err && err.errMsg) ? err.errMsg : (typeof err === 'string' ? err : '网络或服务异常，请重试')),
              showCancel: false
            });
          })
          .finally(() => {
            this.setData({ isUploading: false });
          });
      },
      fail: (err) => {
        clearTimeout(this._analysisTimeoutTimer);
        this.setData({ isUploading: false });
        this.hideOverlay();
        this.logEvent('upload-fail', { cloudPath, error: err });
        wx.showModal({
          title: '上传失败',
          content: (err && err.errMsg) ? err.errMsg : '请检查网络后重试',
          showCancel: false
        });
      }
    });
  },

  /**
   * 日志输出（含时间戳与操作类型）
   */
  logEvent(type, payload) {
    const ts = this.formatTimestamp(new Date());
    console.log(`[${ts}] [${type}]`, payload || {});
  },

  /**
   * 格式化时间戳
   */
  formatTimestamp(date) {
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const ms = `${date.getMilliseconds()}`.padStart(3, '0');
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}.${ms}`;
  },

  /**
   * 分析图片
   */
  analyzeImage() {
    // 分析进行中禁止重复触发
    if (this.data.overlayVisible) {
      return;
    }
    if (!this.data.imageUrl) {
      wx.showToast({
        title: '请先上传图片',
        icon: 'none'
      });
      return;
    }
    // 检查积分是否足够（按配置）
    const need = this.data.analyzeCost || 3;
    if (this.data.points < need) {
      wx.showModal({
        title: '妆妆蛋不足',
        content: `立即分析需要消耗${need}点，当前点数不足。`,
        showCancel: false
      });
      return;
    }

    // 立即显示遮罩，开始分析流程（后扣减）
    this.showOverlay();
    this.startAnalysisFlow();
  },

  // 扣减积分并启动分析流程（带一次重试）
  async consumePointsAndAnalyze(need) {
    const app = getApp();
    const tryConsume = async () => {
      return await wx.cloud.callFunction({ name: 'points', data: { action: 'consume', amount: need, reason: 'analyze' } });
    }
    try {
      let res = await tryConsume();
      if (!(res.result && res.result.success)) {
        // 不足或其他错误
        const code = res.result && res.result.code;
        if (code === 'INSUFFICIENT') {
          wx.showModal({ title: '妆妆蛋不足', content: `需要${need}点，当前不足。`, showCancel: false });
          return;
        }
        // 网络等异常，重试一次
        await new Promise(r => setTimeout(r, 500));
        res = await tryConsume();
        if (!(res.result && res.result.success)) {
          throw new Error(res.result && res.result.message || '扣减失败');
        }
      }

      // 更新本地与全局积分
      const newPoints = (res.result.data && res.result.data.points);
      if (typeof newPoints === 'number') {
        this.setData({ points: newPoints });
        if (app.globalData) {
          app.globalData.userPoints = newPoints;
        }
        wx.setStorageSync('userPoints', newPoints);
      }

      // 启动分析流程
      this.startAnalysisFlow();
    } catch (e) {
      console.error('扣减积分失败:', e);
      // 扣减失败需关闭遮罩，避免界面卡住
      this.hideOverlay();
      wx.showModal({ title: '网络异常', content: '扣减失败，请稍后重试', showCancel: false });
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
          if (app.globalData) { app.globalData.userPoints = newPoints; }
          wx.setStorageSync('userPoints', newPoints);
        }
      } else {
        throw new Error(res.result && res.result.message || '扣减失败');
      }
    } catch (e) {
      this.logEvent('post-consume-fail', { reason, error: e && e.message });
      wx.showToast({ title: '扣减失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 执行图片分析（预留接口）
   */
  performImageAnalysis() {
    wx.showLoading({
      title: '分析中...'
    });

    // TODO: 调用AI分析接口
    console.log('开始分析图片:', this.data.imageUrl);
    
    // 模拟分析过程
    setTimeout(() => {
      wx.hideLoading();
      
      // 扣除积分
      const newPoints = this.data.points - 1;
      this.setData({
        points: newPoints
      });
      
      // 更新全局数据
      const app = getApp();
      if (app.globalData) {
        app.globalData.userPoints = newPoints;
      }
      
      // 跳转到分析结果页面
      wx.navigateTo({
        url: `/pages/result/result?imageUrl=${encodeURIComponent(this.data.imageUrl)}`
      });
    }, 2000);
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
    // 页面显示时刷新积分数据
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
    // 分析期间禁用下拉刷新
    if (this.data.overlayVisible) {
      wx.stopPullDownRefresh();
      return;
    }
    // 正常刷新页面数据
    this.initializeData();
    wx.stopPullDownRefresh();
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
          console.error('makeup 积分监听错误', err);
        }
      });
    } catch (e) {
      console.error('makeup 开启积分监听失败', e);
    }
  },
  stopPointsWatcher() {
    if (this._pointsWatcher && this._pointsWatcher.close) {
      try { this._pointsWatcher.close(); } catch (_) {}
      this._pointsWatcher = null;
    }
  },

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
            const ac = (typeof doc.analyze_cost === 'number') ? doc.analyze_cost : this.data.analyzeCost;
            this.setData({ analyzeCost: ac });
          }
        },
        onError: err => {
          console.error('makeup 配置监听错误', err);
          this._configWatchDisabled = true;
          // 监听失败时降级为轮询
          this.startConfigPolling();
        }
      });
      this._configWatchActive = true;
    } catch (e) {
      console.error('makeup 开启配置监听失败', e);
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
          const ac = (typeof cfg.analyze_cost === 'number') ? cfg.analyze_cost : this.data.analyzeCost;
          if (ac !== this.data.analyzeCost) {
            this.setData({ analyzeCost: ac });
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
  }
})