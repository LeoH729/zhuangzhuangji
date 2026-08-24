const cloud = require('wx-server-sdk')
const tcb = require('@cloudbase/node-sdk')

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloudbase-5gmfinom29f48930'
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const app = tcb.init({ env: ENV_ID })
const auth = app.auth()
const ANALYTICS_PERMISSION = 'analytics.read'
const ROLES_WITH_ANALYTICS = ['super_admin', 'admin', 'template_editor', 'operator', 'finance', 'readonly_analyst']

function success(data = {}) {
  return { success: true, ...data }
}

function failure(code, message) {
  return { success: false, code, message }
}

async function requireAdmin() {
  const identity = auth.getUserInfo()
  const wxContext = cloud.getWXContext()
  const uid = identity && (identity.uid || identity.customUserId || identity.openId)
  const openid = (identity && identity.openId) || (wxContext && wxContext.OPENID) || ''
  if (!uid && !openid) return null
  const conditions = [{ uid: uid || openid, status: _.neq(0) }]
  if (openid && openid !== uid) conditions.push({ openid, status: _.neq(0) })
  for (const condition of conditions) {
    const res = await db.collection('admin_users').where(condition).limit(1).get()
    if (res.data && res.data[0]) return res.data[0]
  }
  return null
}

function validDate(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback
}

function dateKey(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function parseDashboardWindow(payload = {}) {
  const today = dateKey(Date.now())
  const legacyBusinessDate = payload.startDate === payload.endDate ? payload.startDate : payload.endDate
  const businessDate = validDate(payload.business_date || payload.businessDate || legacyBusinessDate, today)
  const businessStartMs = Date.parse(`${businessDate}T00:00:00+08:00`)
  const businessEndExclusiveMs = businessStartMs + 24 * 60 * 60 * 1000
  if (!Number.isFinite(businessStartMs) || businessDate > today) throw new Error('业务日期不合法')
  const requestedTrendDays = Number(payload.trend_days || payload.trendDays || 7)
  const trendDays = [7, 15, 30].includes(requestedTrendDays) ? requestedTrendDays : 7
  const requestedPaymentDays = Number(payload.payment_days || payload.paymentDays || trendDays)
  const paymentDays = [1, 7, 15, 30].includes(requestedPaymentDays) ? requestedPaymentDays : trendDays
  const eventDays = Math.max(trendDays, paymentDays)
  const trendStartMs = businessStartMs - (trendDays - 1) * 24 * 60 * 60 * 1000
  const paymentStartMs = businessStartMs - (paymentDays - 1) * 24 * 60 * 60 * 1000
  const eventStartMs = businessStartMs - (eventDays - 1) * 24 * 60 * 60 * 1000
  return {
    businessDate,
    businessStartMs,
    businessEndExclusiveMs,
    trendDays,
    paymentDays,
    trendStartMs,
    paymentStartMs,
    startDate: dateKey(trendStartMs),
    endDate: businessDate,
    startMs: eventStartMs,
    endExclusiveMs: businessEndExclusiveMs
  }
}

async function fetchAll(collectionName, query, max = 10000) {
  const rows = []
  for (let skip = 0; skip < max; skip += 100) {
    const res = await db.collection(collectionName).where(query).skip(skip).limit(100).get()
    rows.push(...(res.data || []))
    if (!res.data || res.data.length < 100) break
  }
  return rows
}

function distinctCount(rows, key) {
  return new Set(rows.map((item) => item[key]).filter(Boolean)).size
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null
}

function groupBy(rows, getter) {
  return rows.reduce((map, item) => {
    const key = getter(item) || 'unknown'
    if (!map[key]) map[key] = []
    map[key].push(item)
    return map
  }, {})
}

function buildTemplateMetrics(events) {
  const groups = groupBy(events.filter((item) => item.templateId), (item) => item.templateId)
  return Object.entries(groups).map(([templateId, rows]) => {
    const count = (name) => rows.filter((item) => item.eventName === name).length
    const detailViews = count('template_detail_view')
    const generateClicks = count('template_generate_click')
    const originalClicks = count('original_save_click')
    const hdClicks = count('hd_save_click')
    return {
      templateId,
      templateName: rows.find((item) => item.templateName)?.templateName || templateId,
      detailViews,
      detailUsers: distinctCount(rows.filter((item) => item.eventName === 'template_detail_view'), 'actorId'),
      generateClicks,
      generateUsers: distinctCount(rows.filter((item) => item.eventName === 'template_generate_click'), 'actorId'),
      originalSaveClicks: originalClicks,
      originalSaveUsers: distinctCount(rows.filter((item) => item.eventName === 'original_save_click'), 'actorId'),
      originalSaveSuccesses: count('original_save_succeeded'),
      hdSaveClicks: hdClicks,
      hdSaveUsers: distinctCount(rows.filter((item) => item.eventName === 'hd_save_click'), 'actorId'),
      hdSaveSuccesses: count('hd_save_succeeded'),
      usageRate: ratio(generateClicks, detailViews),
      hdSaveRate: ratio(hdClicks, originalClicks),
      updatedAt: new Date(Math.max(...rows.map((item) => item.occurredAtMs || 0))).toISOString()
    }
  })
}

function paymentPackageKey(item = {}) {
  return String(item.packageId || item.package_id || item.productId || item.product_id || 'unknown')
}

function paymentPackageMeta(item = {}, fallbackKey = 'unknown') {
  return {
    package_id: String(item.packageId || item.package_id || fallbackKey),
    product_id: String(item.productId || item.product_id || ''),
    package_label: String(item.packageLabel || item.package_label || ''),
    price_cents: Number(item.priceCents || item.price_cents || 0) || 0,
    points_amount: Number(item.pointsAmount || item.points_amount || 0) || 0
  }
}

function buildPaymentPerformance(events, range) {
  const names = new Set(events.map((item) => item.eventName))
  const windowEvents = events.filter((item) => {
    const occurredAtMs = item.occurredAtMs || 0
    return occurredAtMs >= range.paymentStartMs && occurredAtMs < range.endExclusiveMs
  })
  const views = windowEvents.filter((item) => item.eventName === 'points_page_view')
  const clicks = windowEvents.filter((item) => item.eventName === 'recharge_click')
  const successes = windowEvents.filter((item) => item.eventName === 'recharge_succeeded')
  const failures = windowEvents.filter((item) => item.eventName === 'recharge_failed')
  const packages = {}
  const ensurePackage = (item) => {
    const key = paymentPackageKey(item)
    if (!packages[key]) packages[key] = { ...paymentPackageMeta(item, key), clicks: 0, successes: 0 }
    else {
      const meta = paymentPackageMeta(item, key)
      if (!packages[key].package_label && meta.package_label) packages[key].package_label = meta.package_label
      if (!packages[key].product_id && meta.product_id) packages[key].product_id = meta.product_id
      if (!packages[key].price_cents && meta.price_cents) packages[key].price_cents = meta.price_cents
      if (!packages[key].points_amount && meta.points_amount) packages[key].points_amount = meta.points_amount
    }
    return packages[key]
  }
  clicks.forEach((item) => { ensurePackage(item).clicks += 1 })
  successes.forEach((item) => { ensurePackage(item).successes += 1 })
  const packageRows = Object.values(packages)
    .map((item) => ({ ...item, conversion_rate: ratio(item.successes, item.clicks) }))
    .sort((a, b) => b.clicks - a.clicks || b.successes - a.successes)
  const failureDetails = failures
    .slice()
    .sort((a, b) => (b.occurredAtMs || 0) - (a.occurredAtMs || 0))
    .map((item) => ({
      date: item.date || dateKey(item.occurredAtMs || 0),
      occurred_at: item.occurredAt || (item.occurredAtMs ? new Date(item.occurredAtMs).toISOString() : ''),
      ...paymentPackageMeta(item),
      order_no: String(item.orderNo || item.order_no || ''),
      error_code: String(item.errorCode || item.error_code || ''),
      error_type: String(item.errorType || item.error_type || ''),
      failure_stage: String(item.failureStage || item.failure_stage || '')
    }))
  return {
    payment_days: range.paymentDays,
    page_users: names.has('points_page_view') ? distinctCount(views, 'actorId') : null,
    click_count: names.has('recharge_click') ? clicks.length : null,
    success_count: names.has('recharge_succeeded') ? successes.length : null,
    conversion_rate: names.has('recharge_click') && names.has('recharge_succeeded') ? ratio(successes.length, clicks.length) : null,
    packages: names.has('recharge_click') || names.has('recharge_succeeded') ? packageRows : [],
    failure_details: names.has('recharge_failed') ? failureDetails : []
  }
}

function buildTrend(events, range) {
  const rows = []
  for (let ms = range.trendStartMs; ms < range.endExclusiveMs; ms += 24 * 60 * 60 * 1000) {
    const date = dateKey(ms)
    const dayEvents = events.filter((item) => (item.date || dateKey(item.occurredAtMs || 0)) === date)
    const opens = dayEvents.filter((item) => item.eventName === 'app_open')
    const generate = dayEvents.filter((item) => item.eventName === 'template_generate_click')
    rows.push({
      date,
      activeUsers: distinctCount(opens, 'actorId'),
      newUsers: distinctCount(opens.filter((item) => item.isNewUser), 'actorId'),
      templateUsers: distinctCount(generate, 'actorId'),
      reachRate: ratio(distinctCount(generate, 'actorId'), distinctCount(opens, 'actorId')),
      originalSaveUsers: distinctCount(dayEvents.filter((item) => item.eventName === 'original_save_click'), 'actorId')
    })
  }
  return rows
}

async function getDashboard(payload = {}) {
  const range = parseDashboardWindow(payload)
  let events = []
  let tasks = []
  let eventsAvailable = true
  let tasksAvailable = true
  try {
    events = await fetchAll('analytics_events', {
      occurredAtMs: _.gte(range.startMs).and(_.lt(range.endExclusiveMs))
    })
  } catch (_) { eventsAvailable = false }
  try {
    tasks = await fetchAll('generation_tasks', {
      createdAt: _.gte(new Date(range.businessStartMs)).and(_.lt(new Date(range.businessEndExclusiveMs)))
    })
  } catch (_) { tasksAvailable = false }
  tasks = tasks.filter((item) => item.source !== 'admin_debug')

  const dailyEvents = events.filter((item) => {
    const eventDate = item.date || dateKey(item.occurredAtMs || 0)
    return eventDate === range.businessDate
  })
  const names = new Set(events.map((item) => item.eventName))
  const opens = dailyEvents.filter((item) => item.eventName === 'app_open')
  const detailViews = dailyEvents.filter((item) => item.eventName === 'template_detail_view')
  const generateClicks = dailyEvents.filter((item) => item.eventName === 'template_generate_click')
  const originalClicks = dailyEvents.filter((item) => item.eventName === 'original_save_click')
  const templateMetrics = buildTemplateMetrics(dailyEvents)
  const submitted = tasks.length
  const succeeded = tasks.filter((item) => item.status === 'succeeded').length
  const failed = tasks.filter((item) => item.status === 'failed').length
  const failedByReason = Object.entries(groupBy(tasks.filter((item) => item.status === 'failed'), (item) => item.errorType || item.errorCode || item.errorMessage || 'unknown'))
    .map(([reason, rows]) => ({ reason: String(reason).slice(0, 80), count: rows.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const channelGroups = groupBy(dailyEvents.filter((item) => item.eventName === 'template_detail_view' || item.eventName === 'template_generate_click'), (item) => item.channel)
  const channels = Object.entries(channelGroups).map(([channel, rows]) => {
    const views = rows.filter((item) => item.eventName === 'template_detail_view').length
    const clicks = rows.filter((item) => item.eventName === 'template_generate_click').length
    return { channel, detailViews: views, generateClicks: clicks, usageRate: ratio(clicks, views) }
  }).sort((a, b) => (b.usageRate || 0) - (a.usageRate || 0))

  // missing_events describes an unsupported tracking contract, not a valid event that happened zero times.
  // Optional actions may legitimately have no events in the selected window.
  const requiredEvents = ['app_open', 'template_detail_view', 'template_generate_click', 'original_save_click', 'hd_save_click', 'points_page_view', 'recharge_click', 'recharge_succeeded', 'recharge_failed']
  const supportedEvents = new Set(requiredEvents)
  const missingEvents = eventsAvailable ? requiredEvents.filter((name) => !supportedEvents.has(name)) : requiredEvents
  const dataStatus = eventsAvailable && tasksAvailable
    ? (missingEvents.length ? 'partial' : 'available')
    : (eventsAvailable || tasksAvailable ? 'partial' : 'missing')
  const hasOpenEvent = names.has('app_open')
  const hasDetailEvent = names.has('template_detail_view')
  const hasGenerateEvent = names.has('template_generate_click')
  const hasOriginalSaveEvent = names.has('original_save_click')

  const nowIso = new Date().toISOString()
  const overview = {
    activeUsers: hasOpenEvent ? distinctCount(opens, 'actorId') : null,
    newUsers: hasOpenEvent ? distinctCount(opens.filter((item) => item.isNewUser), 'actorId') : null,
    templateUsers: hasGenerateEvent ? distinctCount(generateClicks, 'actorId') : null,
    templateReachRate: hasGenerateEvent && hasOpenEvent ? ratio(distinctCount(generateClicks, 'actorId'), distinctCount(opens, 'actorId')) : null,
    originalSaveUsers: hasOriginalSaveEvent ? distinctCount(originalClicks, 'actorId') : null,
    totalUsageRate: hasGenerateEvent && hasDetailEvent ? ratio(generateClicks.length, detailViews.length) : null,
    generationSuccessRate: tasksAvailable ? ratio(succeeded, submitted) : null
  }
  const userTrend = hasOpenEvent ? buildTrend(events, range) : []
  const paymentPerformance = buildPaymentPerformance(events, range)
  const templateDetailRankings = [...templateMetrics].sort((a, b) => b.detailViews - a.detailViews).slice(0, 10)
  const templateUsageRankings = [...templateMetrics].filter((item) => item.usageRate != null).sort((a, b) => b.usageRate - a.usageRate).slice(0, 10)
  const hdSaveRankings = [...templateMetrics].filter((item) => item.hdSaveRate != null).sort((a, b) => b.hdSaveRate - a.hdSaveRate).slice(0, 10)
  const generation = {
    submitted: tasksAvailable ? submitted : null,
    succeeded: tasksAvailable ? succeeded : null,
    failed: tasksAvailable ? failed : null,
    successRate: tasksAvailable ? ratio(succeeded, submitted) : null,
    failedByReason
  }
  return success({
    business_date: range.businessDate,
    trend_days: range.trendDays,
    payment_days: range.paymentDays,
    timezone: 'Asia/Shanghai',
    range: { startDate: range.startDate, endDate: range.endDate, timezone: 'Asia/Shanghai' },
    dataStatus,
    data_status: dataStatus,
    updatedAt: nowIso,
    updated_at: nowIso,
    isProvisional: range.businessDate === dateKey(Date.now()),
    is_provisional: range.businessDate === dateKey(Date.now()),
    missingEvents,
    missing_events: missingEvents,
    daily_overview: overview,
    user_trend: userTrend,
    template_funnel: { detail_views: hasDetailEvent ? detailViews.length : null, generate_clicks: hasGenerateEvent ? generateClicks.length : null, usage_rate: overview.totalUsageRate },
    template_detail_rankings: templateDetailRankings,
    template_usage_rankings: templateUsageRankings,
    hd_save_rankings: hdSaveRankings,
    channel_breakdown: channels,
    payment_performance: paymentPerformance,
    generation_performance: {
      submitted_count: generation.submitted,
      succeeded_count: generation.succeeded,
      failed_count: generation.failed,
      success_rate: generation.successRate,
      failure_reasons: failedByReason
    },
    overview,
    userTrend,
    templateDetailRankings,
    templateUsageRankings,
    hdSaveRankings,
    channels,
    generation
  })
}

async function getTemplateObservation(payload = {}) {
  const templateId = String(payload.templateId || '')
  if (!templateId) return failure('BAD_REQUEST', '缺少模板ID')
  const endMs = Date.now()
  const startMs = endMs - 24 * 60 * 60 * 1000
  let events = []
  let tasks = []
  try {
    events = await fetchAll('analytics_events', { templateId, occurredAtMs: _.gte(startMs).and(_.lt(endMs)) })
  } catch (_) {}
  try {
    tasks = await fetchAll('generation_tasks', { featureId: templateId, createdAt: _.gte(new Date(startMs)).and(_.lt(new Date(endMs))) })
  } catch (_) {}
  tasks = tasks.filter((item) => item.source !== 'admin_debug')
  const detailViews = events.filter((item) => item.eventName === 'template_detail_view').length
  const generateClicks = events.filter((item) => item.eventName === 'template_generate_click').length
  const succeeded = tasks.filter((item) => item.status === 'succeeded').length
  const failedTasks = tasks.filter((item) => item.status === 'failed')
  return success({
    templateId,
    windowHours: 24,
    detailViews,
    generateClicks,
    usageRate: ratio(generateClicks, detailViews),
    submitted: tasks.length,
    succeeded,
    failed: failedTasks.length,
    generationSuccessRate: ratio(succeeded, tasks.length),
    anomalies: failedTasks.slice(0, 10).map((item) => ({ taskId: item._id, error: item.errorCode || item.errorMessage || 'unknown', createdAt: item.createdAt })),
    updatedAt: new Date().toISOString()
  })
}

exports.main = async (event = {}) => {
  try {
    const admin = await requireAdmin()
    if (!admin) return failure('NOT_ADMIN', '当前账号无数据看板权限')
    const permissions = Array.isArray(admin.permissions) ? admin.permissions : (ROLES_WITH_ANALYTICS.includes(admin.role || 'admin') ? [ANALYTICS_PERMISSION] : [])
    if (!permissions.includes(ANALYTICS_PERMISSION)) {
      return failure('FORBIDDEN', '当前角色无数据看板权限')
    }
    const action = event.action || 'getDashboardOverview'
    if (action === 'getTemplateObservation') return await getTemplateObservation(event.payload || {})
    if (![
      'getDashboardOverview', 'getDashboardUserTrend', 'getDashboardTemplateRankings',
      'getDashboardHdSaveRankings', 'getDashboardChannelBreakdown', 'getDashboardGenerationPerformance'
    ].includes(action)) return failure('UNKNOWN_ACTION', '未知数据接口')
    return await getDashboard(event.payload || {})
  } catch (err) {
    console.error('[adminAnalytics] error', err)
    return failure('SERVER_ERROR', err.message || '数据统计失败')
  }
}
