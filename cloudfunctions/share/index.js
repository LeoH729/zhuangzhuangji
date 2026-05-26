const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const FEATURE_SCENE_PREFIX = 'f_'
const FEATURES_COLLECTION = 'ai_features'
const FEATURE_CODES_COLLECTION = 'feature_share_codes'

exports.main = async (event) => {
  const { action, featureId, code } = event

  if (action === 'resolveFeatureScene') {
    return resolveFeatureScene(code)
  }

  if (action !== 'getFeatureQrCode') {
    return { success: false, error: 'Unknown action' }
  }

  try {
    if (!featureId) {
      return { success: false, error: '缺少 featureId' }
    }

    const path = `pages/feature/feature?id=${featureId}`
    const wxacodeRes = await cloud.openapi.wxacode.get({
      path,
      width: 280
    })

    if (!wxacodeRes || !wxacodeRes.buffer) {
      return { success: false, error: '小程序码生成失败' }
    }

    const uploadRes = await cloud.uploadFile({
      cloudPath: `share-qrcode/features/${featureId}_${Date.now()}.png`,
      fileContent: wxacodeRes.buffer
    })

    return {
      success: true,
      fileID: uploadRes.fileID,
      path
    }
  } catch (err) {
    console.error('[share] getFeatureQrCode failed:', err)
    return {
      success: false,
      error: err.message || '小程序码生成失败'
    }
  }
}

async function ensureFeatureShareCode(featureId) {
  const code = createFeatureShareCode(featureId)

  await db.collection(FEATURE_CODES_COLLECTION).doc(code).set({
    data: {
      featureId,
      updateTime: db.serverDate()
    }
  })

  return code
}

async function resolveFeatureScene(code) {
  if (!code) {
    return { success: false, error: '缺少 code' }
  }

  try {
    const mappingRes = await db.collection(FEATURE_CODES_COLLECTION).doc(code).get()
    const featureId = mappingRes.data && mappingRes.data.featureId || ''
    return {
      success: !!featureId,
      featureId,
      error: featureId ? '' : '未找到对应模板'
    }
  } catch (err) {
    console.error('[share] resolveFeatureScene failed:', err)
    return resolveFeatureSceneByScan(code, err)
  }
}

async function resolveFeatureSceneByScan(code, originalError) {
  try {
    const res = await db.collection(FEATURES_COLLECTION).get()
    const feature = (res.data || []).find(item => createFeatureShareCode(item._id) === code)
    return {
      success: !!feature,
      featureId: feature ? feature._id : '',
      error: feature ? '' : (originalError.message || '未找到对应模板')
    }
  } catch (err) {
    return {
      success: false,
      error: err.message || originalError.message || '解析小程序码失败'
    }
  }
}

function createFeatureShareCode(featureId) {
  return crypto
    .createHash('sha1')
    .update(String(featureId))
    .digest('hex')
    .slice(0, 18)
}
