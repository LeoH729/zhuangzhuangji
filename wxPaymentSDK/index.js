/**
 * 微信支付SDK - 主入口文件
 * 基于微信支付V3 API实现的完整支付解决方案
 * 
 * 使用方法:
 * const WxPaymentSDK = require('./wxPaymentSDK/index.js');
 * 
 * // 发起支付
 * const result = await WxPaymentSDK.processPayment(userInfo);
 */

/**
 * 微信支付SDK类
 */
class WxPaymentSDK {
  
  /**
   * 完整的支付流程
   * @param {Object} userInfo 用户信息
   * @param {Object} options 支付选项
   * @returns {Promise} 支付结果
   */
  static async processPayment(userInfo, options = {}) {
    console.log('=== 微信支付SDK：开始支付流程 ===');
    
    try {
      // 参数验证
      if (!userInfo || !userInfo.nickName) {
        return {
          success: false,
          message: '用户信息不完整',
          code: 'INVALID_USER_INFO'
        };
      }
      
      // 第一步：创建支付订单
      console.log('第一步：创建支付订单');
      const orderResult = await this.createOrder(userInfo, options);
      
      if (!orderResult.success) {
        return orderResult;
      }
      
      // 第二步：调起微信支付
      console.log('第二步：调起微信支付');
      const paymentResult = await this.requestPayment(orderResult.payParams);
      
      // 返回完整的支付结果
      return {
        success: paymentResult.success,
        message: paymentResult.message,
        orderNo: orderResult.orderNo,
        prepayId: orderResult.prepayId,
        cancelled: paymentResult.cancelled || false,
        code: paymentResult.code,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('微信支付SDK异常:', error);
      return {
        success: false,
        message: error.message || '支付异常',
        code: 'PAYMENT_EXCEPTION',
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * 创建支付订单
   * @param {Object} userInfo 用户信息
   * @param {Object} options 订单选项
   * @returns {Promise} 订单创建结果
   */
  static async createOrder(userInfo, options = {}) {
    console.log('=== 微信支付SDK：创建订单 ===');
    
    return new Promise((resolve) => {
      // 显示加载提示
      wx.showLoading({
        title: '创建订单中...',
        mask: true
      });
      
      // 调用云函数创建订单
      wx.cloud.callFunction({
        name: 'createPayment',
        data: {
          userInfo: userInfo,
          options: options,
          timestamp: Date.now()
        },
        success: (res) => {
          wx.hideLoading();
          console.log('订单创建云函数响应:', res);
          
          if (res.result && res.result.success) {
            resolve({
              success: true,
              orderNo: res.result.data.orderNo,
              prepayId: res.result.data.prepayId,
              payParams: res.result.data.payParams,
              message: '订单创建成功'
            });
          } else {
            resolve({
              success: false,
              message: res.result?.message || '订单创建失败',
              code: res.result?.code || 'CREATE_ORDER_FAILED'
            });
          }
        },
        fail: (error) => {
          wx.hideLoading();
          console.error('调用创建订单云函数失败:', error);
          resolve({
            success: false,
            message: '网络请求失败',
            code: 'NETWORK_ERROR'
          });
        }
      });
    });
  }
  
  /**
   * 调起微信支付
   * @param {Object} payParams 支付参数
   * @returns {Promise} 支付结果
   */
  static async requestPayment(payParams) {
    console.log('=== 微信支付SDK：调起支付 ===');
    
    // 验证支付参数
    if (!this.validatePayParams(payParams)) {
      return {
        success: false,
        message: '支付参数不完整',
        code: 'INVALID_PAY_PARAMS'
      };
    }
    
    return new Promise((resolve) => {
      console.log('调起微信支付，参数:', payParams);
      
      wx.requestPayment({
        ...payParams,
        success: (res) => {
          console.log('微信支付成功:', res);
          resolve({
            success: true,
            message: '支付成功',
            result: res
          });
        },
        fail: (err) => {
          console.error('微信支付失败:', err);
          
          // 判断失败原因
          if (err.errMsg && err.errMsg.indexOf('cancel') > -1) {
            // 用户取消支付
            resolve({
              success: false,
              cancelled: true,
              message: '用户取消支付',
              code: 'USER_CANCEL'
            });
          } else {
            // 其他支付失败
            resolve({
              success: false,
              message: err.errMsg || '支付失败',
              code: 'PAYMENT_FAILED',
              error: err
            });
          }
        }
      });
    });
  }
  
  /**
   * 验证支付参数
   * @param {Object} payParams 支付参数
   * @returns {boolean} 验证结果
   */
  static validatePayParams(payParams) {
    const requiredFields = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'];
    return requiredFields.every(field => payParams && payParams[field]);
  }
  
  /**
   * 查询支付结果
   * @param {string} orderNo 订单号
   * @returns {Promise} 查询结果
   */
  static async queryPaymentResult(orderNo) {
    console.log('=== 微信支付SDK：查询支付结果 ===');
    
    if (!orderNo) {
      return {
        success: false,
        message: '订单号不能为空',
        code: 'INVALID_ORDER_NO'
      };
    }
    
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'queryPayment',
        data: {
          orderNo: orderNo
        },
        success: (res) => {
          console.log('查询支付结果响应:', res);
          
          if (res.result) {
            resolve(res.result);
          } else {
            resolve({
              success: false,
              message: '查询失败',
              code: 'QUERY_FAILED'
            });
          }
        },
        fail: (error) => {
          console.error('查询支付结果失败:', error);
          resolve({
            success: false,
            message: '网络请求失败',
            code: 'NETWORK_ERROR'
          });
        }
      });
    });
  }
  
  /**
   * 格式化金额显示
   * @param {number} amount 金额（分）
   * @returns {string} 格式化后的金额
   */
  static formatAmount(amount) {
    return `¥${(amount / 100).toFixed(2)}`;
  }
  
  /**
   * 生成订单号
   * @returns {string} 订单号
   */
  static generateOrderNo() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `WX${timestamp}${random}`;
  }
  
  /**
   * 显示支付结果提示
   * @param {Object} result 支付结果
   */
  static showPaymentToast(result) {
    if (result.success) {
      wx.showToast({
        title: '支付成功',
        icon: 'success',
        duration: 2000
      });
    } else if (result.cancelled) {
      wx.showToast({
        title: '支付已取消',
        icon: 'none',
        duration: 2000
      });
    } else {
      wx.showToast({
        title: result.message || '支付失败',
        icon: 'none',
        duration: 2000
      });
    }
  }
  
  /**
   * 获取SDK版本信息
   * @returns {Object} 版本信息
   */
  static getVersion() {
    return {
      version: '1.0.0',
      apiVersion: 'v3',
      buildTime: '2024-01-01',
      description: '微信支付SDK - 基于微信支付V3 API'
    };
  }
}

// 导出SDK
module.exports = WxPaymentSDK; 