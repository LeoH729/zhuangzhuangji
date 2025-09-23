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
    categories: ['护肤', '彩妆', '香水', '美发', '身体护理', '工具', '其他']
  },

  // 页面显示时执行
  onShow() {
    this.loadCosmeticsData();
  },



  // 加载化妆品数据
  loadCosmeticsData() {
    const cosmetics = this.app.globalData.cosmetics;
    // 处理数据，计算过期状态和剩余天数
    const processedData = this.processCosmeticsData(cosmetics);
    // 排序数据：未过期的按剩余天数从少到多，已过期的按创建时间从近到晚
    const sortedData = this.sortCosmeticsData(processedData);
    // 更新数据
    this.setData({
      cosmetics: sortedData,
      totalCount: sortedData.length,
      expiringCount: sortedData.filter(item => !item.isExpired && item.daysLeft <= this.data.reminderDays).length,
      expiredCount: sortedData.filter(item => item.isExpired).length
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
        status
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
    // 安全地阻止事件冒泡
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个化妆品记录吗？',
      confirmColor: '#ff3b30',
      success: (res) => {
        if (res.confirm) {
          this.app.deleteCosmetic(id);
          this.loadCosmeticsData();
          wx.showToast({
            title: '删除成功',
            icon: 'success',
            duration: 1500
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
    const cosmetic = this.data.cosmetics.find(item => item.id === id);
    if (cosmetic) {
      // 找到当前类别在数组中的索引
      const categoryIndex = this.data.categories.findIndex(cat => cat === cosmetic.category);
      
      this.setData({
        currentCosmetic: cosmetic,
        editForm: {
          id: cosmetic.id,
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

  // 选择购买日期
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
        this.setData({
          'editForm.imageUrl': tempFilePath
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

    // 更新数据
    const updatedCosmetics = this.data.cosmetics.map(item => {
      if (item.id === editForm.id) {
        return {
          ...item,
          name: editForm.name,
          category: editForm.category,
          purchaseDate: editForm.purchaseDate,
          expiryDate: editForm.expiryDate,
          remarks: editForm.remarks,
          imageUrl: editForm.imageUrl || item.imageUrl
        };
      }
      return item;
    });

    this.setData({
      cosmetics: updatedCosmetics
    });

    // 保存到应用数据
    this.app.globalData.cosmetics = updatedCosmetics;
    // 重新加载数据以更新状态
    this.loadCosmeticsData();

    this.closeEditModal();
    wx.showToast({
      title: '保存成功',
      icon: 'success'
    });
  }
});