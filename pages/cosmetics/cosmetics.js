// pages/cosmetics/cosmetics.js
Page({
  data: {
    cosmetics: [], // 化妆品列表数据
    totalCount: 0, // 总数量
    expiringCount: 0, // 即将过期数量
    expiredCount: 0, // 已过期数量
    reminderDays: 30, // 提前提醒天数
    isLoading: false, // 加载状态
    isRefreshing: false, // 下拉刷新状态
    showEditModal: false, // 编辑弹窗显示状态
    currentCosmetic: null, // 当前编辑的化妆品
    editForm: {
      id: '',
      name: '',
      category: '',
      categoryIndex: 0,
      purchaseDate: '',
      expiryDate: '',
      remarks: '',
      imageUrl: ''
    },
    categories: ['护肤', '彩妆', '香水', '美发', '身体护理', '工具', '其他'],
    showReminderModal: false, // 提醒设置弹窗
    selectedCosmetic: null, // 选中的化妆品
    templateId: 'Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY', // 订阅消息模板ID
    showFloatingButton: false // 控制悬浮按钮显示状态
  },

  // 页面显示时触发
  onShow() {
    this.checkUserAuth();
  },

  // 加载数据（不再依赖昵称/头像授权）
  checkUserAuth() {
    this.loadCosmeticsData();
  },

  // 移除昵称/头像授权流程（保留云函数依赖的 openid 自动识别）

  // 加载化妆品数据
  loadCosmeticsData() {
    this.setData({ isLoading: true });
    
    wx.cloud.callFunction({
      name: 'cosmetics',
      data: {
        action: 'list'
      },
      success: (res) => {
        console.log('获取化妆品数据成功:', res);
        if (res.result && res.result.success) {
          const cosmetics = res.result.data || [];
          const processedData = this.processCosmeticsData(cosmetics);
          const sortedData = this.sortCosmeticsData(processedData);
          
          this.setData({
            cosmetics: sortedData,
            totalCount: sortedData.length,
            expiringCount: sortedData.filter(item => !item.isExpired && !item.isTodayExpired && item.daysLeft <= this.data.reminderDays).length,
            expiredCount: sortedData.filter(item => item.isExpired).length,
            isLoading: false,
            isRefreshing: false,
            showFloatingButton: sortedData.length > 0 // 根据数据长度控制悬浮按钮显示
          });
        } else {
          console.error('获取数据失败:', res.result);
          this.setData({ 
            isLoading: false,
            isRefreshing: false,
            showFloatingButton: false
          });
        }
      },
      fail: (err) => {
        console.error('调用云函数失败:', err);
        this.setData({ 
          isLoading: false,
          isRefreshing: false,
          showFloatingButton: false
        });
      }
    });
  },

  // 对化妆品数据进行排序
  sortCosmeticsData(cosmetics) {
    return cosmetics.sort((a, b) => {
      // 首先按状态排序：即将过期 > 正常 > 已过期
      if (a.status !== b.status) {
        const statusOrder = { 'expiring': 0, 'normal': 1, 'expired': 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      
      // 相同状态下按剩余天数排序
      if (a.status === 'expired') {
        return b.daysRemaining - a.daysRemaining; // 已过期按过期时间倒序
      } else {
        return a.daysRemaining - b.daysRemaining; // 其他按剩余天数正序
      }
    });
  },

  // 处理化妆品数据，计算剩余天数和状态
  processCosmeticsData(cosmetics) {
    // 创建只包含日期部分的今天对象
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return cosmetics.map(item => {
      if (!item.expiryDate) return item;
      
      // 创建只包含日期部分的过期日期对象
      const expiryDate = new Date(item.expiryDate);
      expiryDate.setHours(0, 0, 0, 0);
      
      const timeDiff = expiryDate - today;
      const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      const daysRemaining = daysLeft; // 保持兼容性
      const isExpired = daysLeft < 0;
      const isTodayExpired = daysLeft === 0;
      
      // 处理名称超过10个字符时显示省略号
      let displayName = item.name;
      if (displayName && displayName.length > 10) {
        displayName = displayName.substring(0, 10) + '...';
      }
      
      // 确保备注字段的一致性（兼容notes和remarks两种字段名）
      const remarks = item.remarks || item.notes || '';
      
      let status;
      if (isExpired) {
        status = 'expired';
      } else if (isTodayExpired) {
        status = 'todayExpired';
      } else if (daysLeft <= this.data.reminderDays) {
        status = 'warning';
      } else {
        status = 'normal';
      }

      return {
        ...item,
        displayName,
        remarks, // 添加统一的备注字段
        daysLeft,
        daysRemaining, // 保持兼容性
        isExpired,
        isTodayExpired,
        status,
        displayDays: daysRemaining < 0 ? `已过期${Math.abs(daysRemaining)}天` : 
                    daysRemaining === 0 ? '今天过期' : 
                    `剩余${daysRemaining}天`,
        reminderEnabled: item.reminderEnabled || false // 确保提醒状态字段存在
      };
    });
  },

  // 跳转到添加页面（现在改为悬浮按钮触发）
  navigateToAdd() {
    wx.navigateTo({
      url: '/pages/add/add'
    });
  },

  // 悬浮按钮点击事件
  onFloatingButtonTap() {
    this.navigateToAdd();
  },

  // 删除化妆品
  handleDelete(e) {
    const id = e.currentTarget.dataset.id;
    
    // 通过ID查找化妆品信息
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    const name = cosmetic ? (cosmetic.displayName || cosmetic.name) : '该化妆品';
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除"${name}"吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'cosmetics',
            data: {
              action: 'delete',
              data: { _id: id }
            },
            success: (res) => {
              if (res.result && res.result.success) {
                wx.showToast({
                  title: '删除成功',
                  icon: 'success'
                });
                this.loadCosmeticsData();
              } else {
                const errorMsg = res.result && res.result.message ? res.result.message : '删除失败';
                wx.showToast({
                  title: errorMsg,
                  icon: 'none'
                });
              }
            },
            fail: (err) => {
              console.error('删除失败:', err);
              wx.showToast({
                title: '网络错误',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({ isRefreshing: true });
    this.loadCosmeticsData();
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  },

  // 触底加载更多
  onReachBottom() {
    // 暂时不实现分页加载
    console.log('触底加载更多');
  },

  // 格式化创建时间
  formatCreateTime(createTime) {
    const date = new Date(createTime);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  // 跳转到编辑页面
  navigateToEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/edit/edit?id=${id}`
    });
  },

  // 页面加载时触发
  onLoad() {
    // 页面加载时不需要立即加载数据，等到onShow时再加载
    console.log('化妆品页面加载');
  },

  // 打开编辑弹窗
  openEditModal(e) {
    const id = e.currentTarget.dataset.id;
    
    // 通过ID查找化妆品信息
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    
    if (!cosmetic) {
      wx.showToast({
        title: '化妆品信息不存在',
        icon: 'none'
      });
      return;
    }
    
    const categoryIndex = this.data.categories.indexOf(cosmetic.category);
    
    this.setData({
      showEditModal: true,
      currentCosmetic: cosmetic,
      editForm: {
        id: cosmetic._id,
        name: cosmetic.name,
        category: cosmetic.category,
        categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
        purchaseDate: cosmetic.purchaseDate,
        expiryDate: cosmetic.expiryDate,
        remarks: cosmetic.remarks || '',
        imageUrl: cosmetic.imageUrl || ''
      }
    });
  },

  // 关闭编辑弹窗
  closeEditModal() {
    this.setData({ showEditModal: false });
  },

  // 输入框内容变化
  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    
    this.setData({
      [`editForm.${field}`]: value
    });
  },

  // 处理焦点事件
  handleFocus(e) {
    const { field } = e.currentTarget.dataset;
    console.log(`${field} 获得焦点`);
  },

  // 处理输入框焦点
  handleInputFocus(e) {
    const { field } = e.currentTarget.dataset;
    console.log(`输入框 ${field} 获得焦点`);
    
    // 可以在这里添加一些焦点处理逻辑
    if (field === 'name') {
      // 名称输入框获得焦点时的处理
    }
  },

  // 处理选择器点击
  handlePickerTap(e) {
    console.log('选择器被点击');
  },

  // 类别选择变化
  onCategoryChange(e) {
    const index = e.detail.value;
    this.setData({
      'editForm.categoryIndex': index,
      'editForm.category': this.data.categories[index]
    });
  },

  // 购买日期变化
  onPurchaseDateChange(e) {
    this.setData({
      'editForm.purchaseDate': e.detail.value
    });
  },

  // 过期日期变化
  onExpiryDateChange(e) {
    this.setData({
      'editForm.expiryDate': e.detail.value
    });
  },

  // 选择图片
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        
        // 上传图片到云存储
        const cloudPath = `cosmetics/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
        
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            console.log('图片上传成功:', uploadRes);
            this.setData({
              'editForm.imageUrl': uploadRes.fileID
            });
            wx.showToast({
              title: '图片上传成功',
              icon: 'success'
            });
          },
          fail: (err) => {
            console.error('图片上传失败:', err);
            wx.showToast({
              title: '图片上传失败',
              icon: 'none'
            });
          }
        });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  // 保存化妆品信息
  saveCosmetic() {
    const form = this.data.editForm;
    
    // 表单验证
    if (!form.name.trim()) {
      wx.showToast({
        title: '请输入化妆品名称',
        icon: 'none'
      });
      return;
    }
    
    if (!form.category) {
      wx.showToast({
        title: '请选择化妆品类别',
        icon: 'none'
      });
      return;
    }
    
    if (!form.expiryDate) {
      wx.showToast({
        title: '请选择过期日期',
        icon: 'none'
      });
      return;
    }

    const cosmeticData = {
      _id: form.id,  // 将ID包含在数据中
      name: form.name.trim(),
      category: form.category,
      purchaseDate: form.purchaseDate,
      expiryDate: form.expiryDate,
      remarks: form.remarks.trim(),
      imageUrl: form.imageUrl
    };

    wx.cloud.callFunction({
      name: 'cosmetics',
      data: {
        action: 'update',
        data: cosmeticData  // 修复参数结构
      },
      success: (res) => {
        if (res.result && res.result.success) {
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          });
          this.closeEditModal();
          this.loadCosmeticsData();
        } else {
          const errorMsg = res.result && res.result.message ? res.result.message : '保存失败';
          wx.showToast({
            title: errorMsg,
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('保存失败:', err);
        wx.showToast({
          title: '网络错误，请重试',
          icon: 'none'
        });
      }
    });
  },

  // 切换提醒状态
  toggleReminder(e) {
    const id = e.currentTarget.dataset.id;
    
    // 通过ID查找化妆品信息
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    
    if (!cosmetic) {
      wx.showToast({
        title: '化妆品信息不存在',
        icon: 'none'
      });
      return;
    }
    
    if (cosmetic.reminderEnabled) {
      // 如果已开启提醒，则取消提醒
      this.cancelReminder(cosmetic._id, cosmetic);
    } else {
      // 如果未开启提醒，则设置提醒
      this.setData({
        showReminderModal: true,
        selectedCosmetic: cosmetic
      });
    }
  },

  // 请求订阅消息权限并设置提醒
  requestReminderSubscription(cosmetic) {
    wx.requestSubscribeMessage({
      tmplIds: [this.data.templateId],
      success: (res) => {
        console.log('订阅消息授权结果:', res);
        if (res[this.data.templateId] === 'accept') {
          // 用户同意订阅，设置提醒
          this.setReminderForCosmetic(cosmetic);
        } else {
          wx.showToast({
            title: '需要订阅消息权限才能设置提醒',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('订阅消息授权失败:', err);
        wx.showToast({
          title: '授权失败',
          icon: 'none'
        });
      }
    });
  },

  // 为化妆品设置提醒
  setReminderForCosmetic(cosmetic) {
    const expiryDate = new Date(cosmetic.expiryDate);
    const reminderDate = new Date(expiryDate.getTime() - (this.data.reminderDays * 24 * 60 * 60 * 1000));
    
    // 检查提醒日期是否已过
    const now = new Date();
    if (reminderDate <= now) {
      wx.showToast({
        title: '该化妆品提醒时间已过',
        icon: 'none'
      });
      return;
    }

    const reminderData = {
      cosmeticId: cosmetic._id,
      cosmeticName: cosmetic.name,
      templateId: this.data.templateId,
      reminderDate: reminderDate.toISOString().split('T')[0],
      expiryDate: cosmetic.expiryDate,
      isActive: true
    };

    wx.cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'add',
        data: reminderData
      },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({
            title: '提醒设置成功',
            icon: 'success'
          });
          // 更新本地数据
          const updatedCosmetics = this.data.cosmetics.map(item => {
            if (item._id === cosmetic._id) {
              return { ...item, reminderEnabled: true };
            }
            return item;
          });
          this.setData({ cosmetics: updatedCosmetics });
        } else {
          wx.showToast({
            title: '设置失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('设置提醒失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  },

  // 取消提醒
  cancelReminder(cosmeticId, cosmetic) {
    wx.cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'cancel',
        cosmeticId: cosmeticId
      },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({
            title: '提醒已取消',
            icon: 'success'
          });
          // 更新本地数据
          const updatedCosmetics = this.data.cosmetics.map(item => {
            if (item._id === cosmeticId) {
              return { ...item, reminderEnabled: false };
            }
            return item;
          });
          this.setData({ cosmetics: updatedCosmetics });
        } else {
          wx.showToast({
            title: '取消失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('取消提醒失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  },

  // 设置提醒
  setReminder(e) {
    const cosmetic = this.data.selectedCosmetic;
    if (!cosmetic) return;

    // 先请求订阅消息权限
    this.requestReminderSubscription(cosmetic);
    this.closeReminderModal();
  },

  // 关闭提醒弹窗
  closeReminderModal() {
    this.setData({
      showReminderModal: false,
      selectedCosmetic: null
    });
  },

  // 请求订阅消息
  requestSubscribeMessage() {
    wx.requestSubscribeMessage({
      tmplIds: [this.data.templateId],
      success: (res) => {
        console.log('订阅消息结果:', res);
        if (res[this.data.templateId] === 'accept') {
          // 用户同意订阅
          this.saveReminderSetting(this.data.selectedCosmetic);
        } else {
          wx.showToast({
            title: '需要订阅权限才能设置提醒',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('订阅消息失败:', err);
        wx.showToast({
          title: '订阅失败',
          icon: 'none'
        });
      }
    });
  },

  // 保存提醒设置
  saveReminderSetting(cosmetic) {
    const expiryDate = new Date(cosmetic.expiryDate);
    const reminderDate = new Date(expiryDate.getTime() - (this.data.reminderDays * 24 * 60 * 60 * 1000));

    const reminderData = {
      cosmeticId: cosmetic._id,
      cosmeticName: cosmetic.name,
      templateId: this.data.templateId,
      reminderDate: reminderDate.toISOString().split('T')[0],
      expiryDate: cosmetic.expiryDate,
      isActive: true
    };

    wx.cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'add',
        data: reminderData
      },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({
            title: '提醒设置成功',
            icon: 'success'
          });
          // 更新本地数据
          const updatedCosmetics = this.data.cosmetics.map(item => {
            if (item._id === cosmetic._id) {
              return { ...item, reminderEnabled: true };
            }
            return item;
          });
          this.setData({ cosmetics: updatedCosmetics });
          this.closeReminderModal();
        } else {
          wx.showToast({
            title: '设置失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('设置提醒失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  }
});