const axios = require('axios')
const FormData = require('form-data')
const REQUEST_TIMEOUT_MS = 14 * 60 * 1000
const IMAGE_DOWNLOAD_TIMEOUT_MS = 60 * 1000
const STATUS_REQUEST_TIMEOUT_MS = 30 * 1000
const REFERENCE_IMAGE_COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024
const REFERENCE_IMAGE_TARGET_BYTES = 4 * 1024 * 1024
const REFERENCE_IMAGE_MAX_DIMENSION = 2048

function buildRequestConfig(modelConfig) {
  return {
    headers: {
      Authorization: `Bearer ${modelConfig.api_key}`,
      'Content-Type': 'application/json'
    },
    timeout: REQUEST_TIMEOUT_MS
  }
}

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').replace(/\/+$/, '')
}

function resolveImageSize(modelConfig = {}, fallback = '1024x1024') {
  if (String(modelConfig.model_id || '').trim() === 'gpt-image-2') {
    return 'auto'
  }
  return modelConfig.size || fallback
}

function isGptImageModel(modelConfig = {}) {
  return String(modelConfig.model_id || '').toLowerCase().includes('gpt')
}

function isGeminiImageModel(modelConfig = {}) {
  return String(modelConfig.model_id || '').toLowerCase().includes('gemini')
}

function guessImageExtension(contentType = '', url = '') {
  const lowerType = String(contentType).toLowerCase()
  if (lowerType.includes('webp')) return 'webp'
  if (lowerType.includes('jpeg') || lowerType.includes('jpg')) return 'jpg'
  if (lowerType.includes('gif')) return 'gif'
  if (lowerType.includes('png')) return 'png'
  const cleanedUrl = String(url || '').split('?')[0]
  const ext = cleanedUrl.includes('.') ? cleanedUrl.split('.').pop().toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'png'
}

async function resolveHttpImageUrl(cloud, imageUrls) {
  if (!imageUrls || imageUrls.length === 0 || !imageUrls[0]) {
    return ''
  }

  const fileID = imageUrls[0]
  if (!fileID.startsWith('cloud://')) {
    return fileID
  }

  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] })
  if (tempRes.fileList && tempRes.fileList.length > 0 && tempRes.fileList[0].tempFileURL) {
    return optimizeReferenceImageUrl(cloud, tempRes.fileList[0].tempFileURL, fileID)
  }
  return fileID
}

function summarizeUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim()
  if (!value) {
    return { hasUrl: false }
  }
  try {
    const parsed = new URL(value)
    return {
      hasUrl: true,
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.host,
      path: parsed.pathname.slice(0, 160)
    }
  } catch (err) {
    return {
      hasUrl: true,
      protocol: '',
      host: '',
      path: value.slice(0, 80),
      parseError: err && err.message
    }
  }
}

async function logReferenceImageDiagnostics(provider, modelConfig, imageUrl, payload) {
  const summary = summarizeUrl(imageUrl)
  const fields = Object.keys(payload || {}).filter(key => key !== 'prompt')
  const baseInfo = {
    provider,
    modelCallId: modelConfig && modelConfig.model_call_id,
    modelId: modelConfig && modelConfig.model_id,
    hasReferenceImage: !!imageUrl,
    referenceImage: summary,
    payloadFields: fields
  }

  if (!imageUrl || !String(imageUrl).startsWith('http')) {
    console.warn('[generationExecutor] reference image diagnostic skipped', baseInfo)
    return
  }

  try {
    const response = await axios.head(imageUrl, {
      timeout: STATUS_REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true
    })
    console.log('[generationExecutor] reference image diagnostic', {
      ...baseInfo,
      headStatus: response.status,
      contentType: response.headers && response.headers['content-type'],
      contentLength: response.headers && response.headers['content-length']
    })
  } catch (err) {
    console.warn('[generationExecutor] reference image diagnostic failed', {
      ...baseInfo,
      error: err && err.message,
      code: err && err.code
    })
  }
}

function parseContentLength(value) {
  const size = Number(value)
  return Number.isFinite(size) && size > 0 ? size : 0
}

function buildCompressedCloudPath(sourceUrl = '') {
  const cleanPath = String(sourceUrl || '').split('?')[0]
  const fileName = cleanPath.includes('/') ? cleanPath.split('/').pop() : ''
  const baseName = fileName ? fileName.replace(/\.[^.]+$/, '') : `${Date.now()}_${Math.floor(Math.random() * 100000)}`
  return `compressed_inputs/${baseName}_${Date.now()}.jpg`
}

function appendUrlParam(url = '', param = '') {
  const cleanUrl = String(url || '').trim()
  const cleanParam = String(param || '').trim().replace(/^[?&]+/, '')
  if (!cleanUrl || !cleanParam) return cleanUrl
  const separator = cleanUrl.includes('?') ? '&' : '?'
  return `${cleanUrl}${separator}${cleanParam}`
}

async function uploadCompressedReferenceImage(cloud, sourceUrl, buffer) {
  const cloudPath = buildCompressedCloudPath(sourceUrl)
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  })
  if (!uploadRes.fileID) {
    return ''
  }
  const tempRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
  return tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL
    ? tempRes.fileList[0].tempFileURL
    : uploadRes.fileID
}

function buildImageMogrParam(maxDimension, quality) {
  return `imageMogr2/thumbnail/${maxDimension}x${maxDimension}%3E/format/jpg/quality/${quality}`
}

async function compressReferenceImageByCloudProcessing(imageUrl) {
  const variants = [
    { maxDimension: REFERENCE_IMAGE_MAX_DIMENSION, quality: 82 },
    { maxDimension: REFERENCE_IMAGE_MAX_DIMENSION, quality: 72 },
    { maxDimension: 1600, quality: 72 },
    { maxDimension: 1600, quality: 62 },
    { maxDimension: 1280, quality: 62 },
    { maxDimension: 1280, quality: 52 }
  ]
  let bestBuffer = null
  let bestVariant = null

  for (const variant of variants) {
    const processedUrl = appendUrlParam(imageUrl, buildImageMogrParam(variant.maxDimension, variant.quality))
    const response = await axios.get(processedUrl, {
      responseType: 'arraybuffer',
      timeout: IMAGE_DOWNLOAD_TIMEOUT_MS,
      validateStatus: () => true
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`imageMogr2 request failed: ${response.status}`)
    }
    const buffer = Buffer.from(response.data)
    if (!bestBuffer || buffer.length < bestBuffer.length) {
      bestBuffer = buffer
      bestVariant = variant
    }
    if (buffer.length <= REFERENCE_IMAGE_TARGET_BYTES) {
      return { buffer, variant }
    }
  }

  return bestBuffer ? { buffer: bestBuffer, variant: bestVariant } : null
}

async function optimizeReferenceImageUrl(cloud, imageUrl, sourceFileID = '') {
  if (!imageUrl || !String(imageUrl).startsWith('http')) {
    return imageUrl
  }

  try {
    const headRes = await axios.head(imageUrl, {
      timeout: STATUS_REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true
    })
    const contentLength = parseContentLength(headRes.headers && headRes.headers['content-length'])
    const contentType = String((headRes.headers && headRes.headers['content-type']) || '').toLowerCase()
    if (headRes.status >= 400 || !contentType.includes('image') || contentLength <= REFERENCE_IMAGE_COMPRESS_THRESHOLD_BYTES) {
      return imageUrl
    }

    const compressed = await compressReferenceImageByCloudProcessing(imageUrl)
    const compressedBuffer = compressed && compressed.buffer
    if (!compressedBuffer || compressedBuffer.length >= contentLength) {
      return imageUrl
    }

    const optimizedUrl = await uploadCompressedReferenceImage(cloud, imageUrl, compressedBuffer)
    if (!optimizedUrl) {
      return imageUrl
    }

    console.log('[generationExecutor] reference image compressed', {
      sourceFileID,
      originalBytes: contentLength,
      compressedBytes: compressedBuffer.length,
      processor: 'cloudbase_ci',
      maxDimension: compressed.variant && compressed.variant.maxDimension,
      quality: compressed.variant && compressed.variant.quality
    })
    return optimizedUrl
  } catch (err) {
    console.warn('[generationExecutor] reference image compression skipped', {
      sourceFileID,
      message: err && err.message,
      code: err && err.code
    })
    return imageUrl
  }
}

async function uploadRemoteUrlToCloud(cloud, imageUrl) {
  let targetUrl = imageUrl || ''
  if (targetUrl.includes('via.placeholder.com')) {
    targetUrl = targetUrl.replace('via.placeholder.com', 'dummyimage.com')
  }
  
  const response = await axios.get(targetUrl, {
    responseType: 'arraybuffer',
    timeout: IMAGE_DOWNLOAD_TIMEOUT_MS
  })
  const ext = guessImageExtension(response.headers && response.headers['content-type'], imageUrl)
  const cloudPath = `generated_results/${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(response.data)
  })
  if (!uploadRes.fileID) {
    return ''
  }
  // 改造点：直接返回原生的 cloud:// 永久文件ID，不再转成易引发并发受限的 https:// 临时链接
  return uploadRes.fileID
}

async function uploadB64ToCloud(cloud, b64Json) {
  const imageBuffer = Buffer.from(b64Json, 'base64')
  const cloudPath = `generated_results/${Date.now()}_${Math.floor(Math.random() * 100000)}.png`
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: imageBuffer
  })
  const fileID = uploadRes.fileID
  if (!fileID) {
    return ''
  }
  // 改造点：直接返回原生的 cloud:// 永久文件ID，不再转成易引发并发受限的 https:// 临时链接
  return fileID
}

async function materializeImageUrl(cloud, imageUrl) {
  const rawUrl = String(imageUrl || '').trim()
  if (!rawUrl) {
    return ''
  }
  if (rawUrl.startsWith('data:image/')) {
    const commaIndex = rawUrl.indexOf(',')
    if (commaIndex < 0) {
      return ''
    }
    return uploadB64ToCloud(cloud, rawUrl.slice(commaIndex + 1))
  }
  return uploadRemoteUrlToCloud(cloud, rawUrl)
}

async function downloadImageBuffer(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: IMAGE_DOWNLOAD_TIMEOUT_MS
  })
  return {
    buffer: Buffer.from(response.data),
    contentType: (response.headers && response.headers['content-type']) || 'image/png',
    extension: guessImageExtension(response.headers && response.headers['content-type'], imageUrl)
  }
}

async function callCoze(modelConfig, feature, imageUrls) {
  const response = await axios.post(
    modelConfig.base_url || 'https://api.coze.cn/v1/workflow/run',
    {
      workflow_id: modelConfig.model_id,
      parameters: {
        image: imageUrls[0] || '',
        prompt: feature.prompt || ''
      }
    },
    buildRequestConfig(modelConfig)
  )

  const cozeRes = response.data
  if (!cozeRes || cozeRes.code !== 0) {
    throw new Error(`Coze 工作流执行报错: ${(cozeRes && cozeRes.msg) || '未知错误'}`)
  }

  let dataObj = {}
  if (typeof cozeRes.data === 'string') {
    dataObj = JSON.parse(cozeRes.data)
  } else {
    dataObj = cozeRes.data || {}
  }

  const rawResultImageUrl = dataObj.image || dataObj.result || dataObj.url || ''
  if (!rawResultImageUrl) {
    throw new Error('Coze 工作流未返回图片地址，请检查工作流输出参数')
  }
  
  const resultImageUrl = await uploadRemoteUrlToCloud(cloud, rawResultImageUrl)
  if (!resultImageUrl) {
    throw new Error('Coze 图片转存云存储失败')
  }
  return { status: 'completed', resultImageUrl }
}

async function callVolcengine(cloud, modelConfig, feature, imageUrls) {
  const httpImageUrl = await resolveHttpImageUrl(cloud, imageUrls)
  const payload = {
    model: modelConfig.model_id,
    prompt: feature.prompt || '',
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: '2K',
    stream: false,
    watermark: false
  }

  if (httpImageUrl) {
    payload.image = httpImageUrl
  }

  const response = await axios.post(
    modelConfig.base_url || 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    payload,
    buildRequestConfig(modelConfig)
  )

  const volcRes = response.data
  if (!volcRes || !volcRes.data || volcRes.data.length === 0) {
    throw new Error(`火山引擎执行报错: ${JSON.stringify((volcRes && volcRes.error) || volcRes)}`)
  }

  const rawResultImageUrl = volcRes.data[0].url || ''
  if (!rawResultImageUrl) {
    throw new Error('火山引擎未返回图片地址')
  }
  
  const resultImageUrl = await uploadRemoteUrlToCloud(cloud, rawResultImageUrl)
  if (!resultImageUrl) {
    throw new Error('火山引擎图片转存云存储失败')
  }
  return { status: 'completed', resultImageUrl }
}

async function callSupersolo(cloud, modelConfig, feature, imageUrls) {
  const httpImageUrl = await resolveHttpImageUrl(cloud, imageUrls)
  if (isGeminiImageModel(modelConfig)) {
    return callGeminiImage(cloud, modelConfig, feature, httpImageUrl)
  }
  if (isGptImageModel(modelConfig) && httpImageUrl) {
    return callSupersoloGptImageEdit(cloud, modelConfig, feature, httpImageUrl)
  }
  return callSupersoloImageGeneration(cloud, modelConfig, feature, httpImageUrl)
}

async function callSupersoloImageGeneration(cloud, modelConfig, feature, httpImageUrl) {
  const payload = {
    model: modelConfig.model_id,
    prompt: feature.prompt || '',
    n: 1,
    size: resolveImageSize(modelConfig, '1024x1024')
  }

  if (isGptImageModel(modelConfig)) {
    payload.resolution = '2K'
    payload.response_format = 'url'
  } else {
    payload.response_format = 'b64_json'
  }

  if (httpImageUrl) {
    if (isGptImageModel(modelConfig)) {
      payload.reference_images = [httpImageUrl]
      payload.image_urls = [httpImageUrl]
    } else {
      payload.image = httpImageUrl
    }
  }

  if (isGptImageModel(modelConfig)) {
    await logReferenceImageDiagnostics('supersolo', modelConfig, httpImageUrl, payload)
  }

  const response = await axios.post(
    `${modelConfig.base_url}/images/generations`,
    payload,
    buildRequestConfig(modelConfig)
  )

  const proxyRes = response.data
  if (!proxyRes || !proxyRes.data || proxyRes.data.length === 0) {
    throw new Error(`中转站执行报错: ${JSON.stringify((proxyRes && proxyRes.error) || proxyRes)}`)
  }

  const imageResult = proxyRes.data[0]
  let resultImageUrl = ''

  if (imageResult.b64_json) {
    resultImageUrl = await uploadB64ToCloud(cloud, imageResult.b64_json)
  } else if (imageResult.url) {
    resultImageUrl = await uploadRemoteUrlToCloud(cloud, imageResult.url)
  }

  if (!resultImageUrl) {
    throw new Error('中转站未返回图片 URL 或 b64_json 数据')
  }
  return { status: 'completed', resultImageUrl }
}

async function callSupersoloGptImageEdit(cloud, modelConfig, feature, httpImageUrl) {
  const payload = {
    model: modelConfig.model_id,
    prompt: feature.prompt || '',
    n: Number(modelConfig.n || 1),
    size: 'auto',
    images: [
      {
        image_url: httpImageUrl
      }
    ]
  }
  await logReferenceImageDiagnostics('supersolo_edits', modelConfig, httpImageUrl, payload)
  const baseUrl = normalizeBaseUrl(modelConfig.base_url)
  const response = await axios.post(
    `${baseUrl}/images/edits`,
    payload,
    buildRequestConfig(modelConfig)
  )

  const proxyRes = response.data
  if (!proxyRes || !proxyRes.data || proxyRes.data.length === 0) {
    throw new Error(`中转站编辑接口报错: ${JSON.stringify((proxyRes && proxyRes.error) || proxyRes)}`)
  }

  const imageResult = proxyRes.data[0]
  let resultImageUrl = ''
  if (imageResult.b64_json) {
    resultImageUrl = await uploadB64ToCloud(cloud, imageResult.b64_json)
  } else if (imageResult.url) {
    resultImageUrl = await uploadRemoteUrlToCloud(cloud, imageResult.url)
  }
  if (!resultImageUrl) {
    throw new Error('中转站编辑接口未返回图片 URL 或 b64_json 数据')
  }
  return { status: 'completed', resultImageUrl }
}

function buildGeminiEndpoint(modelConfig = {}) {
  const endpoint = normalizeBaseUrl(modelConfig.base_url)
  if (!endpoint) {
    throw new Error('Gemini 模型缺少完整 base_url，请在后台填写完整 generateContent 接口地址')
  }
  return endpoint
}

function findGeminiImagePart(responseData = {}) {
  const candidates = Array.isArray(responseData.candidates) ? responseData.candidates : []
  for (const candidate of candidates) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : []
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data
      if (inlineData && inlineData.data) {
        return inlineData
      }
    }
  }
  return null
}

async function callGeminiImage(cloud, modelConfig, feature, httpImageUrl) {
  const parts = [{ text: feature.prompt || '' }]
  if (httpImageUrl) {
    const imageFile = await downloadImageBuffer(httpImageUrl)
    parts.push({
      inline_data: {
        mime_type: imageFile.contentType,
        data: imageFile.buffer.toString('base64')
      }
    })
  }

  const response = await axios.post(
    buildGeminiEndpoint(modelConfig),
    {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    },
    {
      headers: {
        'x-goog-api-key': modelConfig.api_key,
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    }
  )

  const imagePart = findGeminiImagePart(response.data)
  if (!imagePart || !imagePart.data) {
    throw new Error(`Gemini 未返回图片数据: ${JSON.stringify(response.data)}`)
  }
  const resultImageUrl = await uploadB64ToCloud(cloud, imagePart.data)
  if (!resultImageUrl) {
    throw new Error('Gemini 图片转存云存储失败')
  }
  return { status: 'completed', resultImageUrl }
}

async function callJiucan(cloud, modelConfig, feature, imageUrls) {
  const httpImageUrl = await resolveHttpImageUrl(cloud, imageUrls)
  if (!httpImageUrl) {
    throw new Error('九参图生图缺少参考图')
  }

  const imageFile = await downloadImageBuffer(httpImageUrl)
  const form = new FormData()
  form.append('model', modelConfig.model_id)
  form.append('prompt', feature.prompt || '')
  form.append('n', String(modelConfig.n || 1))
  form.append('size', resolveImageSize(modelConfig, '1024x1024'))
  form.append('response_format', modelConfig.response_format || 'b64_json')
  form.append('image', imageFile.buffer, {
    filename: `reference.${imageFile.extension}`,
    contentType: imageFile.contentType
  })

  const baseUrl = normalizeBaseUrl(modelConfig.base_url)
  const response = await axios.post(
    `${baseUrl}/images/edits`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${modelConfig.api_key}`
      },
      timeout: REQUEST_TIMEOUT_MS
    }
  )

  const providerRes = response.data
  if (!providerRes || !providerRes.data || providerRes.data.length === 0) {
    throw new Error(`九参执行报错: ${JSON.stringify((providerRes && providerRes.error) || providerRes)}`)
  }

  const imageResult = providerRes.data[0]
  let resultImageUrl = ''

  if (imageResult.b64_json) {
    resultImageUrl = await uploadB64ToCloud(cloud, imageResult.b64_json)
  } else if (imageResult.url) {
    resultImageUrl = await uploadRemoteUrlToCloud(cloud, imageResult.url)
  }

  if (!resultImageUrl) {
    throw new Error('九参未返回图片 URL 或 b64_json 数据')
  }
  return { status: 'completed', resultImageUrl }
}

function parseToapisResultUrl(taskRes) {
  const resultData = taskRes && taskRes.result && Array.isArray(taskRes.result.data)
    ? taskRes.result.data
    : []
  const nestedUrl = resultData[0] && resultData[0].url
  const dataUrl = taskRes && Array.isArray(taskRes.data) && taskRes.data[0]
    ? taskRes.data[0].url
    : ''
  return nestedUrl || dataUrl || taskRes.url || taskRes.result_url || ''
}

function isToapisPendingStatus(status = '') {
  return ['queued', 'in_progress', 'pending', 'running'].includes(String(status).toLowerCase())
}

function isToapisCompletedStatus(status = '') {
  return ['completed', 'succeeded', 'success'].includes(String(status).toLowerCase())
}

const TOAPIS_SIZE_OPTIONS = ['1:1', '3:4', '9:16']

function resolveToapisSize(modelConfig = {}, feature = {}) {
  const featureSize = String(feature.size || '').trim()
  if (TOAPIS_SIZE_OPTIONS.includes(featureSize)) {
    return featureSize
  }
  const modelSize = String(modelConfig.size || '').trim()
  if (TOAPIS_SIZE_OPTIONS.includes(modelSize)) {
    return modelSize
  }
  return '1:1'
}

async function fetchToapisTaskStatus(modelConfig, taskId) {
  const baseUrl = normalizeBaseUrl(modelConfig.base_url || 'https://toapis.com/v1')
  const response = await axios.get(
    `${baseUrl}/images/generations/${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${modelConfig.api_key}`
      },
      timeout: STATUS_REQUEST_TIMEOUT_MS
    }
  )
  return response.data
}

async function createToapisTask(cloud, modelConfig, feature, imageUrls, options = {}) {
  const httpImageUrl = await resolveHttpImageUrl(cloud, imageUrls)
  const payload = {
    model: modelConfig.model_id,
    prompt: feature.prompt || '',
    n: 1,
    size: resolveToapisSize(modelConfig, feature),
    resolution: '2K',
    response_format: 'url'
  }

  if (httpImageUrl) {
    payload.reference_images = [httpImageUrl]
    payload.image_urls = [httpImageUrl]
  }
  if (options.clientBusinessId) {
    payload.client_business_id = options.clientBusinessId
  }

  const baseUrl = normalizeBaseUrl(modelConfig.base_url || 'https://toapis.com/v1')
  const response = await axios.post(
    `${baseUrl}/images/generations`,
    payload,
    buildRequestConfig(modelConfig)
  )
  return response.data
}

async function createSupersoloAsyncTask(cloud, modelConfig, feature, imageUrls) {
  const httpImageUrl = await resolveHttpImageUrl(cloud, imageUrls)
  const payload = {
    model: modelConfig.model_id,
    prompt: feature.prompt || '',
    n: 1,
    size: resolveImageSize(modelConfig, '1024x1024'),
    response_format: 'b64_json'
  }

  if (httpImageUrl) {
    payload.image = httpImageUrl
  }

  const baseUrl = normalizeBaseUrl(modelConfig.base_url)
  const response = await axios.post(
    `${baseUrl}/images/generations/async`,
    payload,
    buildRequestConfig(modelConfig)
  )
  return response.data
}

async function callToapis(cloud, modelConfig, feature, imageUrls, options = {}) {
  let taskRes = null
  if (options.upstreamTaskId) {
    taskRes = await fetchToapisTaskStatus(modelConfig, options.upstreamTaskId)
  } else {
    taskRes = await createToapisTask(cloud, modelConfig, feature, imageUrls, options)
  }

  if (!taskRes) {
    throw new Error('ToAPIs 返回为空')
  }
  if (taskRes.error) {
    throw new Error(taskRes.error.message || `ToAPIs 错误: ${JSON.stringify(taskRes.error)}`)
  }

  const upstreamTaskId = taskRes.id || options.upstreamTaskId || ''
  const upstreamStatus = taskRes.status || ''

  if (isToapisPendingStatus(upstreamStatus)) {
    return {
      status: 'pending',
      upstreamTaskId,
      upstreamStatus
    }
  }

  if (String(upstreamStatus).toLowerCase() === 'failed') {
    const errMsg = taskRes.error && taskRes.error.message
      ? taskRes.error.message
      : `ToAPIs 任务失败: ${JSON.stringify(taskRes)}`
    throw new Error(errMsg)
  }

  if (!isToapisCompletedStatus(upstreamStatus)) {
    return {
      status: 'pending',
      upstreamTaskId,
      upstreamStatus: upstreamStatus || 'unknown'
    }
  }

  const remoteUrl = parseToapisResultUrl(taskRes)
  if (!remoteUrl) {
    throw new Error('ToAPIs 任务已完成但未返回结果图片 URL')
  }

  const resultImageUrl = await materializeImageUrl(cloud, remoteUrl)
  if (!resultImageUrl) {
    throw new Error('ToAPIs 结果图片转存失败')
  }

  return {
    status: 'completed',
    resultImageUrl,
    upstreamTaskId,
    upstreamStatus
  }
}

async function callSupersoloAsync(cloud, modelConfig, feature, imageUrls, options = {}) {
  let taskRes = null
  if (options.upstreamTaskId) {
    taskRes = await fetchToapisTaskStatus(modelConfig, options.upstreamTaskId)
  } else {
    taskRes = await createSupersoloAsyncTask(cloud, modelConfig, feature, imageUrls)
  }

  if (!taskRes) {
    throw new Error('Supersolo 异步接口返回为空')
  }
  if (taskRes.error) {
    throw new Error(taskRes.error.message || `Supersolo 异步接口错误: ${JSON.stringify(taskRes.error)}`)
  }

  const upstreamTaskId = taskRes.id || options.upstreamTaskId || ''
  const upstreamStatus = taskRes.status || ''

  if (isToapisPendingStatus(upstreamStatus)) {
    return { status: 'pending', upstreamTaskId, upstreamStatus }
  }

  if (String(upstreamStatus).toLowerCase() === 'failed') {
    const errMsg = taskRes.error && taskRes.error.message
      ? taskRes.error.message
      : `Supersolo 异步任务失败: ${JSON.stringify(taskRes)}`
    throw new Error(errMsg)
  }

  if (!isToapisCompletedStatus(upstreamStatus)) {
    return { status: 'pending', upstreamTaskId, upstreamStatus: upstreamStatus || 'unknown' }
  }

  const remoteUrl = parseToapisResultUrl(taskRes)
  if (!remoteUrl) {
    throw new Error('Supersolo 异步任务已完成但未返回结果图片 URL')
  }

  const resultImageUrl = await materializeImageUrl(cloud, remoteUrl)
  if (!resultImageUrl) {
    throw new Error('Supersolo 异步结果图片转存失败')
  }

  return { status: 'completed', resultImageUrl, upstreamTaskId, upstreamStatus }
}

async function executeGeneration(cloud, modelConfig, feature, imageUrls, options = {}) {
  if (modelConfig.provider === 'toapis') {
    return callToapis(cloud, modelConfig, feature, imageUrls, options)
  }

  if (isGeminiImageModel(modelConfig) || isGptImageModel(modelConfig)) {
    return callSupersolo(cloud, modelConfig, feature, imageUrls)
  }

  if (modelConfig.provider === 'coze') {
    return callCoze(modelConfig, feature, imageUrls)
  }
  if (modelConfig.provider === 'volcengine') {
    return callVolcengine(cloud, modelConfig, feature, imageUrls)
  }
  if (modelConfig.provider === 'supersolo') {
    return callSupersolo(cloud, modelConfig, feature, imageUrls)
  }
  if (modelConfig.provider === 'jiucan') {
    return callJiucan(cloud, modelConfig, feature, imageUrls)
  }
  if (modelConfig.provider === 'supersolo_async') {
    return callSupersoloAsync(cloud, modelConfig, feature, imageUrls, options)
  }
  if (modelConfig.provider === 'toapis') {
    return callToapis(cloud, modelConfig, feature, imageUrls, options)
  }

  throw new Error(`暂不支持的 provider: ${modelConfig.provider}`)
}

function getModelCallId(modelConfig = {}) {
  return modelConfig.model_call_id || modelConfig.modelCallId || ''
}

function getFallbackOptions(options = {}) {
  return {
    ...options,
    upstreamTaskId: options.fallbackUpstreamTaskId || '',
    clientBusinessId: options.clientBusinessId ? `${options.clientBusinessId}_fallback` : ''
  }
}

function decorateGenerationResult(result, modelConfig, extra = {}) {
  return {
    ...(result || {}),
    provider: modelConfig.provider || '',
    modelCallId: getModelCallId(modelConfig),
    ...extra
  }
}

async function executeGenerationWithFallback(cloud, primaryModelConfig, fallbackModelConfig, feature, imageUrls, options = {}) {
  const activeModelRole = options.activeModelRole === 'fallback' ? 'fallback' : 'primary'

  if (activeModelRole === 'fallback') {
    if (!fallbackModelConfig) {
      throw new Error('fallback model config not found')
    }
    const fallbackResult = await executeGeneration(cloud, fallbackModelConfig, feature, imageUrls, options)
    return decorateGenerationResult(fallbackResult, fallbackModelConfig, {
      activeModelRole: 'fallback',
      fallbackUsed: true
    })
  }

  try {
    const primaryResult = await executeGeneration(cloud, primaryModelConfig, feature, imageUrls, options)
    return decorateGenerationResult(primaryResult, primaryModelConfig, {
      activeModelRole: 'primary',
      fallbackUsed: false
    })
  } catch (primaryErr) {
    if (!fallbackModelConfig) {
      throw primaryErr
    }

    const primaryErrorMessage = (primaryErr && primaryErr.message) || 'primary model failed'
    console.warn('[generationExecutor] primary model failed, switching to fallback', {
      provider: primaryModelConfig && primaryModelConfig.provider,
      modelCallId: getModelCallId(primaryModelConfig),
      fallbackProvider: fallbackModelConfig && fallbackModelConfig.provider,
      fallbackModelCallId: getModelCallId(fallbackModelConfig),
      error: primaryErrorMessage
    })

    try {
      const fallbackResult = await executeGeneration(cloud, fallbackModelConfig, feature, imageUrls, getFallbackOptions(options))
      return decorateGenerationResult(fallbackResult, fallbackModelConfig, {
        activeModelRole: 'fallback',
        fallbackUsed: true,
        primaryErrorMessage
      })
    } catch (fallbackErr) {
      fallbackErr.primaryErrorMessage = primaryErrorMessage
      fallbackErr.fallbackErrorMessage = (fallbackErr && fallbackErr.message) || 'fallback model failed'
      throw fallbackErr
    }
  }
}

module.exports = {
  executeGeneration,
  executeGenerationWithFallback
}
