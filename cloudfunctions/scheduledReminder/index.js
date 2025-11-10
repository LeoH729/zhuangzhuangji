// 定时提醒云函数
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('定时提醒任务开始执行')
  
  try {
    // 调用提醒云函数发送消息
    const result = await cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'sendReminders'
      }
    })
    
    console.log('定时提醒执行结果:', result)
    
    return {
      success: true,
      message: '定时提醒任务执行完成',
      data: result.result
    }
    
  } catch (error) {
    console.error('定时提醒任务执行失败:', error)
    return {
      success: false,
      message: '定时提醒任务执行失败',
      error: error.message
    }
  }
}