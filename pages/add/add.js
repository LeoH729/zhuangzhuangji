// 添加化妆品页面逻辑
Page({
  data: {
    // 表单数据
    formData: {
      name: '', // 化妆品名称
      categoryIndex: 0, // 类别索引
      purchaseDate: '', // 开封日期
      expiryDate: '', // 过期日期
      notes: '', // 备注信息
      imageUrl: '' // 图片路径
    },
    // 类别选项
    categories: [
      { id: 0, name: '请选择类别' },
      { id: 1, name: '护肤' },
      { id: 2, name: '彩妆' },
      { id: 3, name: '香水' },
      { id: 4, name: '美发' },
      { id: 5, name: '身体护理' },
      { id: 6, name: '工具' },
      { id: 7, name: '其他' }
    ],
    // 当前日期
    currentDate: '',
    // 是否可以保存
    canSave: false,
    // 是否正在保存
    isSaving: false,
    // 订阅消息模板ID
    templateId: 'Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY'
  },

  // 页面加载
  onLoad() {
    // 获取应用实例
    this.app = getApp();
    // 初始化数据
    this.setData({
      currentDate: this.app.globalData.currentDate
    });
  },

  // 输入框获取焦点时清除placeholder
  handleFocus(e) {
    const field = e.currentTarget.dataset.field;
    // 如果当前字段为空，则清除placeholder
    if (!this.data.formData[field]) {
      this.setData({
        [`formData.${field}`]: ''
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



  // 输入框变化处理
  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    // 更新表单数据
    this.setData({
      [`formData.${field}`]: value
    }, () => {
      // 验证表单
      this.checkFormValidity();
    });
  },

  // 类别选择变化
  handleCategoryChange(e) {
    const { value } = e.detail;
    this.setData({
      'formData.categoryIndex': value,
      'formData.category': this.data.categories[value].name
    }, () => {
      this.checkFormValidity();
    });
  },

  // 日期选择变化
  handleDateChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`formData.${field}`]: e.detail.value
    }, () => {
      this.checkFormValidity();
    });
  },

  // 选择图片（拍照或相册）
  chooseImage() {
    wx.chooseImage({
      count: 1, // 最多选择1张图片
      sizeType: ['compressed'], // 使用压缩图以减少上传时间
      sourceType: ['album', 'camera'], // 相册或相机
      success: (res) => {
        // 获取临时文件路径
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
              'formData.imageUrl': uploadRes.fileID
            }, () => {
              this.checkFormValidity();
              wx.hideLoading();
              wx.showToast({
                title: '图片上传成功',
                icon: 'success',
                duration: 1500
              });
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

  // 检查表单是否有效
  checkFormValidity() {
    const { name, categoryIndex, expiryDate, imageUrl } = this.data.formData;
    // 验证条件：名称不为空，类别已选择（不是默认的0），过期日期不为空，图片已上传
    const isValid = name.trim() !== '' &&
                   categoryIndex > 0 &&
                   expiryDate !== '' &&
                   imageUrl !== '';
    // 更新可保存状态
    this.setData({
      canSave: isValid
    });
  },

  // 保存化妆品信息
  saveCosmetic() {
    if (!this.data.canSave) return;

    this.setData({ isSaving: true });

    // 构建化妆品对象
    const cosmetic = {
      name: this.data.formData.name.trim(),
      category: this.data.categories[this.data.formData.categoryIndex].name,
      purchaseDate: this.data.formData.purchaseDate,
      expiryDate: this.data.formData.expiryDate,
      remarks: this.data.formData.notes.trim(),
      imageUrl: this.data.formData.imageUrl
    };

    // 先请求订阅消息授权（必须在用户点击事件中直接调用）
    const { templateId } = this.data;
    
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        console.log('订阅消息授权结果:', res);
        // 无论授权结果如何，都继续保存化妆品
        this.saveCosmeticData(cosmetic, res[templateId] === 'accept');
      },
      fail: (err) => {
        console.error('订阅消息授权失败:', err);
        // 授权失败，仍然保存化妆品，但不设置提醒
        this.saveCosmeticData(cosmetic, false);
      }
    });
  },

  // 保存化妆品数据
  saveCosmeticData(cosmetic, shouldSetReminder) {
    // 调用云函数添加数据
    wx.cloud.callFunction({
      name: 'cosmetics',
      data: {
        action: 'add',
        data: cosmetic
      },
      success: (res) => {
        if (res.result.success) {
          if (shouldSetReminder) {
            // 用户同意授权，设置提醒
            this.setReminderForCosmetic(res.result.data, cosmetic);
          } else {
            // 用户拒绝授权或授权失败，仍然显示添加成功
            this.showSuccessAndReturn();
          }
        } else {
          // 保存失败
          wx.showToast({
            title: '保存失败，请重试',
            icon: 'none'
          });
          this.setData({ isSaving: false });
        }
      },
      fail: (err) => {
        console.error('添加失败:', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
        this.setData({ isSaving: false });
      }
    });
  },

  // 为化妆品设置提醒
  // 为化妆品设置提醒
  setReminderForCosmetic(savedCosmetic, cosmeticData) {
    // 计算提醒日期（过期日期前7天）
    const expiryDate = new Date(cosmeticData.expiryDate);
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
            cosmeticId: savedCosmetic._id,
            cosmeticName: cosmeticData.name,
            expiryDate: cosmeticData.expiryDate,
            reminderDate: reminderDate.toISOString().split('T')[0],
            templateId: this.data.templateId // 添加模板ID
          }
        },
        success: (res) => {
          if (res.result.success) {
            console.log('提醒设置成功');
            wx.showToast({
              title: '添加成功，已设置过期提醒',
              icon: 'success',
              duration: 2000
            });
          } else {
            console.error('提醒设置失败:', res.result.error);
            wx.showToast({
              title: '添加成功，但提醒设置失败',
              icon: 'none',
              duration: 2000
            });
          }
          this.resetFormAndReturn();
        },
        fail: (err) => {
          console.error('提醒设置调用失败:', err);
          wx.showToast({
            title: '添加成功，但提醒设置失败',
            icon: 'none',
            duration: 2000
          });
          this.resetFormAndReturn();
        }
      });
    } else {
      // 提醒日期已过，直接显示成功
      this.showSuccessAndReturn();
    }
  },

  // 显示成功提示并返回
  showSuccessAndReturn() {
    wx.showToast({
      title: '添加成功',
      icon: 'success',
      duration: 1500
    });
    this.resetFormAndReturn();
  },

  // 重置表单并返回
  resetFormAndReturn() {
    // 重置表单数据
    this.setData({
      formData: {
        name: '',
        categoryIndex: 0,
        purchaseDate: '',
        expiryDate: '',
        notes: '',
        imageUrl: ''
      },
      canSave: false,
      isSaving: false
    });
    // 返回上一页
    setTimeout(() => {
      wx.navigateBack();
    }, 1500);
  },

  // 页面卸载时检查是否有未保存数据
  onUnload() {
    // 如果有未保存的数据且不是在保存过程中，提示用户
    const { name, categoryIndex, expiryDate, imageUrl } = this.data.formData;
    if (!this.data.isSaving && (name || categoryIndex > 0 || expiryDate || imageUrl)) {
      wx.showToast({
        title: '已取消添加',
        icon: 'none',
        duration: 1000
      });
    }
  }
});