const app = getApp()

const POLL_INTERVAL_MS = 8000
const POLL_TIMEOUT_MS = 16 * 60 * 1000
const ENSURE_WORKER_INTERVAL_MS = 30000

Page({
  data: {
    featureId: '',
    images: [],
    progress: 5,
    statusText: '正在提交任务...',
    taskId: ''
  },

  onLoad(options) {
    if (options.featureId && options.images) {
      this.setData({
        featureId: options.featureId,
        images: JSON.parse(decodeURIComponent(options.images))
      })
      this.pollStartedAt = Date.now()
      this.lastEnsureWorkerAt = 0
      this.startProgress()
      this.startAsyncGeneration()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  startProgress() {
    this.progressInterval = setInterval(() => {
      const current = this.data.progress
      if (current < 92) {
        const inc = Math.max(0.4, (95 - current) / 24)
        this.setData({ progress: current + inc })
      }
    }, 800)
  },

  stopProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  },

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  },

  shouldOpenResultForTask(taskId) {
    const pages = getCurrentPages()
    const currentPage = pages && pages.length ? pages[pages.length - 1] : null
    return currentPage === this &&
      currentPage.route === 'pages/analyzing/analyzing' &&
      this.data.taskId === taskId
  },

  // 弃用客户端直调 generationWorker 以免微信客户端 15 秒限制抛出 "Error: timeout" 报错。
  // 现已统一由后台 ensureWorker 异步拉起，更稳定且控制台不再报红。
  triggerWorker(taskId) {
    console.log('[analyzing] triggerWorker 已弃用，由 ensureWorker 异步拉起。')
  },

  async startAsyncGeneration() {
    try {
      const createRes = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'createTask',
          featureId: this.data.featureId,
          imageUrls: this.data.images
        }
      })

      const result = createRes.result
      if (!result || !result.success || !result.taskId) {
        this.stopProgress()
        wx.showToast({ title: result?.error || '提交任务失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 2000)
        return
      }

      this.setData({
        taskId: result.taskId,
        statusText: '任务已提交，AI 正在绘制中...'
      })
      app.trackGenerationTask(result.taskId)

      this.pollInterval = setInterval(() => {
        this.pollTaskStatus(result.taskId)
      }, POLL_INTERVAL_MS)

      this.pollTaskStatus(result.taskId)
    } catch (err) {
      console.error(err)
      this.stopProgress()
      wx.showToast({ title: '网络错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 2000)
    }
  },

  async pollTaskStatus(taskId) {
    if (this.isPollingRequest) {
      return
    }

    if (Date.now() - this.pollStartedAt > POLL_TIMEOUT_MS) {
      this.stopPolling()
      this.stopProgress()
      wx.showModal({
        title: '生成时间较长',
        content: '任务仍在后台执行，你可以返回上一页稍后在历史记录中查看结果。',
        confirmText: '继续等待',
        cancelText: '返回',
        success: (res) => {
          if (res.confirm) {
            this.pollStartedAt = Date.now()
            this.startProgress()
            this.pollInterval = setInterval(() => {
              this.pollTaskStatus(taskId)
            }, POLL_INTERVAL_MS)
            this.pollTaskStatus(taskId)
          } else {
            wx.navigateBack()
          }
        }
      })
      return
    }

    this.isPollingRequest = true
    try {
      const statusRes = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'getTaskStatus',
          taskId
        }
      })

      const result = statusRes.result
      if (!result || !result.success || !result.task) {
        return
      }

      const task = result.task
      if (task.status === 'pending' || task.status === 'running') {
        const now = Date.now()
        const shouldEnsureWorker =
          task.status === 'pending' &&
          now - this.pollStartedAt > 15000 &&
          now - (this.lastEnsureWorkerAt || 0) > ENSURE_WORKER_INTERVAL_MS
        if (shouldEnsureWorker) {
          this.lastEnsureWorkerAt = now
          wx.cloud.callFunction({
            name: 'aiGenerate',
            data: {
              action: 'ensureWorker',
              taskId
            }
          }).catch((err) => {
            console.error('[analyzing] ensureWorker failed', err)
          })
        }
        this.setData({
          statusText: task.status === 'running' ? 'AI 正在绘制中...' : '任务排队中...'
        })
        return
      }

      this.stopPolling()
      this.stopProgress()

      if (task.status === 'succeeded') {
        app.finishTrackedGenerationTask(taskId, { silent: true })
        this.setData({ progress: 100, statusText: '生成完成' })
        setTimeout(() => {
          if (!this.shouldOpenResultForTask(taskId)) {
            return
          }
          wx.redirectTo({
            url: `/pages/result/result?id=${task.historyId}&url=${encodeURIComponent(task.resultUrl)}`
          })
        }, 500)
        return
      }

      if (task.status === 'failed') {
        app.finishTrackedGenerationTask(taskId, { silent: true })
        wx.showToast({
          title: task.errorMessage || '生成失败',
          icon: 'none'
        })
        setTimeout(() => wx.navigateBack(), 2000)
      }
    } catch (err) {
      console.error('[analyzing] poll failed', err)
    } finally {
      this.isPollingRequest = false
    }
  },

  onUnload() {
    this.stopProgress()
    this.stopPolling()
  },

  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    })
  }
})
