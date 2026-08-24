const axios = require('axios')

const UPSCALE_TASKS_COLLECTION = 'upscale_tasks'
const HISTORY_COLLECTION = 'generation_history'
const UPSCALE_POINTS_COST = 10
const UPSCALE_SCALE = 4
const REPLICATE_MODEL_OWNER = 'nightmareai'
const REPLICATE_MODEL_NAME = 'real-esrgan'
const REPLICATE_API_BASE = 'https://api.replicate.com/v1'
const REPLICATE_WAIT_SECONDS = 60
const REQUEST_TIMEOUT_MS = 70 * 1000
const DOWNLOAD_TIMEOUT_MS = 120 * 1000
const RUNNING_TIMEOUT_MS = 10 * 60 * 1000
const REPLICATE_MAX_INPUT_PIXELS = 2096704
const REPLICATE_SAFE_INPUT_PIXELS = 1000000
const DEFAULT_UPSCALE_INPUT_RATIO = { width: 1, height: 1 }
const MSG_SERVICE_NOT_CONFIGURED = '\u9ad8\u6e05\u670d\u52a1\u672a\u914d\u7f6e\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
const MSG_SERVICE_NO_CREDIT = '\u9ad8\u6e05\u670d\u52a1\u4f59\u989d\u4e0d\u8db3\uff0c\u672c\u6b21\u661f\u5149\u5df2\u9000\u56de\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
const MSG_SERVICE_BUSY = '\u9ad8\u6e05\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u672c\u6b21\u661f\u5149\u5df2\u9000\u56de\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'
const MSG_UPSCALE_FAILED = '\u9ad8\u6e05\u56fe\u7247\u751f\u6210\u5931\u8d25\uff0c\u672c\u6b21\u661f\u5149\u5df2\u9000\u56de'

function getDb(cloud) {
  return cloud.database()
}

function now(db) {
  return db.serverDate()
}

function normalizeError(err) {
  const message = err && err.response && err.response.data
    ? JSON.stringify(err.response.data)
    : (err && err.message) || String(err)
  if (message.includes('REPLICATE_API_TOKEN')) {
    return '高清服务未配置，请稍后再试'
  }
  return message || '高清图片生成失败'
}

function normalizeUpscaleError(err) {
  const status = err && err.response && err.response.status
  const responseData = err && err.response && err.response.data
  const message = responseData
    ? JSON.stringify(responseData)
    : (err && err.message) || String(err)
  if (message.includes('REPLICATE_API_TOKEN')) {
    return MSG_SERVICE_NOT_CONFIGURED
  }
  if (
    status === 402 ||
    /insufficient credit/i.test(message) ||
    (responseData && /insufficient credit/i.test(String(responseData.detail || responseData.title || '')))
  ) {
    return MSG_SERVICE_NO_CREDIT
  }
  if (/GPU memory|max size|total number of pixels|Resize input image/i.test(message)) {
    return '\u539f\u56fe\u5c3a\u5bf8\u8d85\u8fc7\u9ad8\u6e05\u670d\u52a1\u5904\u7406\u4e0a\u9650\uff0c\u672c\u6b21\u661f\u5149\u5df2\u9000\u56de\uff0c\u8bf7\u6362\u4e00\u5f20\u7a0d\u5c0f\u7684\u539f\u56fe\u518d\u8bd5'
  }
  if (status === 401 || status === 403) {
    return MSG_SERVICE_NOT_CONFIGURED
  }
  if (status === 429 || (status >= 500 && status <= 599)) {
    return MSG_SERVICE_BUSY
  }
  return message || MSG_UPSCALE_FAILED
}

function buildTaskResponse(task = {}) {
  return {
    upscaleTaskId: task._id || '',
    historyId: task.historyId || '',
    status: task.status || '',
    resultUrl: task.resultUrl || '',
    errorMessage: task.errorMessage || '',
    scale: task.scale || UPSCALE_SCALE,
    pointsCost: task.pointsCost || UPSCALE_POINTS_COST,
    durationMs: task.durationMs || 0
  }
}

function isRunningTask(task = {}) {
  return task.status === 'pending' || task.status === 'running'
}

function isStaleRunning(task = {}) {
  if (task.status !== 'running') return false
  const startedAt = task.startedAt || task.updatedAt || task.createdAt
  const startedMs = startedAt ? new Date(startedAt).getTime() : 0
  return startedMs > 0 && Date.now() - startedMs > RUNNING_TIMEOUT_MS
}

async function getOwnedHistory(db, openid, historyId) {
  if (!openid) {
    return { error: '用户未登录' }
  }
  if (!historyId) {
    return { error: '缺少 historyId' }
  }
  const res = await db.collection(HISTORY_COLLECTION).doc(historyId).get().catch(() => null)
  const history = res && res.data
  if (!history) {
    return { error: '生成记录不存在' }
  }
  if (history._openid !== openid) {
    return { error: '无权访问该生成记录' }
  }
  return { history }
}

async function isHistoryUpscaleEnabled(db, history = {}) {
  if (history.enableUpscalePrint === true) return true
  if (history.enableUpscalePrint === false) return false
  if (!history.featureId) return false
  const featureRes = await db.collection('ai_features').doc(history.featureId).get().catch(() => null)
  const feature = featureRes && featureRes.data
  return !!(feature && feature.enable_upscale_print)
}

async function findReusableTask(db, openid, historyId) {
  const res = await db.collection(UPSCALE_TASKS_COLLECTION)
    .where({ _openid: openid, historyId })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }))

  const tasks = (res.data || []).sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return right - left
  })
  const succeeded = tasks.find((task) => task.status === 'succeeded' && task.resultUrl)
  if (succeeded) return succeeded
  return tasks.find(isRunningTask) || null
}

async function refundPointsOnce(cloud, db, task, title = '高清打印版生成失败退款') {
  if (!task || !task.pointsDeducted || task.pointsRefunded || !task.pointsCost) {
    return false
  }
  const res = await db.collection(UPSCALE_TASKS_COLLECTION).where({
    _id: task._id,
    pointsRefunded: false
  }).update({
    data: {
      pointsRefunded: true,
      updatedAt: now(db)
    }
  })
  if (!res.stats || res.stats.updated !== 1) {
    return false
  }
  await cloud.callFunction({
    name: 'points',
    data: {
      action: 'internalRecharge',
      internalToken: process.env.INTERNAL_FUNCTION_TOKEN,
      amount: task.pointsCost,
      reason: `refund_upscale_${task._id}`,
      title,
      openid: task._openid
    }
  })
  return true
}

async function resolveHttpImageUrl(cloud, imageUrl = '') {
  const rawUrl = String(imageUrl || '').trim()
  if (!rawUrl) return ''
  if (!rawUrl.startsWith('cloud://')) return rawUrl
  const tempRes = await cloud.getTempFileURL({ fileList: [rawUrl] })
  const item = tempRes.fileList && tempRes.fileList[0]
  return (item && item.tempFileURL) || rawUrl
}

function getUpscaleSafeInputPixels() {
  const configured = Number(process.env.UPSCALE_INPUT_MAX_PIXELS)
  if (Number.isFinite(configured) && configured > 0 && configured < REPLICATE_MAX_INPUT_PIXELS) {
    return Math.floor(configured)
  }
  return REPLICATE_SAFE_INPUT_PIXELS
}

function appendUrlParam(url = '', param = '') {
  const cleanUrl = String(url || '').trim()
  const cleanParam = String(param || '').trim().replace(/^[?&]+/, '')
  if (!cleanUrl || !cleanParam) return cleanUrl
  const separator = cleanUrl.includes('?') ? '&' : '?'
  return `${cleanUrl}${separator}${cleanParam}`
}

function parseSizeRatio(size = '') {
  const value = String(size || '').trim().toLowerCase()
  const match = value.match(/(\d+(?:\.\d+)?)\s*[x:*]\s*(\d+(?:\.\d+)?)/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function normalizeDimensionPair(dimensions) {
  if (!dimensions) return null
  const width = Number(dimensions.width || dimensions.Width)
  const height = Number(dimensions.height || dimensions.Height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function calculateInputBox(dimensions, maxPixels = getUpscaleSafeInputPixels()) {
  const pair = normalizeDimensionPair(dimensions) || DEFAULT_UPSCALE_INPUT_RATIO
  const ratio = pair.width / pair.height
  let width = Math.floor(Math.sqrt(maxPixels * ratio))
  let height = Math.floor(width / ratio)

  while (width * height > maxPixels) {
    if (width >= height) {
      width -= 1
    } else {
      height -= 1
    }
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    maxPixels,
    ratio
  }
}

function buildImageMogrThumbnailParam(box) {
  return `imageMogr2/thumbnail/${box.width}x${box.height}%3E`
}

async function getRemoteImageInfo(inputUrl) {
  if (!inputUrl || !String(inputUrl).startsWith('http')) return null
  const infoUrl = appendUrlParam(inputUrl, 'imageInfo')
  const response = await axios.get(infoUrl, {
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`imageInfo request failed: ${response.status}`)
  }
  const data = response.data || {}
  return normalizeDimensionPair(data)
}

function resolveHistoryRatio(history = {}) {
  return normalizeDimensionPair(history.resultDimensions || history.resultSize)
    || parseSizeRatio(history.size)
    || parseSizeRatio(history.sizeSnapshot)
}

async function getTempUrlForCloudFile(cloud, fileID) {
  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] })
  const item = tempRes.fileList && tempRes.fileList[0]
  return (item && item.tempFileURL) || fileID
}

async function prepareReplicateInputUrl(cloud, history, imageUrl, timings = {}) {
  const resolveStartedAt = Date.now()
  const inputUrl = await resolveHttpImageUrl(cloud, imageUrl)
  timings.sourceResolveMs = Date.now() - resolveStartedAt
  if (!inputUrl) return ''

  const configuredParam = String(process.env.UPSCALE_INPUT_PROCESSING || '').trim()
  if (configuredParam) {
    timings.inputProcessedBy = 'cloudbase_ci'
    timings.inputProcessingMode = 'configured_param'
    timings.inputProcessingParam = configuredParam
    return appendUrlParam(inputUrl, configuredParam)
  }

  let dimensions = null
  const infoStartedAt = Date.now()
  try {
    dimensions = await getRemoteImageInfo(inputUrl)
    timings.sourceImageInfoMs = Date.now() - infoStartedAt
    if (dimensions) {
      timings.sourceWidth = dimensions.width
      timings.sourceHeight = dimensions.height
      timings.sourcePixels = dimensions.width * dimensions.height
      timings.inputRatioSource = 'imageInfo'
    }
  } catch (err) {
    timings.sourceImageInfoMs = Date.now() - infoStartedAt
    timings.sourceImageInfoError = err && err.message ? err.message.slice(0, 160) : String(err)
  }

  if (!dimensions) {
    dimensions = resolveHistoryRatio(history)
    timings.inputRatioSource = dimensions ? 'history_size' : 'default_square'
  }

  const box = calculateInputBox(dimensions)
  const processingParam = buildImageMogrThumbnailParam(box)
  timings.inputProcessedBy = 'cloudbase_ci'
  timings.inputMaxPixels = box.maxPixels
  timings.inputTargetWidth = box.width
  timings.inputTargetHeight = box.height
  timings.inputTargetPixels = box.width * box.height
  timings.inputProcessingParam = processingParam
  return appendUrlParam(inputUrl, processingParam)
}

function guessImageExtension(contentType = '', url = '') {
  const lowerType = String(contentType || '').toLowerCase()
  if (lowerType.includes('webp')) return 'webp'
  if (lowerType.includes('jpeg') || lowerType.includes('jpg')) return 'jpg'
  if (lowerType.includes('png')) return 'png'
  const cleanedUrl = String(url || '').split('?')[0]
  const ext = cleanedUrl.includes('.') ? cleanedUrl.split('.').pop().toLowerCase() : ''
  return ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'png'
}

function getReplicateToken() {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim()
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }
  return token
}

function buildReplicateHeaders(extra = {}) {
  return {
    Authorization: `Token ${getReplicateToken()}`,
    'Content-Type': 'application/json',
    ...extra
  }
}

function getOutputUrl(output) {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output.find((item) => typeof item === 'string' && item) || ''
  }
  if (output && typeof output === 'object') {
    return output.url || output.image || output.output || ''
  }
  return ''
}

async function createReplicatePrediction(inputUrl) {
  const res = await axios.post(
    `${REPLICATE_API_BASE}/models/${REPLICATE_MODEL_OWNER}/${REPLICATE_MODEL_NAME}/predictions`,
    {
      input: {
        image: inputUrl,
        scale: UPSCALE_SCALE,
        face_enhance: false
      }
    },
    {
      headers: buildReplicateHeaders({ Prefer: `wait=${REPLICATE_WAIT_SECONDS}` }),
      timeout: REQUEST_TIMEOUT_MS
    }
  )
  return res.data || {}
}

async function getReplicatePrediction(predictionId) {
  const res = await axios.get(`${REPLICATE_API_BASE}/predictions/${predictionId}`, {
    headers: buildReplicateHeaders(),
    timeout: REQUEST_TIMEOUT_MS
  })
  return res.data || {}
}

async function uploadRemoteResultToCloud(cloud, historyId, outputUrl, timings = {}) {
  const downloadStartedAt = Date.now()
  const response = await axios.get(outputUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS
  })
  timings.resultDownloadMs = Date.now() - downloadStartedAt
  timings.resultBytes = response.data ? Buffer.byteLength(response.data) : 0
  const ext = guessImageExtension(response.headers && response.headers['content-type'], outputUrl)
  const cloudPath = `generated_upscaled/${historyId}_${Date.now()}_x${UPSCALE_SCALE}.${ext}`
  const uploadStartedAt = Date.now()
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(response.data)
  })
  timings.cloudUploadMs = Date.now() - uploadStartedAt
  if (!uploadRes.fileID) {
    throw new Error('高清图片上传云存储失败')
  }
  return uploadRes.fileID
}

async function createUpscaleTask(cloud, openid, historyId) {
  const db = getDb(cloud)
  const owned = await getOwnedHistory(db, openid, historyId)
  if (owned.error) return { success: false, error: owned.error }
  const history = owned.history

  if (!(await isHistoryUpscaleEnabled(db, history))) {
    return { success: false, error: '该图片不支持高清可打印版' }
  }
  if (history.upscaledUrl) {
    return {
      success: true,
      reused: true,
      status: 'succeeded',
      resultUrl: history.upscaledUrl,
      pointsCost: UPSCALE_POINTS_COST
    }
  }

  const reusableTask = await findReusableTask(db, openid, historyId)
  if (reusableTask) {
    return {
      success: true,
      reused: true,
      task: buildTaskResponse(reusableTask)
    }
  }

  const sourceUrl = history.resultUrl || ''
  if (!sourceUrl) {
    return { success: false, error: '原图不存在，无法生成高清版' }
  }

  const deductRes = await cloud.callFunction({
    name: 'points',
    data: {
      action: 'consume',
      amount: UPSCALE_POINTS_COST,
      reason: `upscale_${historyId}`,
      title: '高清可打印版',
      openid
    }
  })

  if (!deductRes || !deductRes.result || !deductRes.result.success) {
    return {
      success: false,
      error: (deductRes && deductRes.result && deductRes.result.message) || '星光不足，请先充值'
    }
  }

  const taskRes = await db.collection(UPSCALE_TASKS_COLLECTION).add({
    data: {
      _openid: openid,
      historyId,
      sourceUrl,
      status: 'pending',
      scale: UPSCALE_SCALE,
      pointsCost: UPSCALE_POINTS_COST,
      pointsDeducted: true,
      pointsRefunded: false,
      provider: 'replicate_real_esrgan',
      replicatePredictionId: '',
      upstreamStatus: '',
      resultUrl: '',
      errorMessage: '',
      createdAt: now(db),
      updatedAt: now(db),
      startedAt: null,
      finishedAt: null,
      durationMs: 0
    }
  })

  await db.collection(HISTORY_COLLECTION).doc(historyId).update({
    data: {
      upscaleStatus: 'pending',
      upscaleTaskId: taskRes._id,
      upscaleScale: UPSCALE_SCALE,
      upscaleProvider: 'replicate_real_esrgan'
    }
  })

  cloud.callFunction({
    name: 'aiGenerate',
    data: {
      action: 'ensureUpscaleWorker',
      upscaleTaskId: taskRes._id,
      openid
    }
  }).catch((err) => {
    console.error('[upscale] trigger worker failed', taskRes._id, err)
  })

  return {
    success: true,
    task: {
      upscaleTaskId: taskRes._id,
      historyId,
      status: 'pending',
      resultUrl: '',
      scale: UPSCALE_SCALE,
      pointsCost: UPSCALE_POINTS_COST
    }
  }
}

async function getUpscaleTaskStatus(cloud, openid, upscaleTaskId) {
  const db = getDb(cloud)
  if (!openid) return { success: false, error: '用户未登录' }
  if (!upscaleTaskId) return { success: false, error: '缺少 upscaleTaskId' }

  const taskRes = await db.collection(UPSCALE_TASKS_COLLECTION).doc(upscaleTaskId).get().catch(() => null)
  const task = taskRes && taskRes.data
  if (!task) return { success: false, error: '高清任务不存在' }
  if (task._openid !== openid) return { success: false, error: '无权访问该高清任务' }
  return { success: true, task: buildTaskResponse(task) }
}

async function markTaskFailed(cloud, db, task, errorMessage) {
  await db.collection(UPSCALE_TASKS_COLLECTION).doc(task._id).update({
    data: {
      status: 'failed',
      errorMessage,
      updatedAt: now(db),
      finishedAt: now(db),
      durationMs: task.createdAt ? Date.now() - new Date(task.createdAt).getTime() : 0
    }
  })
  await db.collection(HISTORY_COLLECTION).doc(task.historyId).update({
    data: {
      upscaleStatus: 'failed',
      upscaleErrorMessage: errorMessage
    }
  }).catch(() => null)
  await refundPointsOnce(cloud, db, task)
}

async function completeTask(cloud, db, task, resultUrl) {
  const durationMs = task.createdAt ? Math.max(0, Date.now() - new Date(task.createdAt).getTime()) : 0
  await db.collection(UPSCALE_TASKS_COLLECTION).doc(task._id).update({
    data: {
      status: 'succeeded',
      resultUrl,
      errorMessage: '',
      updatedAt: now(db),
      finishedAt: now(db),
      durationMs
    }
  })
  await db.collection(HISTORY_COLLECTION).doc(task.historyId).update({
    data: {
      upscaleStatus: 'succeeded',
      upscaledUrl: resultUrl,
      upscaleTaskId: task._id,
      upscaleScale: UPSCALE_SCALE,
      upscaleProvider: task.provider || 'replicate_real_esrgan',
      upscaleErrorMessage: ''
    }
  })
  return { success: true, task: { ...buildTaskResponse(task), status: 'succeeded', resultUrl, durationMs } }
}

async function ensureUpscaleWorker(cloud, openid, upscaleTaskId) {
  const db = getDb(cloud)
  if (!openid) return { success: false, error: '用户未登录' }
  if (!upscaleTaskId) return { success: false, error: '缺少 upscaleTaskId' }

  const taskRes = await db.collection(UPSCALE_TASKS_COLLECTION).doc(upscaleTaskId).get().catch(() => null)
  let task = taskRes && taskRes.data
  if (!task) return { success: false, error: '高清任务不存在' }
  if (task._openid !== openid) return { success: false, error: '无权访问该高清任务' }

  if (task.status === 'succeeded' || task.status === 'failed') {
    return { success: true, task: buildTaskResponse(task), skipped: true }
  }
  if (task.status === 'running' && !isStaleRunning(task)) {
    return { success: true, task: buildTaskResponse(task), skipped: true }
  }

  const claimRes = await db.collection(UPSCALE_TASKS_COLLECTION).where({
    _id: upscaleTaskId,
    status: task.status === 'running' ? 'running' : 'pending'
  }).update({
    data: {
      status: 'running',
      startedAt: task.startedAt || now(db),
      updatedAt: now(db)
    }
  })

  if (!claimRes.stats || claimRes.stats.updated !== 1) {
    const latest = await db.collection(UPSCALE_TASKS_COLLECTION).doc(upscaleTaskId).get().catch(() => null)
    return { success: true, task: buildTaskResponse((latest && latest.data) || task), skipped: true }
  }

  task = {
    ...task,
    status: 'running'
  }

  const timings = {}

  try {
    const historyRes = await db.collection(HISTORY_COLLECTION).doc(task.historyId).get()
    const history = historyRes.data
    if (!history || history._openid !== openid) {
      throw new Error('生成记录不存在或无权访问')
    }
    if (history.upscaledUrl) {
      return await completeTask(cloud, db, task, history.upscaledUrl)
    }

    let prediction = null
    if (task.replicatePredictionId) {
      const pollStartedAt = Date.now()
      prediction = await getReplicatePrediction(task.replicatePredictionId)
      timings.replicatePollMs = Date.now() - pollStartedAt
    } else {
      const inputUrl = await prepareReplicateInputUrl(cloud, history, task.sourceUrl || history.resultUrl, timings)
      if (!inputUrl) throw new Error('原图不存在，无法生成高清版')
      const predictionStartedAt = Date.now()
      prediction = await createReplicatePrediction(inputUrl)
      timings.replicateCreateWaitMs = Date.now() - predictionStartedAt
      await db.collection(UPSCALE_TASKS_COLLECTION).doc(task._id).update({
        data: {
          replicatePredictionId: prediction.id || '',
          upstreamStatus: prediction.status || '',
          timings,
          updatedAt: now(db)
        }
      })
      task.replicatePredictionId = prediction.id || ''
    }

    const status = prediction.status || ''
    if (status === 'succeeded') {
      const outputUrl = getOutputUrl(prediction.output)
      if (!outputUrl) throw new Error('高清服务未返回图片')
      const resultUrl = await uploadRemoteResultToCloud(cloud, task.historyId, outputUrl, timings)
      await db.collection(UPSCALE_TASKS_COLLECTION).doc(task._id).update({
        data: {
          timings,
          updatedAt: now(db)
        }
      })
      return await completeTask(cloud, db, task, resultUrl)
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(prediction.error || '高清图片生成失败')
    }

    await db.collection(UPSCALE_TASKS_COLLECTION).doc(task._id).update({
      data: {
        status: 'pending',
        upstreamStatus: status || 'processing',
        updatedAt: now(db)
      }
    })
    await db.collection(HISTORY_COLLECTION).doc(task.historyId).update({
      data: {
        upscaleStatus: 'pending',
        upscaleTaskId: task._id
      }
    }).catch(() => null)
    return {
      success: true,
      task: {
        ...buildTaskResponse(task),
        status: 'pending'
      }
    }
  } catch (err) {
    const errorMessage = normalizeUpscaleError(err)
    console.error('[upscale] task failed', upscaleTaskId, {
      message: err && err.message,
      response: err && err.response && err.response.data
    })
    await markTaskFailed(cloud, db, task, errorMessage)
    return { success: false, error: errorMessage, task: { ...buildTaskResponse(task), status: 'failed', errorMessage } }
  }
}

module.exports = {
  createUpscaleTask,
  getUpscaleTaskStatus,
  ensureUpscaleWorker,
  UPSCALE_POINTS_COST,
  UPSCALE_SCALE
}
