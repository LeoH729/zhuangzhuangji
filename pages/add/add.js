// 添加化妆品页面逻辑
Page({
  data: {
    // 表单数据
    formData: {
      name: '', // 化妆品名称
      categoryIndex: 0, // 类别索引
      purchaseDate: '', // 购买日期
      expiryDate: '', // 过期日期
      notes: '', // 备注信息
      imageUrl: '' // 图片路径
    },
    // 化妆品类别列表
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
    // 当前日期（用于日期选择器默认结束日期）
    currentDate: '',
    // 是否可以保存（表单验证）
    canSave: false,
    // 加载状态
    isSaving: false
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
      sizeType: ['original', 'compressed'], // 原图或压缩图
      sourceType: ['album', 'camera'], // 相册或相机
      success: (res) => {
        // 获取临时文件路径
        const tempFilePaths = res.tempFilePaths;
        // 设置图片URL
        this.setData({
          'formData.imageUrl': tempFilePaths[0]
        }, () => {
          this.checkFormValidity();
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
      notes: this.data.formData.notes.trim(),
      imageUrl: this.data.formData.imageUrl
    };

    // 调用应用实例的添加方法
    const newCosmetic = this.app.addCosmetic(cosmetic);

    if (newCosmetic) {
      // 保存成功
      wx.showToast({
        title: '添加成功',
        icon: 'success',
        duration: 1500,
        success: () => {
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
            canSave: false
          });
          // 返回上一页
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        }
      });
    } else {
      // 保存失败
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
      this.setData({ isSaving: false });
    }
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