const app = getApp()
const { report } = require('../../utils/analytics.js')

const POLL_INTERVAL_MS = 8000
const POLL_TIMEOUT_MS = 16 * 60 * 1000
const ENSURE_WORKER_INTERVAL_MS = 30000
const SNAKE_GRID_SIZE = 16
const SNAKE_TICK_MS = 220

Page({
  data: {
    featureId: '',
    images: [],
    inputValues: {},
    progress: 5,
    progressText: '5',
    elapsedText: '00:00',
    statusText: '正在提交任务...',
    taskId: '',
    resultReady: false,
    resultUrl: '',
    resultHistoryId: '',
    snakeCells: [],
    snakeScore: 0,
    snakeBest: 0,
    snakeGameOver: false
  },

  onLoad(options) {
    this.initSnakeGame()
    if (options.featureId) {
      const images = options.images ? JSON.parse(decodeURIComponent(options.images)) : []
      const inputValues = options.inputValues ? JSON.parse(decodeURIComponent(options.inputValues)) : {}
      this.setData({
        featureId: options.featureId,
        images,
        inputValues
      })
      this.pollStartedAt = Date.now()
      this.lastEnsureWorkerAt = 0
      this.hasReportedLeave = false
      report('generation_wait_view', {
        feature_id: options.featureId,
        source: 'analyzing'
      })
      this.startProgress()
      this.startAsyncGeneration()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  onShow() {
    if (this.snakeReady && !this.data.snakeGameOver) {
      this.startSnakeLoop()
    }
  },

  onHide() {
    this.stopSnakeLoop()
  },

  initSnakeGame() {
    this.snakeReady = true
    this.setData({
      snakeBest: wx.getStorageSync('snake_wait_best') || 0
    })
    this.resetSnakeGame()
  },

  resetSnakeGame() {
    const middle = Math.floor(SNAKE_GRID_SIZE / 2)
    this.snake = [
      { x: middle, y: middle },
      { x: middle - 1, y: middle },
      { x: middle - 2, y: middle }
    ]
    this.snakeDirection = { x: 1, y: 0 }
    this.snakeNextDirection = { x: 1, y: 0 }
    this.snakeFood = this.createSnakeFood()
    this.setData({
      snakeScore: 0,
      snakeGameOver: false,
      snakeCells: this.buildSnakeCells()
    })
    this.startSnakeLoop()
  },

  startSnakeLoop() {
    if (this.snakeTimer || !this.snakeReady) return
    this.snakeTimer = setInterval(() => {
      this.stepSnakeGame()
    }, SNAKE_TICK_MS)
  },

  stopSnakeLoop() {
    if (this.snakeTimer) {
      clearInterval(this.snakeTimer)
      this.snakeTimer = null
    }
  },

  buildSnakeCells() {
    const snakeMap = {}
    ;(this.snake || []).forEach((part, index) => {
      snakeMap[`${part.x}_${part.y}`] = index === 0 ? 'head' : 'body'
    })

    const cells = []
    for (let y = 0; y < SNAKE_GRID_SIZE; y += 1) {
      for (let x = 0; x < SNAKE_GRID_SIZE; x += 1) {
        const key = `${x}_${y}`
        let type = snakeMap[key] || 'empty'
        if (this.snakeFood && this.snakeFood.x === x && this.snakeFood.y === y) {
          type = 'food'
        }
        cells.push({ key, type })
      }
    }
    return cells
  },

  createSnakeFood() {
    const occupied = {}
    ;(this.snake || []).forEach(part => {
      occupied[`${part.x}_${part.y}`] = true
    })

    let food = { x: 0, y: 0 }
    let guard = 0
    do {
      food = {
        x: Math.floor(Math.random() * SNAKE_GRID_SIZE),
        y: Math.floor(Math.random() * SNAKE_GRID_SIZE)
      }
      guard += 1
    } while (occupied[`${food.x}_${food.y}`] && guard < 200)
    return food
  },

  stepSnakeGame() {
    if (this.data.snakeGameOver) return

    this.snakeDirection = this.snakeNextDirection
    const head = this.snake[0]
    const nextHead = {
      x: head.x + this.snakeDirection.x,
      y: head.y + this.snakeDirection.y
    }

    const hitWall =
      nextHead.x < 0 ||
      nextHead.y < 0 ||
      nextHead.x >= SNAKE_GRID_SIZE ||
      nextHead.y >= SNAKE_GRID_SIZE
    const willEatFood = nextHead.x === this.snakeFood.x && nextHead.y === this.snakeFood.y
    const bodyToCheck = willEatFood ? this.snake : this.snake.slice(0, -1)
    const hitSelf = bodyToCheck.some(part => part.x === nextHead.x && part.y === nextHead.y)

    if (hitWall || hitSelf) {
      this.stopSnakeLoop()
      this.setData({
        snakeGameOver: true,
        snakeCells: this.buildSnakeCells()
      })
      return
    }

    this.snake.unshift(nextHead)
    const nextData = {}
    if (willEatFood) {
      const nextScore = this.data.snakeScore + 1
      const nextBest = Math.max(this.data.snakeBest, nextScore)
      wx.setStorageSync('snake_wait_best', nextBest)
      this.snakeFood = this.createSnakeFood()
      nextData.snakeScore = nextScore
      nextData.snakeBest = nextBest
    } else {
      this.snake.pop()
    }

    nextData.snakeCells = this.buildSnakeCells()
    this.setData(nextData)
  },

  onSnakeTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.snakeTouchStart = { x: touch.clientX, y: touch.clientY }
  },

  onSnakeTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch || !this.snakeTouchStart) return
    const deltaX = touch.clientX - this.snakeTouchStart.x
    const deltaY = touch.clientY - this.snakeTouchStart.y
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 18) return

    const nextDirection = Math.abs(deltaX) > Math.abs(deltaY)
      ? { x: deltaX > 0 ? 1 : -1, y: 0 }
      : { x: 0, y: deltaY > 0 ? 1 : -1 }
    this.setSnakeDirection(nextDirection)
    this.snakeTouchStart = { x: touch.clientX, y: touch.clientY }
  },

  setSnakeDirection(nextDirection) {
    const current = this.snakeDirection || { x: 1, y: 0 }
    const isReverse = current.x + nextDirection.x === 0 && current.y + nextDirection.y === 0
    if (!isReverse) {
      this.snakeNextDirection = nextDirection
    }
  },

  startProgress() {
    this.progressInterval = setInterval(() => {
      const current = this.data.progress
      if (current < 92) {
        const inc = Math.max(0.4, (95 - current) / 24)
        const nextProgress = current + inc
        this.setData({
          progress: nextProgress,
          progressText: String(Math.round(nextProgress))
        })
      }
    }, 800)
  },

  stopProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  },

  formatElapsedTime(elapsedMs) {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const minuteText = minutes < 10 ? `0${minutes}` : String(minutes)
    const secondText = seconds < 10 ? `0${seconds}` : String(seconds)
    return `${minuteText}:${secondText}`
  },

  startGenerationTimer() {
    this.stopGenerationTimer()
    this.generationStartedAt = Date.now()
    this.setData({
      elapsedText: '00:00'
    })
    this.generationTimer = setInterval(() => {
      this.setData({
        elapsedText: this.formatElapsedTime(Date.now() - this.generationStartedAt)
      })
    }, 1000)
  },

  stopGenerationTimer() {
    if (this.generationTimer) {
      clearInterval(this.generationTimer)
      this.generationTimer = null
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

  triggerWorker(taskId) {
    console.log('[analyzing] triggerWorker 已弃用，改由 ensureWorker 异步拉起。', taskId)
  },

  async startAsyncGeneration() {
    try {
      const createRes = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'createTask',
          featureId: this.data.featureId,
          imageUrls: this.data.images,
          inputValues: this.data.inputValues
        }
      })

      const result = createRes.result
      if (!result || !result.success || !result.taskId) {
        this.stopProgress()
        wx.showToast({ title: (result && result.error) || '提交任务失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 2000)
        return
      }

      this.setData({
        taskId: result.taskId,
        statusText: 'AI 正在绘制中...'
      })
      this.startGenerationTimer()
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
            this.reportWaitLeave('timeout_back')
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
        this.stopGenerationTimer()
        report('generation_success', {
          feature_id: task.featureId || this.data.featureId,
          task_id: taskId,
          history_id: task.historyId || '',
          source: 'analyzing'
        })
        app.finishTrackedGenerationTask(taskId, { silent: true })
        this.handleGenerationSucceeded(taskId, task)
        return
      }

      if (task.status === 'failed') {
        this.stopGenerationTimer()
        app.finishTrackedGenerationTask(taskId, { silent: true })
        this.showGenerationFailedModal(task)
      }
    } catch (err) {
      console.error('[analyzing] poll failed', err)
    } finally {
      this.isPollingRequest = false
    }
  },

  handleGenerationSucceeded(taskId, task) {
    this.setData({
      progress: 100,
      progressText: '100',
      statusText: '生成完成',
      resultReady: true,
      resultUrl: task.resultUrl || '',
      resultHistoryId: task.historyId || ''
    })
  },

  showGenerationFailedModal(task = {}) {
    this.stopSnakeLoop()
    this.setData({
      statusText: '生成失败'
    })
    wx.showModal({
      title: '生图失败',
      content: '因网络原因导致生图失败，您的星光已返还，请返回重试',
      confirmText: '确认',
      showCancel: false,
      success: () => {
        this.returnToFeatureDetail(task)
      }
    })
  },

  returnToFeatureDetail(task = {}) {
    const featureId = this.data.featureId || task.featureId || ''
    this.leavingAfterFailure = true
    if (featureId) {
      wx.redirectTo({
        url: `/pages/feature/feature?id=${encodeURIComponent(featureId)}`
      })
      return
    }
    wx.navigateBack()
  },

  openResultPage() {
    if (!this.data.resultHistoryId && !this.data.resultUrl) {
      return
    }
    this.openingResult = true
    report('generation_result_open_click', {
      feature_id: this.data.featureId,
      task_id: this.data.taskId || '',
      history_id: this.data.resultHistoryId || ''
    })
    const params = []
    if (this.data.resultHistoryId) {
      params.push(`id=${encodeURIComponent(this.data.resultHistoryId)}`)
    }
    if (this.data.resultUrl) {
      params.push(`url=${encodeURIComponent(this.data.resultUrl)}`)
    }
    wx.redirectTo({
      url: `/pages/result/result?${params.join('&')}`
    })
  },

  onUnload() {
    this.stopSnakeLoop()
    this.stopProgress()
    this.stopPolling()
    this.stopGenerationTimer()
    if (!this.openingResult && !this.goingHome && !this.leavingAfterFailure) {
      this.reportWaitLeave('back')
    }
  },

  handleBottomAction() {
    if (this.data.resultReady) {
      this.openResultPage()
      return
    }
    this.goHome()
  },

  goHome() {
    this.goingHome = true
    this.reportWaitLeave('browse_other')
    wx.switchTab({
      url: '/pages/index/index'
    })
  },

  reportWaitLeave(action) {
    if (this.hasReportedLeave) return
    this.hasReportedLeave = true
    report('generation_wait_leave', {
      feature_id: this.data.featureId,
      task_id: this.data.taskId || '',
      action,
      wait_seconds: Math.max(0, Math.round((Date.now() - (this.pollStartedAt || Date.now())) / 1000))
    })
  }
})
