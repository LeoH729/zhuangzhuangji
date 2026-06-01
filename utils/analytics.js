function report(eventName, data = {}) {
  if (!eventName || typeof wx === 'undefined') {
    return
  }

  try {
    const payload = {
      ...data,
      ts: Date.now()
    }
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

module.exports = {
  report
}
