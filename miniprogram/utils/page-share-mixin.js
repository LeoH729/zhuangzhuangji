/**
 * 全局 Page 混入：自动为所有页面注入分享能力
 * 
 * 原理：重写 Page 构造函数，在页面配置中检测是否已有分享函数。
 * - 如果页面已定义了 onShareAppMessage / onShareTimeline，保留页面自定义逻辑（不覆盖）
 * - 如果页面未定义，注入默认的分享逻辑
 * 
 * 使用方式：在 app.js 最顶部 require 此文件即可
 */

const {
    HOME_PATH,
    HOME_SHARE_TITLE,
    pickRandom,
    getDefaultShareConfig
} = require('./share.js');

const _originalPage = Page;

Page = function (config) {
    const originalOnLoad = config.onLoad;
    config.onLoad = function (options = {}) {
        if (options.shareTarget === 'home') {
            wx.switchTab({ url: HOME_PATH });
            return;
        }
        if (options.shareTarget === 'feature' && options.featureId) {
            wx.redirectTo({ url: `/pages/feature/feature?id=${options.featureId}` });
            return;
        }
        if (typeof originalOnLoad === 'function') {
            return originalOnLoad.call(this, options);
        }
    };

    // 注入默认的「分享给朋友」
    if (!config.onShareAppMessage) {
        config.onShareAppMessage = function () {
            const shareConfig = getDefaultShareConfig(this.route);
            return {
                title: shareConfig.title || HOME_SHARE_TITLE,
                path: shareConfig.path || HOME_PATH
            };
        };
    }

    // 注入默认的「分享到朋友圈」
    if (!config.onShareTimeline) {
        config.onShareTimeline = function () {
            const shareConfig = getDefaultShareConfig(this.route);
            return {
                title: pickRandom(shareConfig.timelineTitles) || shareConfig.timelineTitle || HOME_SHARE_TITLE,
                query: shareConfig.timelineRedirectHome ? 'shareTarget=home' : ''
            };
        };
    }

    return _originalPage(config);
};
