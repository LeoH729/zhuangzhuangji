// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  traceUser: true
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, data } = event
  
  console.log('云函数接收到的参数:', { action, data, openid: wxContext.OPENID })
  console.log('action类型:', typeof action, 'action值:', JSON.stringify(action))

  try {
    switch (action) {
      case 'add':
        return await addReminder(data, wxContext.OPENID)
      case 'list':
        return await getRemindersList(wxContext.OPENID)
      case 'delete':
        return await deleteReminder(data, wxContext.OPENID)
      case 'cancel':
        return await cancelReminder(data, wxContext.OPENID)
      case 'sendReminders':
        return await sendReminders()
      case 'debugReminders':
        return await debugReminders()
      case 'clearTestData':
        return await clearTestData(wxContext.OPENID)
      default:
        return {
          success: false,
          message: '未知操作'
        }
    }
  } catch (error) {
    console.error('云函数执行错误:', error)
    return {
      success: false,
      message: error.message
    }
  }
}

// 添加提醒
async function addReminder(data, openid) {
  try {
    // 添加提醒记录
    const result = await db.collection('reminders').add({
      data: {
        ...data,
        _openid: openid,
        sent: false, // 添加发送状态字段
        createTime: new Date(),
        updateTime: new Date()
      }
    })
    
    // 同时更新化妆品记录的reminderEnabled字段
    if (data.cosmeticId) {
      await db.collection('cosmetics').doc(data.cosmeticId).update({
        data: {
          reminderEnabled: true,
          updateTime: new Date()
        }
      })
    }
    
    return {
      success: true,
      data: result,
      message: '提醒设置成功'
    }
  } catch (error) {
    console.error('添加提醒失败:', error)
    return {
      success: false,
      error: error.message,
      message: '提醒设置失败'
    }
  }
}

// 清理当前用户的测试数据（提醒记录，并重置相关化妆品状态）
async function clearTestData(openid) {
  try {
    console.log('开始清理测试数据，用户ID:', openid)
    // 查询当前用户所有提醒，拿到涉及的cosmeticId集合
    const remindRes = await db.collection('reminders').where({_openid: openid}).get()
    const cosmeticIds = Array.from(new Set(remindRes.data.map(r => r.cosmeticId).filter(Boolean)))

    // 删除提醒记录
    const removeRes = await db.collection('reminders').where({_openid: openid}).remove()
    console.log('删除提醒记录结果:', removeRes)

    // 将相关化妆品的提醒状态重置为false
    let updatedCount = 0
    for (const cid of cosmeticIds) {
      const upRes = await db.collection('cosmetics').doc(cid).update({
        data: { reminderEnabled: false, updateTime: new Date() }
      })
      console.log('更新化妆品记录结果:', cid, upRes)
      updatedCount += (upRes.stats && upRes.stats.updated) ? upRes.stats.updated : 0
    }

    return {
      success: true,
      message: '清理完成',
      data: {
        removed: removeRes.stats ? removeRes.stats.removed : undefined,
        cosmeticUpdatedCount: updatedCount,
        affectedCosmetics: cosmeticIds
      }
    }
  } catch (error) {
    console.error('清理测试数据失败:', error)
    return {
      success: false,
      message: '清理失败',
      error: error.message
    }
  }
}

// 获取提醒列表
async function getRemindersList(openid) {
  const result = await db.collection('reminders')
    .where({
      _openid: openid,
      isActive: true
    })
    .orderBy('reminderDate', 'asc')
    .get()
  
  return {
    success: true,
    data: result.data,
    message: '获取成功'
  }
}

// 删除提醒
async function deleteReminder(data, openid) {
  const { _id } = data
  
  const result = await db.collection('reminders').doc(_id).remove()
  
  return {
    success: true,
    data: result,
    message: '删除成功'
  }
}

// 取消提醒（根据化妆品ID）
async function cancelReminder(data, openid) {
  try {
    const { cosmeticId } = data
    console.log('取消提醒请求，用户ID:', openid, '化妆品ID:', cosmeticId)
    
    // 删除该化妆品的所有提醒记录
    const result = await db.collection('reminders')
      .where({
        _openid: openid,
        cosmeticId: cosmeticId
      })
      .remove()
    
    console.log('删除提醒记录结果:', result)
    
    // 同时更新化妆品记录的reminderEnabled字段
    if (cosmeticId) {
      const updateResult = await db.collection('cosmetics').doc(cosmeticId).update({
        data: {
          reminderEnabled: false,
          updateTime: new Date()
        }
      })
      console.log('更新化妆品记录结果:', updateResult)
    }
    
    return {
      success: true,
      data: result,
      message: '取消提醒成功'
    }
  } catch (error) {
    console.error('取消提醒失败:', error)
    return {
      success: false,
      error: error.message,
      message: '取消提醒失败'
    }
  }
}

// 发送提醒消息（定时任务调用）
// 发送提醒消息
async function sendReminders() {
  const today = new Date().toISOString().split('T')[0]
  console.log('=== 发送提醒调试信息 ===')
  console.log('今天的日期 (UTC):', today)
  console.log('当前时间:', new Date().toISOString())
  // 工具函数：格式化日期为YYYY-MM-DD；thing字段限长20字符
  const formatDate = (input) => {
    try {
      if (!input) return new Date().toISOString().slice(0, 10)
      if (typeof input === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10)
        if (/^\d{4}\/\d{2}\/\d{2}/.test(input)) return input.replace(/\//g, '-').slice(0, 10)
      }
      const d = new Date(input)
      if (!isNaN(d)) return d.toISOString().slice(0, 10)
      return new Date().toISOString().slice(0, 10)
    } catch (e) {
      return new Date().toISOString().slice(0, 10)
    }
  }
  const safeThing = (s) => (s || '').toString().slice(0, 20)
  
  // 先查看所有提醒记录
  const allReminders = await db.collection('reminders').get()
  console.log('数据库中所有提醒记录数量:', allReminders.data.length)
  console.log('所有提醒记录:', JSON.stringify(allReminders.data, null, 2))
  
  // 查找今天需要发送的提醒（兼容旧数据格式）
  const reminders = await db.collection('reminders')
    .where({
      reminderDate: today
    })
    .get()
  
  // 过滤出未发送的提醒（兼容isActive和sent两种字段）
  const unsentReminders = reminders.data.filter(reminder => {
    // 如果有sent字段，则检查sent是否为false
    if (reminder.hasOwnProperty('sent')) {
      return reminder.sent === false
    }
    // 如果没有sent字段但有isActive字段，则检查isActive是否为true
    if (reminder.hasOwnProperty('isActive')) {
      return reminder.isActive === true
    }
    // 如果两个字段都没有，默认认为未发送
    return true
  })
  
  console.log('符合条件的提醒记录数量:', reminders.data.length)
  console.log('符合条件的提醒记录:', JSON.stringify(reminders.data, null, 2))
  console.log('未发送的提醒记录数量:', unsentReminders.length)
  console.log('未发送的提醒记录:', JSON.stringify(unsentReminders, null, 2))
  
  const results = []
  
  for (const reminder of unsentReminders) {
    try {
      console.log(`开始发送订阅消息给用户: ${reminder._openid}`)
      console.log('消息内容字段:', {
        thing1: safeThing(reminder.cosmeticName),
        phrase3: '食品',
        date2: formatDate(reminder.expiryDate),
        thing8: safeThing('化妆品已临期，请及时处理'),
        templateId: reminder.templateId || 'Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY'
      })
      
      // 发送订阅消息
      const sendResult = await cloud.openapi.subscribeMessage.send({
        touser: reminder._openid,
        page: 'pages/cosmetics/cosmetics',
        data: {
          thing1: { value: safeThing(reminder.cosmeticName) },
          phrase3: { value: '食品' },
          date2: { value: formatDate(reminder.expiryDate) },
          thing8: { value: safeThing('化妆品已临期，请及时处理') }
        },
        templateId: reminder.templateId || 'Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY' // 使用默认模板ID
      })
      
      console.log(`订阅消息发送结果:`, JSON.stringify(sendResult, null, 2))
      
      // 标记为已发送
      await db.collection('reminders').doc(reminder._id).update({
        data: {
          sent: true, // 使用sent字段
          sentTime: new Date(),
          updateTime: new Date()
        }
      })
      
      results.push({
        success: true,
        reminderId: reminder._id,
        cosmeticName: reminder.cosmeticName
      })
      
    } catch (error) {
      console.error('发送提醒失败:', error)
      console.error('错误详情:', JSON.stringify(error, null, 2))
      console.error('错误码:', error.errCode)
      console.error('错误信息:', error.errMsg)
      results.push({
        success: false,
        reminderId: reminder._id,
        error: error.message,
        errCode: error.errCode,
        errMsg: error.errMsg
      })
    }
  }
  
  console.log('处理结果:', JSON.stringify(results, null, 2))
  console.log('=== 调试信息结束 ===')
  
  return {
    success: true,
    data: results,
    message: `处理了 ${results.length} 条提醒`,
    debug: {
      today,
      allRemindersCount: allReminders.data.length,
      matchedRemindersCount: reminders.data.length,
      unsentRemindersCount: unsentReminders.length,
      allReminders: allReminders.data,
      matchedReminders: reminders.data,
      unsentReminders: unsentReminders
    }
  }
}

// 调试函数：查看所有提醒记录
async function debugReminders() {
  const today = new Date().toISOString().split('T')[0]
  console.log('今天的日期:', today)
  
  // 查看所有提醒记录
  const allReminders = await db.collection('reminders').get()
  console.log('所有提醒记录数量:', allReminders.data.length)
  
  // 查看今天的提醒记录（不考虑sent状态）
  const todayReminders = await db.collection('reminders')
    .where({
      reminderDate: today
    })
    .get()
  console.log('今天的提醒记录数量:', todayReminders.data.length)
  
  // 查看今天未发送的提醒记录
  const unsentReminders = await db.collection('reminders')
    .where({
      reminderDate: today,
      sent: false
    })
    .get()
  console.log('今天未发送的提醒记录数量:', unsentReminders.data.length)
  
  return {
    success: true,
    data: {
      today,
      allRemindersCount: allReminders.data.length,
      todayRemindersCount: todayReminders.data.length,
      unsentRemindersCount: unsentReminders.data.length,
      allReminders: allReminders.data,
      todayReminders: todayReminders.data,
      unsentReminders: unsentReminders.data
    },
    message: '调试信息获取完成'
  }
}