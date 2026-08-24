const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function sanitizeModel(model = {}) {
  const copy = { ...model }
  delete copy.api_key
  copy.has_api_key = !!model.api_key
  return copy
}

exports.main = async (event, context) => {
  const { action, payload } = event
  const collection = db.collection('ai_models')
  
  try {
    switch (action) {
      case 'getList':
        const res = await collection.get()
        return { success: true, data: (res.data || []).map(sanitizeModel) }
        
      case 'getDetail':
        const detailRes = await collection.where({ model_call_id: payload.model_call_id }).get()
        return { success: true, data: detailRes.data[0] ? sanitizeModel(detailRes.data[0]) : null }
        
      case 'create':
      case 'update':
      case 'delete':
        return { success: false, code: 'ADMIN_ONLY', error: '模型写操作已迁移至后台管理接口' }
        
      default:
        return { success: false, error: 'Unknown action' }
    }
  } catch (e) {
    console.error(e)
    return { success: false, error: e.message }
  }
}
