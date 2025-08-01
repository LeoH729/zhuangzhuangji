// 应用入口文件
App({
  // 全局数据存储
  globalData: {
    cosmetics: [], // 存储化妆品记录的数组
    reminderDays: 30, // 默认提前30天提醒
    currentDate: new Date().toISOString().split('T')[0] // 当前日期
  },

  // 应用初始化
  onLaunch() {
    // 从本地存储加载数据
    const storedCosmetics = wx.getStorageSync('cosmetics');
    if (storedCosmetics) {
      this.globalData.cosmetics = storedCosmetics;
    }

    // 检查是否需要发送提醒
    this.checkReminders();
  },

  // 检查过期提醒
  checkReminders() {
    const { cosmetics, reminderDays } = this.globalData;
    const today = new Date();
    const reminders = [];

    cosmetics.forEach(item => {
      if (item.expiryDate) {
        const expiryDate = new Date(item.expiryDate);
        const timeDiff = expiryDate - today;
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        // 过期或即将过期（提前reminderDays天）
        if (daysDiff <= reminderDays && daysDiff >= 0) {
          reminders.push({
            ...item,
            daysLeft: daysDiff
          });
        } else if (daysDiff < 0) {
          reminders.push({
            ...item,
            daysLeft: daysDiff,
            isExpired: true
          });
        }
      }
    });

    // 如果有提醒，发送本地通知
    if (reminders.length > 0) {
      this.sendReminderNotification(reminders);
    }
  },

  // 发送提醒通知
  sendReminderNotification(reminders) {
    // 微信小程序通知需要用户授权
    wx.getSetting({
      withSubscriptions: true,
      success(res) {
        // 检查是否有通知授权
        if (res.subscriptionsSetting.mainSwitch) {
          // 构建通知内容
          const expiredCount = reminders.filter(r => r.isExpired).length;
          const soonExpiredCount = reminders.length - expiredCount;
          let title = '妆妆记 - 过期提醒';
          let content = '';

          if (expiredCount > 0 && soonExpiredCount > 0) {
            content = `${expiredCount}个已过期，${soonExpiredCount}个即将过期`;
          } else if (expiredCount > 0) {
            content = `${expiredCount}个化妆品已过期`;
          } else {
            content = `${soonExpiredCount}个化妆品即将过期`;
          }

          // 显示本地通知
          wx.showModal({
            title: title,
            content: content,
            confirmText: '查看详情',
            success(res) {
              // 只有点击确定按钮时才跳转
              if (res.confirm) {
                // 使用switchTab跳转到tabBar页面
                wx.switchTab({
                  url: '/pages/index/index'
                });
              }
            }
          });
        }
      }
    });
  },

  // 保存化妆品数据到本地存储
  saveCosmeticsData() {
    wx.setStorageSync('cosmetics', this.globalData.cosmetics);
  },

  // 添加新的化妆品记录
  addCosmetic(item) {
    // 生成唯一ID
    item.id = Date.now().toString();
    // 添加创建时间
    item.createTime = new Date().toISOString();
    // 添加到数组
    this.globalData.cosmetics.unshift(item);
    // 保存到本地存储
    this.saveCosmeticsData();
    // 检查提醒
    this.checkReminders();
    return item;
  },

  // 删除化妆品记录
  deleteCosmetic(id) {
    this.globalData.cosmetics = this.globalData.cosmetics.filter(item => item.id !== id);
    this.saveCosmeticsData();
  },

  // 更新化妆品记录
  updateCosmetic(updatedItem) {
    const index = this.globalData.cosmetics.findIndex(item => item.id === updatedItem.id);
    if (index !== -1) {
      this.globalData.cosmetics[index] = { ...this.globalData.cosmetics[index], ...updatedItem };
      this.saveCosmeticsData();
      this.checkReminders();
      return true;
    }
    return false;
  }
});