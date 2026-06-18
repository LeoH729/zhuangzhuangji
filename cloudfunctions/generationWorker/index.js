const cloud = require('wx-server-sdk')
const { executeGenerationWithFallback } = require('./generationExecutor')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TASKS_COLLECTION = 'generation_tasks'
const RUNNING_TIMEOUT_MS = 16 * 60 * 1000

function elapsedSince(value, fallbackMs = Date.now()) {
  const time = value ? new Date(value).getTime() : 0
  if (!time || Number.isNaN(time)) {
    return 0
  }
  return Math.max(0, fallbackMs - time)
}

function isUpstreamAsyncProvider(provider = '') {
  return provider === 'toapis' || provider === 'supersolo_async'
}

function getActiveModelCallId(task = {}) {
  if (task.activeModelRole === 'fallback' && task.fallbackModelCallIdSnapshot) {
    return task.fallbackModelCallIdSnapshot
  }
  return task.modelCallIdSnapshot
}

function normalizeWorkerError(err) {
  const isTimeout = err && (err.code === 'ECONNABORTED' || String(err.message || '').toLowerCase().includes('timeout'))
  if (isTimeout) {
    return '模型响应超时（云函数单次上限 900 秒），请改用异步通道或迁移到长任务后端。'
  }
  return (err && err.message) || '生成失败'
}

function isRetryableError(err) {
  const code = String((err && err.code) || '').toUpperCase()
  const message = String((err && err.message) || '').toLowerCase()
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) {
    return true
  }
  return message.includes('timeout') || message.includes('socket hang up') || message.includes('network')
}

async function refundPointsOnce(task) {
  if (!task.pointsDeducted || task.pointsRefunded || !task.pointsCost || task.pointsCost <= 0) {
    return false
  }

  const refundRes = await db.collection(TASKS_COLLECTION).where({
    _id: task._id,
    pointsRefunded: false
  }).update({
    data: {
      pointsRefunded: true
    }
  })

  if (!refundRes.stats || refundRes.stats.updated !== 1) {
    return false
  }

  await cloud.callFunction({
    name: 'points',
    data: {
      action: 'recharge',
      amount: task.pointsCost,
      reason: `refund_task_${task._id}`,
      title: '生图失败退回',
      openid: task._openid
    }
  })

  return true
}

async function claimTask(taskId) {
  const claimRes = await db.collection(TASKS_COLLECTION).where({
    _id: taskId,
    status: 'pending'
  }).update({
    data: {
      status: 'running',
      startedAt: db.serverDate()
    }
  })

  return claimRes.stats && claimRes.stats.updated === 1
}

async function markTaskFailed(task, errorMessage, metrics = {}) {
  await db.collection(TASKS_COLLECTION).doc(task._id).update({
    data: {
      status: 'failed',
      errorMessage: errorMessage || '生成失败',
      ...metrics,
      finishedAt: db.serverDate()
    }
  })

  try {
    await refundPointsOnce(task)
  } catch (refundErr) {
    console.error('[generationWorker] refund failed', refundErr)
  }
}

async function notifyGenerationDone(task, historyId, resultUrl) {
  try {
    await cloud.callFunction({
      name: 'notification',
      data: {
        action: 'sendGenerationDone',
        openid: task._openid,
        taskId: task._id,
        historyId,
        resultUrl,
        featureId: task.featureId || '',
        title: task.featureNameSnapshot || 'AI图片生成完成',
        statusText: '已完成',
        remark: '点击查看生成结果'
      }
    })
  } catch (err) {
    console.warn('[generationWorker] notification send failed', {
      taskId: task && task._id,
      message: err && err.message,
      errCode: err && err.errCode,
      errMsg: err && err.errMsg
    })
  }
}

async function processTask(taskId) {
  const processStartedAtMs = Date.now()
  const taskRes = await db.collection(TASKS_COLLECTION).doc(taskId).get()
  let task = taskRes.data
  if (!task) {
    return { success: false, error: '任务不存在' }
  }

  if (task.status === 'succeeded' || task.status === 'failed') {
    return { success: true, skipped: true, status: task.status }
  }

  // 关键防重与超时自愈：任务处于 running 时，如果是近期启动的，跳过防重；如果已运行过久，进行超时自愈
  if (task.status === 'running') {
    const taskStartTime = task.startedAt || task.createdAt
    const startTimeMs = taskStartTime ? new Date(taskStartTime).getTime() : 0
    const isStale = Date.now() - startTimeMs > RUNNING_TIMEOUT_MS

    if (!isStale) {
      return { success: true, skipped: true, status: 'running' }
    }

    console.warn(`[generationWorker] 任务 ${taskId} 异常卡在 running 状态。开始执行超时自愈恢复...`)

    // 获取该任务的模型配置信息，判断通道类型
    const modelRes = await db.collection('ai_models').where({
      model_call_id: getActiveModelCallId(task)
    }).get()
    const modelConfig = modelRes.data[0]
    const isAsyncProvider = modelConfig && isUpstreamAsyncProvider(modelConfig.provider)

    if (isAsyncProvider && task.upstreamTaskId) {
      // 异步通道且拥有上游任务 ID，可重置为 pending 安全恢复（再次查询/重试状态）
      console.log(`[generationWorker] 任务 ${taskId} 为异步通道，已绑定 upstreamTaskId ${task.upstreamTaskId}。重置为 pending 并进入自愈恢复。`)
      await db.collection(TASKS_COLLECTION).doc(task._id).update({
        data: {
          status: 'pending',
          errorMessage: '超时自愈中'
        }
      })
      const refreshed = await db.collection(TASKS_COLLECTION).doc(task._id).get()
      task = refreshed.data || task
    } else {
      // 同步通道（supersolo, coze, volcengine 等）因无法安全召回图片，为防止重复扣额度，直接置为失败并退回用户小程序积分
      console.warn(`[generationWorker] 任务 ${taskId} 为同步通道或缺失上游ID。将执行自动退款与标记失败。`)
      const errorMsg = '生成超时（已自动退回积分）'
      await markTaskFailed(task, errorMsg)
      return { success: false, taskId, error: errorMsg, recovered: true }
    }
  }

  const claimed = await claimTask(taskId)
  if (!claimed) {
    const latestRes = await db.collection(TASKS_COLLECTION).doc(taskId).get()
    const latest = latestRes.data || {}
    return { success: true, skipped: true, status: latest.status || 'unknown' }
  }
  const refreshed = await db.collection(TASKS_COLLECTION).doc(taskId).get()
  task = refreshed.data || task

  let modelProvider = ''
  let modelCallId = ''
  try {
    const modelRes = await db.collection('ai_models').where({
      model_call_id: task.modelCallIdSnapshot
    }).get()
    const modelConfig = modelRes.data[0]
    if (!modelConfig) {
      throw new Error('模型配置不存在，请联系管理员')
    }
    modelProvider = modelConfig.provider || ''
    modelCallId = modelConfig.model_call_id || task.modelCallIdSnapshot || ''

    let fallbackModelConfig = null
    if (task.fallbackModelCallIdSnapshot) {
      const fallbackModelRes = await db.collection('ai_models').where({
        model_call_id: task.fallbackModelCallIdSnapshot
      }).get()
      fallbackModelConfig = fallbackModelRes.data[0] || null
    }

    const featureSnapshot = {
      name: task.featureNameSnapshot || '',
      prompt: task.compiledPrompt || task.promptSnapshot || '',
      size: task.sizeSnapshot || '',
      points_cost: task.pointsCost || 0
    }

    const executeStartedAtMs = Date.now()
    const execResult = await executeGenerationWithFallback(
      cloud,
      modelConfig,
      fallbackModelConfig,
      featureSnapshot,
      task.imageUrls || [],
      {
        upstreamTaskId: task.upstreamTaskId || '',
        activeModelRole: task.activeModelRole || 'primary',
        clientBusinessId: task._id
      }
    )
    const executionDurationMs = Date.now() - executeStartedAtMs
    if (execResult) {
      modelProvider = execResult.provider || modelProvider
      modelCallId = execResult.modelCallId || modelCallId
    }

    if (!execResult || execResult.status === 'pending') {
      await db.collection(TASKS_COLLECTION).doc(task._id).update({
        data: {
          status: 'pending',
          upstreamTaskId: (execResult && execResult.upstreamTaskId) || task.upstreamTaskId || '',
          upstreamStatus: (execResult && execResult.upstreamStatus) || 'queued',
          upstreamPolledAt: db.serverDate(),
          lastExecutionDurationMs: executionDurationMs,
          provider: modelProvider,
          modelCallId,
          activeModelRole: (execResult && execResult.activeModelRole) || task.activeModelRole || 'primary',
          fallbackUsed: !!(execResult && execResult.fallbackUsed),
          primaryErrorMessage: (execResult && execResult.primaryErrorMessage) || task.primaryErrorMessage || '',
          fallbackErrorMessage: '',
          errorMessage: ''
        }
      })
      console.log('[generationWorker] upstream task pending', {
        taskId: task._id,
        provider: modelProvider,
        modelCallId,
        upstreamTaskId: (execResult && execResult.upstreamTaskId) || task.upstreamTaskId || '',
        upstreamStatus: (execResult && execResult.upstreamStatus) || 'queued',
        executionDurationMs,
        workerCallDurationMs: Date.now() - processStartedAtMs
      })
      return {
        success: true,
        taskId: task._id,
        status: 'pending',
        upstreamStatus: (execResult && execResult.upstreamStatus) || 'queued'
      }
    }

    const resultImageUrl = execResult.resultImageUrl
    const completedAtMs = Date.now()
    const totalDurationMs = elapsedSince(task.createdAt, completedAtMs)
    const workerDurationMs = elapsedSince(task.startedAt, completedAtMs) || (completedAtMs - processStartedAtMs)

    const historyRes = await db.collection('generation_history').add({
      data: {
        _openid: task._openid,
        source: task.source || '',
        adminUid: task.adminUid || '',
        featureId: task.featureId || '',
        featureName: task.featureNameSnapshot || '',
        generationMode: 'worker',
        provider: modelProvider,
        modelCallId,
        fallbackModelCallId: task.fallbackModelCallIdSnapshot || '',
        fallbackUsed: !!execResult.fallbackUsed,
        primaryErrorMessage: execResult.primaryErrorMessage || task.primaryErrorMessage || '',
        photoUrl: (task.imageUrls && task.imageUrls[0]) || '',
        originalImages: task.imageUrls || [],
        inputValues: task.inputValues || {},
        compiledPrompt: task.compiledPrompt || task.promptSnapshot || '',
        templateType: task.templateType || 'image_to_image',
        size: task.sizeSnapshot || '',
        resultUrl: resultImageUrl,
        pointsCost: task.pointsCost || 0,
        enableUpscalePrint: !!task.enableUpscalePrintSnapshot,
        taskId: task._id,
        upstreamTaskId: execResult.upstreamTaskId || task.upstreamTaskId || '',
        upstreamStatus: execResult.upstreamStatus || task.upstreamStatus || '',
        executionDurationMs,
        workerDurationMs,
        totalDurationMs,
        rating: '',
        createdAt: db.serverDate()
      }
    })

    await db.collection(TASKS_COLLECTION).doc(task._id).update({
      data: {
        status: 'succeeded',
        resultUrl: resultImageUrl,
        historyId: historyRes._id,
        provider: modelProvider,
        modelCallId,
        upstreamTaskId: execResult.upstreamTaskId || task.upstreamTaskId || '',
        upstreamStatus: execResult.upstreamStatus || task.upstreamStatus || '',
        executionDurationMs,
        workerDurationMs,
        totalDurationMs,
        activeModelRole: execResult.activeModelRole || task.activeModelRole || 'primary',
        fallbackUsed: !!execResult.fallbackUsed,
        primaryErrorMessage: execResult.primaryErrorMessage || task.primaryErrorMessage || '',
        fallbackErrorMessage: '',
        inputValues: task.inputValues || {},
        compiledPrompt: task.compiledPrompt || task.promptSnapshot || '',
        templateType: task.templateType || 'image_to_image',
        finishedAt: db.serverDate()
      }
    })

    await notifyGenerationDone(task, historyRes._id, resultImageUrl)

    console.log('[generationWorker] task completed', {
      taskId: task._id,
      provider: modelProvider,
      modelCallId,
      upstreamTaskId: execResult.upstreamTaskId || task.upstreamTaskId || '',
      upstreamStatus: execResult.upstreamStatus || task.upstreamStatus || '',
      historyId: historyRes._id,
      executionDurationMs,
      workerDurationMs,
      totalDurationMs
    })

    return {
      success: true,
      taskId: task._id,
      resultUrl: resultImageUrl,
      historyId: historyRes._id
    }
  } catch (err) {
    console.error('[generationWorker] task failed', taskId, {
      message: err && err.message,
      code: err && err.code,
      status: err && err.response && err.response.status,
      responseData: err && err.response && err.response.data,
      method: err && err.config && err.config.method,
      url: err && err.config && err.config.url
    })
    const failedAtMs = Date.now()
    const failureMetrics = {
      provider: modelProvider,
      modelCallId,
      activeModelRole: err.primaryErrorMessage ? 'fallback' : (task.activeModelRole || 'primary'),
      fallbackUsed: !!task.fallbackUsed || !!err.primaryErrorMessage,
      primaryErrorMessage: err.primaryErrorMessage || task.primaryErrorMessage || '',
      fallbackErrorMessage: err.fallbackErrorMessage || '',
      workerDurationMs: elapsedSince(task.startedAt, failedAtMs) || (failedAtMs - processStartedAtMs),
      totalDurationMs: elapsedSince(task.createdAt, failedAtMs)
    }
    const shouldRetryPending =
      isUpstreamAsyncProvider(modelProvider) &&
      !!task.upstreamTaskId &&
      isRetryableError(err)

    if (shouldRetryPending) {
      await db.collection(TASKS_COLLECTION).doc(task._id).update({
        data: {
          status: 'pending',
          upstreamStatus: task.upstreamStatus || 'in_progress',
          errorMessage: ''
        }
      })
      return {
        success: true,
        taskId: task._id,
        status: 'pending',
        upstreamStatus: task.upstreamStatus || 'in_progress',
        retrying: true
      }
    }

    const normalizedError = normalizeWorkerError(err)
    await markTaskFailed(task, normalizedError, failureMetrics)
    return { success: false, taskId, error: normalizedError }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || event.openid
  const taskId = event.taskId || (event.data && event.data.taskId)
  if (!taskId) {
    return { success: false, error: '缺少 taskId' }
  }

  if (openid) {
    const taskRes = await db.collection(TASKS_COLLECTION).doc(taskId).get().catch(() => null)
    const task = taskRes && taskRes.data
    if (!task) {
      return { success: false, error: '任务不存在' }
    }
    if (task._openid !== openid) {
      return { success: false, error: '无权访问该任务' }
    }
  }

  return processTask(taskId)
}
