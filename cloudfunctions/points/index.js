// 云函数：妆妆蛋积分系统（配置、初始化、原子扣减）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 集合与文档ID
const CONFIG_COLLECTION = 'points_config'
const CONFIG_ID = 'global'
const USER_COLLECTION = 'user_points'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, amount, reason } = event || {}
  console.log('[points] entry', { action, amount, reason, openid: wxContext.OPENID })

  try {
    switch (action) {
      case 'getConfig':
        return await getConfig()
      case 'ensureUserPoints':
        return await ensureUserPoints(wxContext.OPENID)
      case 'getUserPoints':
        return await getUserPoints(wxContext.OPENID)
      case 'consume':
        if (!amount || amount <= 0) {
          return { success: false, code: 'BAD_AMOUNT', message: '扣减点数不合法' }
        }
        return await consumePoints(wxContext.OPENID, amount, reason)
      default:
        return { success: false, code: 'UNKNOWN_ACTION', message: '未知操作' }
    }
  } catch (e) {
    console.error('[points] cloud error:', e)
    return { success: false, code: 'SERVER_ERROR', message: e.message || '服务错误' }
  }
}

async function defaultConfig() {
  return {
    name: '妆妆蛋',
    initial_points: 100,
    analyze_cost: 3,
    generate_cost: 5,
    // 新增：控制前端妆妆蛋资源点区域显示（0 不显示，1 显示）
    show_points_section: 1,
    updatedAt: new Date()
  }
}

// 获取全局配置（不存在则初始化）
async function getConfig() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).get()
    if (res.data) {
      console.log('[points] getConfig found existing')
      return { success: true, data: res.data }
    }
  } catch (_) {}

  // 初始化默认配置
  const cfg = await defaultConfig()
  console.log('[points] getConfig init default')
  await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).set({ data: cfg })
  return { success: true, data: cfg, init: true }
}

// 确保用户积分文档存在（_id = OPENID）
async function ensureUserPoints(openid) {
  console.log('[points] ensureUserPoints start', openid)
  const cfgRes = await getConfig()
  const initPoints = (cfgRes && cfgRes.data && cfgRes.data.initial_points) || 100
  const now = new Date()
  try {
    const doc = await db.collection(USER_COLLECTION).doc(openid).get()
    if (doc && doc.data) {
      console.log('[points] ensureUserPoints exists', doc.data)
      return { success: true, data: doc.data }
    }
  } catch (_) {}

  const initDoc = {
    points: initPoints,
    name: (cfgRes && cfgRes.data && cfgRes.data.name) || '妆妆蛋',
    createdAt: now,
    updatedAt: now
  }
  console.log('[points] ensureUserPoints create', initDoc)
  await db.collection(USER_COLLECTION).doc(openid).set({ data: initDoc })
  return { success: true, data: initDoc, init: true }
}

// 查询用户积分
async function getUserPoints(openid) {
  try {
    const doc = await db.collection(USER_COLLECTION).doc(openid).get()
    if (doc && doc.data) {
      return { success: true, data: doc.data }
    }
  } catch (e) {
    // 若不存在则初始化
    const inited = await ensureUserPoints(openid)
    return inited
  }
}

// 原子扣减用户积分（事务）
async function consumePoints(openid, amount, reason = '') {
  const cfgRes = await getConfig()
  const now = new Date()
  return await db.runTransaction(async (transaction) => {
    // 读取用户积分（如不存在则初始化）
    let doc
    try {
      doc = await transaction.collection(USER_COLLECTION).doc(openid).get()
    } catch (e) {
      // 初始化用户文档
      const initPoints = (cfgRes && cfgRes.data && cfgRes.data.initial_points) || 100
      console.log('[points] consume init user doc in tx', { openid, initPoints })
      await transaction.collection(USER_COLLECTION).doc(openid).set({
        data: { points: initPoints, name: (cfgRes && cfgRes.data && cfgRes.data.name) || '妆妆蛋', createdAt: now, updatedAt: now }
      })
      doc = await transaction.collection(USER_COLLECTION).doc(openid).get()
    }

    const current = (doc && doc.data && doc.data.points) || 0
    if (current < amount) {
      return { success: false, code: 'INSUFFICIENT', message: '积分不足', data: { points: current } }
    }

    await transaction.collection(USER_COLLECTION).doc(openid).update({
      data: { points: _.inc(-amount), updatedAt: now, lastReason: reason }
    })

    const after = current - amount
    return { success: true, data: { points: after } }
  })
}