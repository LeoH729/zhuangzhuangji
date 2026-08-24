const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALIASES = {
  feature_detail_view: 'template_detail_view',
  generate_click: 'template_generate_click',
  generation_submit: 'generation_submitted',
  generation_success: 'generation_succeeded'
}

const ALLOWED_EVENTS = new Set([
  'app_open',
  'template_detail_view',
  'template_generate_click',
  'generation_submitted',
  'generation_succeeded',
  'generation_failed',
  'original_save_click',
  'original_save_succeeded',
  'original_save_failed',
  'hd_save_click',
  'hd_save_succeeded',
  'hd_save_failed',
  'points_page_view',
  'recharge_click',
  'recharge_succeeded',
  'recharge_failed'
])

const ALLOWED_FIELDS = [
  'session_id', 'app_version', 'template_id', 'template_version_id', 'template_name',
  'generation_id', 'result_id', 'save_variant', 'channel', 'scene_code',
  'referrer_app_id', 'campaign_id', 'zone', 'category_id', 'source_page',
  'provider', 'model_route', 'duration_ms', 'error_code', 'error_type',
  'package_id', 'product_id', 'package_label', 'price_cents', 'points_amount',
  'order_no', 'failure_stage'
]

function cleanString(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function dateKey(timestamp) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

function normalizeEvent(raw = {}, actorId = '') {
  const originalName = cleanString(raw.event_name || raw.eventName, 64)
  const eventName = ALIASES[originalName] || originalName
  if (!ALLOWED_EVENTS.has(eventName)) return null

  const now = Date.now()
  const requestedAt = Number(raw.occurred_at || raw.occurredAt || raw.ts || now)
  const occurredAtMs = Number.isFinite(requestedAt) && Math.abs(requestedAt - now) < 7 * 24 * 60 * 60 * 1000
    ? requestedAt
    : now
  const eventId = cleanString(raw.event_id || raw.eventId, 96)
  if (!eventId) return null

  const source = raw.properties && typeof raw.properties === 'object' ? raw.properties : raw
  const data = {
    eventId,
    eventName,
    originalEventName: originalName,
    actorId,
    occurredAtMs,
    occurredAt: new Date(occurredAtMs),
    date: dateKey(occurredAtMs),
    receivedAt: db.serverDate()
  }

  ALLOWED_FIELDS.forEach((field) => {
    const camelField = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    let value = source[field] != null ? source[field] : source[camelField]
    if (field === 'template_id' && value == null) value = source.feature_id || source.featureId
    if (field === 'template_name' && value == null) value = source.feature_name || source.featureName
    if (field === 'generation_id' && value == null) value = source.task_id || source.taskId
    if (field === 'result_id' && value == null) value = source.history_id || source.historyId
    if (value == null || value === '') return
    data[camelField] = typeof value === 'number' ? value : cleanString(value)
  })
  return data
}

async function markFirstSeen(actorId, event) {
  if (event.eventName !== 'app_open') return false
  try {
    return await db.runTransaction(async (transaction) => {
      const ref = transaction.collection('analytics_users').doc(actorId)
      const current = await ref.get().catch(() => null)
      if (current && current.data) return false
      await ref.set({ data: {
        actorId,
        firstSeenAt: event.occurredAt,
        firstSeenDate: event.date,
        channel: event.channel || 'unknown',
        createdAt: db.serverDate()
      } })
      return true
    })
  } catch (_) {
    return false
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const actorId = cleanString(wxContext.OPENID || '', 96)
  if (!actorId) return { success: false, code: 'NOT_LOGIN', message: '缺少用户身份' }

  const items = Array.isArray(event.events) ? event.events.slice(0, 20) : [event]
  const normalized = items.map((item) => normalizeEvent(item, actorId)).filter(Boolean)
  if (!normalized.length) return { success: false, code: 'NO_VALID_EVENTS', message: '没有可写入的事件' }

  let accepted = 0
  let duplicated = 0
  for (const item of normalized) {
    item.isNewUser = await markFirstSeen(actorId, item)
    try {
      const inserted = await db.runTransaction(async (transaction) => {
        const ref = transaction.collection('analytics_events').doc(item.eventId)
        const current = await ref.get().catch(() => null)
        if (current && current.data) return false
        await ref.set({ data: item })
        return true
      })
      if (inserted) accepted += 1
      else duplicated += 1
    } catch (_) {
      duplicated += 1
    }
  }
  return { success: true, accepted, duplicated }
}
