function report(eventName, data = {}) {
  if (!eventName || typeof wx === 'undefined') {
    return
  }

  try {
    const payload = Object.assign({}, data, {
      ts: Date.now()
    })
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
  normalizeGenerationErrorType,
  reportGenerationFailed
}
