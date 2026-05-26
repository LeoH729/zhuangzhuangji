const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { action, payload } = event
  const collection = db.collection('ai_models')
  
  try {
    switch (action) {
      case 'getList':
        const res = await collection.get()
        return { success: true, data: res.data }
        
      case 'getDetail':
        const detailRes = await collection.where({ model_call_id: payload.model_call_id }).get()
        return { success: true, data: detailRes.data[0] }
        
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
