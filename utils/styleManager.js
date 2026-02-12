const app = getApp();

class StyleManager {
    constructor() {
        this.CACHE_KEY = 'styleIconsCache';
        this.fs = wx.getFileSystemManager();
        this.localCache = wx.getStorageSync(this.CACHE_KEY) || {};
    }

    /**
     * 获取处理后的风格列表（图标优先使用本地缓存）
     * @param {Array} styles 云端配置的原始 styles 数组
     * @returns {Array} 处理后的 styles 数组
     */
    getStyles(styles) {
        if (!styles || !Array.isArray(styles)) return [];

        return styles.map(style => {
            const localPath = this.getAssetPath(style.icon);
            return {
                ...style,
                icon: localPath
            };
        });
    }

    /**
     * 获取资源的本地路径（如存在缓存则返回缓存路径，否则返回原链接）
     * @param {string} remoteUrl 远程链接
     */
    getAssetPath(remoteUrl) {
        if (!remoteUrl) return '';
        // 如果已经是本地路径或base64，直接返回
        if (!remoteUrl.startsWith('http') && !remoteUrl.startsWith('cloud:')) return remoteUrl;

        const cachedPath = this.localCache[remoteUrl];
        if (cachedPath) {
            // 校验文件是否存在
            try {
                this.fs.accessSync(cachedPath);
                return cachedPath;
            } catch (e) {
                // 文件已丢失，清除缓存记录
                delete this.localCache[remoteUrl];
                this._saveCache();
            }
        }
        return remoteUrl;
    }

    /**
     * 同步资源（静默下载新图片）
     * @param {Object} config 云端配置对象 (包含 styles, tips_image_url 等)
     * @returns {Promise<boolean>} 是否有更新（如果有新图片下载成功，返回 true）
     */
    async syncResources(config) {
        if (!config) return false;

        let hasUpdate = false;
        const downloadTasks = [];

        // 1. 同步风格图标
        if (config.styles && Array.isArray(config.styles)) {
            config.styles.forEach(style => {
                if (style.icon && this._needsDownload(style.icon)) {
                    downloadTasks.push(this._downloadAsset(style.icon));
                }
            });
        }

        // 2. 同步通用资源 (Tips, Banner)
        if (config.tips_image_url && this._needsDownload(config.tips_image_url)) {
            downloadTasks.push(this._downloadAsset(config.tips_image_url));
        }
        if (config.banner_image_url && this._needsDownload(config.banner_image_url)) {
            downloadTasks.push(this._downloadAsset(config.banner_image_url));
        }

        if (downloadTasks.length > 0) {
            console.log(`[StyleManager] 开始静默同步 ${downloadTasks.length} 个资源...`);
            const results = await Promise.all(downloadTasks);
            hasUpdate = results.some(success => success);
        }

        return hasUpdate;
    }

    /**
     * 判断是否需要下载
     */
    _needsDownload(url) {
        if (!url || (!url.startsWith('http') && !url.startsWith('cloud:'))) return false;
        // 如果缓存里没有，或者缓存文件被删了，就需要下载
        const cachedPath = this.localCache[url];
        if (!cachedPath) return true;
        try {
            this.fs.accessSync(cachedPath);
            return false; // 文件存在，无需下载
        } catch (e) {
            return true; // 文件丢失，需要下载
        }
    }

    /**
     * 下载单张图片
     */
    _downloadAsset(url) {
        return new Promise((resolve) => {
            // 如果是 cloud:// 协议，先换取临时链接（downloadFile虽然支持cloud://，但为了统一逻辑也可直接用）
            // wx.downloadFile 原生支持 cloud:// 
            wx.downloadFile({
                url: url,
                success: (res) => {
                    if (res.statusCode === 200) {
                        // 保存到本地用户目录
                        // 1. 去除 query 参数
                        const cleanUrl = url.split('?')[0];
                        // 2. 提取后缀
                        const ext = cleanUrl.match(/\.[^./]+$/) ? cleanUrl.match(/\.[^./]+$/)[0] : '.png';
                        // 使用 hash 作为文件名
                        const fileName = this._hash(url) + ext;
                        const savedFilePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

                        try {
                            // 写入文件
                            this.fs.saveFileSync(res.tempFilePath, savedFilePath);
                            // 更新缓存记录
                            this.localCache[url] = savedFilePath;
                            this._saveCache();
                            console.log(`[StyleManager] 资源已缓存: ${fileName}`);
                            resolve(true);
                        } catch (saveErr) {
                            console.error('[StyleManager] 保存文件失败:', saveErr);
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                },
                fail: (err) => {
                    console.error('[StyleManager] 下载失败:', url, err);
                    resolve(false);
                }
            });
        });
    }

    _saveCache() {
        wx.setStorage({
            key: this.CACHE_KEY,
            data: this.localCache
        });
    }

    // 简单的字符串 hash
    _hash(str) {
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }
}

module.exports = new StyleManager();
