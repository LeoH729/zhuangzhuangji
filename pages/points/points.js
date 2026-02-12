// pages/points/points.js
const WxPaymentSDK = require('../../wxPaymentSDK/index.js');
Page({
    data: {
        points: 0,
        rechargeOptions: [
            { id: 1, amount: 10, price: 1, label: '萌新', tag: '' },
            { id: 2, amount: 60, price: 6, label: '尝鲜', tag: '' },
            { id: 3, amount: 188, price: 18, label: '进阶', tag: '推荐' },
            { id: 4, amount: 418, price: 38, label: '达人', tag: '' },
            { id: 5, amount: 688, price: 58, label: '女神', tag: '' },
            { id: 6, amount: 1088, price: 88, label: '至尊', tag: '超值' }
        ],
        selectedOptionId: 2, // 默认选中推荐
        historyList: [], // 收支明细
        isRecharging: false // 充值中状态
    },

    onLoad(options) {
        this.updatePoints();
        this.loadHistory();
    },

    onShow() {
        // 每次返回页面刷新数据
        this.updatePoints();
        this.loadHistory();
    },

    updatePoints() {
        const app = getApp();
        const pts = (app.globalData && typeof app.globalData.userPoints === 'number') ? app.globalData.userPoints : 0;
        this.setData({ points: pts });
    },

    selectOption(e) {
        const id = e.currentTarget.dataset.id;
        this.setData({ selectedOptionId: id });
    },



    // ... (existing code)

    // 充值（接入微信支付）
    async onRecharge() {
        if (this.data.isRecharging) return;

        const option = this.data.rechargeOptions.find(o => o.id === this.data.selectedOptionId);
        if (!option) return;

        this.setData({ isRecharging: true });

        try {
            // 1. 准备用户信息（支付SDK需要，若无则使用默认值）
            const app = getApp();
            let userInfo = app.globalData.userInfo;
            if (!userInfo || !userInfo.nickName) {
                // 尝试从本地缓存获取
                userInfo = wx.getStorageSync('userInfo') || {};
                if (!userInfo.nickName) {
                    // 使用默认值，避免支付流程受阻（支付本身不依赖昵称，仅SDK校验用）
                    userInfo = { nickName: '微信用户', avatarUrl: '', ...userInfo };
                }
            }

            // 2. 准备支付参数
            // 注意：微信支付金额单位为“分”
            const paymentOptions = {
                amount: option.price * 100, // 元转分
                description: `妆妆蛋充值-${option.label}套餐`,
                attach: JSON.stringify({
                    type: 'recharge',
                    eggAmount: option.amount, // 充值的蛋数量
                    optionId: option.id,
                    label: option.label
                })
            };

            // 3. 发起支付
            const result = await WxPaymentSDK.processPayment(userInfo, paymentOptions);

            if (result.success) {
                wx.showToast({ title: '支付成功', icon: 'success' });

                // 4. 轮询查余额（因为支付回调是异步的，可能有一点延迟）
                this.pollBalanceUpdate(app.globalData.userPoints);
            } else if (result.cancelled) {
                wx.showToast({ title: '支付已取消', icon: 'none' });
            } else {
                wx.showToast({
                    title: result.message || '支付失败',
                    icon: 'none'
                });
            }
        } catch (e) {
            console.error('[Points] 充值异常:', e);
            wx.showToast({ title: '支付发起失败', icon: 'none' });
        } finally {
            this.setData({ isRecharging: false });
        }
    },

    // 轮询更新余额（最多尝试 5 次，每次间隔 1 秒）
    async pollBalanceUpdate(oldPoints, attempt = 1) {
        if (attempt > 5) return; // 超时放弃主动刷新，这期间用户也可以手动刷新

        try {
            const res = await wx.cloud.callFunction({
                name: 'points',
                data: { action: 'getUserPoints' }
            });

            if (res.result && res.result.success) {
                const newPoints = res.result.data.points;
                // 如果积分变动了，说明回调已处理
                if (newPoints !== oldPoints) {
                    const app = getApp();
                    app.globalData.userPoints = newPoints;
                    wx.setStorageSync('userPoints', newPoints);
                    this.setData({ points: newPoints });
                    this.loadHistory(); // 刷新明细
                    return;
                }
            }
        } catch (e) { console.error('查询余额失败', e); }

        // 未更新，等待后重试
        setTimeout(() => {
            this.pollBalanceUpdate(oldPoints, attempt + 1);
        }, 1000);
    },

    // 加载真实收支明细
    async loadHistory() {
        try {
            const res = await wx.cloud.callFunction({
                name: 'points',
                data: { action: 'getHistory', limit: 50, skip: 0 }
            });

            if (res.result && res.result.success) {
                this.setData({ historyList: res.result.data || [] });
            }
        } catch (e) {
            console.error('[Points] 加载明细失败:', e);
        }
    }
})
