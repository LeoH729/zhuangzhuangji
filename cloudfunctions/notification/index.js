const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const USER_COLLECTION = 'user_points'
const LOG_COLLECTION = 'notification_logs'
const CONFIG_COLLECTION = 'notification_config'
const CONFIG_ID = 'global'
const DEFAULT_GRANT_CREDITS = 1

function success(data = {}) {
  return { success: true, ...data }
}

function failure(code, message, extra = {}) {
  return { success: false, code, message, ...extra }
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function trimText(value = '', maxLength = 20) {
  return String(value || '').trim().slice(0, maxLength)
}

function formatDateTime(date = new Date()) {
  const localTime = date.getTime() + 8 * 60 * 60 * 1000
  const d = new Date(localTime)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function normalizeErrCode(value) {
  if (value === undefined || value === null || value === '') return 0
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function normalizeSendResult(result = {}) {
  return {
    errcode: normalizeErrCode(result.errcode || result.errCode),
    errmsg: result.errmsg || result.errMsg || ''
  }
}

function isUnauthorizedErrcode(errcode) {
  return errcode === 43101
}

async function readConfig() {
  let docConfig = {}
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).get()
    docConfig = res && res.data ? res.data : {}
  } catch (err) {
    docConfig = {}
  }

  const generationDoneTemplateId =
    docConfig.generationDoneTemplateId ||
    docConfig.templateId ||
    process.env.GENERATION_DONE_TEMPLATE_ID ||
    ''

  const generationDoneGrantCredits = Math.max(
    normalizeNumber(
      docConfig.generationDoneGrantCredits || process.env.GENERATION_DONE_GRANT_CREDITS,
      DEFAULT_GRANT_CREDITS
    ),
    1
  )

  const generationDoneFields = {
    title: process.env.GENERATION_DONE_FIELD_TITLE || 'thing1',
    status: process.env.GENERATION_DONE_FIELD_STATUS || 'phrase2',
    time: process.env.GENERATION_DONE_FIELD_TIME || 'time3',
    remark: process.env.GENERATION_DONE_FIELD_REMARK || 'thing4',
    ...(docConfig.generationDoneFields || {})
  }

  return {
    generationDoneTemplateId,
    generationDoneGrantCredits,
    generationDoneFields
  }
}

async function addLog(data) {
  try {
    await db.collection(LOG_COLLECTION).add({
      data: {
        ...data,
        createdAt: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[notification] add log failed', err)
  }
}

async function ensureUserDoc(openid) {
  try {
    await cloud.callFunction({
      name: 'points',
      data: {
        action: 'ensureUserPoints',
        openid
      }
    })
  } catch (err) {
    console.warn('[notification] ensure user points failed', err)
  }
}

async function grantCredits(openid, payload = {}) {
  if (!openid) return failure('NO_OPENID', 'missing openid')

  const config = await readConfig()
  const templateId = payload.templateId || config.generationDoneTemplateId
  if (!templateId) {
    return failure('NO_TEMPLATE', 'missing subscribe message template id')
  }

  const amount = Math.max(
    normalizeNumber(payload.amount, config.generationDoneGrantCredits),
    1
  )

  await ensureUserDoc(openid)
  const grantData = {
    notificationCredits: _.inc(amount),
    notificationTemplateId: templateId,
    notificationGrantedAt: db.serverDate(),
    notificationGrantSource: payload.source || 'unknown',
    notificationLastTaskId: payload.taskId || '',
    notificationLastFeatureId: payload.featureId || '',
    notificationLastPage: payload.page || '',
    notificationLastSendStatus: 'granted',
    notificationLastErrcode: 0,
    notificationUpdatedAt: db.serverDate()
  }
  try {
    await db.collection(USER_COLLECTION).doc(openid).update({ data: grantData })
  } catch (err) {
    await db.collection(USER_COLLECTION).doc(openid).set({
      data: {
        points: 0,
        name: '',
        createdAt: db.serverDate(),
        ...grantData,
        notificationCredits: amount
      }
    })
  }

  await addLog({
    _openid: openid,
    type: 'grant',
    status: 'granted',
    templateId,
    taskId: payload.taskId || '',
    featureId: payload.featureId || '',
    page: payload.page || '',
    creditsDelta: amount,
    source: payload.source || 'unknown',
    errcode: 0,
    errmsg: ''
  })

  return success({ creditsDelta: amount })
}

function buildGenerationDonePage(payload = {}) {
  const historyId = payload.historyId || ''
  const resultUrl = payload.resultUrl || ''
  const params = []
  if (historyId) params.push(`id=${encodeURIComponent(historyId)}`)
  if (resultUrl) params.push(`url=${encodeURIComponent(resultUrl)}`)
  return params.length ? `pages/result/result?${params.join('&')}` : 'pages/generation-history/generation-history'
}

function buildGenerationDoneData(config, payload = {}) {
  const fields = config.generationDoneFields || {}
  const data = {}
  data[fields.title || 'thing1'] = {
    value: trimText(payload.title || 'AI图片生成完成', 20)
  }
  data[fields.status || 'phrase2'] = {
    value: trimText(payload.statusText || '已完成', 5)
  }
  data[fields.time || 'time3'] = {
    value: payload.finishedAtText || formatDateTime()
  }
  data[fields.remark || 'thing4'] = {
    value: trimText(payload.remark || '点击查看生成结果', 20)
  }
  return data
}

async function updateSendStatus(openid, status, errcode, extra = {}) {
  try {
    await db.collection(USER_COLLECTION).doc(openid).update({
      data: {
        notificationLastSendStatus: status,
        notificationLastErrcode: errcode,
        notificationLastErrmsg: extra.errmsg || '',
        notificationUpdatedAt: db.serverDate(),
        ...(extra.data || {})
      }
    })
  } catch (err) {
    console.warn('[notification] update send status failed', err)
  }
}

async function consumeCredit(openid) {
  try {
    await db.collection(USER_COLLECTION).where({
      _id: openid,
      notificationCredits: _.gt(0)
    }).update({
      data: {
        notificationCredits: _.inc(-1),
        notificationUpdatedAt: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[notification] consume credit failed', err)
  }
}

async function clearCredits(openid) {
  try {
    await db.collection(USER_COLLECTION).doc(openid).update({
      data: {
        notificationCredits: 0,
        notificationUpdatedAt: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[notification] clear credits failed', err)
  }
}

async function sendGenerationDone(payload = {}) {
  const openid = payload.openid || payload._openid || ''
  if (!openid) return failure('NO_OPENID', 'missing openid')

  const config = await readConfig()
  const userRes = await db.collection(USER_COLLECTION).doc(openid).get().catch(() => null)
  const user = userRes && userRes.data ? userRes.data : {}
  const templateId = payload.templateId || user.notificationTemplateId || config.generationDoneTemplateId
  const credits = normalizeNumber(user.notificationCredits, 0)
  const page = payload.page || buildGenerationDonePage(payload)

  if (!templateId) {
    await addLog({
      _openid: openid,
      type: 'generation_done',
      status: 'skipped_no_template',
      templateId: '',
      taskId: payload.taskId || '',
      historyId: payload.historyId || '',
      page,
      errcode: 0,
      errmsg: 'missing template id'
    })
    return success({ sent: false, skipped: true, reason: 'NO_TEMPLATE' })
  }

  if (credits <= 0) {
    await addLog({
      _openid: openid,
      type: 'generation_done',
      status: 'skipped_no_credit',
      templateId,
      taskId: payload.taskId || '',
      historyId: payload.historyId || '',
      page,
      errcode: 0,
      errmsg: 'no notification credits'
    })
    await updateSendStatus(openid, 'no_credit', 0)
    return success({ sent: false, skipped: true, reason: 'NO_CREDIT' })
  }

  const data = buildGenerationDoneData(config, payload)
  let sendResult = null
  try {
    sendResult = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page,
      data
    })
  } catch (err) {
    sendResult = {
      errcode: err.errCode || err.errcode || -1,
      errmsg: err.errMsg || err.errmsg || err.message || 'send failed'
    }
  }

  const normalized = normalizeSendResult(sendResult)
  const sent = normalized.errcode === 0

  if (sent) {
    await consumeCredit(openid)
    await updateSendStatus(openid, 'success', 0, {
      errmsg: normalized.errmsg || 'ok',
      data: { notificationLastSentAt: db.serverDate() }
    })
  } else if (isUnauthorizedErrcode(normalized.errcode)) {
    await clearCredits(openid)
    await updateSendStatus(openid, 'unauthorized', normalized.errcode, {
      errmsg: normalized.errmsg
    })
  } else {
    await updateSendStatus(openid, 'failed', normalized.errcode, {
      errmsg: normalized.errmsg
    })
  }

  await addLog({
    _openid: openid,
    type: 'generation_done',
    status: sent ? 'success' : 'failed',
    templateId,
    taskId: payload.taskId || '',
    historyId: payload.historyId || '',
    featureId: payload.featureId || '',
    page,
    data,
    errcode: normalized.errcode,
    errmsg: normalized.errmsg
  })

  return success({
    sent,
    errcode: normalized.errcode,
    errmsg: normalized.errmsg
  })
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const action = event.action || ''
  const openid = wxContext.OPENID || event.openid || event._openid || ''

  try {
    if (action === 'getConfig') {
      const config = await readConfig()
      return success({
        config: {
          generationDoneTemplateId: config.generationDoneTemplateId,
          grantCredits: config.generationDoneGrantCredits
        }
      })
    }
    if (action === 'grantCredits') {
      return grantCredits(openid, event)
    }
    if (action === 'sendGenerationDone') {
      return sendGenerationDone(event)
    }
    return failure('UNKNOWN_ACTION', 'unknown action')
  } catch (err) {
    console.error('[notification] error', err)
    return failure('SERVER_ERROR', err.message || 'notification error')
  }
}
