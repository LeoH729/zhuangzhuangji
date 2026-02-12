// pages/profile/profile.js
Page({
    /**
     * 页面的初始数据
     */
    data: {
        avatarUrl: '/images/default_avatar.png', // 暂时使用默认头像占位
        nickName: '妆妆记用户',
        points: 0,
        isAdmin: false
    },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad(options) {
        this.updatePoints();
    },

    /**
     * 生命周期函数--监听页面显示
     */
    onShow() {
        this.updatePoints();
        this.checkAdminStatus();
    },

    updatePoints() {
        const app = getApp();
        const pts = (app.globalData && typeof app.globalData.userPoints === 'number') ? app.globalData.userPoints : 0;
        this.setData({ points: pts });
    },

    checkAdminStatus() {
        const app = getApp();
        const isAdminGlobal = app.globalData && app.globalData.isAdmin;
        const isAdminStored = wx.getStorageSync('isAdmin');

        // 优先使用全局变量，其次使用本地存储
        const isAdmin = !!(isAdminGlobal || isAdminStored);

        if (isAdmin !== this.data.isAdmin) {
            this.setData({ isAdmin });
        }

        // 再次确认（处理异步延迟）
        if (!isAdmin) {
            setTimeout(() => {
                const appLater = getApp();
                const isAdminLater = (appLater.globalData && appLater.globalData.isAdmin) || wx.getStorageSync('isAdmin');
                if (isAdminLater && isAdminLater !== this.data.isAdmin) {
                    this.setData({ isAdmin: isAdminLater });
                }
            }, 1000);
        }
    },

    // 菜单跳转处理
    navigateTo(e) {
        const url = e.currentTarget.dataset.url;
        console.log('Navigating to:', url);
        if (url) {
            wx.navigateTo({
                url,
                fail: (err) => {
                    console.error('Navigation failed:', err);
                    wx.showToast({ title: '页面跳转失败', icon: 'none' });
                }
            });
        }
    },

    goAdminPage() {
        wx.navigateTo({
            url: '/pages/admin/admin'
        });
    },

    onShowAbout() {
        wx.showModal({
            title: '关于我们',
            content: '妆妆记 V1.2.0\r\n联系开发者\r\n419126495@qq.com',
            showCancel: false
        });
    }
})
