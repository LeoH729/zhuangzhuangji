const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function claimJob(jobId) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('template_publish_jobs').doc(jobId)
    const current = await ref.get().catch(() => null)
    if (!current || !current.data || current.data.status !== 'scheduled') return null
    await ref.update({ data: { status: 'publishing', startedAt: db.serverDate(), updatedAt: db.serverDate() } })
    return current.data
  })
}

async function publishJob(jobId, job) {
  const templateRef = db.collection('ai_features').doc(job.templateId)
  const currentRes = await templateRef.get()
  if (!currentRes.data) throw new Error('模板不存在')
  const countRes = await db.collection('template_versions').where({ templateId: job.templateId }).count()
  const versionNumber = (countRes.total || 0) + 1
  const versionRes = await db.collection('template_versions').add({
    data: {
      templateId: job.templateId,
      versionNumber,
      versionNote: job.versionNote,
      snapshot: job.snapshot,
      status: 'published',
      publishJobId: jobId,
      publishedBy: job.createdBy || 'system:scheduler',
      publishedAt: db.serverDate(),
      createdAt: db.serverDate()
    }
  })
  await templateRef.update({
    data: {
      ...job.snapshot,
      status: 1,
      lifecycle_status: 'published',
      draft_data: _.remove(),
      has_draft: false,
      draft_updatedAt: _.remove(),
      draftBy: _.remove(),
      scheduledPublishAt: _.remove(),
      publishedVersionId: versionRes._id,
      publishedVersionNumber: versionNumber,
      publishedAt: db.serverDate(),
      publishedBy: job.createdBy || 'system:scheduler',
      updatedAt: db.serverDate()
    }
  })
  await db.collection('template_publish_jobs').doc(jobId).update({
    data: { status: 'published', versionId: versionRes._id, versionNumber, finishedAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  await db.collection('audit_logs').add({
    data: {
      action: 'scheduledPublishFeature',
      operatorUid: job.createdBy || 'system:scheduler',
      operatorRole: 'system',
      targetId: job.templateId,
      success: true,
      resultCode: 'OK',
      createdAt: db.serverDate()
    }
  })
  return { jobId, templateId: job.templateId, versionId: versionRes._id, versionNumber }
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  if (wxContext && wxContext.OPENID) return { success: false, code: 'FORBIDDEN' }
  const due = await db.collection('template_publish_jobs')
    .where({ status: 'scheduled', scheduledAtMs: _.lte(Date.now()) })
    .limit(20)
    .get()
  const results = []
  for (const item of (due.data || [])) {
    const job = await claimJob(item._id)
    if (!job) continue
    try {
      results.push(await publishJob(item._id, job))
    } catch (error) {
      await db.collection('template_publish_jobs').doc(item._id).update({
        data: { status: 'failed', errorMessage: error.message, finishedAt: db.serverDate(), updatedAt: db.serverDate() }
      }).catch(() => null)
      await db.collection('audit_logs').add({ data: { action: 'scheduledPublishFeature', operatorUid: job.createdBy || 'system:scheduler', operatorRole: 'system', targetId: job.templateId, success: false, resultCode: 'FAILED', errorMessage: error.message, createdAt: db.serverDate() } }).catch(() => null)
    }
  }
  return { success: true, processed: results.length, results }
}
