const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TASKS_COLLECTION = 'generation_tasks'
const RUNNING_TIMEOUT_MS = 16 * 60 * 1000
const UPSTREAM_POLL_INTERVAL_MS = 10000

function buildTaskResponse(task) {
  if (!task) {
    return null
  }

  return {
    taskId: task._id,
    status: task.status,
    upstreamStatus: task.upstreamStatus || '',
    resultUrl: task.resultUrl || '',
    historyId: task.historyId || '',
    errorMessage: task.errorMessage || '',
    createdAt: task.createdAt || null,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null
  }
}

async function createTask(openid, featureId, imageUrls) {
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
      await cloud.callFunction({
        name: 'points',
        data: {
          action: 'recharge',
          amount: pointsCost,
          reason: `refund_${featureId}`,
          title: '生图失败退回',
          openid
        }
      })
    }
    return { success: false, error: '模型配置不存在，请联系管理员' }
  }

  const taskRes = await db.collection(TASKS_COLLECTION).add({
    data: {
      _openid: openid,
      featureId,
      status: 'pending',
      imageUrls: imageUrls || [],
      promptSnapshot: feature.prompt || '',
      modelCallIdSnapshot: feature.model_call_id || '',
      featureNameSnapshot: feature.name || '',
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
        resultUrl: item.resultUrl || '',
        errorMessage: item.errorMessage || '',
        historyId: item.historyId || ''
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
  listTasks
}
