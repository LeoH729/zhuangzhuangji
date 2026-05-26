// pages/generation-history/generation-history.js
const {
  IMAGE_STYLES,
  createImageState,
  markImageLoaded,
  cacheImage,
  getNextRetryState,
  getRetryDelay
} = require('../../utils/image-loader.js')

Page({
  data: {
    taskList: [],
    loading: true,
    loadingMore: false,
    hasMore: true,
    page: 0,
    pageSize: 10
  },

  onLoad() {
    this.loadTasks(true);
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
    this.clearImageRetryTimers();
  },

  onPullDownRefresh() {
    this.loadTasks(true).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadMoreTasks();
    }
  },

  async loadTasks(refresh = false) {
    if (refresh) {
      // 只有在列表为空（首次加载）时，才显示全屏 loading 状态，避免下拉刷新或返回时重置页面
      if (this.data.taskList.length === 0) {
        this.setData({ loading: true });
      }
      this.setData({ page: 0, hasMore: true });
    } else {
      this.setData({ loadingMore: true });
    }

    try {
      const app = getApp();
      const openid = app.globalData.openid || (wx.getStorageSync('userInfo') || {}).openid;
      
      const pageIndex = refresh ? 0 : this.data.page;
      
      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'listTasks',
          page: pageIndex,
          pageSize: this.data.pageSize
        }
      });

      const currentList = this.data.taskList || [];
      const list = (res.result && res.result.tasks || []).map(item => {
        const formatted = this.formatTask(item);
        // 如果新拉取的列表中有之前已加载成功的图片，保持图片状态，防止重新闪烁或消失
        const existing = currentList.find(c => c.id === formatted.id);
        if (existing && existing.image) {
          formatted.image = createImageState(
            formatted.rawResultUrl,
            IMAGE_STYLES.TASK_THUMB,
            existing.image
          );
        }
        return formatted;
      });
      
      this.setData({
        taskList: refresh ? list : [...this.data.taskList, ...list],
        page: pageIndex + 1,
        hasMore: list.length === this.data.pageSize,
        loading: false,
        loadingMore: false
      }, () => {
        this.startPolling();
      });
    } catch (e) {
      console.error('[History] 加载任务记录失败:', e);
      this.setData({ loading: false, loadingMore: false });
    }
  },

  loadMoreTasks() {
    this.loadTasks(false);
  },

  formatTask(item) {
    let dateStr = '';
    const timeVal = item.createdAt || item.createTime;
    if (timeVal) {
      const d = new Date(timeVal);
      const pad = n => String(n).padStart(2, '0');
      dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    let resultUrl = item.resultUrl || '';
    if (resultUrl.includes('via.placeholder.com')) {
      resultUrl = resultUrl.replace('via.placeholder.com', 'dummyimage.com');
    }

    return {
      id: item.id || item._id,
      featureName: item.featureNameSnapshot || item.featureName || 'AI生成任务',
      date: dateStr,
      status: item.status || 'pending',
      rawResultUrl: resultUrl,
      image: createImageState(resultUrl, IMAGE_STYLES.TASK_THUMB),
      errorMessage: item.errorMessage || '',
      historyId: item.historyId || '',
      imageError: false
    };
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.taskList.find(task => task.id === id);
    if (!item || !item.image) return;

    const nextImage = getNextRetryState(item.image);
    const update = () => {
      const taskList = this.data.taskList.map(task => {
        if (task.id === id) {
          task.image = nextImage;
          task.imageError = !!nextImage.error;
        }
        return task;
      });
      this.setData({ taskList });
    };

    if (nextImage.error) {
      update();
      return;
    }

    this.scheduleImageRetry(`task_${id}`, update, getRetryDelay(nextImage.retryCount));
  },

  onImageLoad(e) {
    const id = e.currentTarget.dataset.id;
    const taskList = this.data.taskList.map(item => {
      if (item.id === id) {
        cacheImage(item.image);
        item.image = markImageLoaded(item.image);
        item.imageError = false;
      }
      return item;
    });
    this.setData({ taskList });
  },

  onCardTap(e) {
    const item = e.currentTarget.dataset.item;
    if (item.status === 'succeeded' && item.historyId) {
      wx.navigateTo({
        url: `/pages/result/result?id=${item.historyId}`
      });
    } else if (item.status === 'succeeded' && item.rawResultUrl) {
      // 容错降级：即使老旧任务没有 historyId，也进入结果页展示，而不是走旧的放大图逻辑
      wx.navigateTo({
        url: `/pages/result/result?url=${encodeURIComponent(item.rawResultUrl)}`
      });
    } else if (item.status === 'failed') {
      wx.showModal({
        title: '生成任务失败',
        content: item.errorMessage || '未知生图失败，请重试',
        showCancel: false
      });
    }
  },

  startPolling() {
    if (this.pollTimer) return;
    
    const hasActiveTasks = this.data.taskList.some(
      item => item.status === 'pending' || item.status === 'running'
    );
    
    if (hasActiveTasks) {
      console.log('[History] 发现生成中的任务，启动自动状态轮询...');
      this.pollTimer = setInterval(() => {
        this.pollTasksStatus();
      }, 4000);
    }
  },

  stopPolling() {
    if (this.pollTimer) {
      console.log('[History] 停止自动状态轮询...');
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  async pollTasksStatus() {
    const hasActiveTasks = this.data.taskList.some(
      item => item.status === 'pending' || item.status === 'running'
    );
    
    if (!hasActiveTasks) {
      this.stopPolling();
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'aiGenerate',
        data: {
          action: 'listTasks',
          page: 0,
          pageSize: this.data.pageSize
        }
      });

      const currentList = this.data.taskList || [];
      const newItems = (res.result && res.result.tasks || []).map(item => this.formatTask(item));
      
      let changed = false;
      const updatedList = currentList.map(existingItem => {
        const fresh = newItems.find(n => n.id === existingItem.id);
        const hasTaskChanged =
          fresh &&
          (
            fresh.status !== existingItem.status ||
            fresh.historyId !== existingItem.historyId ||
            fresh.rawResultUrl !== existingItem.rawResultUrl ||
            fresh.errorMessage !== existingItem.errorMessage
          );

        if (hasTaskChanged) {
          changed = true;
          const image = createImageState(
            fresh.rawResultUrl,
            IMAGE_STYLES.TASK_THUMB,
            existingItem.image
          );
          return {
            ...existingItem,
            status: fresh.status,
            rawResultUrl: fresh.rawResultUrl,
            historyId: fresh.historyId,
            image,
            errorMessage: fresh.errorMessage,
            imageError: false
          };
        }
        return existingItem;
      });

      if (changed) {
        console.log('[History] 任务状态发生变更，静默更新列表');
        this.setData({ taskList: updatedList }, () => {
          const stillHasActive = this.data.taskList.some(
            item => item.status === 'pending' || item.status === 'running'
          );
          if (!stillHasActive) {
            this.stopPolling();
          }
        });
      }
    } catch (e) {
      console.error('[History] 轮询任务状态失败:', e);
    }
  },

  scheduleImageRetry(key, callback, delay) {
    this.imageRetryTimers = this.imageRetryTimers || {};
    if (this.imageRetryTimers[key]) {
      clearTimeout(this.imageRetryTimers[key]);
    }
    this.imageRetryTimers[key] = setTimeout(() => {
      delete this.imageRetryTimers[key];
      callback();
    }, delay);
  },

  clearImageRetryTimers() {
    const timers = this.imageRetryTimers || {};
    Object.keys(timers).forEach(key => clearTimeout(timers[key]));
    this.imageRetryTimers = {};
  }
})
