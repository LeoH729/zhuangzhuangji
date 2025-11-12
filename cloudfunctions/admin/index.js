// 管理员身份鉴权云函数
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // 安全地在云端判断管理员身份，不在客户端暴露 openid
  const ADMIN_OPENID = 'obLo_1_UleSf8eX83HwIT_GGq8mA'

  const action = (event && event.action) || 'isAdmin'
  switch (action) {
    case 'isAdmin': {
      const isAdmin = OPENID === ADMIN_OPENID
      return { success: true, isAdmin }
    }
    default:
      return { success: false, message: 'Unknown action' }
  }
}