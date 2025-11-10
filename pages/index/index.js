// 首页逻辑：化妆品列表数据处理与交互
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
    userAuthorized: false, // 用户是否已授权登录
    showReminderModal: false, // 提醒设置弹窗
    selectedCosmetic: null, // 选中的化妆品
    templateId: 'Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY' // 订阅消息模板ID
  },

  // 页面显示时执行
  onShow() {
    this.checkUserAuth();
  },

  // 检查用户授权状态
  checkUserAuth() {
    const app = getApp();
    if (app.globalData.openid) {
      this.setData({ userAuthorized: true });
      this.loadCosmeticsData();
    } else {
      // 等待获取openid
      setTimeout(() => {
        this.checkUserAuth();
      }, 1000);
    }
  },

  // 用户登录授权
  onUserLogin() {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const app = getApp();
        app.globalData.userInfo = res.userInfo;
        this.setData({ userAuthorized: true });
        this.loadCosmeticsData();
      },
      fail: (err) => {
        console.error('用户拒绝授权:', err);
        wx.showToast({
          title: '需要授权才能使用',
          icon: 'none'
        });
      }
    });
  },



  // 加载化妆品数据
  loadCosmeticsData() {
    this.setData({ isLoading: true });
    
    wx.cloud.callFunction({
      name: 'cosmetics',
      data: {
        action: 'list'
      },
      success: (res) => {
        if (res.result.success) {
          const cosmetics = res.result.data;
          // 处理数据，计算过期状态和剩余天数
          const processedData = this.processCosmeticsData(cosmetics);
          // 排序数据：未过期的按剩余天数从少到多，已过期的按创建时间从近到晚
          const sortedData = this.sortCosmeticsData(processedData);
          // 更新数据
          this.setData({
            cosmetics: sortedData,
            totalCount: sortedData.length,
            expiringCount: sortedData.filter(item => !item.isExpired && !item.isTodayExpired && item.daysLeft <= this.data.reminderDays).length,
            expiredCount: sortedData.filter(item => item.isExpired).length,
            isLoading: false
          });
          
          // 同步到全局数据（保持兼容性）
          this.app.globalData.cosmetics = cosmetics;
        } else {
          console.error('加载数据失败:', res.result.message);
          wx.showToast({
            title: '加载数据失败',
            icon: 'none'
          });
          this.setData({ isLoading: false });
        }
      },
      fail: (err) => {
        console.error('调用云函数失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
        this.setData({ isLoading: false });
      }
    });
  },

  // 排序化妆品数据
  sortCosmeticsData(cosmetics) {
    return cosmetics.sort((a, b) => {
      // 先按是否过期排序（未过期在前，已过期在后）
      if (a.isExpired !== b.isExpired) {
        return a.isExpired ? 1 : -1;
      }
      // 未过期的按剩余天数从少到多排序
      if (!a.isExpired) {
        return a.daysLeft - b.daysLeft;
      }
      // 已过期的按创建时间从近到晚排序（假设item中有createTime字段）
      // 如果没有createTime字段，这里会按照原有顺序排列
      if (a.createTime && b.createTime) {
        return new Date(b.createTime) - new Date(a.createTime);
      }
      return 0;
    });
  },

  // 处理化妆品数据，计算过期状态和剩余天数
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
        isExpired,
        isTodayExpired,
        status,
        reminderEnabled: item.reminderEnabled || false // 添加提醒状态字段
      };
    });
  },

  // 导航到添加页面
  navigateToAdd() {
    wx.switchTab({
      url: '/pages/add/add'
    });
  },



  // 删除化妆品
  handleDelete(e) {
    const id = e.currentTarget.dataset.id;
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 "${cosmetic.name}" 吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'cosmetics',
            data: {
              action: 'delete',
              data: { _id: id }
            },
            success: (res) => {
              if (res.result.success) {
                wx.showToast({
                  title: '删除成功',
                  icon: 'success'
                });
                // 重新加载数据
                this.loadCosmeticsData();
              } else {
                wx.showToast({
                  title: '删除失败',
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
      this.setData({ isRefreshing: false });
    }, 500);
  },

  // 页面滚动到底部加载更多（如果有分页功能）
  onReachBottom() {
    // 这里可以实现分页加载逻辑
    if (!this.data.isLoading) {
      // 模拟加载更多
      this.setData({ isLoading: true });
      setTimeout(() => {
        this.setData({ isLoading: false });
      }, 1000);
    }
  },

  // 格式化创建时间
  formatCreateTime(createTime) {
    if (!createTime) return '';
    const date = new Date(createTime);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  },

  // 导航到编辑页面
  navigateToEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.openEditModal(e);
  },

  // 页面加载时执行
  onLoad() {
    // 获取应用实例
    this.app = getApp();
    // 获取提醒天数配置
    this.setData({
      reminderDays: this.app.globalData.reminderDays
    });
  },

  // 打开编辑弹窗
  openEditModal(e) {
    const id = e.currentTarget.dataset.id;
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    if (cosmetic) {
      // 找到当前类别在数组中的索引
      const categoryIndex = this.data.categories.findIndex(cat => cat === cosmetic.category);
      
      this.setData({
        currentCosmetic: cosmetic,
        editForm: {
          id: cosmetic._id,
          name: cosmetic.name,
          category: cosmetic.category,
          categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
          purchaseDate: cosmetic.purchaseDate || '',
          expiryDate: cosmetic.expiryDate,
          remarks: cosmetic.remarks || '',
          imageUrl: cosmetic.imageUrl || ''
        },
        showEditModal: true
      });
    }
  },

  // 关闭编辑弹窗
  closeEditModal() {
    this.setData({
      showEditModal: false
    });
  },

  // 输入框内容变化
  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    let { value } = e.detail;
    
    // 对备注字段进行字数限制
    if (field === 'remarks' && value.length > 14) {
      value = value.substring(0, 14);
    }
    
    this.setData({
      [`editForm.${field}`]: value
    });
  },

  // 输入框获取焦点时清除默认提示文字
  handleFocus(e) {
    const { field } = e.currentTarget.dataset;
    if (!this.data.editForm[field]) {
      this.setData({
        [`editForm.${field}`]: ''
      });
    }
  },

  // 处理输入框容器点击，聚焦到输入框
  handleInputFocus(e) {
    const field = e.currentTarget.dataset.field;
    // 模拟点击输入框，触发聚焦
    this.handleFocus({
      currentTarget: {
        dataset: {
          field: field
        }
      }
    });
  },

  // 处理选择器容器点击，打开选择器
  handlePickerTap(e) {
    // 点击容器时，会自动触发内部picker的点击事件，无需额外处理
  },

  // 选择类别
  onCategoryChange(e) {
    const { value } = e.detail;
    this.setData({
      'editForm.categoryIndex': parseInt(value),
      'editForm.category': this.data.categories[value]
    });
  },

  // 选择开封日期
  onPurchaseDateChange(e) {
    const { value } = e.detail;
    this.setData({
      'editForm.purchaseDate': value
    });
  },

  // 选择过期日期
  onExpiryDateChange(e) {
    const { value } = e.detail;
    this.setData({
      'editForm.expiryDate': value
    });
  },

  // 选择图片
  chooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        
        // 显示上传进度
        wx.showLoading({
          title: '上传图片中...',
          mask: true
        });
        
        // 上传图片到云存储
        const cloudPath = `cosmetics/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
        
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            console.log('图片上传成功:', uploadRes.fileID);
            // 设置云存储文件ID
            this.setData({
              'editForm.imageUrl': uploadRes.fileID
            });
            wx.hideLoading();
            wx.showToast({
              title: '图片上传成功',
              icon: 'success',
              duration: 1500
            });
          },
          fail: (err) => {
            console.error('图片上传失败:', err);
            wx.hideLoading();
            wx.showToast({
              title: '图片上传失败',
              icon: 'none',
              duration: 2000
            });
          }
        });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
        wx.showToast({
          title: '选择图片失败',
          icon: 'none'
        });
      }
    });
  },

  // 保存化妆品信息
  saveCosmetic() {
    const { editForm } = this.data;

    // 表单验证
    if (!editForm.name) {
      wx.showToast({
        title: '请输入化妆品名称',
        icon: 'none'
      });
      return;
    }

    if (!editForm.category) {
      wx.showToast({
        title: '请选择类别',
        icon: 'none'
      });
      return;
    }

    if (!editForm.expiryDate) {
      wx.showToast({
        title: '请选择过期日期',
        icon: 'none'
      });
      return;
    }

    // 调用云函数更新数据
    wx.cloud.callFunction({
      name: 'cosmetics',
      data: {
        action: 'update',
        data: {
          _id: editForm.id,
          name: editForm.name,
          category: editForm.category,
          purchaseDate: editForm.purchaseDate,
          expiryDate: editForm.expiryDate,
          remarks: editForm.remarks,
          imageUrl: editForm.imageUrl
        }
      },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          });
          this.closeEditModal();
          // 重新加载数据
          this.loadCosmeticsData();
        } else {
          wx.showToast({
            title: '保存失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('保存失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  },

  // 设置提醒
  // 切换提醒状态
  toggleReminder(e) {
    const id = e.currentTarget.dataset.id;
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    
    if (!cosmetic) return;
    
    // 只有在灰色状态（未开启提醒）时才调用订阅消息授权
    if (!cosmetic.reminderEnabled) {
      this.requestReminderSubscription(cosmetic);
    } else {
      // 如果已有提醒设置，显示确认弹窗
      wx.showModal({
        title: '确认关闭提醒',
        content: `关闭提醒后，您将收不到"${cosmetic.name}"的到期提醒，是否确认关闭？`,
        confirmText: '确认关闭',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            // 用户确认关闭，执行取消提醒
            this.cancelReminder(id, cosmetic);
          }
          // 用户取消则不执行任何操作
        }
      });
    }
  },

  // 请求提醒订阅授权
  requestReminderSubscription(cosmetic) {
    const { templateId } = this.data;
    
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        if (res[templateId] === 'accept') {
          // 用户同意授权，设置提醒
          this.setReminderForCosmetic(cosmetic);
        } else {
          // 用户拒绝授权，保持灰色状态
          wx.showToast({
            title: '需要授权才能设置提醒',
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
    // 计算提醒日期（过期日期前7天）
    const expiryDate = new Date(cosmetic.expiryDate);
    const reminderDate = new Date(expiryDate);
    reminderDate.setDate(expiryDate.getDate() - 7);

    // 只有当提醒日期在未来时才设置提醒
    const now = new Date();
    if (reminderDate > now) {
      // 调用云函数设置提醒
      wx.cloud.callFunction({
        name: 'reminders',
        data: {
          action: 'add',
          data: {
            cosmeticId: cosmetic._id,
            cosmeticName: cosmetic.name,
            expiryDate: cosmetic.expiryDate,
            reminderDate: reminderDate.toISOString().split('T')[0],
            templateId: this.data.templateId
          }
        },
        success: (res) => {
          if (res.result.success) {
            // 更新本地数据状态
            const updatedCosmetics = this.data.cosmetics.map(item => {
              if (item._id === cosmetic._id) {
                return { ...item, reminderEnabled: true };
              }
              return item;
            });
            
            this.setData({
              cosmetics: updatedCosmetics
            });
            
            wx.showToast({
              title: '提醒设置成功',
              icon: 'success'
            });
          } else {
            wx.showToast({
              title: '提醒设置失败',
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
    } else {
      wx.showToast({
        title: '该化妆品已过期或即将过期，无需设置提醒',
        icon: 'none'
      });
    }
  },

  // 取消提醒
  cancelReminder(cosmeticId, cosmetic) {
    console.log('取消提醒，化妆品ID:', cosmeticId);
    wx.cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'cancel',
        data: { cosmeticId: cosmeticId }
      },
      success: (res) => {
        console.log('云函数返回结果:', res);
        if (res.result && res.result.success) {
          wx.showToast({
            title: '已取消提醒',
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
          console.error('取消提醒失败，云函数返回:', res.result);
          wx.showToast({
            title: res.result?.message || '取消失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('取消提醒调用失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  },

  setReminder(e) {
    const id = e.currentTarget.dataset.id;
    const cosmetic = this.data.cosmetics.find(item => item._id === id);
    
    if (cosmetic) {
      this.setData({
        selectedCosmetic: cosmetic,
        showReminderModal: true
      });
    }
  },

  // 关闭提醒弹窗
  closeReminderModal() {
    this.setData({
      showReminderModal: false,
      selectedCosmetic: null
    });
  },

  // 请求订阅消息授权
  requestSubscribeMessage() {
    const { selectedCosmetic, templateId } = this.data;
    
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        if (res[templateId] === 'accept') {
          // 用户同意授权，保存提醒设置
          this.saveReminderSetting(selectedCosmetic);
        } else {
          wx.showToast({
            title: '需要授权才能设置提醒',
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

  // 保存提醒设置
  saveReminderSetting(cosmetic) {
    // 计算提醒日期（过期前7天）
    const expiryDate = new Date(cosmetic.expiryDate);
    const reminderDate = new Date(expiryDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    
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