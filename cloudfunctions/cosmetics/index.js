// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, data } = event

  try {
    switch (action) {
      case 'add':
        return await addCosmetic(data, wxContext.OPENID)
      case 'update':
        return await updateCosmetic(data, wxContext.OPENID)
      case 'delete':
        return await deleteCosmetic(data, wxContext.OPENID)
      case 'list':
        return await getCosmeticsList(wxContext.OPENID)
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

// 添加化妆品
async function addCosmetic(data, openid) {
  const result = await db.collection('cosmetics').add({
    data: {
      ...data,
      _openid: openid,
      createTime: new Date(),
      updateTime: new Date()
    }
  })
  
  return {
    success: true,
    data: result,
    message: '添加成功'
  }
}

// 更新化妆品
async function updateCosmetic(data, openid) {
  const { _id, ...updateData } = data
  
  if (!_id) {
    return {
      success: false,
      message: '缺少必要参数'
    }
  }
  
  try {
    // 首先检查记录是否存在且属于当前用户
    const checkResult = await db.collection('cosmetics').doc(_id).get()
    
    if (checkResult.data.length === 0) {
      return {
        success: false,
        message: '记录不存在'
      }
    }
    
    const record = checkResult.data[0]
    if (record._openid !== openid) {
      return {
        success: false,
        message: '无权限修改此记录'
      }
    }
    
    // 执行更新操作
    const result = await db.collection('cosmetics').doc(_id).update({
      data: {
        ...updateData,
        updateTime: new Date()
      }
    })
    
    if (result.stats.updated > 0) {
      return {
        success: true,
        data: result,
        message: '更新成功'
      }
    } else {
      return {
        success: false,
        message: '更新失败'
      }
    }
  } catch (error) {
    console.error('更新化妆品时出错:', error)
    return {
      success: false,
      message: '服务器错误'
    }
  }
}

// 删除化妆品
async function deleteCosmetic(data, openid) {
  const { _id } = data
  
  // 先验证记录是否存在且属于当前用户
  const checkResult = await db.collection('cosmetics')
    .doc(_id)
    .where({
      _openid: openid
    })
    .get()
  
  if (checkResult.data.length === 0) {
    return {
      success: false,
      message: '记录不存在或无权限删除'
    }
  }
  
  const result = await db.collection('cosmetics').doc(_id).remove()
  
  return {
    success: true,
    data: result,
    message: '删除成功'
  }
}

// 获取化妆品列表
async function getCosmeticsList(openid) {
  const result = await db.collection('cosmetics')
    .where({
      _openid: openid
    })
    .orderBy('createTime', 'desc')
    .get()
  
  return {
    success: true,
    data: result.data,
    message: '获取成功'
  }
}