import cloudbase from '@cloudbase/js-sdk'

export const cloudbaseConfig = {
  env: import.meta.env.VITE_CLOUDBASE_ENV_ID || 'cloudbase-5gmfinom29f48930',
  region: import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai',
  accessKey: import.meta.env.VITE_CLOUDBASE_ACCESS_KEY || ''
}

const initOptions = {
  env: cloudbaseConfig.env,
  region: cloudbaseConfig.region,
  auth: { detectSessionInUrl: true }
}
if (cloudbaseConfig.accessKey) initOptions.accessKey = cloudbaseConfig.accessKey

export const app = cloudbase.init(initOptions)
export const auth = app.auth({ persistence: 'local' })

const MUTATION_LABELS = {
  createModel: '模型已创建', updateModel: '模型已保存', deleteModel: '模型已删除',
  createGroup: '分类已创建', updateGroup: '分类已保存', deleteGroup: '分类已删除',
  saveFeatureDraft: '模板草稿已保存', publishFeature: '模板已发布', deleteFeature: '模板已删除',
  offlineTemplate: '模板已下线',
  updateTemplatePlacement: '推荐位与排序已保存', saveRecommendationOrder: '推荐位排序已保存',
  rebuildTemplateRatingCounts: '模板评价计数已重建',
  createImageAsset: '图片已创建', createImageAssets: '运营图片已上传', updateImageAsset: '图片已保存', deleteImageAsset: '图片已删除', syncStorageAssets: '图片同步完成',
  createAdmin: '管理员已创建', updateAdmin: '管理员已保存', deleteAdmin: '管理员已删除',
  resetAdminPassword: '管理员临时密码已生成', completePasswordReset: '密码修改已完成',
  adjustUserPoints: '用户星光已调整', retryGenerationJob: '生成任务已重试', updateFeedback: '反馈状态已更新',
  updateSystemConfig: '系统配置已保存'
}

function notifyToast(type, message) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('admin-toast', { detail: { type, message } }))
}

async function callFunction(name, action, payload = {}) {
  const res = await app.callFunction({ name, data: { action, payload } })
  const result = res && res.result ? res.result : res
  if (!result || !result.success) {
    const message = (result && (result.message || result.error)) || '后台接口调用失败'
    const suggestion = result && result.suggestion ? `；${result.suggestion}` : ''
    notifyToast('error', `${message}${suggestion}`)
    const err = new Error(message)
    err.result = result
    err.field = result && result.field
    err.suggestion = result && result.suggestion
    err.traceId = result && result.trace_id
    throw err
  }
  return result
}

export function callAdmin(action, payload = {}) {
  return callFunction('adminApi', action, payload).then((result) => {
    if (MUTATION_LABELS[action]) notifyToast('success', MUTATION_LABELS[action])
    return result
  })
}

export function callAnalytics(action, payload = {}) {
  return callFunction('adminAnalytics', action, payload)
}
