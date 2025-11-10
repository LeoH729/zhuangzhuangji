// 编辑化妆品页面逻辑
Page({
  data: {
    // 表单数据
    formData: {
      id: '', // 化妆品ID
      name: '', // 化妆品名称
      categoryIndex: 0, // 类别索引
      purchaseDate: '', // 开封日期
      expiryDate: '', // 过期日期
      notes: '', // 备注信息
      imageUrl: '' // 图片URL
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
    isLoading: true,
    isSaving: false
  },

  // 页面加载
  onLoad(options) {
      // 获取应用实例
    this.app = getApp();
    // 获取化妆品ID
    this.cosmeticId = options.id;
    // 设置当前日期
    this.setData({
      currentDate: this.app.globalData.currentDate
    });
    // 加载化妆品数据
    this.loadCosmeticData();
  },

  // 加载化妆品数据
  loadCosmeticData() {
    const cosmetics = this.app.globalData.cosmetics;
    // 查找当前化妆品
    const cosmetic = cosmetics.find(item => item.id === this.cosmeticId);

    if (cosmetic) {
      // 查找类别索引
      let categoryIndex = this.data.categories.findIndex(item => item.name === cosmetic.category);
      // 如果找不到匹配的类别，设置为0（请选择类别）
      if (categoryIndex === -1) {
        categoryIndex = 0;
      }
      
      // 设置表单数据
      this.setData({
        formData: {
          id: cosmetic.id,
          name: cosmetic.name,
          categoryIndex: categoryIndex,
          purchaseDate: cosmetic.purchaseDate || '',
          expiryDate: cosmetic.expiryDate,
          notes: cosmetic.notes || '',
          imageUrl: cosmetic.imageUrl
        },
        isLoading: false
      }, () => {
        // 验证表单
        this.checkFormValidity();
      });
    } else {
      // 未找到数据
      this.setData({ isLoading: false });
      wx.showToast({
        title: '未找到该化妆品',
        icon: 'none',
        duration: 2000,
        success: () => {
          wx.navigateBack();
        }
      });
    }
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

  // 更新化妆品信息
  updateCosmetic() {
    if (!this.data.canSave) return;

    this.setData({ isSaving: true });

    // 构建更新后的化妆品对象
    const updatedData = {
      id: this.data.formData.id,
      name: this.data.formData.name.trim(),
      category: this.data.categories[this.data.formData.categoryIndex].name,
      purchaseDate: this.data.formData.purchaseDate,
      expiryDate: this.data.formData.expiryDate,
      notes: this.data.formData.notes.trim(),
      imageUrl: this.data.formData.imageUrl
    };

    // 调用应用实例的更新方法
    const success = this.app.updateCosmetic(updatedData);

    if (success) {
      // 更新成功
      wx.showToast({
        title: '更新成功',
        icon: 'success',
        duration: 1500,
        success: () => {
          // 返回详情页
          wx.navigateBack();
        }
      });
    } else {
      // 更新失败
      wx.showToast({
        title: '更新失败，请重试',
        icon: 'none'
      });
      this.setData({ isSaving: false });
    }
  }
});