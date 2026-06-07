const cloud = require('wx-server-sdk')
const { executeGenerationWithFallback } = require('./generationExecutor')
const {
  createTask,
  getTaskStatus,
  ensureWorker,
  listTasks,
  normalizeTemplateType,
  normalizeInputFields,
  normalizeInputValues,
  compilePrompt,
  TEXT_TO_IMAGE_PROVIDERS
} = require('./taskHelpers')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function refundPoints(openid, amount, featureId) {
  if (!amount || amount <= 0) {
    return
  }

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

async function runSyncGeneration(openid, featureId, imageUrls, inputValues = {}) {
  const syncStartedAtMs = Date.now()
  let pointsDeducted = false
  let deductedAmount = 0
  let modelProvider = ''
  let modelCallId = ''

  try {
    const featureRes = await db.collection('ai_features').doc(featureId).get()
    const feature = featureRes.data
    const templateType = normalizeTemplateType(feature && feature.template_type)
    const inputFields = normalizeInputFields(feature && feature.input_fields)
    const normalizedInputValues = normalizeInputValues(inputValues, inputFields)
    const compiledPrompt = templateType === 'text_to_image'
      ? compilePrompt(feature.prompt || '', inputFields, normalizedInputValues)
      : (feature.prompt || '')
    const normalizedImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : []

    if (templateType === 'text_to_image') {
      for (let i = 0; i < inputFields.length; i += 1) {
        const field = inputFields[i]
        if (field.required && !normalizedInputValues[field.key]) {
          return { success: false, error: `请填写${field.title || field.key}` }
        }
      }
    }

    if (feature.points_cost > 0) {
      const deductRes = await cloud.callFunction({
        name: 'points',
        data: {
          action: 'consume',
          amount: feature.points_cost,
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
      deductedAmount = feature.points_cost
    }

    const modelRes = await db.collection('ai_models').where({
      model_call_id: feature.model_call_id
    }).get()
    const modelConfig = modelRes.data[0]
    if (!modelConfig) {
      throw new Error('模型配置不存在，请联系管理员')
    }
    modelProvider = modelConfig.provider || ''
    modelCallId = modelConfig.model_call_id || feature.model_call_id || ''

    if (templateType === 'text_to_image' && !TEXT_TO_IMAGE_PROVIDERS.includes(modelProvider)) {
      throw new Error('当前模型不支持文生图，请联系管理员更换模型')
    }

    const fallbackModelCallId = feature.fallback_model_call_id || ''
    let fallbackModelConfig = null
    if (fallbackModelCallId) {
      const fallbackModelRes = await db.collection('ai_models').where({
        model_call_id: fallbackModelCallId
      }).get()
      fallbackModelConfig = fallbackModelRes.data[0]
      if (!fallbackModelConfig) {
        throw new Error('fallback model config not found')
      }
      if (templateType === 'text_to_image' && !TEXT_TO_IMAGE_PROVIDERS.includes(fallbackModelConfig.provider)) {
        throw new Error('fallback model is not compatible with text-to-image')
      }
    }

    const executeStartedAtMs = Date.now()
    const execResult = await executeGenerationWithFallback(cloud, modelConfig, fallbackModelConfig, {
      ...feature,
      prompt: compiledPrompt
    }, normalizedImageUrls, {
      clientBusinessId: `sync_${Date.now()}`
    })
    const executionDurationMs = Date.now() - executeStartedAtMs
    if (!execResult || execResult.status !== 'completed' || !execResult.resultImageUrl) {
      throw new Error('当前模型通道为异步返回，请使用异步任务生成流程')
    }
    const resultImageUrl = execResult.resultImageUrl
    modelProvider = execResult.provider || modelProvider
    modelCallId = execResult.modelCallId || modelCallId
    const totalDurationMs = Date.now() - syncStartedAtMs

    const historyRes = await db.collection('generation_history').add({
      data: {
        _openid: openid,
        featureId: featureId,
        featureName: feature.name,
        generationMode: 'sync',
        provider: modelProvider,
        modelCallId,
        fallbackModelCallId,
        fallbackUsed: !!execResult.fallbackUsed,
        primaryErrorMessage: execResult.primaryErrorMessage || '',
        photoUrl: normalizedImageUrls[0] || '',
        originalImages: normalizedImageUrls,
        inputValues: normalizedInputValues,
        compiledPrompt,
        templateType,
        resultUrl: resultImageUrl,
        pointsCost: feature.points_cost,
        executionDurationMs,
        totalDurationMs,
        rating: '',
        createdAt: db.serverDate()
      }
    })

    console.log('[aiGenerate] sync generation completed', {
      featureId,
      provider: modelProvider,
      modelCallId,
      historyId: historyRes._id,
      executionDurationMs,
      totalDurationMs
    })

    return {
      success: true,
      resultUrl: resultImageUrl,
      historyId: historyRes._id,
      executionDurationMs,
      totalDurationMs
    }
  } catch (err) {
    console.error('[aiGenerate] sync generation failed', {
      featureId,
      provider: modelProvider,
      modelCallId,
      totalDurationMs: Date.now() - syncStartedAtMs,
      error: err && err.message
    })
    if (pointsDeducted && deductedAmount > 0) {
      try {
        await refundPoints(openid, deductedAmount, featureId)
      } catch (refundErr) {
        console.error('[aiGenerate] sync refund failed', refundErr)
      }
    }
    throw err
  }
}

async function rateTask(openid, historyId, rating) {
  if (!openid) {
    return { success: false, error: '用户未登录' }
  }
  if (!historyId) {
    return { success: false, error: '缺少 historyId' }
  }
  if (rating !== 'hang' && rating !== 'la') {
    return { success: false, error: '非法的评价类型' }
  }

  const historyRes = await db.collection('generation_history').doc(historyId).get()
  const history = historyRes.data
  if (!history) {
    return { success: false, error: '生图记录不存在' }
  }

  if (history._openid !== openid) {
    return { success: false, error: '无权评价该生图记录' }
  }

  if (history.rating) {
    return { success: false, error: '您已经评价过了' }
  }

  // 尝试找寻关联的卡片 ID (featureId)
  let featureId = history.featureId
  if (!featureId && history.taskId) {
    const taskRes = await db.collection('generation_tasks').doc(history.taskId).get().catch(() => null)
    if (taskRes && taskRes.data) {
      featureId = taskRes.data.featureId
    }
  }
  if (!featureId && history.featureName) {
    const featRes = await db.collection('ai_features').where({ name: history.featureName }).get().catch(() => null)
    if (featRes && featRes.data && featRes.data.length > 0) {
      featureId = featRes.data[0]._id
    }
  }

  if (!featureId) {
    return { success: false, error: '未找到关联的卡片，无法记录评分' }
  }

  const _ = db.command
  const updateData = {}
  if (rating === 'hang') {
    updateData.hang_count = _.inc(1)
  } else {
    updateData.la_count = _.inc(1)
  }

  // 1. 更新卡片的点赞/踩统计总数
  await db.collection('ai_features').doc(featureId).update({
    data: updateData
  })

  // 2. 标记该历史记录为已评价
  await db.collection('generation_history').doc(historyId).update({
    data: {
      rating
    }
  })

  return { success: true }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || event.userInfo?.openId
  const action = event.action || 'sync'
  const { featureId, imageUrls, inputValues, taskId, page, pageSize, historyId, rating } = event

  try {
    if (action === 'createTask') {
      return await createTask(openid, featureId, imageUrls, inputValues)
    }

    if (action === 'getTaskStatus') {
      return await getTaskStatus(openid, taskId)
    }

    if (action === 'rateTask') {
      return await rateTask(openid, historyId, rating)
    }

    if (action === 'ensureWorker') {
      return await ensureWorker(openid, taskId)
    }

    if (action === 'listTasks') {
      return await listTasks(openid, page, pageSize)
    }

    return await runSyncGeneration(openid, featureId, imageUrls, inputValues)
  } catch (err) {
    console.error('[aiGenerate]', err)
    return { success: false, error: err.message || '生成失败' }
  }
}
