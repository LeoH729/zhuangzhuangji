const EVENT_ALIASES = {
  feature_detail_view: 'template_detail_view',
  generate_click: 'template_generate_click',
  generation_submit: 'generation_submitted',
  generation_success: 'generation_succeeded'
}
const { REFERRER_APP_CHANNELS } = require('../config/analytics.js')

let analyticsContext = {}
let pendingEvents = []
let flushTimer = null
let analyticsReady = false
let persistedEventsLoaded = false
const FAILED_EVENTS_KEY = 'analytics_pending_events_v2'
const MAX_PERSISTED_EVENTS = 60
const CHANNELS = new Set(['app_jump', 'recent_tasks', 'mobile_search', 'official_account', 'mini_program_jump', 'share', 'qr_code', 'direct', 'other', 'unknown'])

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function classifyChannel(options = {}) {
  const query = options.query || {}
  if (query.channel || query.campaign_id) {
    const explicitChannel = String(query.channel || 'other')
    return CHANNELS.has(explicitChannel) ? explicitChannel : 'other'
  }
  const referrerAppId = options.referrerInfo && options.referrerInfo.appId || ''
  if (referrerAppId && REFERRER_APP_CHANNELS[referrerAppId]) return REFERRER_APP_CHANNELS[referrerAppId]
  if (referrerAppId) return 'mini_program_jump'
  const scene = Number(options.scene || 0)
  if ([1036, 1069].includes(scene)) return 'app_jump'
  if ([1001, 1089, 1103, 1104].includes(scene)) return 'recent_tasks'
  if ([1027, 1058, 1096].includes(scene)) return 'official_account'
  if ([1005, 1006, 1042, 1090].includes(scene)) return 'mobile_search'
  if ([1007, 1008, 1044, 1096].includes(scene)) return 'share'
  if ([1011, 1012, 1013, 1047, 1048, 1049].includes(scene)) return 'qr_code'
  if ([1000, 1023].includes(scene)) return 'direct'
  return scene ? 'other' : 'unknown'
}

function createLaunchContext(options = {}, appVersion = '') {
  const query = options.query || {}
  return {
    session_id: makeId(),
    app_version: appVersion,
    channel: classifyChannel(options),
    scene_code: Number(options.scene || 0),
    referrer_app_id: options.referrerInfo && options.referrerInfo.appId || '',
    campaign_id: query.campaign_id || query.campaignId || ''
  }
}

function setAnalyticsContext(context = {}) {
  analyticsContext = { ...analyticsContext, ...context }
}

function persistPendingEvents() {
  if (typeof wx === 'undefined' || !wx.setStorage) return
  const events = pendingEvents.slice(-MAX_PERSISTED_EVENTS)
  wx.setStorage({ key: FAILED_EVENTS_KEY, data: events, fail: () => {} })
}

function loadPersistedEvents() {
  if (persistedEventsLoaded || typeof wx === 'undefined' || !wx.getStorage) return
  persistedEventsLoaded = true
  wx.getStorage({
    key: FAILED_EVENTS_KEY,
    success: (res) => {
      const stored = Array.isArray(res.data) ? res.data : []
      pendingEvents = stored.slice(-MAX_PERSISTED_EVENTS).concat(pendingEvents).slice(-MAX_PERSISTED_EVENTS)
      if (analyticsReady) scheduleFlush(100)
    },
    fail: () => {}
  })
}

function scheduleFlush(delay = 800) {
  if (!analyticsReady || flushTimer || !pendingEvents.length) return
  flushTimer = setTimeout(flushEvents, delay)
}

function flushEvents() {
  flushTimer = null
  if (!analyticsReady || !pendingEvents.length || typeof wx === 'undefined' || !wx.cloud) return
  const events = pendingEvents.splice(0, 20)
  wx.cloud.callFunction({
    name: 'analyticsIngest',
    data: { events }
  }).then(() => {
    if (pendingEvents.length) persistPendingEvents()
    else if (typeof wx.removeStorage === 'function') wx.removeStorage({ key: FAILED_EVENTS_KEY, fail: () => {} })
  }).catch((err) => {
    pendingEvents = events.concat(pendingEvents).slice(-MAX_PERSISTED_EVENTS)
    persistPendingEvents()
    console.warn('[analytics] ingest failed', err)
  })
  if (pendingEvents.length) scheduleFlush(800)
}

function enqueue(eventName, payload) {
  pendingEvents.push({
    event_id: makeId(),
    event_name: EVENT_ALIASES[eventName] || eventName,
    occurred_at: Date.now(),
    properties: payload
  })
  if (!analyticsReady) return
  if (pendingEvents.length >= 5) {
    flushEvents()
  } else {
    scheduleFlush(800)
  }
}

function markAnalyticsReady() {
  if (analyticsReady) return
  analyticsReady = true
  loadPersistedEvents()
  scheduleFlush(100)
}

function flushAnalyticsOnHide() {
  if (!pendingEvents.length) return
  persistPendingEvents()
  if (analyticsReady) flushEvents()
}

function report(eventName, data = {}) {
  if (!eventName || typeof wx === 'undefined') {
    return
  }

  try {
    const payload = Object.assign({}, analyticsContext, data, {
      ts: Date.now()
    })
    enqueue(eventName, payload)
    if (typeof wx.reportEvent === 'function') {
      wx.reportEvent(eventName, payload)
      return
    }
    if (typeof wx.reportAnalytics === 'function') {
      wx.reportAnalytics(eventName, payload)
    }
  } catch (err) {
    console.warn('[analytics] report failed', eventName, err)
  }
}

function normalizeGenerationErrorType(message = '') {
  const text = String(message || '').toLowerCase()
  if (text.indexOf('timeout') >= 0 || text.indexOf('超时') >= 0 || text.indexOf('瓒呮椂') >= 0) {
    return 'timeout'
  }
  if (
    text.indexOf('network') >= 0 ||
    text.indexOf('socket') >= 0 ||
    text.indexOf('econn') >= 0 ||
    text.indexOf('网络') >= 0 ||
    text.indexOf('缃戠粶') >= 0
  ) {
    return 'network'
  }
  if (
    text.indexOf('config') >= 0 ||
    text.indexOf('模型配置') >= 0 ||
    text.indexOf('妯″瀷閰嶇疆') >= 0 ||
    text.indexOf('api key') >= 0
  ) {
    return 'config'
  }
  if (
    text.indexOf('upstream') >= 0 ||
    text.indexOf('上游') >= 0 ||
    text.indexOf('涓婃父') >= 0 ||
    text.indexOf('任务失败') >= 0 ||
    text.indexOf('failed') >= 0
  ) {
    return 'upstream_failed'
  }
  return 'unknown'
}

function reportGenerationFailed(task = {}, source = '') {
  report('generation_failed', {
    feature_id: task.featureId || '',
    template_version_id: task.templateVersionId || task.templateVersionIdSnapshot || '',
    task_id: task.taskId || task.id || '',
    provider: task.provider || '',
    model_call_id: task.modelCallId || '',
    template_type: task.templateType || '',
    source,
    error_type: normalizeGenerationErrorType(task.errorMessage || task.fallbackErrorMessage || task.primaryErrorMessage || ''),
    duration_ms: task.totalDurationMs || 0,
    fallback_used: task.fallbackUsed ? 1 : 0,
    active_model_role: task.activeModelRole || ''
  })
}

module.exports = {
  report,
  setAnalyticsContext,
  createLaunchContext,
  classifyChannel,
  flushEvents,
  markAnalyticsReady,
  flushAnalyticsOnHide,
  normalizeGenerationErrorType,
  reportGenerationFailed
}
