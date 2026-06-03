/**
 * 微信小程序虚拟支付 SDK
 * 专门用于合规化虚拟道具/代币购买
 * 
 * 使用方法:
 * const WxVirtualPaymentSDK = require('../../wxPaymentSDK/virtualPayment.js');
 * 
 * const result = await WxVirtualPaymentSDK.processPayment({
 *   productId: 'points_6',
 *   goodsPrice: 600, // 分为单位
 *   description: '星光充值-尝鲜套餐',
 *   attach: JSON.stringify({...})
 * });
 */
class WxVirtualPaymentSDK {
  
  /**
   * 调起虚拟支付的完整流程
   * @param {Object} options 支付参数
   * @param {string} options.productId 道具唯一ID（微信后台配置）
   * @param {number} options.goodsPrice 道具价格（分）
   * @param {string} options.description 道具描述
   * @param {string} options.attach 透传业务字段
   * @returns {Promise<Object>} 支付处理结果
   */
  static async processPayment(options = {}) {
    console.log('=== 微信虚拟支付 SDK：开始支付流程 ===', options);
    
    try {
      wx.showLoading({ title: '准备支付中...', mask: true });
      
      // 1. 获取微信临时登录凭证 code（用于在云端实时安全换取 session_key，避免数据库过期依赖）
      console.log('[VirtualPay] 正在获取微信登录凭证...');
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject
        });
      });
      
      if (!loginRes || !loginRes.code) {
        throw new Error('获取微信登录凭证失败，请重试');
      }
      console.log('[VirtualPay] 获取登录凭证 code 成功:', loginRes.code);

      // 2. 调用云函数获取安全签名及预下单数据
      console.log('[VirtualPay] 向云端请求预下单及双重安全签名...');
      const signRes = await wx.cloud.callFunction({
        name: 'virtualPayment',
        data: {
          action: 'createOrder',
          code: loginRes.code,           // 临时凭证，用于在云端实时安全换取 session_key
          productId: options.productId, // 道具 ID (例如 points_6)
          goodsPrice: options.goodsPrice, // 价格（分）
          description: options.description,
          attach: options.attach
        }
      });
      wx.hideLoading();

      if (!signRes.result || !signRes.result.success) {
        return {
          success: false,
          message: (signRes.result && signRes.result.message) || '获取支付签名失败',
          code: (signRes.result && signRes.result.code) || 'SIGN_FAILED'
        };
      }

      const signData = signRes.result.data || {};
      const payParams = signData.payParams || {};
      const orderNo = signData.orderNo;
      console.log('[VirtualPay] 成功获取支付参数和订单号:', { orderNo, payParams });

      // 3. 调起小程序虚拟支付 API
      console.log('[VirtualPay] 调起微信官方虚拟支付界面...');
      return new Promise((resolve) => {
        const requestParams = Object.assign({}, payParams, {
          success: (res) => {
            console.log('✅ 微信虚拟支付成功回调:', res);
            resolve({
              success: true,
              orderNo: orderNo,
              message: '支付处理成功',
              result: res
            });
          },
          fail: (err) => {
            console.error('❌ 微信虚拟支付失败回调:', err);
            
            // 判断是否用户主动取消
            if (err.errMsg && (err.errMsg.indexOf('cancel') > -1 || err.errCode === 10000 || err.errCode === -1)) {
              resolve({
                success: false,
                cancelled: true,
                message: '用户取消支付',
                code: 'USER_CANCEL'
              });
            } else {
              resolve({
                success: false,
                message: err.errMsg || '支付失败',
                code: 'PAYMENT_FAILED',
                error: err
              });
            }
          }
        });
        wx.requestVirtualPayment(requestParams);
      });

    } catch (error) {
      wx.hideLoading();
      console.error('微信虚拟支付异常:', error);
      return {
        success: false,
        message: error.message || '支付异常',
        code: 'PAYMENT_EXCEPTION'
      };
    }
  }
}

module.exports = WxVirtualPaymentSDK;
