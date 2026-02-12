/**
 * 微信支付SDK 使用示例
 * 演示如何在小程序页面中使用微信支付SDK
 */

// 引入微信支付SDK
const WxPaymentSDK = require('../index.js');

Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    paymentResult: null,
    isLoading: false
  },

  onLoad: function() {
    // 页面加载时检查用户信息
    this.checkUserInfo();
  },

  /**
   * 检查用户信息
   */
  checkUserInfo: function() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo.nickName) {
      this.setData({
        userInfo: userInfo,
        hasUserInfo: true
      });
    }
  },

  /**
   * 获取用户信息
   */
  getUserProfile: function() {
    wx.getUserProfile({
      desc: '用于支付身份验证',
      success: (res) => {
        console.log('获取用户信息成功:', res);
        const userInfo = res.userInfo;
        
        // 保存用户信息到本地存储
        wx.setStorageSync('userInfo', userInfo);
        
        this.setData({
          userInfo: userInfo,
          hasUserInfo: true
        });
      },
      fail: (err) => {
        console.error('获取用户信息失败:', err);
        wx.showToast({
          title: '需要授权才能使用支付功能',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 发起支付 - 基础用法
   */
  async startPayment() {
    if (!this.data.hasUserInfo) {
      wx.showToast({
        title: '请先获取用户信息',
        icon: 'none'
      });
      return;
    }

    this.setData({ isLoading: true });

    try {
      console.log('=== 开始支付流程 ===');
      
      // 调用SDK的完整支付流程
      const result = await WxPaymentSDK.processPayment(this.data.userInfo);
      
      console.log('支付结果:', result);
      this.setData({ 
        paymentResult: result,
        isLoading: false 
      });
      
      // 显示支付结果
      WxPaymentSDK.showPaymentToast(result);
      
    } catch (error) {
      console.error('支付异常:', error);
      this.setData({ isLoading: false });
      
      wx.showToast({
        title: '支付异常',
        icon: 'none'
      });
    }
  },

  /**
   * 发起支付 - 高级用法（分步骤）
   */
  async startAdvancedPayment() {
    if (!this.data.hasUserInfo) {
      wx.showToast({
        title: '请先获取用户信息',
        icon: 'none'
      });
      return;
    }

    this.setData({ isLoading: true });

    try {
      console.log('=== 开始高级支付流程 ===');
      
      // 第一步：创建订单
      console.log('第一步：创建支付订单');
      const orderResult = await WxPaymentSDK.createOrder(this.data.userInfo, {
        description: '自定义商品描述',
        amount: 1 // 支付金额（分）
      });
      
      if (!orderResult.success) {
        throw new Error(orderResult.message);
      }
      
      console.log('订单创建成功:', orderResult);
      
      // 第二步：调起支付
      console.log('第二步：调起微信支付');
      const paymentResult = await WxPaymentSDK.requestPayment(orderResult.payParams);
      
      console.log('支付完成:', paymentResult);
      
      // 第三步：查询支付结果（可选）
      if (paymentResult.success) {
        console.log('第三步：查询支付结果');
        const queryResult = await WxPaymentSDK.queryPaymentResult(orderResult.orderNo);
        console.log('查询结果:', queryResult);
      }
      
      this.setData({ 
        paymentResult: paymentResult,
        isLoading: false 
      });
      
      // 显示支付结果
      WxPaymentSDK.showPaymentToast(paymentResult);
      
    } catch (error) {
      console.error('高级支付流程异常:', error);
      this.setData({ isLoading: false });
      
      wx.showToast({
        title: error.message || '支付异常',
        icon: 'none'
      });
    }
  },

  /**
   * 查询支付结果
   */
  async queryPayment() {
    if (!this.data.paymentResult || !this.data.paymentResult.orderNo) {
      wx.showToast({
        title: '请先发起支付',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({ title: '查询中...' });
      
      const result = await WxPaymentSDK.queryPaymentResult(this.data.paymentResult.orderNo);
      
      wx.hideLoading();
      console.log('查询支付结果:', result);
      
      if (result.success) {
        wx.showModal({
          title: '查询结果',
          content: `订单状态：${result.status || '未知'}\n支付状态：${result.paid ? '已支付' : '未支付'}`,
          showCancel: false
        });
      } else {
        wx.showToast({
          title: result.message || '查询失败',
          icon: 'none'
        });
      }
      
    } catch (error) {
      wx.hideLoading();
      console.error('查询支付结果异常:', error);
      wx.showToast({
        title: '查询异常',
        icon: 'none'
      });
    }
  },

  /**
   * 格式化支付金额
   */
  formatAmount: function(amount) {
    return WxPaymentSDK.formatAmount(amount);
  },

  /**
   * 清除支付结果
   */
  clearResult: function() {
    this.setData({
      paymentResult: null
    });
  },

  /**
   * 查看SDK版本信息
   */
  showSDKInfo: function() {
    const versionInfo = WxPaymentSDK.getVersion();
    
    wx.showModal({
      title: 'SDK信息',
      content: `版本：${versionInfo.version}\nAPI版本：${versionInfo.apiVersion}\n描述：${versionInfo.description}`,
      showCancel: false
    });
  },

  /**
   * 复制订单号
   */
  copyOrderNo: function() {
    if (!this.data.paymentResult || !this.data.paymentResult.orderNo) {
      wx.showToast({
        title: '没有订单号可复制',
        icon: 'none'
      });
      return;
    }

    wx.setClipboardData({
      data: this.data.paymentResult.orderNo,
      success: function() {
        wx.showToast({
          title: '订单号已复制',
          icon: 'success'
        });
      }
    });
  }
}); 