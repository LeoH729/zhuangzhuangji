// pages/feedback/feedback.js
Page({
    data: {
        contactIndex: 0,
        contactTypes: ['功能异常', '产品建议', '其他'],
        content: '',
        email: '',
        isSubmitting: false
    },

    onTypeChange(e) {
        this.setData({ contactIndex: e.detail.value });
    },

    onInput(e) {
        const field = e.currentTarget.dataset.field;
        this.setData({ [field]: e.detail.value });
    },

    submitFeedback() {
        // 验证反馈内容
        if (!this.data.content || this.data.content.trim() === '') {
            wx.showToast({ title: '请填写反馈内容', icon: 'none' });
            return;
        }

        // 防止重复提交
        if (this.data.isSubmitting) {
            return;
        }

        this.setData({ isSubmitting: true });
        wx.showLoading({ title: '提交中' });

        // 调用云函数提交反馈
        wx.cloud.callFunction({
            name: 'feedback',
            data: {
                action: 'submit',
                type: this.data.contactTypes[this.data.contactIndex],
                content: this.data.content,
                email: this.data.email
            },
            success: (res) => {
                console.log('反馈提交结果:', res);
                wx.hideLoading();

                if (res.result && res.result.success) {
                    wx.showToast({
                        title: '提交成功',
                        icon: 'success',
                        duration: 2000
                    });

                    // 清空表单
                    this.setData({
                        contactIndex: 0,
                        content: '',
                        email: '',
                        isSubmitting: false
                    });

                    // 延迟返回上一页
                    setTimeout(() => {
                        wx.navigateBack();
                    }, 2000);
                } else {
                    wx.showToast({
                        title: res.result?.message || '提交失败',
                        icon: 'none'
                    });
                    this.setData({ isSubmitting: false });
                }
            },
            fail: (err) => {
                console.error('调用云函数失败:', err);
                wx.hideLoading();
                wx.showToast({
                    title: '网络错误，请稍后重试',
                    icon: 'none'
                });
                this.setData({ isSubmitting: false });
            }
        });
    }
})
