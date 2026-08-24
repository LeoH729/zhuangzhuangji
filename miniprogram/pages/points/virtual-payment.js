class WxVirtualPaymentSDK {
  static async processPayment(options = {}) {
    try {
      wx.showLoading({ title: '准备支付中...', mask: true })
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: reject })
      })
      if (!loginRes || !loginRes.code) throw new Error('获取微信登录凭证失败，请重试')

      const signRes = await wx.cloud.callFunction({
        name: 'virtualPayment',
        data: {
          action: 'createOrder',
          code: loginRes.code,
          productId: options.productId,
          goodsPrice: options.goodsPrice,
          description: options.description,
          attach: options.attach
        }
      })
      wx.hideLoading()
      if (!signRes.result || !signRes.result.success) {
        return {
          success: false,
          message: signRes.result && signRes.result.message || '获取支付签名失败',
          code: signRes.result && signRes.result.code || 'SIGN_FAILED'
        }
      }

      const signData = signRes.result.data || {}
      const orderNo = signData.orderNo
      return new Promise(resolve => {
        wx.requestVirtualPayment(Object.assign({}, signData.payParams || {}, {
          success: result => resolve({ success: true, orderNo, message: '支付处理成功', result }),
          fail: error => {
            if (error.errMsg && (error.errMsg.includes('cancel') || error.errCode === 10000 || error.errCode === -1)) {
              resolve({ success: false, cancelled: true, message: '用户取消支付', code: 'USER_CANCEL' })
              return
            }
            resolve({ success: false, message: error.errMsg || '支付失败', code: 'PAYMENT_FAILED', error })
          }
        }))
      })
    } catch (error) {
      wx.hideLoading()
      return { success: false, message: error.message || '支付异常', code: 'PAYMENT_EXCEPTION' }
    }
  }
}

module.exports = WxVirtualPaymentSDK
