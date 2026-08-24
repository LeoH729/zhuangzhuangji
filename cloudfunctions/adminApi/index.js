const cloud = require('wx-server-sdk')
const tcb = require('@cloudbase/node-sdk')
const COS = require('cos-nodejs-sdk-v5')
const crypto = require('crypto')
const CloudBaseManager = require('@cloudbase/manager-node')

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloudbase-5gmfinom29f48930'
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || '636c-cloudbase-5gmfinom29f48930-1380597463'
const STORAGE_REGION = process.env.STORAGE_REGION || 'ap-shanghai'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const app = tcb.init({ env: ENV_ID })
const auth = app.auth()
const managerApp = new CloudBaseManager({
  envId: ENV_ID,
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY,
  token: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_TOKEN
})
const cos = new COS({
  SecretId: process.env.TENCENTCLOUD_SECRETID,
  SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
  SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_TOKEN
})

const COLLECTIONS = {
  admins: 'admin_users',
  models: 'ai_models',
  groups: 'ai_groups',
  features: 'ai_features',
  images: 'image_assets',
  users: 'user_points',
  pointsHistory: 'points_history',
  generationHistory: 'generation_history',
  generationTasks: 'generation_tasks',
  analyticsEvents: 'analytics_events',
  orders: 'orders',
  feedbacks: 'feedbacks',
  pointsConfig: 'points_config',
  auditLogs: 'audit_logs',
  featureHomeCache: 'feature_home_cache',
  templateVersions: 'template_versions',
  templateTestCases: 'template_test_cases',
  templatePublishJobs: 'template_publish_jobs'
}

const ROLE_ACTIONS = {
  super_admin: ['*'],
  admin: ['*'],
  template_editor: [
    'listModels', 'listGroups', 'createGroup', 'updateGroup', 'deleteGroup', 'listFeatures', 'createFeature',
    'updateFeature', 'updateTemplatePlacement', 'saveRecommendationOrder', 'deleteFeature', 'saveFeatureDraft', 'publishFeature', 'debugFeatureGeneration',
    'getDebugGenerationStatus', 'checkFeaturePublish', 'offlineTemplate', 'rebuildHomeCache',
    'listImages', 'createImageAsset', 'createImageAssets', 'updateImageAsset', 'deleteImageAsset', 'syncStorageAssets', 'completePasswordReset'
  ],
  operator: ['listGenerationJobs', 'retryGenerationJob', 'listUsers', 'listFeedbacks', 'updateFeedback', 'revealSensitiveValue', 'completePasswordReset'],
  finance: ['listOrders', 'listUsers', 'adjustUserPoints', 'revealSensitiveValue', 'completePasswordReset'],
  readonly_analyst: ['completePasswordReset']
}

const MUTATION_ACTIONS = new Set([
  'createModel', 'updateModel', 'deleteModel', 'createGroup', 'updateGroup', 'deleteGroup',
  'createAdmin', 'updateAdmin', 'deleteAdmin', 'createFeature', 'updateFeature', 'saveFeatureDraft',
  'publishFeature', 'deleteFeature', 'createImageAsset', 'createImageAssets', 'updateImageAsset', 'deleteImageAsset',
  'offlineTemplate', 'syncStorageAssets', 'syncUserPoints', 'adjustUserPoints',
  'retryGenerationJob', 'updateFeedback', 'updateSystemConfig', 'updateTemplatePlacement',
  'saveRecommendationOrder', 'migrateRecommendationOrderV22', 'rebuildTemplateRatingCounts', 'migrateTemplatesV2', 'rollbackTemplatesV2Migration',
  'rebuildHomeCache',
  'resetAdminPassword', 'completePasswordReset', 'revealSensitiveValue', 'migrateTemplatesV21'
])

const TEMPLATE_TYPE_IMAGE = 'image_to_image'
const TEMPLATE_TYPE_TEXT = 'text_to_image'
const TEXT_TO_IMAGE_PROVIDERS = ['volcengine', 'supersolo', 'supersolo_async', 'toapis', 'joapi', 'jimeng_cli']
const TOAPIS_SIZE_OPTIONS = ['1:1', '3:4', '9:16']
const HOME_CACHE_SCHEMA_VERSION = 1
const HOME_CACHE_TTL_MS = 5 * 60 * 1000

const MODEL_FIELDS = [
  'model_call_id',
  'name',
  'provider',
  'base_url',
  'model_id',
  'api_key',
  'ratio',
  'resolution_type',
  'status',
  'remark'
]

const GROUP_FIELDS = ['name', 'zone', 'status', 'sort', 'description']
const ADMIN_FIELDS = ['uid', 'openid', 'username', 'displayName', 'role', 'permissions', 'status', 'passwordResetRequired', 'temporaryPasswordExpiresAt']
const FEATURE_FIELDS = [
  'name',
  'group',
  'placements',
  'home_banner',
  'detail_banner',
  'upload_count',
  'points_cost',
  'enable_upscale_print',
  'size',
  'model_call_id',
  'fallback_model_call_id',
  'prompt',
  'template_type',
  'input_fields',
  'supported_ratios',
  'lifecycle_status',
  'status',
  'sort',
  'tag',
  'description'
]
const FEATURE_DRAFT_FIELDS = ['draft_data', 'has_draft', 'draft_updatedAt', 'draftBy', 'publishedAt', 'publishedBy']
const VALID_ADMIN_ROLES = ['super_admin', 'admin', 'template_editor', 'operator', 'finance', 'readonly_analyst']
const SUPER_ADMIN_ACTIONS = ['listAdmins', 'createAdmin', 'updateAdmin', 'deleteAdmin', 'resetAdminPassword', 'migrateTemplatesV2', 'migrateTemplatesV21', 'rollbackTemplatesV2Migration', 'migrateRecommendationOrderV22', 'rebuildTemplateRatingCounts']
const IMAGE_FIELDS = [
  'name',
  'category',
  'usage',
  'folder',
  'objectKey',
  'cloudPath',
  'fileID',
  'modelCallId',
  'model_call_id',
  'modelCallIdSnapshot',
  'generatedOpenid',
  'generated_openid',
  'openid',
  '_openid',
  'temporaryUrl',
  'size',
  'etag',
  'lastModified',
  'source',
  'status',
  'remark'
]

function now() {
  return db.serverDate()
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return NaN
  if (typeof value === 'string' && !String(value).trim()) return NaN
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

function cleanPrefix(prefix = '') {
  return String(prefix || '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizeTemplateType(value) {
  return value === TEMPLATE_TYPE_TEXT ? TEMPLATE_TYPE_TEXT : TEMPLATE_TYPE_IMAGE
}

function normalizeToapisSize(value = '') {
  const size = String(value || '').trim()
  return TOAPIS_SIZE_OPTIONS.includes(size) ? size : ''
}

function normalizeInputFields(fields = []) {
  if (!Array.isArray(fields)) return []
  return fields
    .map((field, index) => ({
      key: String(field && field.key || '').trim(),
      title: String(field && (field.title || field.label) || '').trim(),
      placeholder: String(field && field.placeholder || '').trim(),
      maxLength: normalizeNumber(field && (field.maxLength || field.max_length || field.limit), 0),
      required: field && field.required !== false,
      sort: normalizeNumber(field && field.sort, index)
    }))
    .filter((field) => field.key)
    .sort((a, b) => a.sort - b.sort)
}

function normalizeZone(value = '') {
  return value === 'boss' ? 'boss' : 'play'
}

function isFeatureZone(value = '') {
  return value === 'boss' || value === 'play'
}

function normalizePlacements(placements = [], legacyGroup = '') {
  const list = Array.isArray(placements) ? placements : []
  const normalized = list
    .map((item) => ({
      zone: normalizeZone(item && item.zone),
      group: String(item && (item.group || item.category_id) || '').trim(),
      sort_order: Math.max(normalizeNumber(item && (item.sort_order ?? item.sortOrder), 0), 0)
    }))
    .filter((item) => item.group)

  if (normalized.length > 0) return normalized
  const group = String(legacyGroup || '').trim()
  return group ? [{ zone: 'play', group, sort_order: 0 }] : []
}

function featureMatchesZone(feature = {}, zone = '') {
  if (!isFeatureZone(zone)) return true
  return normalizePlacements(feature.placements, feature.group).some((item) => item.zone === zone)
}

function featureMatchesGroup(feature = {}, zone = '', group = '') {
  const groupName = String(group || '').trim()
  if (!isFeatureZone(zone) || !groupName) return false
  return normalizePlacements(feature.placements, feature.group).some((item) => item.zone === zone && item.group === groupName)
}

function normalizeFeatureTag(tag = 'normal') {
  return ['normal', 'new', 'hot'].includes(tag) ? tag : 'normal'
}

function homeCacheDocumentId(zone, group) {
  return crypto.createHash('sha1').update(`${zone}\n${group}`).digest('hex')
}

function getFeaturePlacementOrder(feature = {}, zone = '', group = '') {
  const placement = normalizePlacements(feature.placements, feature.group)
    .find((item) => item.zone === zone && item.group === group)
  const value = placement && Number(placement.sort_order)
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER
}

function toHomeCacheCard(feature = {}) {
  return {
    _id: feature._id,
    name: String(feature.name || ''),
    home_banner: String(feature.home_banner || ''),
    points_cost: Math.max(normalizeNumber(feature.points_cost, 0), 0),
    tag: normalizeFeatureTag(feature.tag)
  }
}

async function listAllHomeCacheDocuments() {
  try {
    const result = await db.collection(COLLECTIONS.featureHomeCache).limit(100).get()
    return result.data || []
  } catch (_) {
    return []
  }
}

async function invalidateHomeCache() {
  try {
    const documents = await listAllHomeCacheDocuments()
    await Promise.all(documents.map((item) => (
      db.collection(COLLECTIONS.featureHomeCache).doc(item._id).remove().catch(() => null)
    )))
    return { success: true, removed: documents.length }
  } catch (error) {
    console.warn('[adminApi] invalidate home cache failed', error && error.message)
    return { success: false, removed: 0, message: error && error.message }
  }
}

async function withHomeCacheInvalidation(operation) {
  const result = await operation()
  if (!result || result.success !== true) return result
  const invalidation = await invalidateHomeCache()
  if (!invalidation.success) {
    result.warnings = [...(result.warnings || []), {
      code: 'HOME_CACHE_INVALIDATION_FAILED',
      message: '首页缓存刷新失败，将在5分钟内自动恢复',
      suggestion: '请执行“重建首页缓存”或稍后再次检查小程序展示'
    }]
  }
  return result
}

async function rebuildHomeCache() {
  const features = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.features)
      .where({ status: 1 })
      .field({ _id: true, name: true, home_banner: true, points_cost: true, tag: true, placements: true, group: true })
      .skip(skip)
      .limit(100)
      .get()
    features.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }

  const groups = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.groups)
      .where({ status: 1 })
      .field({ name: true, zone: true, sort: true })
      .skip(skip)
      .limit(100)
      .get()
    groups.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }

  const buckets = new Map()
  groups.forEach((group) => {
    const zone = normalizeZone(group.zone)
    const name = String(group.name || '').trim()
    if (name) buckets.set(`${zone}\n${name}`, { zone, group: name })
  })
  features.forEach((feature) => {
    normalizePlacements(feature.placements, feature.group).forEach((placement) => {
      buckets.set(`${placement.zone}\n${placement.group}`, { zone: placement.zone, group: placement.group })
    })
  })

  const previous = await listAllHomeCacheDocuments()
  const activeIds = new Set()
  for (const bucket of buckets.values()) {
    const id = homeCacheDocumentId(bucket.zone, bucket.group)
    activeIds.add(id)
    const items = features
      .filter((feature) => featureMatchesGroup(feature, bucket.zone, bucket.group))
      .sort((left, right) => {
        const leftOrder = getFeaturePlacementOrder(left, bucket.zone, bucket.group)
        const rightOrder = getFeaturePlacementOrder(right, bucket.zone, bucket.group)
        return leftOrder !== rightOrder
          ? leftOrder - rightOrder
          : String(left._id || '').localeCompare(String(right._id || ''))
      })
      .map(toHomeCacheCard)
    await db.collection(COLLECTIONS.featureHomeCache).doc(id).set({
      data: {
        schema_version: HOME_CACHE_SCHEMA_VERSION,
        zone: bucket.zone,
        category: bucket.group,
        items,
        expires_at: new Date(Date.now() + HOME_CACHE_TTL_MS),
        rebuilt_at: new Date()
      }
    })
  }
  await Promise.all(previous
    .filter((item) => !activeIds.has(item._id))
    .map((item) => db.collection(COLLECTIONS.featureHomeCache).doc(item._id).remove().catch(() => null)))

  return success({
    buckets: buckets.size,
    published_templates: features.length,
    rebuilt_at: new Date().toISOString()
  })
}

function groupMatchesZone(group = {}, zone = '') {
  if (!isFeatureZone(zone)) return true
  return normalizeZone(group.zone) === zone
}

function normalizeInputValues(inputValues = {}, fields = []) {
  const values = {}
  fields.forEach((field) => {
    const rawValue = inputValues && Object.prototype.hasOwnProperty.call(inputValues, field.key)
      ? inputValues[field.key]
      : ''
    let value = String(rawValue || '').trim()
    if (field.maxLength > 0 && value.length > field.maxLength) {
      value = value.slice(0, field.maxLength)
    }
    values[field.key] = value
  })
  return values
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function maskIdentifier(value = '', start = 6, end = 4) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= start + end + 2) return `${text.slice(0, 2)}••••${text.slice(-2)}`
  return `${text.slice(0, start)}••••••${text.slice(-end)}`
}

function compilePrompt(prompt = '', fields = [], inputValues = {}) {
  let compiled = String(prompt || '')
  fields.forEach((field) => {
    const pattern = new RegExp(`\\{${escapeRegExp(field.key)}\\}`, 'g')
    compiled = compiled.replace(pattern, inputValues[field.key] || '')
  })
  return compiled
}

function extractAspectRatioFromPrompt(prompt = '') {
  const supported = new Set(['1:1', '3:4', '4:3', '4:5', '9:16', '16:9'])
  const matches = String(prompt || '').matchAll(/(?:^|[^\d])(1|3|4|9|16)\s*[:：]\s*(1|3|4|5|9|16)(?!\d)/g)
  for (const match of matches) {
    const ratio = `${match[1]}:${match[2]}`
    if (supported.has(ratio)) return ratio
  }
  return ''
}

function getObjectKeyFromFileID(fileID = '') {
  if (!fileID || typeof fileID !== 'string') return ''
  const marker = `${ENV_ID}.${STORAGE_BUCKET}/`
  const markerIndex = fileID.indexOf(marker)
  if (markerIndex >= 0) {
    return decodeURIComponent(fileID.slice(markerIndex + marker.length).split('?')[0])
  }
  const cloudIndex = fileID.indexOf('cloud://')
  if (cloudIndex === 0) {
    const slashIndex = fileID.indexOf('/', 'cloud://'.length)
    if (slashIndex >= 0) return decodeURIComponent(fileID.slice(slashIndex + 1).split('?')[0])
  }
  return fileID.replace(/^\/+/, '')
}

function getFolderFromKey(key = '') {
  const normalized = String(key || '').replace(/^\/+/, '')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex < 0) return ''
  return normalized.slice(0, slashIndex)
}

function getNameFromKey(key = '') {
  const normalized = String(key || '').replace(/^\/+/, '')
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex < 0 ? normalized : normalized.slice(slashIndex + 1)
}

function getFileIDFromKey(key = '') {
  return `cloud://${ENV_ID}.${STORAGE_BUCKET}/${String(key || '').replace(/^\/+/, '')}`
}

const TEMP_FILE_URL_BATCH_SIZE = 20

async function getTempFileUrls(fileList = []) {
  const unique = [...new Set((fileList || []).filter(Boolean))]
  const urlMap = {}
  for (let index = 0; index < unique.length; index += TEMP_FILE_URL_BATCH_SIZE) {
    const chunk = unique.slice(index, index + TEMP_FILE_URL_BATCH_SIZE)
    const tempRes = await cloud.getTempFileURL({ fileList: chunk }).catch((err) => {
      console.warn('[adminApi] getTempFileURL batch failed', err && err.message)
      return { fileList: [] }
    })
    ;(tempRes.fileList || []).forEach((item) => {
      if (item && item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
    })
  }
  const missing = unique.filter((fileID) => !urlMap[fileID])
  await Promise.all(missing.map(async (fileID) => {
    const key = getObjectKeyFromFileID(fileID)
    if (!key) return
    const signed = await new Promise((resolve) => {
      cos.getObjectUrl({
        Bucket: STORAGE_BUCKET,
        Region: STORAGE_REGION,
        Key: key,
        Sign: true,
        Expires: 3600
      }, (err, data) => resolve((!err && data && data.Url) ? data.Url : ''))
    })
    if (signed) urlMap[fileID] = signed
  }))
  return urlMap
}

function cosRequest(method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function pickFields(source, fields) {
  const target = {}
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) {
      target[field] = source[field]
    }
  })
  return target
}

function sanitizeModel(item = {}) {
  const copy = { ...item }
  copy.model_call_id = copy.model_call_id || copy.modelCallId || ''
  copy.model_id = copy.model_id || copy.modelId || ''
  if (copy.api_key) {
    copy.api_key = '******'
    copy.has_api_key = true
  } else {
    copy.has_api_key = false
  }
  return copy
}

async function listModelRefs() {
  const models = []
  for (let skip = 0; ; skip += 100) {
    const res = await db.collection(COLLECTIONS.models)
      .field({ model_call_id: true, modelCallId: true, name: true, provider: true, model_id: true, status: true })
      .skip(skip)
      .limit(100)
      .get()
    models.push(...(res.data || []))
    if (!res.data || res.data.length < 100) break
  }
  return sanitizeList(models, sanitizeModel).filter((item) => item.model_call_id)
}

function sanitizeList(list, mapper = (item) => item) {
  return (list || []).map(mapper)
}

function parseLegacyDateMs(value) {
  if (typeof value !== 'string') return NaN
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const withTimezone = /(?:Z|[+-]\d\d:?\d\d)$/.test(normalized) ? normalized : `${normalized}+08:00`
  const timestamp = Date.parse(withTimezone)
  return Number.isFinite(timestamp) ? timestamp : NaN
}

function normalizeSortValue(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const timestamp = parseLegacyDateMs(value)
    return Number.isFinite(timestamp) ? timestamp : value
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object') {
    if (typeof value.getTime === 'function') return value.getTime()
    if (typeof value.$date === 'number') return value.$date
    if (typeof value.$date === 'string') {
      const timestamp = Date.parse(value.$date)
      return Number.isFinite(timestamp) ? timestamp : value.$date
    }
  }
  return String(value)
}

function normalizeSort(payload = {}, fallbackBy = 'createdAt', fallbackOrder = 'desc') {
  const sortBy = String(payload.sortBy || payload.sort_by || fallbackBy || '').trim()
  const sortOrder = String(payload.sortOrder || payload.sort_order || fallbackOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
  if (!/^[A-Za-z0-9_.$-]+$/.test(sortBy)) {
    return { sortBy: fallbackBy, sortOrder }
  }
  return { sortBy, sortOrder }
}

function success(data = {}) {
  return { success: true, ...data }
}

function failure(code, message, extra = {}) {
  const suggestions = {
    BAD_REQUEST: '请检查填写内容后重试',
    NOT_FOUND: '请刷新列表，确认对象仍然存在',
    FORBIDDEN: '请联系超级管理员确认账号权限',
    NOT_LOGIN: '请重新登录后台',
    NOT_ADMIN: '请联系超级管理员添加后台权限',
    PUBLISH_CHECK_FAILED: '请按发布检查清单补齐内容',
    TEST_GATE_NOT_MET: '请先完成规定数量的模板测试',
    TEST_COVERAGE_INCOMPLETE: '请补齐主策略、兜底策略和目标比例测试',
    SERVER_ERROR: '请稍后重试；若持续失败，请将请求编号提供给技术人员'
  }
  const traceId = extra.trace_id || crypto.randomBytes(8).toString('hex')
  return {
    success: false,
    code,
    message,
    field: extra.field || '',
    suggestion: extra.suggestion || suggestions[code] || '请刷新后重试，或联系管理员处理',
    trace_id: traceId,
    details: extra.details || null,
    ...extra
  }
}

function canPerform(admin, action) {
  const allowed = ROLE_ACTIONS[admin && admin.role || 'admin'] || []
  return allowed.includes('*') || allowed.includes(action)
}

function sanitizeAuditPayload(payload = {}) {
  const copy = JSON.parse(JSON.stringify(payload || {}))
  const scrub = (value) => {
    if (!value || typeof value !== 'object') return
    Object.keys(value).forEach((key) => {
      if (/api[_-]?key|password|token|secret|openid|phone|email|url|banner|prompt/i.test(key)) value[key] = '[REDACTED]'
      else scrub(value[key])
    })
  }
  scrub(copy)
  return copy
}

const ACTION_LABELS = {
  createModel: '创建能力策略', updateModel: '更新能力策略', deleteModel: '删除能力策略',
  createGroup: '创建分类', updateGroup: '更新分类', deleteGroup: '删除分类',
  saveFeatureDraft: '保存模板草稿', publishFeature: '发布模板', offlineTemplate: '下线模板',
  deleteFeature: '删除模板', updateTemplatePlacement: '调整推荐位与排序', saveRecommendationOrder: '保存推荐位排序',
  migrateRecommendationOrderV22: '迁移推荐位排序', rebuildTemplateRatingCounts: '重建模板评价计数',
  createImageAsset: '新增运营图片', createImageAssets: '批量新增运营图片', updateImageAsset: '更新图片', deleteImageAsset: '删除图片', syncStorageAssets: '同步图片',
  createAdmin: '创建管理员', updateAdmin: '更新管理员', deleteAdmin: '删除管理员', resetAdminPassword: '重置管理员密码',
  completePasswordReset: '完成强制改密', adjustUserPoints: '调整用户星光', retryGenerationJob: '重试生成任务',
  updateFeedback: '更新反馈状态', updateSystemConfig: '更新系统配置', revealSensitiveValue: '查看敏感信息'
}

function getAuditObject(action, payload = {}) {
  const data = payload.data || {}
  if (action === 'saveRecommendationOrder') return { type: 'recommendation_order', id: [payload.zone, payload.group].filter(Boolean).join('/') || 'all', name: [payload.zone, payload.group].filter(Boolean).join(' / ') || '专区排序' }
  if (action === 'migrateRecommendationOrderV22') return { type: 'recommendation_order', id: 'all', name: '全部推荐位初始顺序' }
  if (action === 'rebuildTemplateRatingCounts') return { type: 'template_rating', id: 'all', name: '全部模板评价计数' }
  if (/Feature|Template/.test(action)) return { type: 'template', id: payload.id || payload.templateId || '', name: data.name || payload.name || payload.confirmName || '' }
  if (/Image|Asset|Storage/.test(action)) return { type: 'asset', id: payload.id || '', name: data.name || payload.name || '' }
  if (/Admin|Password/.test(action)) return { type: 'admin', id: payload.id || payload.adminId || '', name: data.displayName || data.username || payload.adminName || '' }
  if (/Model/.test(action)) return { type: 'model_policy', id: payload.id || '', name: data.name || payload.name || '' }
  if (/Group/.test(action)) return { type: 'template_category', id: payload.id || '', name: data.name || payload.name || '' }
  if (/UserPoints/.test(action)) return { type: 'user', id: payload.openid || '', name: '' }
  if (action === 'revealSensitiveValue') return { type: 'user', id: payload.recordId || '', name: '' }
  if (/GenerationJob/.test(action)) return { type: 'generation_job', id: payload.taskId || '', name: '' }
  if (/Feedback/.test(action)) return { type: 'feedback', id: payload.id || payload.feedbackId || '', name: '' }
  return { type: 'system', id: payload.id || '', name: '' }
}

async function writeAuditLog(action, payload, guard, result) {
  if (!MUTATION_ACTIONS.has(action)) return
  const object = getAuditObject(action, payload)
  const sanitized = sanitizeAuditPayload(payload)
  await db.collection(COLLECTIONS.auditLogs).add({
    data: {
      action,
      actionCode: action,
      actionLabel: ACTION_LABELS[action] || action,
      operatorUid: guard.caller.uid,
      operatorOpenid: guard.caller.openid || '',
      operatorName: guard.admin.displayName || guard.admin.username || guard.caller.uid,
      operatorRole: guard.admin.role || 'admin',
      targetId: object.id,
      objectType: object.type,
      objectId: object.id,
      objectName: object.name,
      reason: String(payload.reason || (payload.data && payload.data.reason) || '').slice(0, 200),
      changeSummary: sanitized.data || sanitized,
      resultCode: result && result.code || '',
      resultLabel: result && result.success ? '成功' : (result && result.message || '失败'),
      traceId: result && result.trace_id || crypto.randomBytes(8).toString('hex'),
      success: !!(result && result.success),
      createdAt: now()
    }
  }).catch((err) => console.error('[adminApi] audit log failed', err))
}

async function getCaller() {
  const identity = auth.getUserInfo()
  const uid = identity && (identity.uid || identity.customUserId || identity.openId)
  const wxContext = cloud.getWXContext()
  const openid = (identity && identity.openId) || (wxContext && wxContext.OPENID) || ''
  if (!uid && !openid) {
    return null
  }
  return {
    uid: uid || openid,
    openid,
    customUserId: identity && identity.customUserId ? identity.customUserId : '',
    appId: identity && identity.appId ? identity.appId : ''
  }
}

async function getAdmin(caller) {
  if (!caller || !caller.uid) return null
  const byUid = await db.collection(COLLECTIONS.admins).where({
    uid: caller.uid,
    status: _.neq(0)
  }).limit(1).get()
  if (byUid.data && byUid.data[0]) return byUid.data[0]

  if (caller.openid && caller.openid !== caller.uid) {
    const byOpenid = await db.collection(COLLECTIONS.admins).where({
      openid: caller.openid,
      status: _.neq(0)
    }).limit(1).get()
    if (byOpenid.data && byOpenid.data[0]) return byOpenid.data[0]
  }
  return null
}

async function requireAdmin() {
  const caller = await getCaller()
  if (!caller) {
    return { error: failure('NOT_LOGIN', '请先登录后台账号') }
  }
  const admin = await getAdmin(caller)
  if (!admin) {
    return { error: failure('NOT_ADMIN', '当前账号不在管理员白名单中', { caller }) }
  }
  return { caller, admin }
}

async function getAdminStatus() {
  const caller = await getCaller()
  const adminCountRes = await db.collection(COLLECTIONS.admins).count()
  const admin = caller ? await getAdmin(caller) : null
  return success({
    caller,
    admin,
    isAdmin: !!admin,
    needsBootstrap: (adminCountRes.total || 0) === 0,
    display_name: admin && (admin.displayName || admin.username || caller.uid) || '',
    role_label: admin && ({ super_admin: '超级管理员', admin: '管理员', template_editor: '模板编辑', operator: '运营专员', finance: '财务专员', readonly_analyst: '数据分析（只读）' }[admin.role] || admin.role) || '',
    password_reset_required: !!(admin && admin.passwordResetRequired),
    temporary_password_expires_at: admin && admin.temporaryPasswordExpiresAt || null
  })
}

async function bootstrapAdmin(payload = {}) {
  const caller = await getCaller()
  if (!caller) {
    return failure('NOT_LOGIN', '请先登录后台账号')
  }
  const adminCountRes = await db.collection(COLLECTIONS.admins).count()
  if ((adminCountRes.total || 0) > 0) {
    return failure('BOOTSTRAP_CLOSED', '管理员已存在，初始化入口已关闭')
  }

  const expectedToken = String(process.env.BOOTSTRAP_TOKEN || '')
  const receivedToken = String(payload.bootstrapToken || '')
  const tokenMatches = expectedToken && receivedToken && expectedToken.length === receivedToken.length &&
    crypto.timingSafeEqual(Buffer.from(expectedToken), Buffer.from(receivedToken))
  if (!tokenMatches) {
    return failure('BOOTSTRAP_FORBIDDEN', '初始化密钥无效')
  }

  const data = {
    uid: caller.uid,
    openid: caller.openid,
    username: payload.username || '',
    displayName: payload.displayName || payload.username || 'Super Admin',
    role: 'super_admin',
    permissions: ['analytics.read'],
    status: 1,
    createdAt: now(),
    updatedAt: now()
  }
  const bootstrapId = 'bootstrap_super_admin'
  try {
    const created = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.admins).doc(bootstrapId)
      const current = await ref.get().catch(() => null)
      if (current && current.data) return false
      await ref.set({ data })
      return true
    })
    if (!created) return failure('BOOTSTRAP_RACE', '初始化已被其他请求完成，请重新登录')
  } catch (err) {
    return failure('BOOTSTRAP_RACE', '初始化已被其他请求完成，请重新登录')
  }
  return success({ _id: bootstrapId, admin: { ...data, _id: bootstrapId } })
}

function buildListWhere(payload = {}, allowedFilters = []) {
  const where = { ...(payload.where || {}) }
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {}
  allowedFilters.forEach((field) => {
    const value = filters[field]
    if (value === '' || value === null || value === undefined) return
    where[field] = Array.isArray(value) ? _.in(value) : value
  })
  const dateField = String(filters.dateField || '')
  if (allowedFilters.includes(dateField) && (filters.dateFrom || filters.dateTo)) {
    const from = filters.dateFrom ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) ? `${filters.dateFrom}T00:00:00.000+08:00` : filters.dateFrom) : null
    const to = filters.dateTo ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) ? `${filters.dateTo}T23:59:59.999+08:00` : filters.dateTo) : null
    if (from && to) where[dateField] = _.gte(from).and(_.lte(to))
    else if (from) where[dateField] = _.gte(from)
    else if (to) where[dateField] = _.lte(to)
  }
  return where
}

async function listCollection(collectionName, payload = {}, mapper, options = {}) {
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize || payload.page_size, 20), 1), 100)
  const skip = (page - 1) * pageSize
  let where = buildListWhere(payload, options.allowedFilters || [])
  const keyword = String(payload.keyword || '').trim()
  if (keyword && options.keywordFields && options.keywordFields.length) {
    const regex = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
    const keywordCondition = _.or(options.keywordFields.map((field) => ({ [field]: regex })))
    where = Object.keys(where).length ? _.and([where, keywordCondition]) : keywordCondition
  }
  const { sortBy, sortOrder } = normalizeSort(payload)
  const query = db.collection(collectionName).where(where)
  const [countRes, listRes] = await Promise.all([
    query.count(),
    query.orderBy(sortBy, sortOrder).skip(skip).limit(pageSize).get()
  ])
  return success({
    data: sanitizeList(listRes.data, mapper),
    total: countRes.total || 0,
    page,
    pageSize,
    page_size: pageSize,
    updated_at: new Date().toISOString()
  })
}

async function createDoc(collectionName, payload, fields) {
  const data = pickFields(payload || {}, fields)
  data.createdAt = now()
  data.updatedAt = now()
  const res = await db.collection(collectionName).add({ data })
  return success({ _id: res._id })
}

async function updateDoc(collectionName, payload, fields) {
  if (!payload || !payload.id) return failure('BAD_REQUEST', '缺少记录 ID')
  const data = pickFields(payload.data || {}, fields)
  data.updatedAt = now()
  await db.collection(collectionName).doc(payload.id).update({ data })
  return success()
}

async function deleteDoc(collectionName, payload) {
  if (!payload || !payload.id) return failure('BAD_REQUEST', '缺少记录 ID')
  await db.collection(collectionName).doc(payload.id).remove()
  return success()
}

async function listModels(payload) {
  return listCollection(COLLECTIONS.models, payload, sanitizeModel, { keywordFields: ['name', 'model_call_id', 'provider'], allowedFilters: ['provider', 'status', 'createdAt'] })
}

async function createModel(payload) {
  if (!payload || !payload.model_call_id) return failure('BAD_REQUEST', '缺少 model_call_id')
  return createDoc(COLLECTIONS.models, payload, MODEL_FIELDS)
}

async function updateModel(payload) {
  if (payload && payload.data && payload.data.api_key === '') {
    delete payload.data.api_key
  }
  return updateDoc(COLLECTIONS.models, payload, MODEL_FIELDS)
}

async function listGroups(payload) {
  const zone = isFeatureZone(payload && payload.zone) ? payload.zone : ''
  if (!zone) return listCollection(COLLECTIONS.groups, payload, undefined, { keywordFields: ['name', 'description'], allowedFilters: ['zone', 'status', 'createdAt'] })

  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 20), 1), 100)
  const { sortBy, sortOrder } = normalizeSort(payload, 'sort', 'asc')
  const countRes = await db.collection(COLLECTIONS.groups).count()
  const total = countRes.total || 0
  const all = []
  const limit = 100

  for (let skip = 0; skip < total; skip += limit) {
    const res = await db.collection(COLLECTIONS.groups).skip(skip).limit(limit).get()
    all.push(...(res.data || []))
  }

  const direction = sortOrder === 'asc' ? 1 : -1
  const keyword = String(payload.keyword || '').trim().toLowerCase()
  const filters = payload.filters || {}
  const filtered = all.filter((item) => groupMatchesZone(item, zone))
    .filter((item) => !keyword || `${item.name || ''} ${item.description || ''}`.toLowerCase().includes(keyword))
    .filter((item) => filters.status === '' || filters.status === undefined || normalizeNumber(item.status, 0) === normalizeNumber(filters.status, 0))
  filtered.sort((a, b) => {
    const left = normalizeSortValue(a[sortBy])
    const right = normalizeSortValue(b[sortBy])
    if (left < right) return -1 * direction
    if (left > right) return 1 * direction
    return 0
  })

  return success({
    data: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize
  })
}

async function createGroup(payload) {
  if (!payload || !payload.name) return failure('BAD_REQUEST', '缺少分组名称')
  return createDoc(COLLECTIONS.groups, payload, GROUP_FIELDS)
}

async function listAdmins(payload) {
  return listCollection(COLLECTIONS.admins, payload, undefined, { keywordFields: ['displayName', 'username', 'uid'], allowedFilters: ['role', 'status', 'createdAt'] })
}

async function createAdmin(payload) {
  if (!payload || !payload.uid) return failure('BAD_REQUEST', '缺少管理员 UID')
  if (payload.role && !VALID_ADMIN_ROLES.includes(payload.role)) return failure('BAD_REQUEST', '无效的管理员角色')
  const data = {
    ...payload,
    role: payload.role || 'admin',
    permissions: Array.isArray(payload.permissions) ? payload.permissions : ['analytics.read'],
    status: typeof payload.status === 'number' ? payload.status : 1
  }
  return createDoc(COLLECTIONS.admins, data, ADMIN_FIELDS)
}

async function updateAdmin(payload = {}, caller) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少管理员记录 ID')
  const doc = await db.collection(COLLECTIONS.admins).doc(payload.id).get()
  const admin = doc.data
  if (!admin) return failure('NOT_FOUND', '管理员不存在')
  const data = pickFields(payload.data || {}, ADMIN_FIELDS)
  if (data.role && !VALID_ADMIN_ROLES.includes(data.role)) return failure('BAD_REQUEST', '无效的管理员角色')
  if (admin.uid === caller.uid && data.status === 0) {
    return failure('BAD_REQUEST', '不能停用当前登录的管理员账号')
  }
  data.updatedAt = now()
  await db.collection(COLLECTIONS.admins).doc(payload.id).update({ data })
  return success()
}

async function deleteAdmin(payload = {}, caller) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少管理员记录 ID')
  const doc = await db.collection(COLLECTIONS.admins).doc(payload.id).get()
  const admin = doc.data
  if (!admin) return failure('NOT_FOUND', '管理员不存在')
  if (admin.uid === caller.uid) return failure('BAD_REQUEST', '不能删除当前登录的管理员账号')
  await db.collection(COLLECTIONS.admins).doc(payload.id).remove()
  return success()
}

function createTemporaryPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%&*?'
  const all = upper + lower + numbers + symbols
  const pick = (source) => source[crypto.randomInt(0, source.length)]
  const first = pick(upper)
  const chars = [pick(lower), pick(numbers), pick(symbols)]
  while (chars.length < 15) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return first + chars.join('')
}

async function resetAdminPassword(payload = {}, caller = {}) {
  const adminId = payload.id || payload.adminId || ''
  const reason = String(payload.reason || '').trim()
  if (!adminId) return failure('BAD_REQUEST', '请选择要重置密码的管理员', { field: 'adminId' })
  if (!reason) return failure('BAD_REQUEST', '请填写重置原因', { field: 'reason' })
  const doc = await db.collection(COLLECTIONS.admins).doc(adminId).get().catch(() => null)
  const admin = doc && doc.data
  if (!admin) return failure('NOT_FOUND', '管理员不存在')
  if (admin.uid === caller.uid) return failure('SELF_RESET_FORBIDDEN', '不能在后台重置当前登录账号，请使用“修改自己的密码”')
  if (!admin.uid) return failure('ADMIN_UID_MISSING', '该管理员未关联认证账号，无法重置密码')

  const temporaryPassword = createTemporaryPassword()
  const modifyResult = await managerApp.user.modifyUser({ uid: admin.uid, password: temporaryPassword })
  if (modifyResult && modifyResult.Data && modifyResult.Data.Success === false) {
    return failure('AUTH_PASSWORD_RESET_FAILED', '认证服务未能重置密码')
  }
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  await db.collection(COLLECTIONS.admins).doc(adminId).update({
    data: {
      passwordResetRequired: true,
      temporaryPasswordExpiresAt: expiresAt,
      passwordResetAt: now(),
      passwordResetBy: caller.uid,
      updatedAt: now()
    }
  })
  return success({ temporaryPassword, expiresAt: expiresAt.toISOString(), passwordResetRequired: true })
}

async function completePasswordReset(caller = {}) {
  const adminRes = await db.collection(COLLECTIONS.admins).where({ uid: caller.uid }).limit(1).get()
  const admin = adminRes.data && adminRes.data[0]
  if (!admin) return failure('NOT_FOUND', '管理员账号不存在')
  await db.collection(COLLECTIONS.admins).doc(admin._id).update({
    data: {
      passwordResetRequired: false,
      temporaryPasswordExpiresAt: _.remove(),
      passwordResetCompletedAt: now(),
      updatedAt: now()
    }
  })
  return success({ passwordResetRequired: false })
}

async function listFeatures(payload = {}) {
  const zone = isFeatureZone(payload.zone) ? payload.zone : ''
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 20), 1), 100)
  const { sortBy, sortOrder } = normalizeSort(payload, 'updatedAt', 'desc')
  const safeSortBy = ['updatedAt', 'createdAt', 'name', 'sort'].includes(sortBy) ? sortBy : 'updatedAt'
  const filters = payload.filters || {}
  const keyword = String(payload.keyword || '').trim().toLowerCase()
  const all = []
  for (let skip = 0; ; skip += 100) {
    const res = await db.collection(COLLECTIONS.features).skip(skip).limit(100).get()
    all.push(...(res.data || []))
    if (!res.data || res.data.length < 100) break
  }
  const normalized = all.map((item) => {
    const placements = normalizePlacements(item.placements, item.group)
    const lifecycle = item.lifecycle_status || (normalizeNumber(item.status, 0) === 1 ? 'published' : 'draft')
    return {
      ...item,
      updatedAt: item.draft_updatedAt || item.updatedAt,
      placements,
      lifecycle_status: lifecycle,
      has_unpublished_changes: !!(item.has_draft || item.has_unpublished_changes),
      is_unassigned: placements.length === 0,
      published_version_id: item.publishedVersionId || '',
      draft_updated_at: item.draft_updatedAt || null
    }
  })
  const filtered = normalized.filter((item) => {
    if (zone && !featureMatchesZone(item, zone)) return false
    if (keyword && !`${item.name || ''} ${item._id || ''}`.toLowerCase().includes(keyword)) return false
    if (filters.lifecycleStatus === 'unassigned' && !item.is_unassigned) return false
    if (filters.lifecycleStatus && filters.lifecycleStatus !== 'unassigned' && item.lifecycle_status !== filters.lifecycleStatus) return false
    if (filters.categoryId && !item.placements.some((entry) => entry.group === filters.categoryId && (!zone || entry.zone === zone))) return false
    if (filters.tag && (item.tag || 'normal') !== filters.tag) return false
    if (filters.modelCallId && item.model_call_id !== filters.modelCallId && item.fallback_model_call_id !== filters.modelCallId) return false
    const dateFromMs = filters.dateFrom ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) ? `${filters.dateFrom}T00:00:00.000+08:00` : filters.dateFrom) : NaN
    const dateToMs = filters.dateTo ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) ? `${filters.dateTo}T23:59:59.999+08:00` : filters.dateTo) : NaN
    if (Number.isFinite(dateFromMs) && normalizeSortValue(item.updatedAt) < dateFromMs) return false
    if (Number.isFinite(dateToMs) && normalizeSortValue(item.updatedAt) > dateToMs) return false
    return true
  })
  const direction = sortOrder === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const left = normalizeSortValue(a[safeSortBy])
    const right = normalizeSortValue(b[safeSortBy])
    if (left < right) return -1 * direction
    if (left > right) return 1 * direction
    return 0
  })
  const pageRows = await attachCoverUrls(filtered.slice((page - 1) * pageSize, page * pageSize))
  const result = success({
    data: pageRows,
    total: filtered.length,
    page,
    pageSize,
    updated_at: new Date().toISOString()
  })
  const imageWhere = payload.imageFolder ? { folder: payload.imageFolder } : {}
  const [modelsRes, groupsRes, imagesRes] = await Promise.all([
    listModelRefs(),
    db.collection(COLLECTIONS.groups).get(),
    db.collection(COLLECTIONS.images).where(imageWhere).field({ name: true, folder: true, objectKey: true, fileID: true, usage: true, status: true }).limit(500).get()
  ])
  const foldersRes = await db.collection(COLLECTIONS.images).field({ folder: true }).limit(1000).get()
  const folders = [...new Set((foldersRes.data || []).map((item) => item.folder || '').filter((item) => item !== ''))].sort()
  return {
    ...result,
    folders,
    refs: {
      models: modelsRes,
      groups: groupsRes.data || [],
      images: imagesRes.data || []
    }
  }
}

async function createFeature(payload) {
  const feature = normalizeFeaturePayload(payload || {})
  if (!feature.name) return failure('BAD_REQUEST', '缺少模板名称')
  if (!feature.model_call_id) return failure('BAD_REQUEST', '请选择主能力策略')
  if (feature.placements.length === 0) return failure('BAD_REQUEST', '请至少配置一个展示位置')
  return createDoc(COLLECTIONS.features, feature, FEATURE_FIELDS)
}

async function updateFeature(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少记录 ID')
  const feature = normalizeFeaturePayload(payload.data || {})
  await db.collection(COLLECTIONS.features).doc(payload.id).update({
    data: { ...feature, updatedAt: now() }
  })
  return success()
}

async function deleteFeature(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少模板ID')
  const current = await db.collection(COLLECTIONS.features).doc(payload.id).get().catch(() => null)
  if (!current || !current.data) return failure('NOT_FOUND', '模板不存在')
  if (String(payload.confirmName || '') !== String(current.data.name || '')) {
    return failure('CONFIRM_NAME_MISMATCH', '请输入完整模板名称后再删除')
  }
  if (normalizeNumber(current.data.status, 0) === 1) {
    return failure('OFFLINE_REQUIRED', '已发布模板需先下线，再执行删除')
  }
  await db.collection(COLLECTIONS.features).doc(payload.id).remove()
  return success({ id: payload.id })
}

async function updateTemplatePlacement(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少模板ID')
  const currentRes = await db.collection(COLLECTIONS.features).doc(payload.id).get().catch(() => null)
  if (!currentRes || !currentRes.data) return failure('NOT_FOUND', '模板不存在')
  const current = currentRes.data
  const source = payload.data || payload
  const data = {
    sort: normalizeNumber(source.sort ?? current.sort, 10),
    tag: ['normal', 'new', 'hot'].includes(source.tag ?? current.tag) ? (source.tag || current.tag || 'normal') : 'normal',
    updatedAt: now()
  }
  if (source.placements) {
    data.placements = normalizePlacements(source.placements, source.group)
    data.group = data.placements[0]?.group || ''
    if (current.has_draft && current.draft_data && typeof current.draft_data === 'object') {
      data.draft_data = { ...current.draft_data, placements: data.placements, group: data.group }
    }
  }
  await db.collection(COLLECTIONS.features).doc(payload.id).update({ data })
  return success({ id: payload.id, placements: data.placements || current.placements })
}

async function saveRecommendationOrder(payload = {}) {
  const zone = isFeatureZone(payload.zone) ? payload.zone : ''
  const group = String(payload.group || '').trim()
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!zone) return failure('BAD_REQUEST', '请选择有效的专区')
  if (!group) return failure('BAD_REQUEST', '请选择有效的分类')
  if (!items.length) return failure('BAD_REQUEST', '当前排序列表为空，无需保存')

  const normalizedItems = items.map((item) => ({
    templateId: String(item && (item.template_id || item.templateId) || '').trim(),
    sortOrder: normalizeNumber(item && (item.sort_order ?? item.sortOrder), NaN),
    tag: normalizeFeatureTag(item && item.tag)
  }))
  if (normalizedItems.some((item) => !item.templateId || !Number.isInteger(item.sortOrder) || item.sortOrder < 1)) {
    return failure('BAD_REQUEST', '排序值必须是从1开始的正整数')
  }
  if (new Set(normalizedItems.map((item) => item.templateId)).size !== normalizedItems.length) {
    return failure('BAD_REQUEST', '排序列表存在重复模板')
  }
  if (new Set(normalizedItems.map((item) => item.sortOrder)).size !== normalizedItems.length) {
    return failure('BAD_REQUEST', '排序值不能重复')
  }

  const all = []
  for (let skip = 0; ; skip += 100) {
    const res = await db.collection(COLLECTIONS.features).where({ status: 1 }).skip(skip).limit(100).get()
    all.push(...(res.data || []))
    if (!res.data || res.data.length < 100) break
  }
  const bucket = all.filter((feature) => featureMatchesGroup(feature, zone, group))
  const bucketIds = new Set(bucket.map((feature) => feature._id))
  const invalidIds = normalizedItems.filter((item) => !bucketIds.has(item.templateId)).map((item) => item.templateId)
  const missingIds = bucket.filter((feature) => !normalizedItems.some((item) => item.templateId === feature._id)).map((feature) => feature._id)
  if (invalidIds.length || missingIds.length) {
    return failure('ORDER_BUCKET_CHANGED', '排序列表已发生变化，请刷新后重新排序', {
      details: { invalid_template_ids: invalidIds, missing_template_ids: missingIds },
      suggestion: '刷新页面获取最新模板列表后重试'
    })
  }

  const orderMap = Object.fromEntries(normalizedItems.map((item) => [item.templateId, item]))
  await db.runTransaction(async (transaction) => {
    const latestFeatures = []
    for (const feature of bucket) {
      const docRef = transaction.collection(COLLECTIONS.features).doc(feature._id)
      const latestRes = await docRef.get()
      const latest = latestRes.data
      if (!latest || normalizeNumber(latest.status, 0) !== 1 || !featureMatchesGroup(latest, zone, group)) {
        throw new Error('ORDER_BUCKET_CHANGED')
      }
      latestFeatures.push({ feature, latest })
    }
    for (const { feature, latest } of latestFeatures) {
      const docRef = transaction.collection(COLLECTIONS.features).doc(feature._id)
      const next = orderMap[feature._id]
      const placements = normalizePlacements(latest.placements, latest.group).map((placement) => (
        placement.zone === zone && placement.group === group ? { ...placement, sort_order: next.sortOrder } : placement
      ))
      await docRef.update({ data: { placements, tag: next.tag, updatedAt: now() } })
    }
  }).catch((err) => {
    if (err && err.message === 'ORDER_BUCKET_CHANGED') throw Object.assign(new Error('排序列表已发生变化，请刷新后重试'), { code: 'ORDER_BUCKET_CHANGED' })
    throw err
  })
  return success({ zone, group, saved: normalizedItems.length, updated_at: new Date().toISOString() })
}

function normalizeFeaturePayload(payload = {}) {
  const data = pickFields(payload || {}, FEATURE_FIELDS)
  const templateType = normalizeTemplateType(data.template_type)
  data.template_type = templateType
  data.enable_upscale_print = !!data.enable_upscale_print
  data.upload_count = templateType === TEMPLATE_TYPE_TEXT ? 0 : Math.max(normalizeNumber(data.upload_count, 1), 1)
  data.input_fields = templateType === TEMPLATE_TYPE_TEXT ? normalizeInputFields(data.input_fields) : []
  data.points_cost = normalizeNumber(data.points_cost, 0)
  data.size = normalizeToapisSize(data.size)
  data.status = normalizeNumber(data.status, 0)
  data.sort = normalizeNumber(data.sort, 10)
  data.tag = data.tag || 'normal'
  data.placements = normalizePlacements(data.placements, data.group)
  data.group = data.placements[0] ? data.placements[0].group : ''
  return data
}

function validateFeatureForGeneration(feature = {}, imageUrls = [], inputValues = {}) {
  if (!feature.name) return failure('BAD_REQUEST', '缺少模板名称')
  if (!feature.model_call_id) return failure('BAD_REQUEST', '请选择主能力策略')
  if (!feature.prompt || !String(feature.prompt).trim()) return failure('BAD_REQUEST', '提示词不能为空')

  const templateType = normalizeTemplateType(feature.template_type)
  if (templateType === TEMPLATE_TYPE_IMAGE && (!imageUrls || imageUrls.length === 0)) {
    return failure('BAD_REQUEST', '请上传调试参考图')
  }

  if (templateType === TEMPLATE_TYPE_TEXT) {
    const fields = normalizeInputFields(feature.input_fields)
    if (fields.length === 0) return failure('BAD_REQUEST', '文生图模板缺少动态字段')
    const values = normalizeInputValues(inputValues, fields)
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index]
      if (field.required && !values[field.key]) {
        return failure('BAD_REQUEST', `请填写${field.title || field.key}`)
      }
    }
  }

  return null
}

async function getModelByCallId(modelCallId = '') {
  if (!modelCallId) return null
  const res = await db.collection(COLLECTIONS.models).where({ model_call_id: modelCallId }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function validateModelCompatibility(feature = {}) {
  const templateType = normalizeTemplateType(feature.template_type)
  const modelConfig = await getModelByCallId(feature.model_call_id)
  if (!modelConfig) return failure('BAD_REQUEST', '模型配置不存在')
  if (normalizeNumber(modelConfig.status, 0) !== 1) return failure('BAD_REQUEST', '主能力策略当前已停用')
  if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(modelConfig.provider)) {
    return failure('BAD_REQUEST', '当前模型不支持文生图')
  }

  if (!feature.fallback_model_call_id) return null
  const fallbackConfig = await getModelByCallId(feature.fallback_model_call_id)
  if (!fallbackConfig) return failure('BAD_REQUEST', '兜底模型配置不存在')
  if (normalizeNumber(fallbackConfig.status, 0) !== 1) return failure('BAD_REQUEST', '兜底能力策略当前已停用')
  if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(fallbackConfig.provider)) {
    return failure('BAD_REQUEST', '兜底模型不支持文生图')
  }

  return null
}

async function saveFeatureDraft(payload = {}, caller = {}) {
  const feature = normalizeFeaturePayload({ ...(payload.data || payload), status: 0, lifecycle_status: 'draft' })
  if (!String(feature.name || '').trim()) return failure('BAD_REQUEST', '请填写模板名称', { field: 'name' })
  feature.name = String(feature.name).trim()
  const isUnassigned = feature.placements.length === 0

  if (!payload.id) {
    const createdAt = now()
    const res = await db.collection(COLLECTIONS.features).add({
      data: { ...feature, status: 0, lifecycle_status: 'draft', is_unassigned: isUnassigned, createdAt, updatedAt: createdAt }
    })
    return success({
      _id: res._id,
      id: res._id,
      lifecycle_status: 'draft',
      is_unassigned: isUnassigned,
      updated_at: createdAt
    })
  }

  const currentRes = await db.collection(COLLECTIONS.features).doc(payload.id).get()
  const current = currentRes.data
  if (!current) return failure('NOT_FOUND', '模板不存在')

  if (normalizeNumber(current.status, 0) === 1) {
    await db.collection(COLLECTIONS.features).doc(payload.id).update({
      data: {
        draft_data: feature,
        has_draft: true,
        has_unpublished_changes: true,
        draft_updatedAt: now(),
        draftBy: caller.uid || ''
      }
    })
    return success({ id: payload.id, lifecycle_status: 'published', has_unpublished_changes: true, is_unassigned: isUnassigned, savedAsDraft: true, updated_at: new Date().toISOString() })
  }

  const lifecycleStatus = current.lifecycle_status === 'offline' ? 'offline' : 'draft'
  const data = { ...feature, status: 0, lifecycle_status: lifecycleStatus, is_unassigned: isUnassigned, has_unpublished_changes: false, updatedAt: now() }
  await db.collection(COLLECTIONS.features).doc(payload.id).update({ data })
  return success({ id: payload.id, lifecycle_status: lifecycleStatus, is_unassigned: isUnassigned, savedAsDraft: true, updated_at: new Date().toISOString() })
}

async function recordTemplateVersion(templateId, snapshot, caller = {}, versionNote = '', sourceVersionId = '') {
  const countRes = await db.collection(COLLECTIONS.templateVersions).where({ templateId }).count().catch(() => ({ total: 0 }))
  const versionNumber = (countRes.total || 0) + 1
  const res = await db.collection(COLLECTIONS.templateVersions).add({
    data: {
      templateId,
      versionNumber,
      versionNote: String(versionNote || '后台发布').trim().slice(0, 200),
      snapshot,
      sourceVersionId,
      status: 'published',
      publishedBy: caller.uid || '',
      publishedAt: now(),
      createdAt: now()
    }
  })
  return { versionId: res._id, versionNumber }
}

async function listTemplateVersions(payload = {}) {
  if (!payload.templateId) return failure('BAD_REQUEST', '缺少模板ID')
  return listCollection(COLLECTIONS.templateVersions, {
    ...payload,
    where: { templateId: payload.templateId },
    sortBy: 'versionNumber',
    sortOrder: 'desc'
  })
}

async function listTemplateTestCases(payload = {}) {
  if (!payload.templateId) return failure('BAD_REQUEST', '缺少模板ID')
  const result = await listCollection(COLLECTIONS.templateTestCases, {
    ...payload,
    where: { templateId: payload.templateId },
    sortBy: 'createdAt',
    sortOrder: 'desc'
  })
  for (const item of (result.data || []).filter((row) => ['pending', 'running'].includes(row.status))) {
    const taskRes = await db.collection(COLLECTIONS.generationTasks).doc(item.taskId).get().catch(() => null)
    const task = taskRes && taskRes.data
    if (!task || !['succeeded', 'failed'].includes(task.status)) continue
    const update = {
      status: task.status,
      provider: task.provider || '',
      modelCallId: task.modelCallId || task.modelCallIdSnapshot || '',
      fallbackUsed: !!task.fallbackUsed,
      durationMs: task.totalDurationMs || task.executionDurationMs || 0,
      errorMessage: task.errorMessage || '',
      resultUrl: task.resultUrl || '',
      finishedAt: task.finishedAt || now(),
      updatedAt: now()
    }
    await db.collection(COLLECTIONS.templateTestCases).doc(item._id).update({ data: update })
    Object.assign(item, update)
  }
  const completedCount = (result.data || []).filter((row) => ['succeeded', 'failed'].includes(row.status)).length
  if (completedCount >= 5) {
    await updateUnpublishedLifecycle(payload.templateId, 'ready').catch(() => null)
  }
  return result
}

async function getCompletedTemplateTestCount(templateId) {
  if (!templateId) return 0
  const result = await db.collection(COLLECTIONS.templateTestCases)
    .where({ templateId, status: _.in(['succeeded', 'failed']) })
    .count()
  return result.total || 0
}

async function updateUnpublishedLifecycle(templateId, lifecycleStatus) {
  if (!templateId) return
  const currentRes = await db.collection(COLLECTIONS.features).doc(templateId).get().catch(() => null)
  const current = currentRes && currentRes.data
  if (!current || normalizeNumber(current.status, 0) === 1) return
  await db.collection(COLLECTIONS.features).doc(templateId).update({
    data: { lifecycle_status: lifecycleStatus, updatedAt: now() }
  })
}

async function checkFeaturePublish(payload = {}) {
  const templateId = payload.id || payload.templateId || ''
  if (!templateId) return failure('SAVE_DRAFT_FIRST', '请先保存模板草稿')
  const currentRes = await db.collection(COLLECTIONS.features).doc(templateId).get().catch(() => null)
  const current = currentRes && currentRes.data
  if (!current) return failure('NOT_FOUND', '模板不存在')
  const source = normalizeFeaturePayload({ ...(payload.data || current.draft_data || current), status: 1 })
  const errors = []
  const warnings = []
  const addError = (section, field, message, suggestion) => errors.push({ section, step: section, field, message, reason: message, suggestion })
  if (!source.name) addError('basic', 'name', '模板名称为空', '填写清晰、唯一的模板名称')
  if (![TEMPLATE_TYPE_IMAGE, TEMPLATE_TYPE_TEXT].includes(source.template_type)) addError('basic', 'template_type', '模板类型不合法', '重新选择模板类型')
  if (source.template_type === TEMPLATE_TYPE_IMAGE && (!Number.isInteger(source.upload_count) || source.upload_count < 1)) addError('basic', 'upload_count', '上传图片数量不合法', '填写大于或等于1的整数')
  if (source.template_type === TEMPLATE_TYPE_TEXT && !(source.input_fields || []).length) addError('core', 'input_fields', '文生图模板没有用户输入字段', '至少配置一个文本输入字段')
  const keys = (source.input_fields || []).map((item) => item.key).filter(Boolean)
  if (new Set(keys).size !== keys.length) addError('core', 'input_fields', '用户输入字段标识重复', '保证每个字段标识唯一')
  if (!Number.isInteger(source.points_cost) || source.points_cost < 0) addError('basic', 'points_cost', '星光消耗不合法', '填写大于或等于0的整数')
  if (!source.model_call_id) addError('core', 'model_call_id', '未选择主能力策略', '选择一个已启用的能力策略')
  if (!source.fallback_model_call_id) addError('core', 'fallback_model_call_id', '未选择兜底能力策略', '选择一个已启用的兜底能力策略')
  if (source.model_call_id && source.model_call_id === source.fallback_model_call_id) addError('core', 'fallback_model_call_id', '主策略和兜底策略不能相同', '为兜底能力选择另一个可用策略')
  if (!source.home_banner) addError('assets', 'home_banner', '缺少首页/列表封面', '从图片中心选择运营图片')
  if (!source.detail_banner) addError('assets', 'detail_banner', '缺少详情页图片', '从图片中心选择运营图片')
  if (!source.placements.length) addError('placement', 'placements', '未配置展示位置', '至少选择一个专区和分类')
  if (!String(source.prompt || '').trim()) addError('core', 'prompt', '提示词为空', '填写提示词并校验动态变量')
  const missingVariables = (source.input_fields || []).filter((field) => field.key && !String(source.prompt || '').includes(`{${field.key}}`))
  if (missingVariables.length) addError('core', 'prompt', `提示词缺少变量 ${missingVariables.map((item) => `{${item.key}}`).join('、')}`, '将缺失变量插入提示词')
  if (source.model_call_id && source.fallback_model_call_id) {
    const modelError = await validateModelCompatibility(source)
    if (modelError) {
      const fallbackError = /兜底/.test(modelError.message || '')
      addError('core', fallbackError ? 'fallback_model_call_id' : 'model_call_id', modelError.message, modelError.suggestion)
    }
  }
  return success({ passed: errors.length === 0, errors, warnings, checked_at: new Date().toISOString() })
}

async function rollbackTemplate(payload = {}, caller = {}) {
  if (!payload.templateId || !payload.versionId) return failure('BAD_REQUEST', '缺少模板或版本ID')
  const currentRes = await db.collection(COLLECTIONS.features).doc(payload.templateId).get().catch(() => null)
  if (!currentRes || !currentRes.data) return failure('NOT_FOUND', '模板不存在')
  if (String(payload.confirmName || '') !== String(currentRes.data.name || '')) {
    return failure('CONFIRM_NAME_MISMATCH', '请输入完整模板名称后再回滚')
  }
  const versionRes = await db.collection(COLLECTIONS.templateVersions).doc(payload.versionId).get().catch(() => null)
  const version = versionRes && versionRes.data
  if (!version || version.templateId !== payload.templateId) return failure('NOT_FOUND', '模板版本不存在')
  const snapshot = normalizeFeaturePayload({ ...(version.snapshot || {}), status: 1 })
  await db.collection(COLLECTIONS.features).doc(payload.templateId).update({
    data: {
      ...snapshot,
      status: 1,
      lifecycle_status: 'published',
      rolledBackFromVersionId: payload.versionId,
      publishedAt: now(),
      publishedBy: caller.uid || '',
      updatedAt: now()
    }
  })
  const next = await recordTemplateVersion(
    payload.templateId,
    snapshot,
    caller,
    payload.versionNote || `回滚至版本 V${version.versionNumber}`,
    payload.versionId
  )
  await db.collection(COLLECTIONS.features).doc(payload.templateId).update({
    data: { publishedVersionId: next.versionId, publishedVersionNumber: next.versionNumber, updatedAt: now() }
  })
  return success({ templateId: payload.templateId, ...next })
}

async function offlineTemplate(payload = {}, caller = {}) {
  if (!payload.templateId) return failure('BAD_REQUEST', '缺少模板ID')
  await db.collection(COLLECTIONS.features).doc(payload.templateId).update({
    data: { status: 0, lifecycle_status: 'offline', offlineAt: now(), offlineBy: caller.uid || '', updatedAt: now() }
  })
  return success({ templateId: payload.templateId, status: 'offline' })
}

async function publishFeature(payload = {}, caller = {}) {
  const id = payload.id || ''
  if (!id) return failure('SAVE_DRAFT_FIRST', '请先保存模板草稿')
  const currentRes = await db.collection(COLLECTIONS.features).doc(id).get()
  const current = currentRes.data
  if (!current) return failure('NOT_FOUND', '模板不存在')
  const publishData = normalizeFeaturePayload({ ...(payload.data || current.draft_data || current), status: 1 })
  const validation = await checkFeaturePublish({ id, data: publishData })
  if (!validation.passed) {
    return failure('PUBLISH_CHECK_FAILED', `还有${validation.errors.length}项内容需要完善`, {
      details: { errors: validation.errors, warnings: validation.warnings },
      errors: validation.errors,
      warnings: validation.warnings,
      suggestion: '请按页面标红字段完成修改后重新发布'
    })
  }

  const existingOrderByZone = Object.fromEntries(normalizePlacements(current.placements, current.group).map((item) => [item.zone, item.sort_order || 0]))
  const preserveExistingOrder = (current.tag || 'normal') === (publishData.tag || 'normal')
  publishData.placements = publishData.placements.map((item) => ({
    ...item,
    sort_order: preserveExistingOrder ? (existingOrderByZone[item.zone] || item.sort_order || 0) : 0
  }))

  await db.collection(COLLECTIONS.features).doc(id).update({
    data: {
      ...publishData,
      status: 1,
      lifecycle_status: 'published',
      draft_data: _.remove(),
      has_draft: false,
      has_unpublished_changes: false,
      is_unassigned: false,
      draft_updatedAt: _.remove(),
      draftBy: _.remove(),
      publishedAt: now(),
      publishedBy: caller.uid || '',
      updatedAt: now()
    }
  })
  return success({ id, published: true, published_at: new Date().toISOString() })
}

async function scheduleTemplatePublish(payload = {}, caller = {}) {
  const templateId = payload.id || payload.templateId || ''
  const versionNote = String(payload.versionNote || '').trim()
  const scheduledAtMs = Date.parse(payload.scheduledAt || '')
  if (!templateId) return failure('BAD_REQUEST', '请先保存模板草稿')
  if (!versionNote) return failure('VERSION_NOTE_REQUIRED', '定时发布前必须填写版本说明')
  if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now() + 60 * 1000) return failure('BAD_REQUEST', '定时发布时间必须晚于当前时间至少 1 分钟')
  const currentRes = await db.collection(COLLECTIONS.features).doc(templateId).get().catch(() => null)
  const current = currentRes && currentRes.data
  if (!current) return failure('NOT_FOUND', '模板不存在')
  const snapshot = normalizeFeaturePayload({ ...(payload.data || current.draft_data || current), status: 1 })
  if (!snapshot.name || !snapshot.model_call_id || !snapshot.prompt || !snapshot.home_banner || !snapshot.detail_banner || !snapshot.placements.length) {
    return failure('PUBLISH_CHECK_FAILED', '发布检查失败：请补全名称、能力策略、提示词、素材和展示位置')
  }
  const testCount = await getCompletedTemplateTestCount(templateId)
  if (testCount < 5) return failure('TEST_GATE_NOT_MET', `定时发布前至少完成 5 组测试，当前 ${testCount} 组`)
  const testsRes = await db.collection(COLLECTIONS.templateTestCases).where({ templateId, status: _.in(['succeeded', 'failed']) }).limit(100).get()
  const tests = testsRes.data || []
  if (!tests.some((item) => (item.requestedModelRole || 'primary') === 'primary')) return failure('TEST_COVERAGE_INCOMPLETE', '请至少完成一组主能力策略测试')
  if (snapshot.fallback_model_call_id && !tests.some((item) => item.requestedModelRole === 'fallback')) return failure('TEST_COVERAGE_INCOMPLETE', '请至少完成一组兜底能力策略测试')
  const modelError = await validateModelCompatibility(snapshot)
  if (modelError) return modelError
  const pending = await db.collection(COLLECTIONS.templatePublishJobs).where({ templateId, status: 'scheduled' }).limit(1).get()
  if (pending.data && pending.data[0]) return failure('SCHEDULE_EXISTS', '当前模板已有待执行的定时发布')
  const result = await db.collection(COLLECTIONS.templatePublishJobs).add({
    data: {
      templateId,
      snapshot,
      versionNote: versionNote.slice(0, 200),
      scheduledAt: new Date(scheduledAtMs),
      scheduledAtMs,
      status: 'scheduled',
      createdBy: caller.uid || '',
      createdAt: now(),
      updatedAt: now()
    }
  })
  await db.collection(COLLECTIONS.features).doc(templateId).update({ data: { scheduledPublishAt: new Date(scheduledAtMs), lifecycle_status: 'ready', updatedAt: now() } })
  return success({ jobId: result._id, templateId, scheduledAt: new Date(scheduledAtMs).toISOString() })
}

async function getScheduledPublish(payload = {}) {
  if (!payload.templateId) return failure('BAD_REQUEST', '缺少模板ID')
  const result = await db.collection(COLLECTIONS.templatePublishJobs)
    .where({ templateId: payload.templateId, status: 'scheduled' })
    .orderBy('scheduledAtMs', 'asc')
    .limit(1)
    .get()
  const job = result.data && result.data[0]
  return success({ job: job ? { jobId: job._id, templateId: job.templateId, scheduledAt: job.scheduledAt, status: job.status, versionNote: job.versionNote } : null })
}

async function cancelScheduledPublish(payload = {}, caller = {}) {
  if (!payload.jobId) return failure('BAD_REQUEST', '缺少定时发布任务ID')
  const ref = db.collection(COLLECTIONS.templatePublishJobs).doc(payload.jobId)
  const result = await ref.get().catch(() => null)
  if (!result || !result.data) return failure('NOT_FOUND', '定时发布任务不存在')
  if (result.data.status !== 'scheduled') return failure('INVALID_STATUS', '当前任务已不可取消')
  await ref.update({ data: { status: 'cancelled', cancelledBy: caller.uid || '', cancelledAt: now(), updatedAt: now() } })
  await db.collection(COLLECTIONS.features).doc(result.data.templateId).update({ data: { scheduledPublishAt: _.remove(), updatedAt: now() } }).catch(() => null)
  return success({ jobId: payload.jobId, status: 'cancelled' })
}

async function debugFeatureGeneration(payload = {}, caller = {}) {
  const featureSource = payload.feature || payload.data || {}
  const feature = normalizeFeaturePayload({ ...featureSource, size: payload.targetRatio || featureSource.size })
  const forceFallback = payload.forceFallback === true
  if (forceFallback && !feature.fallback_model_call_id) return failure('BAD_REQUEST', '当前模板未配置兜底能力策略')
  const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.filter(Boolean) : []
  const inputFields = normalizeInputFields(feature.input_fields)
  const inputValues = normalizeInputValues(payload.inputValues || {}, inputFields)
  const validationError = validateFeatureForGeneration(feature, imageUrls, inputValues)
  if (validationError) return validationError
  const modelError = await validateModelCompatibility(feature)
  if (modelError) return modelError

  const templateType = normalizeTemplateType(feature.template_type)
  const compiledPrompt = templateType === TEMPLATE_TYPE_TEXT
    ? compilePrompt(feature.prompt || '', inputFields, inputValues)
    : (feature.prompt || '')
  if (!compiledPrompt.trim()) return failure('BAD_REQUEST', '编译后的提示词不能为空')
  const promptAspectRatio = extractAspectRatioFromPrompt(compiledPrompt)

  const taskRes = await db.collection(COLLECTIONS.generationTasks).add({
    data: {
      _openid: `admin:${caller.uid || caller.openid || 'unknown'}`,
      source: 'admin_debug',
      adminUid: caller.uid || '',
      featureId: payload.featureId || payload.id || '',
      status: 'pending',
      imageUrls,
      promptSnapshot: feature.prompt || '',
      compiledPrompt,
      inputValues,
      inputFields,
      templateType,
      modelCallIdSnapshot: feature.model_call_id || '',
      fallbackModelCallIdSnapshot: feature.fallback_model_call_id || '',
      sizeSnapshot: promptAspectRatio,
      requestedAspectRatio: promptAspectRatio,
      effectiveAspectRatio: promptAspectRatio,
      activeModelRole: forceFallback ? 'fallback' : 'primary',
      fallbackUsed: forceFallback,
      fallbackErrorMessage: '',
      featureNameSnapshot: feature.name || '后台调试生图',
      enableUpscalePrintSnapshot: !!feature.enable_upscale_print,
      pointsCost: 0,
      pointsDeducted: false,
      pointsRefunded: false,
      upstreamTaskId: '',
      upstreamStatus: '',
      resultUrl: '',
      errorMessage: '',
      historyId: '',
      createdAt: now(),
      startedAt: null,
      finishedAt: null
    }
  })

  const templateId = payload.featureId || payload.id || ''
  if (templateId) {
    await db.collection(COLLECTIONS.templateTestCases).doc(taskRes._id).set({
      data: {
        templateId,
        taskId: taskRes._id,
        status: 'pending',
        modelCallId: feature.model_call_id || '',
        fallbackModelCallId: feature.fallback_model_call_id || '',
        targetRatio: promptAspectRatio,
        requestedModelRole: forceFallback ? 'fallback' : 'primary',
        templateType,
        createdBy: caller.uid || '',
        createdAt: now(),
        updatedAt: now()
      }
    })
  }

  cloud.callFunction({
    name: 'generationWorker',
    data: { taskId: taskRes._id }
  }).catch((err) => {
    console.error('[adminApi] debug generation worker trigger failed', taskRes._id, err)
  })

  return success({ taskId: taskRes._id, compiledPrompt })
}

async function getDebugGenerationStatus(payload = {}, caller = {}) {
  const taskId = payload.taskId || ''
  if (!taskId) return failure('BAD_REQUEST', '缺少 taskId')
  const taskRes = await db.collection(COLLECTIONS.generationTasks).doc(taskId).get()
  const task = taskRes.data
  if (!task) return failure('NOT_FOUND', '调试任务不存在')
  if (task.source !== 'admin_debug') return failure('FORBIDDEN', '不是后台调试任务')
  if (task.adminUid && task.adminUid !== caller.uid) return failure('FORBIDDEN', '无权查看该调试任务')

  if (['succeeded', 'failed'].includes(task.status)) {
    await db.collection(COLLECTIONS.templateTestCases).doc(taskId).update({
      data: {
        status: task.status,
        provider: task.provider || '',
        modelCallId: task.modelCallId || task.modelCallIdSnapshot || '',
        fallbackUsed: !!task.fallbackUsed,
        durationMs: task.totalDurationMs || task.executionDurationMs || 0,
        errorMessage: task.errorMessage || '',
        resultUrl: task.resultUrl || '',
        finishedAt: task.finishedAt || now(),
        updatedAt: now()
      }
    }).catch(() => null)
  }

  if (task.status === 'pending' || task.status === 'running') {
    cloud.callFunction({
      name: 'generationWorker',
      data: { taskId }
    }).catch((err) => {
      console.error('[adminApi] debug generation worker ensure failed', taskId, err)
    })
  }

  let resultTempUrl = ''
  if (task.resultUrl) {
    const tempRes = await cloud.getTempFileURL({ fileList: [task.resultUrl] }).catch(() => null)
    resultTempUrl = tempRes && tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL || ''
  }

  return success({
    task: {
      taskId,
      status: task.status || 'pending',
      upstreamStatus: task.upstreamStatus || '',
      resultUrl: task.resultUrl || '',
      resultTempUrl,
      historyId: task.historyId || '',
      errorMessage: task.errorMessage || '',
      compiledPrompt: task.compiledPrompt || task.promptSnapshot || '',
      provider: task.provider || '',
      modelCallId: task.modelCallId || task.modelCallIdSnapshot || '',
      fallbackUsed: !!task.fallbackUsed,
      primaryErrorMessage: task.primaryErrorMessage || '',
      executionDurationMs: task.executionDurationMs || task.lastExecutionDurationMs || 0,
      totalDurationMs: task.totalDurationMs || 0,
      createdAt: task.createdAt || null,
      finishedAt: task.finishedAt || null
    }
  })
}

function getImageModelCallId(item = {}) {
  return item.modelCallId || item.model_call_id || item.modelCallIdSnapshot || ''
}

function getImageGeneratedOpenid(item = {}) {
  return item.generatedOpenid || item.generated_openid || item.openid || item._openid || ''
}

function getImageResultCandidates(item = {}) {
  const candidates = [
    item.fileID,
    item.resultUrl,
    item.upscaledUrl
  ]
  const objectKey = cleanPrefix(item.objectKey || item.cloudPath || '')
  if (objectKey) {
    candidates.push(getFileIDFromKey(objectKey))
  }
  return [...new Set(candidates.filter(Boolean))]
}

function putImageGenerationMeta(map, resultUrl, source = {}) {
  if (!resultUrl) return
  const current = map[resultUrl] || {}
  const modelCallId = source.modelCallId || source.model_call_id || source.modelCallIdSnapshot || ''
  const generatedOpenid = source.generatedOpenid || source.generated_openid || source.openid || source._openid || ''
  const historyId = source.historyId || source.history_id || source._id || ''
  const generationId = source.generationId || source.generation_id || source.taskId || source.task_id || (source.historyId || source.history_id ? source._id : '') || ''
  if (!modelCallId && !generatedOpenid && !historyId && !generationId) return
  map[resultUrl] = {
    historyId: current.historyId || historyId,
    generationId: current.generationId || generationId,
    modelCallId: current.modelCallId || modelCallId,
    generatedOpenid: current.generatedOpenid || generatedOpenid,
    featureId: current.featureId || source.featureId || '',
    featureName: current.featureName || source.featureName || source.featureNameSnapshot || '',
    provider: current.provider || source.provider || '',
    fallbackUsed: current.fallbackUsed ?? !!source.fallbackUsed
  }
}

function isGeneratedResultImage(item = {}) {
  return getImageAssetIdentity(item).toLowerCase().startsWith('generated_results/')
}

function supportsPreciseSaveTracking(appVersion = '') {
  const parts = String(appVersion || '').split('.').map((item) => Number(item))
  if (parts.length < 3 || parts.some((item) => !Number.isInteger(item) || item < 0)) return false
  const versionNumber = parts[0] * 1000000 + parts[1] * 1000 + parts[2]
  return versionNumber >= 1004008
}

async function attachImageSaveStatus(items = []) {
  const rows = items.map((item) => (
    isGeneratedResultImage(item)
      ? { ...item, isSaved: null, saveStatus: 'unknown' }
      : { ...item, isSaved: null, saveStatus: '' }
  ))
  const resultIds = [...new Set(rows
    .filter(isGeneratedResultImage)
    .map((item) => String(item.historyId || item.history_id || '').trim())
    .filter(Boolean))]
  const generationIds = [...new Set(rows
    .filter(isGeneratedResultImage)
    .map((item) => String(item.generationId || item.generation_id || item.taskId || item.task_id || '').trim())
    .filter(Boolean))]
  if (resultIds.length === 0 && generationIds.length === 0) return rows

  const eventRows = new Map()
  const successEvents = new Set(['original_save_succeeded', 'hd_save_succeeded'])
  const preciseSaveEvents = new Set([
    'original_save_click', 'original_save_succeeded', 'original_save_failed',
    'hd_save_click', 'hd_save_succeeded', 'hd_save_failed'
  ])

  async function collectEvents(field, ids) {
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batchIds = ids.slice(offset, offset + 20)
      try {
        const eventRes = await db.collection(COLLECTIONS.analyticsEvents)
          .where({ [field]: _.in(batchIds) })
          .field({ _id: true, resultId: true, generationId: true, eventName: true, appVersion: true })
          .limit(1000)
          .get()
        ;(eventRes.data || []).forEach((event) => eventRows.set(event._id || `${event.eventName}:${event.resultId}:${event.generationId}`, event))
      } catch (err) {
        console.warn(`[adminApi] image save-status ${field} lookup failed`, err && err.message)
      }
    }
  }

  const resultLookupIds = [...new Set([...resultIds, ...generationIds])]
  await collectEvents('resultId', resultLookupIds)
  await collectEvents('generationId', generationIds)

  return rows.map((item) => {
    if (!isGeneratedResultImage(item)) return item
    const resultId = String(item.historyId || item.history_id || '').trim()
    const generationId = String(item.generationId || item.generation_id || item.taskId || item.task_id || '').trim()
    if (!resultId && !generationId) return item
    let tracked = false
    let saved = false
    for (const event of eventRows.values()) {
      const matches = (resultId && event.resultId === resultId) ||
        (generationId && (event.generationId === generationId || event.resultId === generationId))
      if (!matches) continue
      if (preciseSaveEvents.has(event.eventName)) tracked = true
      if (successEvents.has(event.eventName)) saved = true
      // 1.4.8 is the first client version with precise original/HD save events.
      if (['generation_submitted', 'generation_succeeded'].includes(event.eventName) && supportsPreciseSaveTracking(event.appVersion)) tracked = true
    }
    if (!tracked) return item
    return { ...item, isSaved: saved, saveStatus: saved ? 'saved' : 'not_saved' }
  })
}

async function enrichImageGenerationInfo(items = []) {
  const missingItems = items.filter((item) => (
    !getImageModelCallId(item) || !getImageGeneratedOpenid(item) || isGeneratedResultImage(item)
  ))
  if (missingItems.length === 0) return attachImageSaveStatus(items)

  const candidates = [...new Set(missingItems.flatMap(getImageResultCandidates))].slice(0, 100)
  if (candidates.length === 0) return attachImageSaveStatus(items)

  const generationMap = {}
  const historyRes = await db.collection(COLLECTIONS.generationHistory)
    .where(_.or([
      { resultUrl: _.in(candidates) },
      { upscaledUrl: _.in(candidates) },
      { photoUrl: _.in(candidates) },
      { originalImages: _.in(candidates) }
    ]))
    .field({ _id: true, taskId: true, resultUrl: true, upscaledUrl: true, photoUrl: true, originalImages: true, modelCallId: true, provider: true, fallbackUsed: true, _openid: true, featureId: true, featureName: true })
    .limit(100)
    .get()

  ;(historyRes.data || []).forEach((item) => {
    putImageGenerationMeta(generationMap, item.resultUrl, item)
    putImageGenerationMeta(generationMap, item.upscaledUrl, item)
    putImageGenerationMeta(generationMap, item.photoUrl, item)
    ;(Array.isArray(item.originalImages) ? item.originalImages : []).forEach((value) => putImageGenerationMeta(generationMap, value, item))
  })

  if (candidates.length > 0) {
    const taskRes = await db.collection(COLLECTIONS.generationTasks)
      .where(_.or([
        { resultUrl: _.in(candidates) },
        { imageUrls: _.in(candidates) }
      ]))
      .field({ _id: true, historyId: true, resultUrl: true, imageUrls: true, modelCallId: true, modelCallIdSnapshot: true, provider: true, fallbackUsed: true, _openid: true, featureId: true, featureNameSnapshot: true })
      .limit(100)
      .get()

    ;(taskRes.data || []).forEach((item) => {
      putImageGenerationMeta(generationMap, item.resultUrl, item)
      ;(Array.isArray(item.imageUrls) ? item.imageUrls : []).forEach((value) => putImageGenerationMeta(generationMap, value, item))
    })
  }

  const enriched = items.map((item) => {
    const candidate = getImageResultCandidates(item).find((value) => generationMap[value])
    if (!candidate) return item
    const meta = generationMap[candidate]
    return {
      ...item,
      historyId: item.historyId || item.history_id || meta.historyId,
      generationId: item.generationId || item.generation_id || item.taskId || item.task_id || meta.generationId,
      modelCallId: getImageModelCallId(item) || meta.modelCallId,
      generatedOpenid: getImageGeneratedOpenid(item) || meta.generatedOpenid,
      ownerOpenid: item.ownerOpenid || getImageGeneratedOpenid(item) || meta.generatedOpenid,
      featureId: item.featureId || meta.featureId,
      featureName: item.featureName || meta.featureName,
      provider: item.provider || meta.provider,
      fallbackUsed: item.fallbackUsed ?? meta.fallbackUsed
    }
  })
  return attachImageSaveStatus(enriched)
}

async function listAllByQuery(query, fields = {}) {
  const rows = []
  const limit = 100
  let skip = 0
  while (true) {
    const pageQuery = Object.keys(fields).length > 0 ? query.field(fields) : query
    const res = await pageQuery.skip(skip).limit(limit).get()
    const batch = res.data || []
    rows.push(...batch)
    skip += batch.length
    if (batch.length < limit) break
  }
  return rows
}

function getImageReferenceKeys(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return []
  const keys = [raw]
  if (raw.startsWith('cloud://')) {
    const objectKey = cleanPrefix(getObjectKeyFromFileID(raw))
    if (objectKey) keys.push(objectKey)
  }
  return [...new Set(keys)]
}

function getImageAssetReferenceKeys(item = {}) {
  return [...new Set([
    ...getImageReferenceKeys(item.fileID),
    cleanPrefix(item.objectKey || ''),
    cleanPrefix(item.cloudPath || '')
  ].filter(Boolean))]
}

async function getImageTemplateRefs() {
  const features = await listAllByQuery(
    db.collection(COLLECTIONS.features).orderBy('sort', 'asc'),
    { name: true, status: true, sort: true, template_type: true }
  )
  return features.map((item) => ({
    id: item._id,
    name: item.name || item._id,
    status: item.status,
    templateType: normalizeTemplateType(item.template_type)
  }))
}

async function listImagesByTemplate(payload, featureId) {
  const histories = await listAllByQuery(
    db.collection(COLLECTIONS.generationHistory).where({ featureId }),
    {
      featureId: true,
      featureName: true,
      photoUrl: true,
      originalImages: true,
      resultUrl: true,
      upscaledUrl: true,
      modelCallId: true,
      provider: true,
      fallbackUsed: true,
      _openid: true
    }
  )
  const referenceMeta = {}
  histories.forEach((history) => {
    const originals = [history.photoUrl, ...(Array.isArray(history.originalImages) ? history.originalImages : [])]
    originals.forEach((value) => {
      getImageReferenceKeys(value).forEach((key) => {
        if (!referenceMeta[key]) referenceMeta[key] = { imageRole: 'original', history }
      })
    })
    ;[history.resultUrl, history.upscaledUrl].forEach((value) => {
      getImageReferenceKeys(value).forEach((key) => {
        referenceMeta[key] = { imageRole: value === history.upscaledUrl ? 'upscaled' : 'generated', history }
      })
    })
  })

  const folder = String(payload.folder || '')
  const where = folder ? { folder } : {}
  const assets = await listAllByQuery(db.collection(COLLECTIONS.images).where(where))
  const keyword = String(payload.keyword || '').trim().toLowerCase()
  const filters = payload.filters || {}
  const matched = assets.map((item) => {
    const meta = getImageAssetReferenceKeys(item).map((key) => referenceMeta[key]).find(Boolean)
    if (!meta) return null
    return {
      ...item,
      featureId,
      featureName: meta.history.featureName || '',
      imageRole: meta.imageRole,
      modelCallId: getImageModelCallId(item) || getImageModelCallId(meta.history),
      generatedOpenid: getImageGeneratedOpenid(item) || getImageGeneratedOpenid(meta.history),
      provider: item.provider || meta.history.provider || '',
      fallbackUsed: item.fallbackUsed ?? !!meta.history.fallbackUsed
    }
  }).filter(Boolean).filter((item) => {
    if (keyword && !`${item.name || ''} ${item.objectKey || ''} ${item.folder || ''}`.toLowerCase().includes(keyword)) return false
    if (filters.usage && item.usage !== filters.usage) return false
    if (filters.status !== '' && filters.status !== undefined && normalizeNumber(item.status, 0) !== normalizeNumber(filters.status, 0)) return false
    return true
  })

  const { sortBy, sortOrder } = normalizeSort(payload, 'lastModified', 'desc')
  matched.sort((left, right) => {
    const a = normalizeSortValue(left[sortBy])
    const b = normalizeSortValue(right[sortBy])
    if (a === b) return 0
    const direction = sortOrder === 'asc' ? 1 : -1
    return a > b ? direction : -direction
  })

  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 20), 1), 100)
  return success({
    data: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize
  })
}

async function listImages(payload) {
  const safePayload = payload || {}
  const scope = ['user', 'operations'].includes(safePayload.scope) ? safePayload.scope : ''
  if (scope) return listImagesByScope(safePayload, scope)
  const featureId = String(safePayload.featureId || '').trim()
  const where = safePayload.folder ? { folder: safePayload.folder } : {}
  const result = featureId
    ? await listImagesByTemplate(safePayload, featureId)
    : await listCollection(COLLECTIONS.images, { ...safePayload, where }, undefined, {
      keywordFields: ['name', 'objectKey', 'folder', 'usage'],
      allowedFilters: ['usage', 'status', 'folder', 'createdAt', 'lastModified']
    })
  const fileList = (result.data || []).map((item) => item.fileID).filter(Boolean)
  const [foldersRes, templates] = await Promise.all([
    db.collection(COLLECTIONS.images).field({ folder: true }).limit(1000).get(),
    getImageTemplateRefs()
  ])
  const folders = [...new Set((foldersRes.data || []).map((item) => item.folder || '').filter((item) => item !== ''))].sort()
  result.folders = folders
  result.refs = { ...(result.refs || {}), templates }
  if (fileList.length === 0) {
    result.data = await enrichImageGenerationInfo(result.data || [])
    return result
  }

  const urlMap = await getTempFileUrls(fileList)
  result.data = result.data.map((item) => ({
    ...item,
    temporaryUrl: urlMap[item.fileID] || item.temporaryUrl || ''
  }))
  result.data = await enrichImageGenerationInfo(result.data)
  return result
}

const USER_IMAGE_PREFIXES = ['uploads/', 'generated_results/', 'generated_upscaled/', 'admin-debug-inputs/', 'generated/']
const OPERATIONS_IMAGE_PREFIXES = ['Pictures', 'pictures']

function isOperationsImageKey(key = '') {
  const first = cleanPrefix(String(key || '').replace(/\\/g, '/')).split('/')[0]
  return first.toLowerCase() === 'pictures'
}

function imageMatchesScope(item = {}, scope = 'user') {
  const objectKey = `${getImageAssetIdentity(item)}/`
  if (scope === 'operations') return isOperationsImageKey(objectKey)
  return USER_IMAGE_PREFIXES.some((prefix) => objectKey.toLowerCase().startsWith(prefix.toLowerCase()))
}

async function attachCoverUrls(features = []) {
  const toFileID = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw || raw.startsWith('http')) return ''
    if (raw.startsWith('cloud://')) return raw
    return getFileIDFromKey(getObjectKeyFromFileID(raw) || raw)
  }
  const fileList = [...new Set(features.map((item) => toFileID(item.home_banner)).filter(Boolean))]
  const urlMap = await getTempFileUrls(fileList)
  return features.map((item) => {
    const raw = String(item.home_banner || '').trim()
    const fileID = toFileID(raw)
    return { ...item, cover_url: raw.startsWith('http') ? raw : (urlMap[fileID] || '') }
  })
}

async function listOperationsStorageAssets() {
  const objectMap = new Map()
  try {
    const pages = await Promise.all(OPERATIONS_IMAGE_PREFIXES.map((prefix) => listStorageObjects(prefix)))
    pages.flat().forEach((item) => { if (item && item.Key) objectMap.set(item.Key.replace(/^\/+/, ''), item) })
  } catch (err) {
    console.warn('[adminApi] list Pictures directory failed', err && err.message)
  }
  const dbAssets = await listAllByQuery(db.collection(COLLECTIONS.images))
  const dbOps = dbAssets.filter((item) => isOperationsImageKey(getImageAssetIdentity(item)))
  const dbByKey = {}
  dbOps.forEach((item) => {
    const key = getImageAssetIdentity(item)
    if (key) dbByKey[key] = item
    if (key) dbByKey[key.toLowerCase()] = item
  })
  if (!objectMap.size) return dbOps
  return [...objectMap.values()].map((item) => {
    const objectKey = String(item.Key || '').replace(/^\/+/, '')
    const existing = dbByKey[objectKey] || dbByKey[objectKey.toLowerCase()]
    return {
      ...(existing || {}),
      _id: existing && existing._id ? existing._id : objectKey,
      name: (existing && existing.name) || getNameFromKey(objectKey),
      folder: (existing && existing.folder) || getFolderFromKey(objectKey),
      objectKey,
      cloudPath: objectKey,
      fileID: (existing && existing.fileID) || getFileIDFromKey(objectKey),
      size: Number(item.Size || (existing && existing.size) || 0),
      lastModified: item.LastModified || (existing && existing.lastModified) || '',
      source: (existing && existing.source) || 'storage'
    }
  })
}

function imageDateMs(item = {}) {
  return normalizeSortValue(item.lastModified || item.createdAt || item.updatedAt)
}

async function getTemplateImageKeys(featureId = '') {
  if (!featureId) return null
  const histories = await listAllByQuery(
    db.collection(COLLECTIONS.generationHistory).where({ featureId }),
    { photoUrl: true, originalImages: true, resultUrl: true, upscaledUrl: true }
  )
  const keys = new Set()
  histories.forEach((history) => {
    ;[history.photoUrl, history.resultUrl, history.upscaledUrl, ...(Array.isArray(history.originalImages) ? history.originalImages : [])]
      .filter(Boolean)
      .forEach((value) => getImageReferenceKeys(value).forEach((key) => keys.add(key)))
  })
  return keys
}

async function listImagesByScope(payload = {}, scope = 'user') {
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize || payload.page_size, 20), 1), 100)
  const keyword = String(payload.keyword || '').trim().toLowerCase()
  const filters = payload.filters || {}
  const featureId = scope === 'user' ? String(payload.featureId || payload.template_id || filters.templateId || '').trim() : ''
  const dateFrom = payload.start_date || filters.dateFrom || ''
  const dateTo = payload.end_date || filters.dateTo || ''
  const dateFromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00.000+08:00`) : NaN
  const dateToMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999+08:00`) : NaN
  const templateKeys = await getTemplateImageKeys(featureId)
  const assets = scope === 'operations'
    ? await listOperationsStorageAssets()
    : await listAllByQuery(db.collection(COLLECTIONS.images))
  const matched = assets.filter((item) => {
    if (!imageMatchesScope(item, scope)) return false
    if (keyword && !`${item.name || ''} ${item.objectKey || ''} ${item.cloudPath || ''}`.toLowerCase().includes(keyword)) return false
    const timestamp = imageDateMs(item)
    if (Number.isFinite(dateFromMs) && timestamp < dateFromMs) return false
    if (Number.isFinite(dateToMs) && timestamp > dateToMs) return false
    if (templateKeys) return getImageAssetReferenceKeys(item).some((key) => templateKeys.has(key))
    return true
  })
  const { sortBy, sortOrder } = normalizeSort(payload, 'lastModified', 'desc')
  const direction = sortOrder === 'asc' ? 1 : -1
  matched.sort((left, right) => {
    const a = normalizeSortValue(left[sortBy])
    const b = normalizeSortValue(right[sortBy])
    if (a === b) return String(left._id || '').localeCompare(String(right._id || ''))
    return a > b ? direction : -direction
  })
  const pageRows = matched.slice((page - 1) * pageSize, page * pageSize)
  const urlMap = await getTempFileUrls(pageRows.map((item) => item.fileID))
  const templates = await getImageTemplateRefs()
  const data = await enrichImageGenerationInfo(pageRows.map((item) => ({ ...item, temporaryUrl: urlMap[item.fileID] || '' })))
  return success({ data, total: matched.length, page, pageSize, page_size: pageSize, scope, refs: { templates }, updated_at: new Date().toISOString() })
}

async function listAllImageAssetRefs() {
  const refs = []
  const limit = 100
  let skip = 0
  while (true) {
    const res = await db.collection(COLLECTIONS.images)
      .field({ objectKey: true, cloudPath: true, fileID: true, createdAt: true, updatedAt: true })
      .skip(skip)
      .limit(limit)
      .get()
    const rows = res.data || []
    refs.push(...rows)
    skip += rows.length
    if (rows.length < limit) break
  }
  return refs
}

function getImageAssetIdentity(item = {}) {
  return cleanPrefix(item.objectKey || item.cloudPath || getObjectKeyFromFileID(item.fileID || ''))
}

async function createImageAsset(payload) {
  if (!payload || !payload.fileID) return failure('BAD_REQUEST', '缺少 fileID')
  const data = pickFields(payload, IMAGE_FIELDS)
  const objectKey = data.objectKey || data.cloudPath || getObjectKeyFromFileID(data.fileID)
  if (payload.scope === 'operations') {
    const normalizedKey = cleanPrefix(objectKey)
    const fileKey = cleanPrefix(getObjectKeyFromFileID(data.fileID))
    if (!isOperationsImageKey(normalizedKey) || normalizedKey.includes('../') || normalizedKey.includes('..\\') || fileKey.toLowerCase() !== normalizedKey.toLowerCase()) {
      return failure('INVALID_OBJECT_PATH', '运营图片只能上传到 Pictures/ 目录', { field: 'object_path', suggestion: '请使用 Pictures/ 下的安全对象路径' })
    }
  }
  data.objectKey = objectKey
  data.cloudPath = objectKey
  data.folder = data.folder || getFolderFromKey(objectKey)
  data.name = data.name || getNameFromKey(objectKey)
  data.status = typeof data.status === 'number' ? data.status : 1
  data.source = data.source || 'admin'
  data.lastModified = data.lastModified || new Date().toISOString()
  data.createdAt = now()
  data.updatedAt = now()

  const existingRes = await db.collection(COLLECTIONS.images).where({ objectKey }).limit(1).get()
  const existing = existingRes.data && existingRes.data[0]
  if (existing) {
    delete data.createdAt
    await db.collection(COLLECTIONS.images).doc(existing._id).update({ data })
    return success({ _id: existing._id, updatedExisting: true })
  }

  const res = await db.collection(COLLECTIONS.images).add({ data })
  return success({ _id: res._id })
}

async function createImageAssets(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) return failure('BAD_REQUEST', '缺少待上传图片')
  const results = []
  for (const item of items) {
    try {
      const result = await createImageAsset({ ...item, scope: item.scope || payload.scope || 'operations' })
      results.push({
        success: !!result.success,
        name: item.name || item.objectKey || '',
        _id: result._id || '',
        message: result.success ? '' : (result.message || '创建失败')
      })
    } catch (err) {
      results.push({
        success: false,
        name: item.name || item.objectKey || '',
        _id: '',
        message: err.message || '创建失败'
      })
    }
  }
  const created = results.filter((item) => item.success).length
  const failed = results.filter((item) => !item.success)
  if (!created) return failure('UPLOAD_FAILED', `全部 ${results.length} 张图片创建失败`)
  return success({ created, failed: failed.length, results, failed_items: failed })
}

async function updateImageAsset(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少图片资源 ID')
  const doc = await db.collection(COLLECTIONS.images).doc(payload.id).get()
  const asset = doc.data
  if (!asset) return failure('NOT_FOUND', '图片资源不存在')

  const data = pickFields(payload.data || {}, IMAGE_FIELDS)
  const nextKey = cleanPrefix(data.objectKey || data.cloudPath || '')
  const currentKey = cleanPrefix(asset.objectKey || asset.cloudPath || getObjectKeyFromFileID(asset.fileID))

  if (nextKey && currentKey && nextKey !== currentKey) {
    await cosRequest('putObjectCopy', {
      Bucket: STORAGE_BUCKET,
      Region: STORAGE_REGION,
      Key: nextKey,
      CopySource: `${STORAGE_BUCKET}.cos.${STORAGE_REGION}.myqcloud.com/${encodeURIComponent(currentKey).replace(/%2F/g, '/')}`
    })
    await cosRequest('deleteObject', {
      Bucket: STORAGE_BUCKET,
      Region: STORAGE_REGION,
      Key: currentKey
    })
    data.objectKey = nextKey
    data.cloudPath = nextKey
    data.folder = data.folder || getFolderFromKey(nextKey)
    data.fileID = getFileIDFromKey(nextKey)
    data.name = data.name || getNameFromKey(nextKey)
    data.lastModified = new Date().toISOString()
  } else if (nextKey) {
    data.objectKey = nextKey
    data.cloudPath = nextKey
    data.folder = data.folder || getFolderFromKey(nextKey)
    data.fileID = data.fileID || getFileIDFromKey(nextKey)
  }

  data.updatedAt = now()
  await db.collection(COLLECTIONS.images).doc(payload.id).update({ data })
  return success({ fileID: data.fileID || asset.fileID })
}

async function listStorageObjects(prefix = '') {
  const normalizedPrefix = cleanPrefix(prefix)
  const params = {
    Bucket: STORAGE_BUCKET,
    Region: STORAGE_REGION,
    Prefix: normalizedPrefix ? `${normalizedPrefix}/` : '',
    MaxKeys: 1000
  }
  const objects = []
  let marker = ''
  do {
    const res = await cosRequest('getBucket', { ...params, Marker: marker })
    ;(res.Contents || []).forEach((item) => {
      if (!item.Key || item.Key.endsWith('/')) return
      objects.push(item)
    })
    marker = res.NextMarker || ''
  } while (marker)
  return objects
}

async function syncStorageAssets(payload = {}) {
  const scope = ['user', 'operations'].includes(payload.scope) ? payload.scope : ''
  const prefixes = scope === 'operations'
    ? OPERATIONS_IMAGE_PREFIXES
    : scope === 'user'
      ? USER_IMAGE_PREFIXES.map((item) => cleanPrefix(item))
      : [cleanPrefix(payload.prefix || '')]
  const objectPages = await Promise.all(prefixes.map((prefix) => listStorageObjects(prefix)))
  const objectMap = new Map()
  objectPages.flat().forEach((item) => objectMap.set(item.Key, item))
  const objects = [...objectMap.values()]
  const existingRes = { data: await listAllImageAssetRefs() }
  const existingMap = {}
  ;(existingRes.data || []).forEach((item) => {
    const objectKey = getImageAssetIdentity(item)
    if (objectKey && !existingMap[objectKey]) existingMap[objectKey] = item._id
  })
  let created = 0
  let updated = 0
  const skipped = []
  const tasks = []
  const failed = []

  for (const item of objects) {
    const objectKey = item.Key.replace(/^\/+/, '')
    const data = {
      name: getNameFromKey(objectKey),
      folder: getFolderFromKey(objectKey),
      objectKey,
      cloudPath: objectKey,
      fileID: getFileIDFromKey(objectKey),
      size: Number(item.Size || 0),
      etag: item.ETag || '',
      lastModified: item.LastModified || '',
      source: 'storage_sync',
      status: 1,
      syncedAt: now(),
      updatedAt: now()
    }

    if (existingMap[objectKey]) {
      if (payload.refreshExisting) {
        tasks.push(async () => {
          await db.collection(COLLECTIONS.images).doc(existingMap[objectKey]).update({ data })
          updated += 1
        })
      } else {
        skipped.push(objectKey)
      }
    } else {
      tasks.push(async () => {
        await db.collection(COLLECTIONS.images).add({
          data: {
            ...data,
            category: data.folder,
            usage: data.folder,
            createdAt: now()
          }
        })
        created += 1
      })
    }
  }

  const chunkSize = 20
  for (let index = 0; index < tasks.length; index += chunkSize) {
    const chunk = tasks.slice(index, index + chunkSize)
    const results = await Promise.allSettled(chunk.map((task) => task()))
    results.forEach((result, resultIndex) => {
      if (result.status === 'rejected') failed.push({ index: index + resultIndex, message: result.reason && result.reason.message || '同步失败' })
    })
  }

  return success({
    scope: scope || 'legacy',
    prefixes,
    scanned: objects.length,
    created,
    updated,
    skipped: skipped.length,
    skipped_objects: skipped.slice(0, 100),
    failed
  })
}

function valuesReferenceImage(values = [], targetKeys = new Set()) {
  return values.filter(Boolean).some((value) => getImageReferenceKeys(value).some((key) => targetKeys.has(key)))
}

async function getImageReferences(asset = {}) {
  const targetKeys = new Set(getImageAssetReferenceKeys(asset))
  if (!targetKeys.size) return []
  const [features, histories, tasks] = await Promise.all([
    listAllByQuery(db.collection(COLLECTIONS.features), { name: true, home_banner: true, detail_banner: true, draft_data: true }),
    listAllByQuery(db.collection(COLLECTIONS.generationHistory), { featureId: true, resultUrl: true, upscaledUrl: true, photoUrl: true, originalImages: true }),
    listAllByQuery(db.collection(COLLECTIONS.generationTasks), { featureId: true, status: true, resultUrl: true, imageUrls: true })
  ])
  const refs = []
  features.forEach((item) => {
    const draft = item.draft_data || {}
    if (valuesReferenceImage([item.home_banner, item.detail_banner, draft.home_banner, draft.detail_banner], targetKeys)) {
      refs.push({ type: 'template', id: item._id, name: item.name || item._id })
    }
  })
  histories.forEach((item) => {
    if (valuesReferenceImage([item.photoUrl, item.resultUrl, item.upscaledUrl, ...(Array.isArray(item.originalImages) ? item.originalImages : [])], targetKeys)) {
      refs.push({ type: 'generation_record', id: item._id, name: item.featureId || '生成记录' })
    }
  })
  tasks.filter((item) => ['pending', 'running'].includes(item.status)).forEach((item) => {
    if (valuesReferenceImage([item.resultUrl, ...(Array.isArray(item.imageUrls) ? item.imageUrls : [])], targetKeys)) {
      refs.push({ type: 'generation_job', id: item._id, name: item.featureId || '运行中任务' })
    }
  })
  return refs.slice(0, 100)
}

async function countImageAssetRefs(asset = {}) {
  const conditions = []
  const objectKey = getImageAssetIdentity(asset)
  if (asset.fileID) conditions.push({ fileID: asset.fileID })
  if (objectKey) {
    conditions.push({ objectKey })
    conditions.push({ cloudPath: objectKey })
  }
  if (conditions.length === 0) return 0
  const res = await db.collection(COLLECTIONS.images).where(_.or(conditions)).count()
  return res.total || 0
}

async function deleteImageAsset(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少图片资源 ID')
  const doc = await db.collection(COLLECTIONS.images).doc(payload.id).get()
  const asset = doc.data
  if (!asset) return failure('NOT_FOUND', '图片资源不存在')

  const refs = await getImageReferences(asset)
  if (refs.length > 0) {
    return failure('IMAGE_IN_USE', '图片正在被业务数据引用，不能删除', { refs, details: { refs }, suggestion: '请先解除模板、生成记录或运行中任务的引用' })
  }

  const sameFileRefCount = await countImageAssetRefs(asset)
  const shouldDeleteStorageFile = sameFileRefCount <= 1

  if (shouldDeleteStorageFile && asset.fileID) {
    await cloud.deleteFile({ fileList: [asset.fileID] })
  } else if (shouldDeleteStorageFile && asset.objectKey) {
    await cosRequest('deleteObject', {
      Bucket: STORAGE_BUCKET,
      Region: STORAGE_REGION,
      Key: asset.objectKey
    })
  }
  await db.collection(COLLECTIONS.images).doc(payload.id).remove()
  return success({ storageDeleted: shouldDeleteStorageFile, sameFileRefCount })
}

const LAST_REASON_LABELS = {
  admin_sync: '后台同步用户',
  admin_adjust: '后台调整星光'
}

function readUserPoints(item = {}) {
  return normalizeNumber(item.points ?? item.starlight ?? item.eggs, 0)
}

function historyTime(row = {}) {
  const value = row.createdAt
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (value.$date) return new Date(value.$date).getTime()
  return Date.parse(value) || 0
}

function looksLikeFeatureId(value = '') {
  const text = String(value || '').trim()
  if (!text || LAST_REASON_LABELS[text]) return false
  if (/^(recharge|task_|admin_)/.test(text)) return false
  return /^[a-zA-Z0-9_-]{16,}$/.test(text)
}

function labelLastReason(reason = '', title = '', featureName = '') {
  const text = String(title || '').trim()
  if (text) return text
  const value = String(reason || '').trim()
  if (featureName) return `使用模板「${featureName}」`
  if (LAST_REASON_LABELS[value]) return LAST_REASON_LABELS[value]
  if (value.startsWith('recharge_vp_') || value.startsWith('recharge_')) return '星光充值'
  if (value.startsWith('task_')) return '任务奖励'
  return value || '—'
}

async function enrichUserRows(rows = []) {
  if (!rows.length) return []
  const openids = [...new Set(rows.map((item) => item._id).filter(Boolean))]
  const historyByUser = {}
  const successfulGenerationCountByUser = {}
  for (let i = 0; i < openids.length; i += 10) {
    const batch = openids.slice(i, i + 10)
    const [records, generationCounts] = await Promise.all([
      listAllByQuery(db.collection(COLLECTIONS.pointsHistory).where({ _openid: _.in(batch) })),
      db.collection(COLLECTIONS.generationHistory)
        .aggregate()
        .match({ _openid: _.in(batch) })
        .group({ _id: '$_openid', count: db.command.aggregate.sum(1) })
        .end()
        .catch(async () => {
          const histories = await listAllByQuery(
            db.collection(COLLECTIONS.generationHistory).where({ _openid: _.in(batch) }),
            { _openid: true }
          )
          const fallbackCounts = {}
          histories.forEach((item) => { if (item._openid) fallbackCounts[item._openid] = (fallbackCounts[item._openid] || 0) + 1 })
          return { list: Object.entries(fallbackCounts).map(([id, count]) => ({ _id: id, count })) }
        })
    ])
    records.forEach((record) => {
      const key = record._openid
      if (!key) return
      if (!historyByUser[key]) historyByUser[key] = []
      historyByUser[key].push(record)
    })
    ;(generationCounts.list || generationCounts.data || []).forEach((record) => {
      if (record._id) successfulGenerationCountByUser[record._id] = normalizeNumber(record.count, 0)
    })
  }

  const featureIds = [...new Set(rows.flatMap((item) => {
    const history = (historyByUser[item._id] || []).slice().sort((a, b) => historyTime(b) - historyTime(a))
    const reason = String((history[0] && history[0].reason) || item.lastReason || '').trim()
    return looksLikeFeatureId(reason) ? [reason] : []
  }))]
  const featureNames = {}
  await Promise.all(featureIds.map(async (id) => {
    const doc = await db.collection(COLLECTIONS.features).doc(id).get().catch(() => null)
    if (doc && doc.data && doc.data.name) featureNames[id] = doc.data.name
  }))

  const enriched = []
  for (const item of rows) {
    const history = (historyByUser[item._id] || []).slice().sort((a, b) => historyTime(b) - historyTime(a))
    const points = readUserPoints(item)
    const latest = history[0] || {}
    const lastReason = String(latest.reason || item.lastReason || '').trim()
    enriched.push({
      ...item,
      points,
      successfulGenerationCount: successfulGenerationCountByUser[item._id] || 0,
      lastReason,
      lastReasonLabel: labelLastReason(lastReason, latest.title, featureNames[lastReason])
    })
  }
  return enriched
}

async function listUsers(payload) {
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize || payload.page_size, 20), 1), 100)
  const { sortBy, sortOrder } = normalizeSort(payload, 'updatedAt', 'desc')
  const safeSortBy = ['updatedAt', 'createdAt', 'points'].includes(sortBy) ? sortBy : 'updatedAt'
  const keyword = String(payload.keyword || '').trim()
  if (keyword) {
    const doc = await db.collection(COLLECTIONS.users).doc(keyword).get().catch(() => null)
    const item = doc && doc.data
    const data = item ? await enrichUserRows([{ ...item, _id: item._id || keyword, maskedOpenid: maskIdentifier(keyword) }]) : []
    return success({ data, total: item ? 1 : 0, page: 1, pageSize, page_size: pageSize, updated_at: new Date().toISOString() })
  }
  const filters = payload.filters || {}
  const where = {}
  const minPoints = parseOptionalNumber(filters.minPoints)
  const maxPoints = parseOptionalNumber(filters.maxPoints)
  if (Number.isFinite(minPoints) && Number.isFinite(maxPoints)) where.points = _.gte(minPoints).and(_.lte(maxPoints))
  else if (Number.isFinite(minPoints)) where.points = _.gte(minPoints)
  else if (Number.isFinite(maxPoints)) where.points = _.lte(maxPoints)
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) ? `${filters.dateFrom}T00:00:00.000+08:00` : filters.dateFrom) : null
    const to = filters.dateTo ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) ? `${filters.dateTo}T23:59:59.999+08:00` : filters.dateTo) : null
    if (from && to) where.updatedAt = _.gte(from).and(_.lte(to))
    else if (from) where.updatedAt = _.gte(from)
    else if (to) where.updatedAt = _.lte(to)
  }
  const query = db.collection(COLLECTIONS.users).where(where)
  const [countRes, listRes] = await Promise.all([
    query.count(),
    query.orderBy(safeSortBy, sortOrder).skip((page - 1) * pageSize).limit(pageSize).get()
  ])
  const data = await enrichUserRows((listRes.data || []).map((item) => ({ ...item, maskedOpenid: maskIdentifier(item._id) })))
  return success({
    data,
    total: countRes.total || 0,
    page,
    pageSize,
    page_size: pageSize,
    updated_at: new Date().toISOString()
  })
}

async function revealSensitiveValue(payload = {}) {
  const recordId = String(payload.recordId || '').trim()
  const reason = String(payload.reason || '').trim()
  if (payload.type !== 'user_openid' || !recordId) return failure('BAD_REQUEST', '不支持的敏感信息类型')
  if (!reason) return failure('BAD_REQUEST', '查看敏感信息必须填写原因')
  const doc = await db.collection(COLLECTIONS.users).doc(recordId).get().catch(() => null)
  if (!doc || !doc.data) return failure('NOT_FOUND', '用户不存在')
  return success({ value: recordId })
}

function collectOpenidsFromDoc(doc = {}) {
  return [
    doc._openid,
    doc.openid,
    doc.payer_openid,
    doc.payer && doc.payer.openid,
    doc.userInfo && doc.userInfo.openid,
    doc.userInfo && doc.userInfo.openId
  ].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
}

async function scanOpenids(collectionName) {
  const openids = new Set()
  let skip = 0
  const limit = 100

  while (true) {
    let res
    try {
      res = await db.collection(collectionName).skip(skip).limit(limit).get()
    } catch (err) {
      return { collection: collectionName, scanned: 0, openids, error: err.message || String(err) }
    }

    const rows = res.data || []
    rows.forEach((row) => {
      collectOpenidsFromDoc(row).forEach((openid) => openids.add(openid))
    })

    skip += rows.length
    if (rows.length < limit) break
  }

  return { collection: collectionName, scanned: skip, openids }
}

async function getInitialPointsConfig() {
  const res = await db.collection(COLLECTIONS.pointsConfig).limit(1).get().catch(() => ({ data: [] }))
  const config = (res.data || [])[0] || {}
  return {
    points: normalizeNumber(config.initialPoints || config.initial_points, 100),
    name: '星光'
  }
}

async function normalizeUserPointTimestamps() {
  const countRes = await db.collection(COLLECTIONS.users).count()
  const total = countRes.total || 0
  const tasks = []
  const failed = []
  let normalized = 0
  const limit = 100

  for (let skip = 0; skip < total; skip += limit) {
    const res = await db.collection(COLLECTIONS.users).skip(skip).limit(limit).get()
    ;(res.data || []).forEach((item) => {
      const data = {}
      ;['createdAt', 'updatedAt'].forEach((field) => {
        if (typeof item[field] !== 'string') return
        const timestamp = parseLegacyDateMs(item[field])
        if (Number.isFinite(timestamp)) data[field] = new Date(timestamp)
      })
      if (Object.keys(data).length === 0) return
      tasks.push(async () => {
        try {
          await db.collection(COLLECTIONS.users).doc(item._id).update({ data })
          normalized += 1
        } catch (err) {
          failed.push({ id: item._id, message: err.message || String(err) })
        }
      })
    })
  }

  const chunkSize = 20
  for (let index = 0; index < tasks.length; index += chunkSize) {
    await Promise.all(tasks.slice(index, index + chunkSize).map((task) => task()))
  }

  return { normalized, failed }
}

async function syncUserPoints() {
  const timestampResult = await normalizeUserPointTimestamps()
  const sources = [
    COLLECTIONS.users,
    COLLECTIONS.pointsHistory,
    COLLECTIONS.generationHistory,
    COLLECTIONS.generationTasks,
    COLLECTIONS.orders,
    COLLECTIONS.feedbacks
  ]
  const [config, ...scanResults] = await Promise.all([
    getInitialPointsConfig(),
    ...sources.map((collection) => scanOpenids(collection))
  ])
  const allOpenids = new Set()
  scanResults.forEach((result) => {
    result.openids.forEach((openid) => allOpenids.add(openid))
  })

  let existing = 0
  let created = 0
  const failed = []
  const tasks = []
  allOpenids.forEach((openid) => {
    tasks.push(async () => {
      try {
        const doc = await db.collection(COLLECTIONS.users).doc(openid).get().catch(() => null)
        if (doc && doc.data) {
          existing += 1
          return
        }
        await db.collection(COLLECTIONS.users).doc(openid).set({
          data: {
            _openid: openid,
            points: config.points,
            name: config.name,
            lastReason: 'admin_sync',
            source: 'admin_sync',
            createdAt: now(),
            updatedAt: now()
          }
        })
        created += 1
      } catch (err) {
        failed.push({ openid, message: err.message || String(err) })
      }
    })
  })

  const chunkSize = 20
  for (let index = 0; index < tasks.length; index += chunkSize) {
    await Promise.all(tasks.slice(index, index + chunkSize).map((task) => task()))
  }

  return success({
    scanned: allOpenids.size,
    existing,
    created,
    failed,
    normalizedTimestamps: timestampResult.normalized,
    timestampFailed: timestampResult.failed,
    sources: scanResults.map((result) => ({
      collection: result.collection,
      scanned: result.scanned,
      openids: result.openids.size,
      error: result.error || ''
    }))
  })
}

async function adjustUserPoints(payload = {}, caller) {
  const openid = payload.openid || payload.id
  if (!openid) return failure('BAD_REQUEST', '缺少用户 OpenID')
  const mode = payload.mode === 'delta' ? 'delta' : 'set'
  const value = normalizeNumber(payload.value, NaN)
  if (!Number.isFinite(value)) return failure('BAD_REQUEST', '星光数必须是数字')
  const historyId = `admin_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`

  const result = await db.runTransaction(async (transaction) => {
    const userRef = transaction.collection(COLLECTIONS.users).doc(openid)
    const userDoc = await userRef.get().catch(() => null)
    const current = userDoc && userDoc.data ? normalizeNumber(userDoc.data.points, 0) : 0
    const nextPoints = mode === 'delta' ? current + value : value
    if (nextPoints < 0) throw new Error('星光数不能小于 0')
    const data = { points: nextPoints, updatedAt: now(), lastReason: 'admin_adjust' }
    if (userDoc && userDoc.data) await userRef.update({ data })
    else await userRef.set({ data: { ...data, createdAt: now(), name: payload.name || '星光' } })
    await transaction.collection(COLLECTIONS.pointsHistory).doc(historyId).set({
      data: {
        _openid: openid,
        type: nextPoints >= current ? 'recharge' : 'consume',
        amount: Math.abs(nextPoints - current),
        reason: 'admin_adjust',
        title: payload.reason || '后台调整星光',
        operatorUid: caller.uid,
        beforePoints: current,
        afterPoints: nextPoints,
        createdAt: now()
      }
    })
    return { current, nextPoints }
  })
  return success({ points: result.nextPoints, beforePoints: result.current })
}

async function listGenerationJobs(payload = {}) {
  return listCollection(COLLECTIONS.generationTasks, payload, undefined, {
    keywordFields: ['featureNameSnapshot', 'featureId', '_openid', 'provider', 'modelCallIdSnapshot'],
    allowedFilters: ['status', 'provider', 'featureId', 'createdAt']
  })
}

async function retryGenerationJob(payload = {}) {
  if (!payload.taskId) return failure('BAD_REQUEST', '缺少任务ID')
  const ref = db.collection(COLLECTIONS.generationTasks).doc(payload.taskId)
  const doc = await ref.get().catch(() => null)
  if (!doc || !doc.data) return failure('NOT_FOUND', '生成任务不存在')
  if (doc.data.status !== 'failed') return failure('INVALID_STATUS', '只有失败任务可以重试')
  await ref.update({
    data: {
      status: 'pending',
      errorMessage: '',
      retryCount: _.inc(1),
      adminRetryAt: now(),
      updatedAt: now()
    }
  })
  await cloud.callFunction({ name: 'generationWorker', data: { taskId: payload.taskId } }).catch(() => null)
  return success({ taskId: payload.taskId, status: 'pending' })
}

async function listOrders(payload = {}) {
  return listCollection(COLLECTIONS.orders, payload, undefined, {
    keywordFields: ['out_trade_no', 'openid', '_openid', 'transaction_id'],
    allowedFilters: ['status', 'created_at', 'createdAt']
  })
}

async function listFeedbacks(payload = {}) {
  return listCollection(COLLECTIONS.feedbacks, { ...payload, sortBy: payload.sortBy || payload.sort_by || 'createTime' }, (item) => {
    const safeItem = { ...item }
    delete safeItem.email
    delete safeItem.phone
    delete safeItem.contact
    return safeItem
  }, {
    keywordFields: ['content', 'openid', 'type'],
    allowedFilters: ['status', 'type', 'createTime']
  })
}

async function updateFeedback(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少反馈ID')
  const data = pickFields(payload.data || {}, ['status', 'reply', 'assignee', 'remark'])
  data.updateTime = now()
  await db.collection(COLLECTIONS.feedbacks).doc(payload.id).update({ data })
  return success({ id: payload.id })
}

async function listAuditLogs(payload = {}) {
  return listCollection(COLLECTIONS.auditLogs, payload, undefined, {
    keywordFields: ['operatorName', 'operatorUid', 'actionLabel', 'objectName', 'objectId', 'targetId'],
    allowedFilters: ['operatorRole', 'actionCode', 'success', 'createdAt']
  })
}

async function getSystemConfig() {
  const res = await db.collection(COLLECTIONS.pointsConfig).doc('global').get().catch(() => null)
  const data = res && res.data || {}
  return success({
    data: {
      name: '星光',
      initial_points: normalizeNumber(data.initial_points ?? data.initialPoints, 100),
      analyze_cost: normalizeNumber(data.analyze_cost, 3),
      generate_cost: normalizeNumber(data.generate_cost, 5),
      tryon_cost: normalizeNumber(data.tryon_cost, 3),
      show_points_section: normalizeNumber(data.show_points_section, 1),
      banner_image_url: data.banner_image_url || '',
      tips_image_url: data.tips_image_url || ''
    }
  })
}

async function updateSystemConfig(payload = {}) {
  const source = payload.data || payload
  const data = pickFields(source, ['initial_points', 'analyze_cost', 'generate_cost', 'tryon_cost', 'show_points_section', 'banner_image_url', 'tips_image_url'])
  for (const key of ['initial_points', 'analyze_cost', 'generate_cost', 'tryon_cost', 'show_points_section']) {
    if (data[key] != null) data[key] = normalizeNumber(data[key], 0)
  }
  data.name = '星光'
  data.updatedAt = now()
  const ref = db.collection(COLLECTIONS.pointsConfig).doc('global')
  const existing = await ref.get().catch(() => null)
  if (existing && existing.data) await ref.update({ data })
  else await ref.set({ data })
  return success({ data })
}

async function migrateTemplatesV2(payload = {}, caller = {}) {
  const dryRun = payload.dryRun !== false
  const features = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.features).skip(skip).limit(100).get()
    features.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  const summary = { dryRun, scanned: features.length, versionCandidates: 0, versionsCreated: 0, lifecycleUpdated: 0, skipped: 0 }
  for (const feature of features) {
    if (feature.migrationVersion === 'v2') {
      summary.skipped += 1
      continue
    }
    const lifecycleStatus = normalizeNumber(feature.status, 0) === 1 ? 'published' : 'offline'
    const existing = await db.collection(COLLECTIONS.templateVersions).where({ templateId: feature._id }).limit(1).get()
    const hasVersion = !!(existing.data && existing.data[0])
    if (hasVersion) {
      summary.skipped += 1
      continue
    }
    if (lifecycleStatus === 'published') summary.versionCandidates += 1
    if (dryRun) continue
    let versionId = ''
    let versionNumber = 0
    if (lifecycleStatus === 'published') {
      const versionResult = await db.collection(COLLECTIONS.templateVersions).add({
        data: {
          templateId: feature._id,
          versionNumber: 1,
          versionNote: 'V2迁移自动生成的 V1 快照',
          snapshot: normalizeFeaturePayload(feature),
          status: 'published',
          migrationTag: 'v2_bootstrap',
          publishedBy: caller.uid || '',
          publishedAt: feature.publishedAt || feature.updatedAt || feature.createdAt || now(),
          createdAt: now()
        }
      })
      versionId = versionResult._id
      versionNumber = 1
      summary.versionsCreated += 1
    }
    await db.collection(COLLECTIONS.features).doc(feature._id).update({
      data: {
        lifecycle_status: lifecycleStatus,
        migrationVersion: 'v2',
        ...(versionId ? { publishedVersionId: versionId, publishedVersionNumber: versionNumber } : {}),
        updatedAt: now()
      }
    })
    summary.lifecycleUpdated += 1
  }
  return success(summary)
}

async function migrateTemplatesV21(payload = {}) {
  const dryRun = payload.dryRun !== false
  const features = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.features).skip(skip).limit(100).get()
    features.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  const summary = { dryRun, scanned: features.length, updated: 0, lifecycle: {}, unassigned: 0, withUnpublishedChanges: 0 }
  for (const feature of features) {
    const placements = normalizePlacements(feature.placements, feature.group)
    const lifecycleStatus = feature.lifecycle_status || (normalizeNumber(feature.status, 0) === 1 ? 'published' : 'offline')
    const isUnassigned = placements.length === 0
    const hasUnpublishedChanges = !!feature.has_draft
    summary.lifecycle[lifecycleStatus] = (summary.lifecycle[lifecycleStatus] || 0) + 1
    if (isUnassigned) summary.unassigned += 1
    if (hasUnpublishedChanges) summary.withUnpublishedChanges += 1
    if (dryRun) continue
    await db.collection(COLLECTIONS.features).doc(feature._id).update({
      data: {
        lifecycle_status: lifecycleStatus,
        is_unassigned: isUnassigned,
        has_unpublished_changes: hasUnpublishedChanges,
        migrationVersion: 'v2.1',
        updatedAt: now()
      }
    })
    summary.updated += 1
  }
  return success(summary)
}

async function migrateRecommendationOrderV22(payload = {}) {
  const dryRun = payload.dryRun !== false
  const features = await listAllByQuery(db.collection(COLLECTIONS.features))
  const published = features.filter((feature) => normalizeNumber(feature.status, 0) === 1)
  const zones = ['boss', 'play']
  const badges = ['new', 'hot', 'normal']
  const orderByTemplate = {}
  const buckets = []

  const timestampValue = (value) => {
    if (!value) return 0
    if (typeof value.toMillis === 'function') return value.toMillis()
    if (typeof value.getTime === 'function') return value.getTime()
    if (value.$date) return new Date(value.$date).getTime() || 0
    return new Date(value).getTime() || 0
  }

  zones.forEach((zone) => {
    badges.forEach((badge) => {
      const bucket = published
        .filter((feature) => (feature.tag || 'normal') === badge && featureMatchesZone(feature, zone))
        .sort((left, right) => (
          normalizeNumber(left.sort, 10) - normalizeNumber(right.sort, 10)
          || timestampValue(left.createdAt) - timestampValue(right.createdAt)
          || String(left._id).localeCompare(String(right._id))
        ))
      bucket.forEach((feature, index) => {
        if (!orderByTemplate[feature._id]) orderByTemplate[feature._id] = {}
        orderByTemplate[feature._id][zone] = index + 1
      })
      buckets.push({ zone, recommendation_badge: badge, templates: bucket.length })
    })
  })

  if (!dryRun) {
    for (const feature of published) {
      const zoneOrders = orderByTemplate[feature._id]
      if (!zoneOrders) continue
      const placements = normalizePlacements(feature.placements, feature.group).map((placement) => ({
        ...placement,
        sort_order: zoneOrders[placement.zone] || placement.sort_order || 0
      }))
      await db.collection(COLLECTIONS.features).doc(feature._id).update({
        data: { placements, recommendationOrderMigration: 'v2.2', updatedAt: now() }
      })
    }
  }

  return success({
    dryRun,
    templates_scanned: features.length,
    published_templates: published.length,
    templates_updated: dryRun ? 0 : Object.keys(orderByTemplate).length,
    buckets
  })
}

async function rebuildTemplateRatingCounts(payload = {}) {
  const dryRun = payload.dryRun !== false
  const [features, ratings] = await Promise.all([
    listAllByQuery(db.collection(COLLECTIONS.features), { name: true, hang_count: true, la_count: true, user_hang_count: true, user_la_count: true }),
    listAllByQuery(db.collection(COLLECTIONS.generationHistory), { featureId: true, rating: true })
  ])
  const counts = {}
  let invalidRecords = 0
  ratings.forEach((item) => {
    if (!item.featureId || !['hang', 'la'].includes(item.rating)) {
      if (item.rating) invalidRecords += 1
      return
    }
    if (!counts[item.featureId]) counts[item.featureId] = { hang: 0, la: 0 }
    counts[item.featureId][item.rating] += 1
  })
  const before = features.reduce((total, item) => ({
    hang: total.hang + Math.max(normalizeNumber(item.hang_count, 0), 0),
    la: total.la + Math.max(normalizeNumber(item.la_count, 0), 0)
  }), { hang: 0, la: 0 })
  const after = Object.values(counts).reduce((total, item) => ({ hang: total.hang + item.hang, la: total.la + item.la }), { hang: 0, la: 0 })
  if (!dryRun) {
    for (const feature of features) {
      const count = counts[feature._id] || { hang: 0, la: 0 }
      await db.collection(COLLECTIONS.features).doc(feature._id).update({
        data: {
          user_hang_count: count.hang,
          user_la_count: count.la,
          hang_count: count.hang,
          la_count: count.la,
          rating_count_updated_at: now(),
          updatedAt: now()
        }
      })
    }
  }
  return success({
    dryRun,
    templates_scanned: features.length,
    templates_with_ratings: Object.keys(counts).length,
    rating_records_scanned: ratings.length,
    invalid_records: invalidRecords,
    before,
    after,
    updated: dryRun ? 0 : features.length
  })
}

async function rollbackTemplatesV2Migration(payload = {}) {
  if (payload.confirm !== 'ROLLBACK_V2_BOOTSTRAP') return failure('CONFIRM_REQUIRED', '回滚迁移需要明确确认字符串')
  const versions = []
  const features = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.templateVersions).where({ migrationTag: 'v2_bootstrap' }).skip(skip).limit(100).get()
    versions.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(COLLECTIONS.features).where({ migrationVersion: 'v2' }).skip(skip).limit(100).get()
    features.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  for (const feature of features) {
    await db.collection(COLLECTIONS.features).doc(feature._id).update({
      data: {
        lifecycle_status: _.remove(),
        migrationVersion: _.remove(),
        publishedVersionId: _.remove(),
        publishedVersionNumber: _.remove(),
        updatedAt: now()
      }
    }).catch(() => null)
  }
  for (const version of versions) {
    await db.collection(COLLECTIONS.templateVersions).doc(version._id).remove()
  }
  return success({ featuresReverted: features.length, versionsRemoved: versions.length })
}

async function dispatch(action, payload, caller) {
  switch (action) {
    case 'getAdminStatus':
      return getAdminStatus()
    case 'bootstrapAdmin':
      return bootstrapAdmin(payload)
    case 'listModels':
      return listModels(payload)
    case 'createModel':
      return createModel(payload)
    case 'updateModel':
      return updateModel(payload)
    case 'deleteModel':
      return deleteDoc(COLLECTIONS.models, payload)
    case 'listGroups':
      return listGroups(payload)
    case 'createGroup':
      return withHomeCacheInvalidation(() => createGroup(payload))
    case 'updateGroup':
      return withHomeCacheInvalidation(() => updateDoc(COLLECTIONS.groups, payload, GROUP_FIELDS))
    case 'deleteGroup':
      return withHomeCacheInvalidation(() => deleteDoc(COLLECTIONS.groups, payload))
    case 'listAdmins':
      return listAdmins(payload)
    case 'createAdmin':
      return createAdmin(payload)
    case 'updateAdmin':
      return updateAdmin(payload, caller)
    case 'deleteAdmin':
      return deleteAdmin(payload, caller)
    case 'resetAdminPassword':
      return resetAdminPassword(payload, caller)
    case 'completePasswordReset':
      return completePasswordReset(caller)
    case 'listFeatures':
      return listFeatures(payload)
    case 'createFeature':
      return failure('LEGACY_WRITE_DISABLED', '旧模板创建接口已停用，请使用保存草稿流程')
    case 'updateFeature':
      return failure('LEGACY_WRITE_DISABLED', '旧模板更新接口已停用，请使用草稿与发布流程')
    case 'updateTemplatePlacement':
      return withHomeCacheInvalidation(() => updateTemplatePlacement(payload))
    case 'saveRecommendationOrder':
      return withHomeCacheInvalidation(() => saveRecommendationOrder(payload))
    case 'saveFeatureDraft':
      return saveFeatureDraft(payload, caller)
    case 'publishFeature':
      return withHomeCacheInvalidation(() => publishFeature(payload, caller))
    case 'checkFeaturePublish':
      return checkFeaturePublish(payload)
    case 'offlineTemplate':
      return withHomeCacheInvalidation(() => offlineTemplate(payload, caller))
    case 'rebuildHomeCache':
      return rebuildHomeCache()
    case 'debugFeatureGeneration':
      return debugFeatureGeneration(payload, caller)
    case 'getDebugGenerationStatus':
      return getDebugGenerationStatus(payload, caller)
    case 'deleteFeature':
      return withHomeCacheInvalidation(() => deleteFeature(payload))
    case 'listImages':
      return listImages(payload)
    case 'createImageAsset':
      return createImageAsset(payload)
    case 'createImageAssets':
      return createImageAssets(payload)
    case 'updateImageAsset':
      return updateImageAsset(payload)
    case 'deleteImageAsset':
      return deleteImageAsset(payload)
    case 'syncStorageAssets':
      return syncStorageAssets(payload)
    case 'listUsers':
      return listUsers(payload)
    case 'revealSensitiveValue':
      return revealSensitiveValue(payload)
    case 'syncUserPoints':
      return syncUserPoints()
    case 'adjustUserPoints':
      return adjustUserPoints(payload, caller)
    case 'listGenerationJobs':
      return listGenerationJobs(payload)
    case 'retryGenerationJob':
      return retryGenerationJob(payload)
    case 'listOrders':
      return listOrders(payload)
    case 'listFeedbacks':
      return listFeedbacks(payload)
    case 'updateFeedback':
      return updateFeedback(payload)
    case 'listAuditLogs':
      return listAuditLogs(payload)
    case 'getSystemConfig':
      return getSystemConfig()
    case 'updateSystemConfig':
      return updateSystemConfig(payload)
    case 'migrateTemplatesV2':
      return migrateTemplatesV2(payload, caller)
    case 'migrateTemplatesV21':
      return migrateTemplatesV21(payload)
    case 'migrateRecommendationOrderV22':
      return migrateRecommendationOrderV22(payload)
    case 'rebuildTemplateRatingCounts':
      return rebuildTemplateRatingCounts(payload)
    case 'rollbackTemplatesV2Migration':
      return rollbackTemplatesV2Migration(payload)
    default:
      return failure('UNKNOWN_ACTION', '未知操作')
  }
}

exports.main = async (event = {}) => {
  const action = event.action || ''
  const payload = event.payload || {}

  try {
    if (action === 'getAdminStatus' || action === 'bootstrapAdmin') {
      return await dispatch(action, payload)
    }

    const guard = await requireAdmin()
    if (guard.error) return guard.error
    if (guard.admin.passwordResetRequired) {
      const expiresAt = normalizeSortValue(guard.admin.temporaryPasswordExpiresAt)
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        return failure('TEMP_PASSWORD_EXPIRED', '临时密码已过期，请联系超级管理员重新重置')
      }
      if (action !== 'completePasswordReset') {
        return failure('PASSWORD_RESET_REQUIRED', '首次登录必须先修改临时密码')
      }
    }
    if (SUPER_ADMIN_ACTIONS.includes(action) && guard.admin.role !== 'super_admin') {
      return failure('FORBIDDEN', '仅超级管理员可管理管理员与权限')
    }
    if (!canPerform(guard.admin, action)) {
      return failure('FORBIDDEN', '当前角色无权执行此操作')
    }
    const result = await dispatch(action, payload, guard.caller)
    await writeAuditLog(action, payload, guard, result)
    return result
  } catch (err) {
    console.error('[adminApi] error', err)
    return failure('SERVER_ERROR', err.message || '后台接口错误')
  }
}
