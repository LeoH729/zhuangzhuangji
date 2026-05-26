const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { action, payload } = event
  const collection = db.collection('ai_features')
  
  try {
    switch (action) {
      case 'getGroups':
        try {
          const groupRes = await db.collection('ai_groups').where({ status: 1 }).orderBy('sort', 'asc').get()
          if (groupRes.data && groupRes.data.length > 0) {
            const groups = groupRes.data.map(item => item.name)
            return { success: true, data: groups }
          }
        } catch (groupError) {
          console.warn('获取 ai_groups 失败，自动降级去重提取分组列表:', groupError)
        }
        // 降级防错：从 active features 中提取去重分组
        const { data } = await collection.where({ status: 1 }).field({ group: true }).get()
        const groups = [...new Set(data.map(item => item.group).filter(Boolean))]
        return { success: true, data: groups }
      
      case 'getList':
        // 获取所有激活卡片，可选分组过滤
        const query = { status: 1 }
        if (payload?.group && payload.group !== '全部') {
          query.group = payload.group
        }
        // 云函数默认最多返回 100 条记录
        const res = await collection.where(query).get()
        const features = res.data || []
        
        // 内存精细组合排序：new (创建时间 desc) > hot (创建时间 desc) > normal (夯数 desc, 创建时间 desc)
        features.sort((a, b) => {
          const tagA = a.tag || 'normal'
          const tagB = b.tag || 'normal'
          
          const getTagWeight = (tag) => {
            if (tag === 'new') return 3
            if (tag === 'hot') return 2
            return 1 // 'normal'
          }
          
          const weightA = getTagWeight(tagA)
          const weightB = getTagWeight(tagB)
          
          if (weightA !== weightB) {
            return weightB - weightA // 权重降序：new(3) > hot(2) > normal(1)
          }
          
          const timeA = a.createTime ? (a.createTime instanceof Date ? a.createTime.getTime() : new Date(a.createTime).getTime()) : 0
          const timeB = b.createTime ? (b.createTime instanceof Date ? b.createTime.getTime() : new Date(b.createTime).getTime()) : 0
          
          if (tagA === 'new' || tagA === 'hot') {
            return timeB - timeA // new 或 hot：按创建时间倒序
          } else {
            // normal：按夯数倒序，夯数相同时按时间倒序
            const hangA = a.hang_count || 0
            const hangB = b.hang_count || 0
            if (hangA !== hangB) {
              return hangB - hangA
            }
            return timeB - timeA
          }
        })
        
        return { success: true, data: features }
        
      case 'getDetail':
        const detailRes = await collection.doc(payload.id).get()
        return { success: true, data: detailRes.data }
        
      case 'create':
        const createRes = await collection.add({ data: { ...payload, createTime: db.serverDate() } })
        return { success: true, _id: createRes._id }
        
      case 'update':
        const updateRes = await collection.doc(payload.id).update({ data: { ...payload.data, updateTime: db.serverDate() } })
        return { success: true, updated: updateRes.stats.updated }
        
      case 'delete':
        const deleteRes = await collection.doc(payload.id).remove()
        return { success: true, removed: deleteRes.stats.removed }
        
      default:
        return { success: false, error: 'Unknown action' }
    }
  } catch (e) {
    console.error(e)
    return { success: false, error: e.message }
  }
}
