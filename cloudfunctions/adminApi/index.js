const cloud = require('wx-server-sdk')
const tcb = require('@cloudbase/node-sdk')
const COS = require('cos-nodejs-sdk-v5')

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloudbase-5gmfinom29f48930'
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || '636c-cloudbase-5gmfinom29f48930-1380597463'
const STORAGE_REGION = process.env.STORAGE_REGION || 'ap-shanghai'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const app = tcb.init({ env: ENV_ID })
const auth = app.auth()
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
  orders: 'orders',
  feedbacks: 'feedbacks',
  pointsConfig: 'points_config'
}

const TEMPLATE_TYPE_IMAGE = 'image_to_image'
const TEMPLATE_TYPE_TEXT = 'text_to_image'
const TEXT_TO_IMAGE_PROVIDERS = ['volcengine', 'supersolo', 'supersolo_async', 'toapis', 'joapi', 'jimeng_cli']
const TOAPIS_SIZE_OPTIONS = ['1:1', '3:4', '9:16']

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
const ADMIN_FIELDS = ['uid', 'openid', 'username', 'displayName', 'role', 'status']
const FEATURE_FIELDS = [
  'name',
  'group',
  'placements',
  'home_banner',
  'detail_banner',
  'upload_count',
  'points_cost',
  'enable_upscale_print',
  'hang_count',
  'la_count',
  'size',
  'model_call_id',
  'fallback_model_call_id',
  'prompt',
  'template_type',
  'input_fields',
  'status',
  'sort',
  'tag',
  'description'
]
const FEATURE_DRAFT_FIELDS = ['draft_data', 'has_draft', 'draft_updatedAt', 'draftBy', 'publishedAt', 'publishedBy']
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
      group: String(item && item.group || '').trim()
    }))
    .filter((item) => item.group)

  if (normalized.length > 0) return normalized
  const group = String(legacyGroup || '').trim()
  return group ? [{ zone: 'play', group }] : []
}

function featureMatchesZone(feature = {}, zone = '') {
  if (!isFeatureZone(zone)) return true
  return normalizePlacements(feature.placements, feature.group).some((item) => item.zone === zone)
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

function compilePrompt(prompt = '', fields = [], inputValues = {}) {
  let compiled = String(prompt || '')
  fields.forEach((field) => {
    const pattern = new RegExp(`\\{${escapeRegExp(field.key)}\\}`, 'g')
    compiled = compiled.replace(pattern, inputValues[field.key] || '')
  })
  return compiled
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
  if (copy.api_key) {
    copy.api_key = '******'
    copy.has_api_key = true
  } else {
    copy.has_api_key = false
  }
  return copy
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
  const sortBy = String(payload.sortBy || fallbackBy || '').trim()
  const sortOrder = String(payload.sortOrder || fallbackOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
  if (!/^[A-Za-z0-9_.$-]+$/.test(sortBy)) {
    return { sortBy: fallbackBy, sortOrder }
  }
  return { sortBy, sortOrder }
}

function success(data = {}) {
  return { success: true, ...data }
}

function failure(code, message, extra = {}) {
  return { success: false, code, message, ...extra }
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
    needsBootstrap: (adminCountRes.total || 0) === 0
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

  const data = {
    uid: caller.uid,
    openid: caller.openid,
    username: payload.username || '',
    displayName: payload.displayName || payload.username || 'Super Admin',
    role: 'super_admin',
    status: 1,
    createdAt: now(),
    updatedAt: now()
  }
  const res = await db.collection(COLLECTIONS.admins).add({ data })
  return success({ _id: res._id, admin: { ...data, _id: res._id } })
}

async function listCollection(collectionName, payload = {}, mapper) {
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 20), 1), 100)
  const skip = (page - 1) * pageSize
  const where = payload.where || {}
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
    pageSize
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
  return listCollection(COLLECTIONS.models, payload, sanitizeModel)
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
  if (!zone) return listCollection(COLLECTIONS.groups, payload)

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
  const filtered = all.filter((item) => groupMatchesZone(item, zone))
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
  return listCollection(COLLECTIONS.admins, payload)
}

async function createAdmin(payload) {
  if (!payload || !payload.uid) return failure('BAD_REQUEST', '缺少管理员 UID')
  const data = {
    ...payload,
    role: payload.role || 'admin',
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

async function listFeatures(payload = {}) {
  const zone = isFeatureZone(payload.zone) ? payload.zone : ''
  let result
  if (zone) {
    const page = Math.max(normalizeNumber(payload.page, 1), 1)
    const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 20), 1), 100)
    const { sortBy, sortOrder } = normalizeSort(payload)
    const countRes = await db.collection(COLLECTIONS.features).count()
    const total = countRes.total || 0
    const all = []
    const limit = 100

    for (let skip = 0; skip < total; skip += limit) {
      const res = await db.collection(COLLECTIONS.features).skip(skip).limit(limit).get()
      all.push(...(res.data || []))
    }

    const direction = sortOrder === 'asc' ? 1 : -1
    const filtered = all.filter((item) => featureMatchesZone(item, zone))
    filtered.sort((a, b) => {
      const left = normalizeSortValue(a[sortBy])
      const right = normalizeSortValue(b[sortBy])
      if (left < right) return -1 * direction
      if (left > right) return 1 * direction
      return 0
    })

    result = success({
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize
    })
  } else {
    result = await listCollection(COLLECTIONS.features, payload)
  }
  const imageWhere = payload.imageFolder ? { folder: payload.imageFolder } : {}
  const [modelsRes, groupsRes, imagesRes] = await Promise.all([
    db.collection(COLLECTIONS.models).field({ model_call_id: true, name: true, provider: true, status: true }).get(),
    db.collection(COLLECTIONS.groups).get(),
    db.collection(COLLECTIONS.images).where(imageWhere).field({ name: true, folder: true, objectKey: true, fileID: true, usage: true, status: true }).limit(500).get()
  ])
  const foldersRes = await db.collection(COLLECTIONS.images).field({ folder: true }).limit(1000).get()
  const folders = [...new Set((foldersRes.data || []).map((item) => item.folder || '').filter((item) => item !== ''))].sort()
  return {
    ...result,
    folders,
    refs: {
      models: sanitizeList(modelsRes.data, sanitizeModel),
      groups: groupsRes.data || [],
      images: imagesRes.data || []
    }
  }
}

async function createFeature(payload) {
  const feature = normalizeFeaturePayload(payload || {})
  if (!feature.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (!feature.model_call_id) return failure('BAD_REQUEST', '请选择模型')
  if (feature.placements.length === 0) return failure('BAD_REQUEST', '请至少配置一个归属')
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

function normalizeFeaturePayload(payload = {}) {
  const data = pickFields(payload || {}, FEATURE_FIELDS)
  const templateType = normalizeTemplateType(data.template_type)
  data.template_type = templateType
  data.enable_upscale_print = !!data.enable_upscale_print
  data.upload_count = templateType === TEMPLATE_TYPE_TEXT ? 0 : Math.max(normalizeNumber(data.upload_count, 1), 1)
  data.input_fields = templateType === TEMPLATE_TYPE_TEXT ? normalizeInputFields(data.input_fields) : []
  data.points_cost = normalizeNumber(data.points_cost, 0)
  data.hang_count = normalizeNumber(data.hang_count, 0)
  data.la_count = normalizeNumber(data.la_count, 0)
  data.size = normalizeToapisSize(data.size)
  data.status = normalizeNumber(data.status, 0)
  data.sort = normalizeNumber(data.sort, 10)
  data.tag = data.tag || 'normal'
  data.placements = normalizePlacements(data.placements, data.group)
  data.group = data.placements[0] ? data.placements[0].group : ''
  return data
}

function validateFeatureForGeneration(feature = {}, imageUrls = [], inputValues = {}) {
  if (!feature.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (!feature.model_call_id) return failure('BAD_REQUEST', '请选择模型')
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
  if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(modelConfig.provider)) {
    return failure('BAD_REQUEST', '当前模型不支持文生图')
  }

  if (feature.fallback_model_call_id) {
    const fallbackConfig = await getModelByCallId(feature.fallback_model_call_id)
    if (!fallbackConfig) return failure('BAD_REQUEST', '兜底模型配置不存在')
    if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(fallbackConfig.provider)) {
      return failure('BAD_REQUEST', '兜底模型不支持文生图')
    }
  }

  return null
}

async function saveFeatureDraft(payload = {}, caller = {}) {
  const feature = normalizeFeaturePayload({ ...(payload.data || payload), status: 0 })
  if (!feature.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (!feature.model_call_id) return failure('BAD_REQUEST', '请选择模型')

  if (!payload.id) {
    return createDoc(COLLECTIONS.features, feature, FEATURE_FIELDS)
  }

  const currentRes = await db.collection(COLLECTIONS.features).doc(payload.id).get()
  const current = currentRes.data
  if (!current) return failure('NOT_FOUND', '卡片不存在')

  if (normalizeNumber(current.status, 0) === 1) {
    await db.collection(COLLECTIONS.features).doc(payload.id).update({
      data: {
        draft_data: feature,
        has_draft: true,
        draft_updatedAt: now(),
        draftBy: caller.uid || ''
      }
    })
    return success({ id: payload.id, savedAsDraft: true })
  }

  const data = { ...feature, status: 0, updatedAt: now() }
  await db.collection(COLLECTIONS.features).doc(payload.id).update({ data })
  return success({ id: payload.id, savedAsDraft: true })
}

async function publishFeature(payload = {}, caller = {}) {
  const id = payload.id || ''
  const source = payload.data ? normalizeFeaturePayload({ ...payload.data, status: 1 }) : null
  if (source && !source.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (source && !source.model_call_id) return failure('BAD_REQUEST', '请选择模型')
  if (source && source.placements.length === 0) return failure('BAD_REQUEST', '请至少配置一个归属')

  if (!id) {
    if (!source) return failure('BAD_REQUEST', '缺少发布数据')
    const res = await createDoc(COLLECTIONS.features, {
      ...source,
      status: 1,
      publishedAt: now(),
      publishedBy: caller.uid || ''
    }, FEATURE_FIELDS.concat(FEATURE_DRAFT_FIELDS))
    return success({ _id: res._id, published: true })
  }

  const currentRes = await db.collection(COLLECTIONS.features).doc(id).get()
  const current = currentRes.data
  if (!current) return failure('NOT_FOUND', '卡片不存在')
  const publishData = source || normalizeFeaturePayload({ ...(current.draft_data || current), status: 1 })
  if (!publishData.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (!publishData.model_call_id) return failure('BAD_REQUEST', '请选择模型')
  if (publishData.placements.length === 0) return failure('BAD_REQUEST', '请至少配置一个归属')

  await db.collection(COLLECTIONS.features).doc(id).update({
    data: {
      ...publishData,
      status: 1,
      draft_data: _.remove(),
      has_draft: false,
      draft_updatedAt: _.remove(),
      draftBy: _.remove(),
      publishedAt: now(),
      publishedBy: caller.uid || '',
      updatedAt: now()
    }
  })
  return success({ id, published: true })
}

async function debugFeatureGeneration(payload = {}, caller = {}) {
  const feature = normalizeFeaturePayload(payload.feature || payload.data || {})
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
      sizeSnapshot: feature.size || '',
      activeModelRole: 'primary',
      fallbackUsed: false,
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
  if (!resultUrl || map[resultUrl]) return
  const modelCallId = source.modelCallId || source.model_call_id || source.modelCallIdSnapshot || ''
  const generatedOpenid = source.generatedOpenid || source.generated_openid || source.openid || source._openid || ''
  if (!modelCallId && !generatedOpenid) return
  map[resultUrl] = {
    modelCallId,
    generatedOpenid,
    provider: source.provider || '',
    fallbackUsed: !!source.fallbackUsed
  }
}

async function enrichImageGenerationInfo(items = []) {
  const missingItems = items.filter((item) => !getImageModelCallId(item) || !getImageGeneratedOpenid(item))
  if (missingItems.length === 0) return items

  const candidates = [...new Set(missingItems.flatMap(getImageResultCandidates))].slice(0, 100)
  if (candidates.length === 0) return items

  const generationMap = {}
  const historyRes = await db.collection(COLLECTIONS.generationHistory)
    .where(_.or([
      { resultUrl: _.in(candidates) },
      { upscaledUrl: _.in(candidates) }
    ]))
    .field({ resultUrl: true, upscaledUrl: true, modelCallId: true, provider: true, fallbackUsed: true, _openid: true })
    .limit(100)
    .get()

  ;(historyRes.data || []).forEach((item) => {
    putImageGenerationMeta(generationMap, item.resultUrl, item)
    putImageGenerationMeta(generationMap, item.upscaledUrl, item)
  })

  const unresolvedCandidates = candidates.filter((candidate) => !generationMap[candidate])
  if (unresolvedCandidates.length > 0) {
    const taskRes = await db.collection(COLLECTIONS.generationTasks)
      .where({ resultUrl: _.in(unresolvedCandidates) })
      .field({ resultUrl: true, modelCallId: true, modelCallIdSnapshot: true, provider: true, fallbackUsed: true, _openid: true })
      .limit(100)
      .get()

    ;(taskRes.data || []).forEach((item) => {
      putImageGenerationMeta(generationMap, item.resultUrl, item)
    })
  }

  return items.map((item) => {
    if (getImageModelCallId(item) && getImageGeneratedOpenid(item)) return item
    const candidate = getImageResultCandidates(item).find((value) => generationMap[value])
    if (!candidate) return item
    const meta = generationMap[candidate]
    return {
      ...item,
      modelCallId: getImageModelCallId(item) || meta.modelCallId,
      generatedOpenid: getImageGeneratedOpenid(item) || meta.generatedOpenid,
      provider: item.provider || meta.provider,
      fallbackUsed: item.fallbackUsed ?? meta.fallbackUsed
    }
  })
}

async function listImages(payload) {
  const where = payload && payload.folder ? { folder: payload.folder } : {}
  const result = await listCollection(COLLECTIONS.images, { ...payload, where })
  const fileList = (result.data || []).map((item) => item.fileID).filter(Boolean)
  const foldersRes = await db.collection(COLLECTIONS.images).field({ folder: true }).limit(1000).get()
  const folders = [...new Set((foldersRes.data || []).map((item) => item.folder || '').filter((item) => item !== ''))].sort()
  result.folders = folders
  if (fileList.length === 0) {
    result.data = await enrichImageGenerationInfo(result.data || [])
    return result
  }

  const tempRes = await cloud.getTempFileURL({ fileList: fileList.slice(0, 50) })
  const urlMap = {}
  ;(tempRes.fileList || []).forEach((item) => {
    urlMap[item.fileID] = item.tempFileURL
  })
  result.data = result.data.map((item) => ({
    ...item,
    temporaryUrl: urlMap[item.fileID] || item.temporaryUrl || ''
  }))
  result.data = await enrichImageGenerationInfo(result.data)
  return result
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
  const prefix = cleanPrefix(payload.prefix || '')
  const objects = await listStorageObjects(prefix)
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
    await Promise.all(chunk.map((task) => task()))
  }

  return success({
    prefix,
    scanned: objects.length,
    created,
    updated,
    skipped
  })
}

async function getImageReferences(fileID) {
  const refs = await db.collection(COLLECTIONS.features).where(
    _.or([
      { home_banner: fileID },
      { detail_banner: fileID }
    ])
  ).field({ name: true, home_banner: true, detail_banner: true }).get()
  return refs.data || []
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

  const refs = asset.fileID ? await getImageReferences(asset.fileID) : []
  if (refs.length > 0 && !payload.force) {
    return failure('IMAGE_IN_USE', '图片正在被卡片引用，不能直接删除', { refs })
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

async function listUsers(payload) {
  const page = Math.max(normalizeNumber(payload.page, 1), 1)
  const pageSize = Math.min(Math.max(normalizeNumber(payload.pageSize, 50), 1), 100)
  const { sortBy, sortOrder } = normalizeSort(payload, 'updatedAt', 'desc')
  const countRes = await db.collection(COLLECTIONS.users).count()
  const total = countRes.total || 0
  const all = []
  const limit = 100

  for (let skip = 0; skip < total; skip += limit) {
    const res = await db.collection(COLLECTIONS.users).skip(skip).limit(limit).get()
    all.push(...(res.data || []))
  }

  const direction = sortOrder === 'asc' ? 1 : -1
  all.sort((a, b) => {
    const left = normalizeSortValue(a[sortBy])
    const right = normalizeSortValue(b[sortBy])
    if (left < right) return -1 * direction
    if (left > right) return 1 * direction
    return 0
  })

  return success({
    data: all.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize
  })
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
    name: config.name || '妆妆蛋'
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

  const userRef = db.collection(COLLECTIONS.users).doc(openid)
  const userDoc = await userRef.get().catch(() => null)
  const current = userDoc && userDoc.data ? normalizeNumber(userDoc.data.points, 0) : 0
  const nextPoints = mode === 'delta' ? current + value : value
  if (nextPoints < 0) return failure('BAD_REQUEST', '星光数不能小于 0')

  const data = {
    points: nextPoints,
    updatedAt: now(),
    lastReason: 'admin_adjust'
  }
  if (userDoc && userDoc.data) {
    await userRef.update({ data })
  } else {
    await userRef.set({
      data: {
        ...data,
        createdAt: now(),
        name: payload.name || '星光'
      }
    })
  }

  await db.collection(COLLECTIONS.pointsHistory).add({
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
  return success({ points: nextPoints })
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
      return createGroup(payload)
    case 'updateGroup':
      return updateDoc(COLLECTIONS.groups, payload, GROUP_FIELDS)
    case 'deleteGroup':
      return deleteDoc(COLLECTIONS.groups, payload)
    case 'listAdmins':
      return listAdmins(payload)
    case 'createAdmin':
      return createAdmin(payload)
    case 'updateAdmin':
      return updateAdmin(payload, caller)
    case 'deleteAdmin':
      return deleteAdmin(payload, caller)
    case 'listFeatures':
      return listFeatures(payload)
    case 'createFeature':
      return createFeature(payload)
    case 'updateFeature':
      return updateFeature(payload)
    case 'saveFeatureDraft':
      return saveFeatureDraft(payload, caller)
    case 'publishFeature':
      return publishFeature(payload, caller)
    case 'debugFeatureGeneration':
      return debugFeatureGeneration(payload, caller)
    case 'getDebugGenerationStatus':
      return getDebugGenerationStatus(payload, caller)
    case 'deleteFeature':
      return deleteDoc(COLLECTIONS.features, payload)
    case 'listImages':
      return listImages(payload)
    case 'createImageAsset':
      return createImageAsset(payload)
    case 'updateImageAsset':
      return updateImageAsset(payload)
    case 'deleteImageAsset':
      return deleteImageAsset(payload)
    case 'syncStorageAssets':
      return syncStorageAssets(payload)
    case 'listUsers':
      return listUsers(payload)
    case 'syncUserPoints':
      return syncUserPoints()
    case 'adjustUserPoints':
      return adjustUserPoints(payload, caller)
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
    return await dispatch(action, payload, guard.caller)
  } catch (err) {
    console.error('[adminApi] error', err)
    return failure('SERVER_ERROR', err.message || '后台接口错误')
  }
}
