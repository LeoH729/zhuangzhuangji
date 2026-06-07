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

const MODEL_FIELDS = [
  'model_call_id',
  'name',
  'provider',
  'base_url',
  'model_id',
  'api_key',
  'status',
  'remark'
]

const GROUP_FIELDS = ['name', 'status', 'sort', 'description']
const ADMIN_FIELDS = ['uid', 'openid', 'username', 'displayName', 'role', 'status']
const FEATURE_FIELDS = [
  'name',
  'group',
  'home_banner',
  'detail_banner',
  'upload_count',
  'points_cost',
  'hang_count',
  'la_count',
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
const IMAGE_FIELDS = [
  'name',
  'category',
  'usage',
  'folder',
  'objectKey',
  'cloudPath',
  'fileID',
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
  return listCollection(COLLECTIONS.groups, payload)
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
  const result = await listCollection(COLLECTIONS.features, payload)
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
  if (!payload || !payload.name) return failure('BAD_REQUEST', '缺少卡片名称')
  if (!payload.model_call_id) return failure('BAD_REQUEST', '请选择模型')
  return createDoc(COLLECTIONS.features, payload, FEATURE_FIELDS)
}

async function listImages(payload) {
  const where = payload && payload.folder ? { folder: payload.folder } : {}
  const result = await listCollection(COLLECTIONS.images, { ...payload, where })
  const fileList = (result.data || []).map((item) => item.fileID).filter(Boolean)
  const foldersRes = await db.collection(COLLECTIONS.images).field({ folder: true }).limit(1000).get()
  const folders = [...new Set((foldersRes.data || []).map((item) => item.folder || '').filter((item) => item !== ''))].sort()
  result.folders = folders
  if (fileList.length === 0) return result

  const tempRes = await cloud.getTempFileURL({ fileList: fileList.slice(0, 50) })
  const urlMap = {}
  ;(tempRes.fileList || []).forEach((item) => {
    urlMap[item.fileID] = item.tempFileURL
  })
  result.data = result.data.map((item) => ({
    ...item,
    temporaryUrl: urlMap[item.fileID] || item.temporaryUrl || ''
  }))
  return result
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
  const existingRes = await db.collection(COLLECTIONS.images).field({ objectKey: true }).limit(1000).get()
  const existingMap = {}
  ;(existingRes.data || []).forEach((item) => {
    if (item.objectKey) existingMap[item.objectKey] = item._id
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

async function deleteImageAsset(payload = {}) {
  if (!payload.id) return failure('BAD_REQUEST', '缺少图片资源 ID')
  const doc = await db.collection(COLLECTIONS.images).doc(payload.id).get()
  const asset = doc.data
  if (!asset) return failure('NOT_FOUND', '图片资源不存在')

  const refs = asset.fileID ? await getImageReferences(asset.fileID) : []
  if (refs.length > 0 && !payload.force) {
    return failure('IMAGE_IN_USE', '图片正在被卡片引用，不能直接删除', { refs })
  }

  if (asset.fileID) {
    await cloud.deleteFile({ fileList: [asset.fileID] })
  } else if (asset.objectKey) {
    await cosRequest('deleteObject', {
      Bucket: STORAGE_BUCKET,
      Region: STORAGE_REGION,
      Key: asset.objectKey
    })
  }
  await db.collection(COLLECTIONS.images).doc(payload.id).remove()
  return success()
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
      return updateDoc(COLLECTIONS.features, payload, FEATURE_FIELDS)
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
