/**
 * 智能处理云开发图片链接：
 * 1. 将 tcb.qcloud.la 临时链接还原为原生 cloud:// 永久链接
 * 2. 对包含中文等特殊字符的 cloud:// 路径进行安全的 URL 编码，防止部分设备解析失败
 * @param {string} url 原始链接
 * @returns {string} 处理后的原生 cloud:// 链接
 */
function restoreCloudUrl(url) {
  if (typeof url !== 'string' || !url) {
    return url || '';
  }
  
  let cloudUrl = url;

  // 1. 如果是 https 的临时链接，先尝试将其还原为 cloud:// 格式
  if (url.includes('.tcb.qcloud.la/')) {
    const match = url.match(/^https:\/\/([^\.]+)\.tcb\.qcloud\.la\/(.+)$/);
    if (match) {
      const prefix = match[1];
      let path = match[2];
      const envMatch = prefix.match(/-(cloudbase-[^-]+)-/);
      if (envMatch) {
        const envId = envMatch[1];
        try {
          path = decodeURIComponent(path);
        } catch (e) {
          // ignore
        }
        cloudUrl = `cloud://${envId}.${prefix}/${path}`;
      }
    }
  }

  // 2. 对于所有的 cloud:// 链接，确保其路径部分被正确 encodeURI 编码（解决中文文件名无法加载的问题）
  if (cloudUrl.startsWith('cloud://')) {
    // 匹配 cloud://域名/路径 的格式
    const cloudMatch = cloudUrl.match(/^(cloud:\/\/[^\/]+\/)(.+)$/);
    if (cloudMatch) {
      const base = cloudMatch[1]; // cloud://envId.prefix/
      let path = cloudMatch[2];   // 神奇悬赏图.png
      
      // 先尝试 decode，防止已经被 encode 过导致重复 encode
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        // ignore
      }
      
      // 重新进行标准的整体 URL 编码
      return base + encodeURI(path);
    }
  }

  return cloudUrl;
}

/**
 * 将任意腾讯云链接（cloud:// 或 https://）转换为带图片处理样式的 HTTPS 链接。
 * 极大地压缩图片体积，防止由于图片过大导致网络并发失败和流量消耗。
 * @param {string} url 原始链接
 * @param {string} styleName 样式名称（如 'thumb'）
 * @returns {string} 带样式的 HTTPS 链接
 */
function getProcessedImageUrl(url, styleName = '') {
  if (typeof url !== 'string' || !url) return url || '';

  let httpsUrl = url;

  // 1. 如果是原生 cloud:// 协议，将其转换为 tcb.qcloud.la 的 HTTPS 链接
  if (url.startsWith('cloud://')) {
    const match = url.match(/^cloud:\/\/[^\.]+\.([^\/]+)\/(.+)$/);
    if (match) {
      const prefix = match[1];
      let path = match[2];
      try {
        // 先尝试 decode，再统一 encode，防止路径带中文导致解析失败
        path = encodeURI(decodeURIComponent(path));
      } catch (e) {
        path = encodeURI(path);
      }
      httpsUrl = `https://${prefix}.tcb.qcloud.la/${path}`;
    }
  } else if (url.startsWith('https://') && url.includes('.tcb.qcloud.la/')) {
    // 2. 如果已经是临时 HTTPS 链接，同样要确保中文路径的安全编码
    const match = url.match(/^https:\/\/([^\.]+)\.tcb\.qcloud\.la\/(.+)$/);
    if (match) {
      const prefix = match[1];
      let path = match[2];
      try {
        path = encodeURI(decodeURIComponent(path));
      } catch (e) {
        path = encodeURI(path);
      }
      httpsUrl = `https://${prefix}.tcb.qcloud.la/${path}`;
    }
  }

  // 3. 追加数据万象样式名称 (如果提供了样式，并且是腾讯云的链接)
  if (styleName && httpsUrl.startsWith('https://') && httpsUrl.includes('.tcb.qcloud.la/')) {
    // 如果已经有其他参数，清掉防冲突
    httpsUrl = httpsUrl.split('?')[0];
    // 防止重复追加
    if (!httpsUrl.endsWith(`/${styleName}`)) {
      httpsUrl = `${httpsUrl}/${styleName}`;
    }
  }

  return httpsUrl;
}

function appendRetryParam(url, retry = 0) {
  if (!retry || typeof url !== 'string' || !url || url.startsWith('cloud://')) {
    return url || '';
  }
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}_img_retry=${retry}`;
}

function buildImageUrl(rawUrl, options = {}) {
  const styleName = options.styleName || options.style || '';
  const retry = options.retry || 0;
  const useOriginal = !!options.useOriginal;

  if (typeof rawUrl !== 'string' || !rawUrl) {
    return rawUrl || '';
  }

  const safeUrl = restoreCloudUrl(rawUrl);
  const displayUrl = useOriginal
    ? getProcessedImageUrl(safeUrl, '')
    : getProcessedImageUrl(safeUrl, styleName);

  return appendRetryParam(displayUrl, retry);
}

module.exports = {
  restoreCloudUrl,
  getProcessedImageUrl,
  buildImageUrl,
  appendRetryParam
};
