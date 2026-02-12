// pages/generation-history/generation-history.js
Page({
    data: {
        historyList: [],
        loading: true
    },

    onLoad(options) {
        this.loadHistory();
    },

    onShow() {
        // 每次进入页面刷新
        this.loadHistory();
    },

    async loadHistory() {
        this.setData({ loading: true });
        try {
            const db = wx.cloud.database();
            const res = await db.collection('generation_history')
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();

            const list = (res.data || []).map(item => {
                let dateStr = '';
                if (item.createdAt) {
                    const d = new Date(item.createdAt);
                    const pad = n => String(n).padStart(2, '0');
                    dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                }

                // 解析风格名称：优先使用记录中的 styleName，其次根据 styleId 查配置
                let displayStyleName = item.styleName;
                if (!displayStyleName && item.styleId) {
                    const app = getApp();
                    const cfg = (app.globalData && app.globalData.pointsConfig) || wx.getStorageSync('pointsConfig');
                    if (cfg && cfg.styles) {
                        const style = cfg.styles.find(s => s.id === item.styleId);
                        if (style) displayStyleName = style.name;
                    }
                }

                return {
                    id: item._id,
                    styleName: displayStyleName || item.styleId || '未知风格',
                    date: dateStr,
                    resultUrl: item.resultUrl || '',
                    photoUrl: item.photoUrl || ''
                };
            });

            this.setData({ historyList: list, loading: false });
        } catch (e) {
            console.error('[History] 加载生成记录失败:', e);
            this.setData({ historyList: [], loading: false });
        }
    },

    onViewImage(e) {
        const resultUrl = e.currentTarget.dataset.url;
        if (resultUrl) {
            // 收集所有有效的结果图 URL 用于左右滑动预览
            const allUrls = this.data.historyList
                .map(item => item.resultUrl)
                .filter(url => !!url);

            wx.previewImage({
                urls: allUrls.length > 0 ? allUrls : [resultUrl],
                current: resultUrl
            });
        }
    }
})
