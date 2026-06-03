const CACHE_META_KEY = 'image_cache_meta_v1'
const CACHE_DIR_NAME = 'image-cache'
const MAX_CACHE_BYTES = 100 * 1024 * 1024

function canUseCache() {
  return typeof wx !== 'undefined' && wx.getFileSystemManager && wx.env && wx.env.USER_DATA_PATH
}

function getFs() {
  return wx.getFileSystemManager()
}

function getCacheDir() {
  return `${wx.env.USER_DATA_PATH}/${CACHE_DIR_NAME}`
}

function getMeta() {
  return wx.getStorageSync(CACHE_META_KEY) || { totalSize: 0, items: {} }
}

function setMeta(meta) {
  wx.setStorageSync(CACHE_META_KEY, meta)
}

function hashKey(text = '') {
  let hash = 2166136261
  const str = String(text || '')
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function getCacheKey(rawUrl = '', styleName = '') {
  return hashKey(`${styleName || 'original'}::${rawUrl || ''}`)
}

function getExtension(url = '') {
  const cleanUrl = String(url || '').split('?')[0].split('/').pop() || ''
  const ext = cleanUrl.includes('.') ? cleanUrl.split('.').pop().toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'png'
}

function ensureCacheDir() {
  if (!canUseCache()) return false
  const fs = getFs()
  const dir = getCacheDir()
  try {
    fs.accessSync(dir)
  } catch (e) {
    try {
      fs.mkdirSync(dir, true)
    } catch (mkdirErr) {
      console.warn('[image-cache] mkdir failed', mkdirErr)
      return false
    }
  }
  return true
}

function fileExists(path) {
  if (!path || !canUseCache()) return false
  try {
    getFs().accessSync(path)
    return true
  } catch (e) {
    return false
  }
}

function getCachedImagePath(rawUrl = '', styleName = '') {
  if (!canUseCache() || !rawUrl) return ''
  const meta = getMeta()
  const key = getCacheKey(rawUrl, styleName)
  const item = meta.items && meta.items[key]
  if (!item || !item.path || !fileExists(item.path)) {
    if (item && meta.items) {
      meta.totalSize = Math.max(0, (meta.totalSize || 0) - (item.size || 0))
      delete meta.items[key]
      setMeta(meta)
    }
    return ''
  }

  item.lastAccessAt = Date.now()
  setMeta(meta)
  return item.path
}

function removeCacheItem(meta, key) {
  const item = meta.items[key]
  if (!item) return
  try {
    if (item.path && fileExists(item.path)) {
      getFs().unlinkSync(item.path)
    }
  } catch (e) {
    console.warn('[image-cache] unlink failed', e)
  }
  meta.totalSize = Math.max(0, (meta.totalSize || 0) - (item.size || 0))
  delete meta.items[key]
}

function pruneCache(meta = getMeta(), extraBytes = 0) {
  if (!canUseCache()) return
  const items = meta.items || {}
  let total = meta.totalSize || 0
  const entries = Object.keys(items)
    .map(key => Object.assign({ key }, items[key]))
    .sort((a, b) => (a.lastAccessAt || 0) - (b.lastAccessAt || 0))

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (total + extraBytes <= MAX_CACHE_BYTES) break
    removeCacheItem(meta, entry.key)
    total = meta.totalSize || 0
  }
  setMeta(meta)
}

function cacheImage(imageState = {}) {
  if (!canUseCache() || !imageState.rawUrl || !imageState.displayUrl) return
  if (imageState.usingOriginalFallback) return
  if (imageState.displayUrl.startsWith(`${wx.env.USER_DATA_PATH}/`)) return
  if (imageState.displayUrl.startsWith('cloud://')) return

  const rawUrl = imageState.rawUrl
  const styleName = imageState.styleName || ''
  const displayUrl = imageState.displayUrl
  const key = getCacheKey(rawUrl, styleName)
  const meta = getMeta()
  if (meta.items && meta.items[key] && fileExists(meta.items[key].path)) {
    meta.items[key].lastAccessAt = Date.now()
    setMeta(meta)
    return
  }
  if (!displayUrl.startsWith('http://') && !displayUrl.startsWith('https://')) return
  if (!ensureCacheDir()) return

  wx.downloadFile({
    url: displayUrl,
    success: (res) => {
      if (!res.tempFilePath || (res.statusCode && res.statusCode !== 200)) return
      const fs = getFs()
      const ext = getExtension(displayUrl)
      const targetPath = `${getCacheDir()}/${key}.${ext}`
      fs.getFileInfo({
        filePath: res.tempFilePath,
        success: (info) => {
          const fileSize = info.size || 0
          if (!fileSize || fileSize > MAX_CACHE_BYTES) return
          const freshMeta = getMeta()
          freshMeta.items = freshMeta.items || {}
          pruneCache(freshMeta, fileSize)
          try {
            if (fileExists(targetPath)) {
              fs.unlinkSync(targetPath)
            }
            fs.saveFileSync(res.tempFilePath, targetPath)
            freshMeta.items[key] = {
              rawUrl,
              styleName,
              path: targetPath,
              size: fileSize,
              createdAt: Date.now(),
              lastAccessAt: Date.now()
            }
            freshMeta.totalSize = Object.keys(freshMeta.items).reduce((sum, itemKey) => {
              return sum + (freshMeta.items[itemKey].size || 0)
            }, 0)
            pruneCache(freshMeta, 0)
          } catch (copyErr) {
            console.warn('[image-cache] copy failed', copyErr)
          }
        }
      })
    },
    fail: (err) => {
      console.warn('[image-cache] download failed', err)
    }
  })
}

module.exports = {
  MAX_CACHE_BYTES,
  cacheImage,
  getCachedImagePath,
  pruneCache
}
