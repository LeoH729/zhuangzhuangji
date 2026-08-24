// pages/points/points.js
const WxVirtualPaymentSDK = require('./virtual-payment.js');
const { report } = require('../../utils/analytics.js');

const PRODUCT_ID_MAP = {
    1: 'points_1',
    2: 'points_6',
    3: 'points_18',
    4: 'points_38',
    5: 'points_58',
    6: 'points_88'
};

function packageAnalytics(option = {}, extra = {}) {
    return Object.assign({
        package_id: option.id || '',
        product_id: PRODUCT_ID_MAP[option.id] || '',
        package_label: option.label || '',
        price_cents: Number(option.price || 0) * 100,
        points_amount: option.amount || 0
    }, extra);
}

Page({
    data: {
        generationNotice: { visible: false, taskId: '', message: '' },
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
        getApp().startDeferredBootstrap();
        this._successOrders = {};
        this.updatePoints();
        this.loadHistory();
        this.reconcilePendingOrders(); // 启动未核销订单扫描与发货补偿
    },

    onShow() {
        const app = getApp();
        app.syncGenerationNoticeToPage(this);
        report('points_page_view');
        // 每次返回页面刷新数据
        this.updatePoints();
        this.loadHistory();
        this.reconcilePendingOrders(); // 启动未核销订单扫描与发货补偿
    },

    updateGenerationNotice(notice) {
        this.setData({ generationNotice: notice || { visible: false, taskId: '', message: '' } });
    },

    onGenerationNoticeTap() {
        const app = getApp();
        app.goToGenerationHistoryFromNotice();
    },

    markRechargeSucceeded(orderNo, payload = {}) {
        if (orderNo && this._successOrders && this._successOrders[orderNo]) return;
        this._successOrders = this._successOrders || {};
        if (orderNo) this._successOrders[orderNo] = true;
        report('recharge_succeeded', payload);
    },

    async updatePoints() {
        try {
            const res = await wx.cloud.callFunction({
                name: 'points',
                data: { action: 'getUserPoints' }
            });

            if (res.result && res.result.success && res.result.data) {
                const pts = res.result.data.points || 0;
                const app = getApp();
                app.globalData.userPoints = pts;
                wx.setStorageSync('userPoints', pts);
                this.setData({ points: pts });
                return;
            }
        } catch (e) {
            console.error('[Points] 刷新余额失败:', e);
        }

        const app = getApp();
        const fallbackPoints = (app.globalData && typeof app.globalData.userPoints === 'number') ? app.globalData.userPoints : 0;
        this.setData({ points: fallbackPoints });
    },

    selectOption(e) {
        const id = e.currentTarget.dataset.id;
        this.setData({ selectedOptionId: id });
    },

    // 充值（接入微信虚拟支付合规流程）
    async onRecharge() {
        if (this.data.isRecharging) return;

        const option = this.data.rechargeOptions.find(o => o.id === this.data.selectedOptionId);
        if (!option) return;

        this.setData({ isRecharging: true });
        const analyticsBase = packageAnalytics(option);
        report('recharge_click', analyticsBase);

        try {
            const paymentOptions = {
                productId: PRODUCT_ID_MAP[option.id],
                goodsPrice: option.price * 100, // 元转分
                description: `星光充值-${option.label}套餐`,
                attach: JSON.stringify({
                    type: 'recharge',
                    eggAmount: option.amount, // 充值的星光数量 (维持字段名为eggAmount保持向后兼容)
                    optionId: option.id,
                    label: option.label
                })
            };

            console.log('[Points] 开始调起虚拟支付，参数:', paymentOptions);

            // 发起虚拟支付
            const result = await WxVirtualPaymentSDK.processPayment(paymentOptions);

            if (result.success) {
                wx.showToast({ title: '支付处理中...', icon: 'loading' });
                // 启动主动对账轮询与余额刷新（主动触发后端查单核销，确保 100% 极速到账）
                const app = getApp();
                this.pollBalanceWithOrderCheck(result.orderNo, app.globalData.userPoints || 0, analyticsBase);
            } else if (result.cancelled) {
                report('recharge_failed', Object.assign({}, analyticsBase, {
                    order_no: result.orderNo || '',
                    error_code: result.code || 'USER_CANCEL',
                    error_type: 'user_cancel',
                    failure_stage: 'user_cancel'
                }));
                wx.showToast({ title: '支付已取消', icon: 'none' });
            } else {
                report('recharge_failed', Object.assign({}, analyticsBase, {
                    order_no: result.orderNo || '',
                    error_code: result.code || '',
                    error_type: result.message || 'virtual_payment',
                    failure_stage: 'virtual_payment'
                }));
                wx.showToast({
                    title: result.message || '支付失败',
                    icon: 'none'
                });
            }
        } catch (e) {
            console.error('[Points] 虚拟支付调起异常:', e);
            const message = (e && (e.message || e.errMsg)) || '支付调起失败';
            const stage = /create|order|下单/.test(String(message)) ? 'create_order' : 'virtual_payment';
            report('recharge_failed', Object.assign({}, analyticsBase, {
                error_code: (e && (e.code || e.errno)) || '',
                error_type: message,
                failure_stage: stage
            }));
            wx.showToast({ title: '支付调起失败', icon: 'none' });
        } finally {
            this.setData({ isRecharging: false });
        }
    },

    // 主动对账轮询与余额更新（最多尝试 6 次，每次间隔 1.5 秒）
    async pollBalanceWithOrderCheck(orderNo, oldPoints, analyticsBase = {}, attempt = 1) {
        if (attempt > 6) {
            wx.hideLoading();
            return; // 轮询结束，若因微信网络延迟未到账，后续也会通过微信异步发货，用户也可手动刷新页面
        }

        try {
            console.log(`[Points] 第 ${attempt} 次主动发起查单对账:`, orderNo);
            
            // 1. 主动触发服务端的查单对账逻辑，对账成功时后端会直接核销并发货
            const queryRes = await wx.cloud.callFunction({
                name: 'virtualPayment',
                data: {
                    action: 'queryOrder',
                    orderNo: orderNo
                }
            });

            // 诊断与除错：如果返回明确的支付失败（如签名/商户配置等错误），弹出详细弹窗，避免静默掩盖
            if (queryRes.result && !queryRes.result.success) {
                console.error('[Points] 对账服务返回错误:', queryRes.result);
                report('recharge_failed', Object.assign({}, analyticsBase, {
                    order_no: orderNo || '',
                    error_code: queryRes.result.code || '',
                    error_type: queryRes.result.message || 'query_order',
                    failure_stage: 'query_order'
                }));
                wx.showModal({
                    title: '充值同步状态提示',
                    content: queryRes.result.message || '微信支付查单失败，请重试',
                    showCancel: false
                });
                return;
            }

            const isPaid = queryRes.result && queryRes.result.success && queryRes.result.status === 'PAID';

            // 2. 主动拉取用户最新的积分余额
            const ptsRes = await wx.cloud.callFunction({
                name: 'points',
                data: { action: 'getUserPoints' }
            });

            if (ptsRes.result && ptsRes.result.success) {
                const newPoints = ptsRes.result.data.points;
                // 如果积分变动了，或者后端查单确认成功，则刷新页面显示
                if (newPoints !== oldPoints || isPaid) {
                    const app = getApp();
                    app.globalData.userPoints = newPoints;
                    wx.setStorageSync('userPoints', newPoints);
                    this.setData({ points: newPoints });
                    this.loadHistory(); // 刷新收支明细
                    this.markRechargeSucceeded(orderNo, Object.assign({}, analyticsBase, { order_no: orderNo || '' }));
                    wx.showToast({ title: '充值成功', icon: 'success', duration: 3000 });
                    return;
                }
            }
        } catch (e) { 
            console.error('[Points] 轮询对账查单异常:', e);
            if (attempt === 1) {
                report('recharge_failed', Object.assign({}, analyticsBase, {
                    order_no: orderNo || '',
                    error_code: (e && (e.code || e.errno)) || '',
                    error_type: (e && (e.message || e.errMsg)) || 'query_order',
                    failure_stage: 'query_order'
                }));
            }
        }

        // 未核销，等待 1.5 秒后重试
        setTimeout(() => {
            this.pollBalanceWithOrderCheck(orderNo, oldPoints, analyticsBase, attempt + 1);
        }, 1500);
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
    },

    analyticsFromOrder(order = {}) {
        let option = {};
        try {
            const attach = typeof order.attach === 'string' ? JSON.parse(order.attach || '{}') : (order.attach || {});
            option = {
                id: attach.optionId,
                label: attach.label,
                amount: attach.eggAmount,
                price: Number(order.amount || 0) / 100
            };
        } catch (e) {}
        return packageAnalytics(option, { order_no: order.orderNo || '' });
    },

    // 自动扫描并核销未完成的订单（发货补偿与防漏单机制）
    async reconcilePendingOrders() {
        try {
            console.log('[Points] 启动未完成订单扫描...');
            const db = wx.cloud.database();
            // 查询当前用户 3 天内创建且状态仍为 CREATED 的虚拟支付订单
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
            const res = await db.collection('orders').where({
                status: 'CREATED',
                pay_type: 'VIRTUAL_PAYMENT',
                created_at: db.command.gte(threeDaysAgo)
            }).limit(5).get();

            if (res.data && res.data.length > 0) {
                console.log(`[Points] 发现 ${res.data.length} 笔未核销订单，启动后台补发流程...`);
                let hasReconciled = false;

                for (let i = 0; i < res.data.length; i += 1) {
                    const order = res.data[i];
                    console.log('[Points] 正在核销订单:', order.orderNo);
                    const queryRes = await wx.cloud.callFunction({
                        name: 'virtualPayment',
                        data: {
                            action: 'queryOrder',
                            orderNo: order.orderNo
                        }
                    });

                    if (queryRes.result && queryRes.result.success && queryRes.result.status === 'PAID') {
                        console.log(`[Points] 订单 ${order.orderNo} 补发发货成功！`);
                        this.markRechargeSucceeded(order.orderNo, this.analyticsFromOrder(order));
                        hasReconciled = true;
                    } else if (queryRes.result && !queryRes.result.success) {
                        report('recharge_failed', Object.assign({}, this.analyticsFromOrder(order), {
                            error_code: queryRes.result.code || '',
                            error_type: queryRes.result.message || 'query_order',
                            failure_stage: 'query_order'
                        }));
                    }
                }

                if (hasReconciled) {
                    // 只要有任意一笔补发成功，刷新余额和明细
                    this.updatePoints();
                    this.loadHistory();
                    wx.showToast({ title: '已自动同步充值记录', icon: 'success', duration: 3000 });
                }
            } else {
                console.log('[Points] 无待核销订单');
            }
        } catch (e) {
            console.error('[Points] 扫描未完成订单异常:', e);
        }
    }
})
