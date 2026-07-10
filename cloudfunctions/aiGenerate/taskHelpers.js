const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TASKS_COLLECTION = 'generation_tasks'
const RUNNING_TIMEOUT_MS = 16 * 60 * 1000
const UPSTREAM_POLL_INTERVAL_MS = 10000
const TEMPLATE_TYPE_IMAGE = 'image_to_image'
const TEMPLATE_TYPE_TEXT = 'text_to_image'
const TEXT_TO_IMAGE_PROVIDERS = ['volcengine', 'supersolo', 'supersolo_async', 'toapis', 'joapi', 'jimeng_cli']

function normalizeTemplateType(value) {
  return value === TEMPLATE_TYPE_TEXT ? TEMPLATE_TYPE_TEXT : TEMPLATE_TYPE_IMAGE
}

function normalizeInputFields(fields) {
  if (!Array.isArray(fields)) return []
  return fields
    .map((field, index) => ({
      key: String(field && field.key || '').trim(),
      title: String(field && (field.title || field.label) || '').trim(),
      placeholder: String(field && field.placeholder || '').trim(),
      maxLength: Number(field && (field.maxLength || field.max_length || field.limit)) || 0,
      required: field && field.required !== false,
      sort: Number(field && field.sort) || index
    }))
    .filter(field => field.key)
    .sort((a, b) => a.sort - b.sort)
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

function toTimestamp(value) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function getTaskTotalDurationMs(task) {
  if (!task) return 0
  if (Number(task.totalDurationMs) > 0) {
    return Number(task.totalDurationMs)
  }
  const createdAtMs = toTimestamp(task.createdAt)
  if (!createdAtMs) return 0
  const finishedAtMs = toTimestamp(task.finishedAt)
  const endAtMs = finishedAtMs || Date.now()
  return Math.max(0, endAtMs - createdAtMs)
}

async function refundFeaturePoints(openid, amount, featureId) {
  if (!amount || amount <= 0) return
  await cloud.callFunction({
    name: 'points',
    data: {
      action: 'recharge',
      amount,
      reason: `refund_${featureId}`,
      title: '生图失败退回',
      openid
    }
  })
}

function buildTaskResponse(task) {
  if (!task) {
    return null
  }

  return {
    taskId: task._id,
    featureId: task.featureId || '',
    status: task.status,
    upstreamStatus: task.upstreamStatus || '',
    resultUrl: task.resultUrl || '',
    historyId: task.historyId || '',
    errorMessage: task.errorMessage || '',
    templateType: task.templateType || TEMPLATE_TYPE_IMAGE,
    provider: task.provider || '',
    modelCallId: task.modelCallId || task.modelCallIdSnapshot || '',
    fallbackUsed: !!task.fallbackUsed,
    activeModelRole: task.activeModelRole || '',
    primaryErrorMessage: task.primaryErrorMessage || '',
    fallbackErrorMessage: task.fallbackErrorMessage || '',
    inputValues: task.inputValues || {},
    compiledPrompt: task.compiledPrompt || task.promptSnapshot || '',
    createdAt: task.createdAt || null,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    totalDurationMs: getTaskTotalDurationMs(task)
  }
}

async function createTask(openid, featureId, imageUrls, inputValues = {}) {
  if (!openid) {
    return { success: false, error: '用户未登录' }
  }
  if (!featureId) {
    return { success: false, error: '缺少 featureId' }
  }

  const featureRes = await db.collection('ai_features').doc(featureId).get()
  const feature = featureRes.data
  if (!feature) {
    return { success: false, error: '功能不存在' }
  }

  let pointsDeducted = false
  const pointsCost = feature.points_cost || 0
  const templateType = normalizeTemplateType(feature.template_type)
  const inputFields = normalizeInputFields(feature.input_fields)
  const normalizedInputValues = normalizeInputValues(inputValues, inputFields)
  const compiledPrompt = templateType === TEMPLATE_TYPE_TEXT
    ? compilePrompt(feature.prompt || '', inputFields, normalizedInputValues)
    : (feature.prompt || '')
  const normalizedImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : []

  if (templateType === TEMPLATE_TYPE_IMAGE) {
    const requiredUploadCount = Math.max(Number(feature.upload_count || 1), 1)
    if (requiredUploadCount > 0 && normalizedImageUrls.length === 0) {
      return { success: false, error: '请上传图片' }
    }
  }

  if (templateType === TEMPLATE_TYPE_TEXT) {
    for (let i = 0; i < inputFields.length; i += 1) {
      const field = inputFields[i]
      if (field.required && !normalizedInputValues[field.key]) {
        return { success: false, error: `请填写${field.title || field.key}` }
      }
    }
    if (!compiledPrompt.trim()) {
      return { success: false, error: '提示词为空，请检查模板配置' }
    }
  }

  if (pointsCost > 0) {
    const deductRes = await cloud.callFunction({
      name: 'points',
      data: {
        action: 'consume',
        amount: pointsCost,
        reason: featureId,
        title: `使用生图：${feature.name}`,
        openid
      }
    })

    if (!deductRes || !deductRes.result || !deductRes.result.success) {
      return {
        success: false,
        error: (deductRes && deductRes.result && deductRes.result.message) || '积分不足，请先充值'
      }
    }
    pointsDeducted = true
  }

  const modelRes = await db.collection('ai_models').where({
    model_call_id: feature.model_call_id
  }).get()
  const modelConfig = modelRes.data[0]
  if (!modelConfig) {
    if (pointsDeducted && pointsCost > 0) {
      await refundFeaturePoints(openid, pointsCost, featureId)
    }
    return { success: false, error: '模型配置不存在，请联系管理员' }
  }

  if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(modelConfig.provider)) {
    if (pointsDeducted && pointsCost > 0) {
      await refundFeaturePoints(openid, pointsCost, featureId)
    }
    return { success: false, error: '当前模型不支持文生图，请联系管理员更换模型' }
  }

  const fallbackModelCallId = feature.fallback_model_call_id || ''
  let fallbackModelConfig = null
  if (fallbackModelCallId) {
    const fallbackModelRes = await db.collection('ai_models').where({
      model_call_id: fallbackModelCallId
    }).get()
    fallbackModelConfig = fallbackModelRes.data[0]
    if (!fallbackModelConfig) {
      if (pointsDeducted && pointsCost > 0) {
        await refundFeaturePoints(openid, pointsCost, featureId)
      }
      return { success: false, error: 'fallback model config not found' }
    }
    if (templateType === TEMPLATE_TYPE_TEXT && !TEXT_TO_IMAGE_PROVIDERS.includes(fallbackModelConfig.provider)) {
      if (pointsDeducted && pointsCost > 0) {
        await refundFeaturePoints(openid, pointsCost, featureId)
      }
      return { success: false, error: 'fallback model is not compatible with text-to-image' }
    }
  }

  const taskRes = await db.collection(TASKS_COLLECTION).add({
    data: {
      _openid: openid,
      featureId,
      status: 'pending',
      imageUrls: normalizedImageUrls,
      promptSnapshot: feature.prompt || '',
      compiledPrompt,
      inputValues: normalizedInputValues,
      inputFields,
      templateType,
      modelCallIdSnapshot: feature.model_call_id || '',
      fallbackModelCallIdSnapshot: fallbackModelCallId,
      sizeSnapshot: feature.size || '',
      activeModelRole: 'primary',
      fallbackUsed: false,
      fallbackErrorMessage: '',
      featureNameSnapshot: feature.name || '',
      enableUpscalePrintSnapshot: !!feature.enable_upscale_print,
      pointsCost,
      pointsDeducted,
      pointsRefunded: false,
      upstreamTaskId: '',
      upstreamStatus: '',
      resultUrl: '',
      errorMessage: '',
      historyId: '',
      createdAt: db.serverDate(),
      startedAt: null,
      finishedAt: null
    }
  })

  const taskId = taskRes._id

  cloud.callFunction({
    name: 'generationWorker',
    data: { taskId }
  }).catch((triggerErr) => {
    console.error('[aiGenerate] worker trigger failed', taskId, triggerErr)
  })

  return {
    success: true,
    taskId
  }
}

async function getTaskStatus(openid, taskId) {
  if (!openid) {
    return { success: false, error: '用户未登录' }
  }
  if (!taskId) {
    return { success: false, error: '缺少 taskId' }
  }

  const taskRes = await db.collection(TASKS_COLLECTION).doc(taskId).get()
  const task = taskRes.data
  if (!task) {
    return { success: false, error: '任务不存在' }
  }
  if (task._openid !== openid) {
    return { success: false, error: '无权访问该任务' }
  }

  return {
    success: true,
    task: buildTaskResponse(task)
  }
}

async function ensureWorker(openid, taskId) {
  const taskRes = await db.collection(TASKS_COLLECTION).doc(taskId).get().catch(() => null)
  const task = taskRes && taskRes.data
  if (!task) {
    return { success: false, error: '任务不存在' }
  }
  if (task._openid !== openid) {
    return { success: false, error: '无权访问该任务' }
  }

  const status = task.status
  const startedAt = task.startedAt
  const createdAt = task.createdAt
  const upstreamPolledAt = task.upstreamPolledAt

  const taskStartTime = startedAt || createdAt
  const startTimeMs = taskStartTime ? new Date(taskStartTime).getTime() : 0
  const isStaleRunning = status === 'running' && (Date.now() - startTimeMs > RUNNING_TIMEOUT_MS)
  const upstreamPolledAtMs = upstreamPolledAt ? new Date(upstreamPolledAt).getTime() : 0
  const recentlyPolledUpstream =
    !!task.upstreamTaskId &&
    upstreamPolledAtMs > 0 &&
    Date.now() - upstreamPolledAtMs < UPSTREAM_POLL_INTERVAL_MS

  if (recentlyPolledUpstream) {
    return { success: true, skipped: true, status, reason: 'upstream_poll_throttled' }
  }

  if (status !== 'pending' && !isStaleRunning) {
    return { success: true, skipped: true, status }
  }

  cloud.callFunction({
    name: 'generationWorker',
    data: { taskId, openid }
  }).catch((triggerErr) => {
    console.error('[aiGenerate] ensureWorker trigger failed', taskId, triggerErr)
  })

  return { success: true, triggered: true }
}

async function listTasks(openid, page = 0, pageSize = 10) {
  if (!openid) {
    return { success: false, error: '用户未登录' }
  }

  try {
    const res = await db.collection(TASKS_COLLECTION)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    // 自动扫描待处理或超时卡死的任务进行静默拉起
    for (const item of res.data) {
      const isPending = item.status === 'pending'
      const taskStartTime = item.startedAt || item.createdAt
      const startTimeMs = taskStartTime ? new Date(taskStartTime).getTime() : 0
      const isStaleRunning = item.status === 'running' && (Date.now() - startTimeMs > RUNNING_TIMEOUT_MS)

      if (isPending || isStaleRunning) {
        // 静默唤醒背景任务
        ensureWorker(openid, item._id).catch(err => {
          console.error('[aiGenerate] 自愈唤醒任务失败:', item._id, err)
        })
      }
    }

    const list = res.data.map(item => {
      return {
        id: item._id,
        featureName: item.featureNameSnapshot || item.featureName || 'AI生成任务',
        createdAt: item.createdAt || null,
        status: item.status || 'pending',
        templateType: item.templateType || TEMPLATE_TYPE_IMAGE,
        inputValues: item.inputValues || {},
        compiledPrompt: item.compiledPrompt || item.promptSnapshot || '',
        resultUrl: item.resultUrl || '',
        errorMessage: item.errorMessage || '',
        historyId: item.historyId || '',
        totalDurationMs: getTaskTotalDurationMs(item)
      }
    })

    return {
      success: true,
      tasks: list
    }
  } catch (err) {
    console.error('[aiGenerate] listTasks failed', err)
    return { success: false, error: err.message }
  }
}

module.exports = {
  createTask,
  getTaskStatus,
  ensureWorker,
  buildTaskResponse,
  TASKS_COLLECTION,
  listTasks,
  normalizeTemplateType,
  normalizeInputFields,
  normalizeInputValues,
  compilePrompt,
  TEXT_TO_IMAGE_PROVIDERS
}
