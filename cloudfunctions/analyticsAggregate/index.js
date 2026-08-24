const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const DAY_MS = 24 * 60 * 60 * 1000
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

function dateKey(timestamp = Date.now()) {
  return new Date(timestamp + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

function dayRange(date) {
  const start = Date.parse(`${date}T00:00:00+08:00`)
  return { start, end: start + DAY_MS }
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex')
}

async function fetchAll(collection, where) {
  const rows = []
  for (let skip = 0; ; skip += 100) {
    const result = await db.collection(collection).where(where).skip(skip).limit(100).get()
    rows.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  return rows
}

function groupBy(rows, keyFn) {
  const groups = new Map()
  rows.forEach((row) => {
    const key = keyFn(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })
  return groups
}

function count(rows, eventName) {
  return rows.filter((row) => row.eventName === eventName).length
}

function unique(rows, eventName, field = 'actorId') {
  return new Set(rows.filter((row) => row.eventName === eventName && row[field]).map((row) => row[field])).size
}

async function replaceMetric(collection, id, data) {
  await db.collection(collection).doc(id).set({ data })
}

async function aggregateDate(date) {
  const { start, end } = dayRange(date)
  const [events, jobs] = await Promise.all([
    fetchAll('analytics_events', { occurredAtMs: _.gte(start).and(_.lt(end)) }),
    fetchAll('generation_tasks', { createdAt: _.gte(new Date(start)).and(_.lt(new Date(end))), source: _.neq('admin_debug') })
  ])
  const updatedAt = db.serverDate()
  const activeUsers = unique(events, 'app_open')
  const newUsers = new Set(events.filter((row) => row.eventName === 'app_open' && row.isNewUser && row.actorId).map((row) => row.actorId)).size
  const templateUsers = unique(events, 'template_generate_click')
  const originalSaveUsers = unique(events, 'original_save_click')
  await replaceMetric('daily_app_metrics', date, {
    date,
    active_user_count: activeUsers,
    new_user_count: newUsers,
    template_user_count: templateUsers,
    template_reach_rate: rate(templateUsers, activeUsers),
    original_save_user_count: originalSaveUsers,
    is_provisional: date === dateKey(),
    updatedAt
  })

  const templateGroups = groupBy(events.filter((row) => row.templateId), (row) => row.templateId)
  for (const [templateId, rows] of templateGroups.entries()) {
    const detailViews = count(rows, 'template_detail_view')
    const generateClicks = count(rows, 'template_generate_click')
    const originalClicks = count(rows, 'original_save_click')
    const hdClicks = count(rows, 'hd_save_click')
    const submitted = count(rows, 'generation_submitted')
    const succeeded = count(rows, 'generation_succeeded')
    const latest = rows.reduce((result, row) => row.occurredAtMs > (result.occurredAtMs || 0) ? row : result, {})
    await replaceMetric('daily_template_metrics', stableId(date, templateId), {
      date,
      template_id: templateId,
      template_version_id: latest.templateVersionId || '',
      detail_view_count: detailViews,
      detail_view_user_count: unique(rows, 'template_detail_view'),
      generate_click_count: generateClicks,
      generate_click_user_count: unique(rows, 'template_generate_click'),
      original_save_click_count: originalClicks,
      original_save_user_count: unique(rows, 'original_save_click'),
      original_save_success_count: count(rows, 'original_save_succeeded'),
      hd_save_click_count: hdClicks,
      hd_save_user_count: unique(rows, 'hd_save_click'),
      hd_save_success_count: count(rows, 'hd_save_succeeded'),
      template_usage_rate: rate(generateClicks, detailViews),
      hd_save_rate: rate(hdClicks, originalClicks),
      generation_submitted_count: submitted,
      generation_succeeded_count: succeeded,
      generation_success_rate: rate(succeeded, submitted),
      updatedAt
    })
  }

  const channelGroups = groupBy(events, (row) => row.channel || 'unknown')
  for (const [channel, rows] of channelGroups.entries()) {
    const detailViews = count(rows, 'template_detail_view')
    const generateClicks = count(rows, 'template_generate_click')
    await replaceMetric('daily_channel_metrics', stableId(date, channel), {
      date,
      channel,
      detail_view_count: detailViews,
      generate_click_count: generateClicks,
      template_usage_rate: rate(generateClicks, detailViews),
      updatedAt
    })
  }

  const submittedJobs = jobs.length
  const succeededJobs = jobs.filter((job) => job.status === 'succeeded').length
  const failedJobs = jobs.filter((job) => job.status === 'failed').length
  const failedByReason = {}
  jobs.filter((job) => job.status === 'failed').forEach((job) => {
    const reason = job.errorCode || job.errorMessage || 'unknown'
    failedByReason[reason] = (failedByReason[reason] || 0) + 1
  })
  await replaceMetric('daily_generation_metrics', date, {
    date,
    submitted_count: submittedJobs,
    succeeded_count: succeededJobs,
    failed_count: failedJobs,
    generation_success_rate: rate(succeededJobs, submittedJobs),
    failed_by_reason: failedByReason,
    authoritative_source: 'generation_tasks',
    updatedAt
  })
  return { date, eventCount: events.length, jobCount: jobs.length }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  if (wxContext && wxContext.OPENID) return { success: false, code: 'FORBIDDEN', message: '汇总任务仅允许定时器或服务端调用' }
  const jobId = stableId('rollup', Date.now(), Math.random())
  await db.collection('analytics_sync_jobs').doc(jobId).set({
    data: { jobId, type: 'daily_rollup', status: 'running', startedAt: db.serverDate() }
  })
  try {
    const dates = Array.isArray(event.dates) && event.dates.length
      ? event.dates.slice(0, 31)
      : [dateKey(Date.now() - DAY_MS), dateKey()]
    const results = []
    for (const date of dates) results.push(await aggregateDate(date))
    const retentionCutoff = Date.now() - 180 * DAY_MS
    const expired = await db.collection('analytics_events')
      .where({ occurredAtMs: _.lt(retentionCutoff) })
      .limit(100)
      .get()
    if (expired.data && expired.data.length) {
      await Promise.all(expired.data.map((item) => db.collection('analytics_events').doc(item._id).remove()))
    }
    await db.collection('analytics_sync_jobs').doc(jobId).update({
      data: { status: 'succeeded', results, expiredEventsRemoved: expired.data?.length || 0, finishedAt: db.serverDate() }
    })
    return { success: true, jobId, results }
  } catch (error) {
    await db.collection('analytics_sync_jobs').doc(jobId).update({
      data: { status: 'failed', errorMessage: error.message, finishedAt: db.serverDate() }
    }).catch(() => null)
    return { success: false, jobId, error: error.message }
  }
}
