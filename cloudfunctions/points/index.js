// 云函数：妆妆蛋积分系统（配置、初始化、原子扣减、充值、收支明细）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 格式化时间为 YYYY-MM-DD HH:mm:ss（北京时间）
function formatDateTime(date = new Date()) {
  const localTime = date.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(localTime);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 集合与文档ID
const CONFIG_COLLECTION = 'points_config'
const CONFIG_ID = 'global'
const USER_COLLECTION = 'user_points'
const HISTORY_COLLECTION = 'points_history'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || event.openid
  const { action, amount, reason, title } = event || {}
  console.log('[points] entry', { action, amount, reason, title, openid })

  try {
    switch (action) {
      case 'getConfig':
        return await getConfig()
      case 'ensureUserPoints':
        return await ensureUserPoints(openid)
      case 'getUserPoints':
        return await getUserPoints(openid)
      case 'consume':
        return await consumePoints(openid, amount, reason, title)
      case 'recharge':
        return await rechargePoints(openid, amount, reason, title)
      case 'getHistory':
        return await getHistory(openid, event.limit, event.skip)
      default:
        return { success: false, code: 'UNKNOWN_ACTION', message: '未知操作' }
    }
  } catch (e) {
    console.error('[points] cloud error:', e)
    return { success: false, code: 'SERVER_ERROR', message: e.message || '服务错误' }
  }
}

// 默认妆容风格配置
const DEFAULT_STYLES = [
  { id: 'style_001', name: '新春红运', icon: '/images/style_new_year_red.png', sort: 10 },
  { id: 'style_002', name: '富家千金', icon: '/images/style_rich_girl.png', sort: 20 },
  { id: 'style_003', name: '国泰民安', icon: '/images/style_national_prosperity.png', sort: 30 },
  { id: 'style_004', name: '港风复古', icon: '/images/style_hk_retro.png', sort: 40 },
  { id: 'style_005', name: '欧美辣妹', icon: '/images/style_western_hot.png', sort: 50 },
  { id: 'style_006', name: '伪素颜', icon: '/images/style_natural_bare.png', sort: 60 },
  { id: 'style_007', name: '日式杂志', icon: '/images/style_jp_magazine.png', sort: 70 }
]

async function defaultConfig() {
  return {
    name: '妆妆蛋',
    initial_points: 100,
    analyze_cost: 3,
    generate_cost: 5,
    tryon_cost: 3,
    show_points_section: 1,
    styles: DEFAULT_STYLES, // 加入默认风格
    banner_image_url: '', // 默认 banner 为空
    tips_image_url: '/images/icon_tips_small.svg', // 默认 tips 图片
    updatedAt: formatDateTime()
  }
}

// 获取全局配置（不存在则初始化，存在但缺styles则补全）
async function getConfig() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).get()
    if (res.data) {
      console.log('[points] getConfig found existing')

      console.log('[points] getConfig found existing');

      // 如果缺 tips_image_url，补全默认值
      const updateData = {};
      let needsUpdate = false;

      if (!res.data.tips_image_url) {
        updateData.tips_image_url = '/images/icon_tips_small.svg';
        res.data.tips_image_url = '/images/icon_tips_small.svg';
        needsUpdate = true;
      }

      // 如果缺 styles，补全默认值
      if (!res.data.styles || !Array.isArray(res.data.styles) || res.data.styles.length === 0) {
        updateData.styles = DEFAULT_STYLES;
        res.data.styles = DEFAULT_STYLES;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).update({
          data: updateData
        });
      }

      return { success: true, data: res.data }
    }
  } catch (_) { }

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
  const now = formatDateTime()
  try {
    const doc = await db.collection(USER_COLLECTION).doc(openid).get()
    if (doc && doc.data) {
      console.log('[points] ensureUserPoints exists', doc.data)
      return { success: true, data: doc.data }
    }
  } catch (_) { }

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
    const inited = await ensureUserPoints(openid)
    return inited
  }
}

// 记录收支流水
async function addHistory(openid, type, amount, reason, title) {
  try {
    await db.collection(HISTORY_COLLECTION).add({
      data: {
        _openid: openid,
        type,        // 'consume' 或 'recharge'
        amount,      // 正整数
        reason,      // 'virtual_tryon_hk_retro', 'recharge_180' 等
        title,       // 显示标题，如 '虚拟试妆-港风复古', '充值-推荐套餐'
        createdAt: db.serverDate()
      }
    })
  } catch (e) {
    console.error('[points] addHistory error:', e)
  }
}

// 原子扣减用户积分（事务）+ 记录流水
async function consumePoints(openid, amount, reason = '', title = '') {
  const cfgRes = await getConfig()
  const now = formatDateTime()
  const result = await db.runTransaction(async (transaction) => {
    let doc
    try {
      doc = await transaction.collection(USER_COLLECTION).doc(openid).get()
    } catch (e) {
      const initPoints = (cfgRes && cfgRes.data && cfgRes.data.initial_points) || 100
      console.log('[points] consume init user doc in tx', { openid, initPoints })
      await transaction.collection(USER_COLLECTION).doc(openid).set({
        data: { points: initPoints, name: (cfgRes && cfgRes.data && cfgRes.data.name) || '妆妆蛋', createdAt: now, updatedAt: now }
      })
      doc = await transaction.collection(USER_COLLECTION).doc(openid).get()
    }

    const current = (doc && doc.data && doc.data.points) || 0
    if (typeof amount !== 'number') {
      return { success: false, code: 'BAD_AMOUNT', message: '扣减点数不合法', data: { points: current } }
    }
    if (amount <= 0) {
      return { success: true, data: { points: current } }
    }
    if (current < amount) {
      return { success: false, code: 'INSUFFICIENT', message: '积分不足', data: { points: current } }
    }

    await transaction.collection(USER_COLLECTION).doc(openid).update({
      data: { points: _.inc(-amount), updatedAt: now, lastReason: reason }
    })

    const after = current - amount
    return { success: true, data: { points: after } }
  })

  // 事务成功后记录流水（事务外）
  if (result && result.success) {
    const displayTitle = title || reason || '消费'
    await addHistory(openid, 'consume', amount, reason, displayTitle)
  }
  return result
}

// 充值（暂时跳过支付，直接加积分）+ 记录流水
async function rechargePoints(openid, amount, reason = '', title = '') {
  if (typeof amount !== 'number' || amount <= 0) {
    return { success: false, code: 'BAD_AMOUNT', message: '充值数量不合法' }
  }

  const now = formatDateTime()

  // 确保用户文档存在
  await ensureUserPoints(openid)

  // 原子增加积分
  await db.collection(USER_COLLECTION).doc(openid).update({
    data: { points: _.inc(amount), updatedAt: now }
  })

  // 读取更新后的积分
  const doc = await db.collection(USER_COLLECTION).doc(openid).get()
  const after = (doc && doc.data && doc.data.points) || 0

  // 记录流水
  const displayTitle = title || `充值${amount}蛋`
  await addHistory(openid, 'recharge', amount, reason, displayTitle)

  return { success: true, data: { points: after } }
}

// 获取收支明细
async function getHistory(openid, limit = 20, skip = 0) {
  const res = await db.collection(HISTORY_COLLECTION)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  // 格式化时间
  const list = (res.data || []).map(item => {
    let timeStr = ''
    if (item.createdAt) {
      // 数据库存的是 UTC，云函数环境也是 UTC
      // 手动加 8 小时转为北京时间
      const date = new Date(item.createdAt);
      const localTime = date.getTime() + 8 * 60 * 60 * 1000;
      const d = new Date(localTime);

      const pad = n => String(n).padStart(2, '0')
      timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return {
      id: item._id,
      action: item.type,
      amount: item.amount,
      reason: item.reason,
      title: item.title,
      time: timeStr
    }
  })

  return { success: true, data: list }
}