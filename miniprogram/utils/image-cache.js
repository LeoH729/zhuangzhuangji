const CACHE_META_KEY = 'image_cache_meta_v2'
const CACHE_DIR_NAME = 'image-cache-v2'
const MAX_CACHE_BYTES = 100 * 1024 * 1024
const META_WRITE_DELAY_MS = 2000

let cacheMeta = { totalSize: 0, items: {} }
let initialized = false
let initializingPromise = null
let metaWriteTimer = null
const activeDownloads = new Set()

function canUseCache() {
  return typeof wx !== 'undefined' && wx.getFileSystemManager && wx.env && wx.env.USER_DATA_PATH
}

function getFs() {
  return wx.getFileSystemManager()
}

function getCacheDir() {
  return `${wx.env.USER_DATA_PATH}/${CACHE_DIR_NAME}`
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
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  return 'png'
}

function initializeImageCache() {
  if (initialized) return Promise.resolve(cacheMeta)
  if (initializingPromise) return initializingPromise
  if (!canUseCache() || !wx.getStorage) {
    initialized = true
    return Promise.resolve(cacheMeta)
  }
  initializingPromise = new Promise(resolve => {
    wx.getStorage({
      key: CACHE_META_KEY,
      success: (res) => {
        const data = res.data || {}
        cacheMeta = {
          totalSize: Number(data.totalSize || 0),
          items: data.items && typeof data.items === 'object' ? data.items : {}
        }
      },
      complete: () => {
        initialized = true
        resolve(cacheMeta)
      }
    })
  })
  return initializingPromise
}

function scheduleMetaWrite() {
  if (!initialized || metaWriteTimer || typeof wx === 'undefined' || !wx.setStorage) return
  metaWriteTimer = setTimeout(flushImageCacheMeta, META_WRITE_DELAY_MS)
}

function flushImageCacheMeta() {
  if (metaWriteTimer) {
    clearTimeout(metaWriteTimer)
    metaWriteTimer = null
  }
  if (!initialized || typeof wx === 'undefined' || !wx.setStorage) return
  wx.setStorage({ key: CACHE_META_KEY, data: cacheMeta, fail: () => {} })
}

function getCachedImagePath(rawUrl = '', styleName = '') {
  if (!initialized || !rawUrl) return ''
  const item = cacheMeta.items[getCacheKey(rawUrl, styleName)]
  if (!item || !item.path) return ''
  item.lastAccessAt = Date.now()
  scheduleMetaWrite()
  return item.path
}

function unlinkFile(path) {
  return new Promise(resolve => {
    if (!path || !canUseCache()) return resolve()
    getFs().unlink({ filePath: path, complete: resolve })
  })
}

async function removeCacheKey(key) {
  const item = cacheMeta.items[key]
  if (!item) return
  delete cacheMeta.items[key]
  cacheMeta.totalSize = Math.max(0, cacheMeta.totalSize - Number(item.size || 0))
  scheduleMetaWrite()
  await unlinkFile(item.path)
}

function invalidateCachedImage(imageState = {}) {
  if (!initialized || !imageState.rawUrl) return
  const key = getCacheKey(imageState.rawUrl, imageState.styleName || '')
  removeCacheKey(key).catch(() => {})
}

async function pruneCache(extraBytes = 0) {
  if (!initialized || !canUseCache()) return
  const entries = Object.keys(cacheMeta.items)
    .map(key => Object.assign({ key }, cacheMeta.items[key]))
    .sort((a, b) => Number(a.lastAccessAt || 0) - Number(b.lastAccessAt || 0))
  for (let i = 0; i < entries.length && cacheMeta.totalSize + extraBytes > MAX_CACHE_BYTES; i += 1) {
    await removeCacheKey(entries[i].key)
  }
}

function ensureCacheDir() {
  return new Promise(resolve => {
    const fs = getFs()
    const dirPath = getCacheDir()
    fs.access({
      path: dirPath,
      success: () => resolve(true),
      fail: () => fs.mkdir({ dirPath, recursive: true, success: () => resolve(true), fail: () => resolve(false) })
    })
  })
}

function getFileSize(filePath) {
  return new Promise(resolve => {
    getFs().getFileInfo({ filePath, success: info => resolve(Number(info.size || 0)), fail: () => resolve(0) })
  })
}

function saveFile(tempFilePath, filePath) {
  return new Promise(resolve => {
    getFs().saveFile({ tempFilePath, filePath, success: () => resolve(true), fail: () => resolve(false) })
  })
}

async function cacheImage(imageState = {}) {
  if (!canUseCache() || !imageState.rawUrl || !imageState.displayUrl || imageState.usingOriginalFallback) return
  if (!initialized) return
  const displayUrl = imageState.displayUrl
  if (displayUrl.startsWith(`${wx.env.USER_DATA_PATH}/`) || displayUrl.startsWith('cloud://')) return
  if (!displayUrl.startsWith('http://') && !displayUrl.startsWith('https://')) return

  const key = getCacheKey(imageState.rawUrl, imageState.styleName || '')
  if (cacheMeta.items[key] || activeDownloads.has(key)) return
  activeDownloads.add(key)
  try {
    const dirReady = await ensureCacheDir()
    if (!dirReady) return
    const download = await new Promise(resolve => {
      wx.downloadFile({ url: displayUrl, success: resolve, fail: () => resolve(null) })
    })
    if (!download || !download.tempFilePath || (download.statusCode && download.statusCode !== 200)) return
    const fileSize = await getFileSize(download.tempFilePath)
    if (!fileSize || fileSize > MAX_CACHE_BYTES) return
    await pruneCache(fileSize)
    const targetPath = `${getCacheDir()}/${key}.${getExtension(displayUrl)}`
    await unlinkFile(targetPath)
    const saved = await saveFile(download.tempFilePath, targetPath)
    if (!saved) return
    cacheMeta.items[key] = {
      rawUrl: imageState.rawUrl,
      styleName: imageState.styleName || '',
      path: targetPath,
      size: fileSize,
      createdAt: Date.now(),
      lastAccessAt: Date.now()
    }
    cacheMeta.totalSize = Object.keys(cacheMeta.items).reduce((sum, itemKey) => sum + Number(cacheMeta.items[itemKey].size || 0), 0)
    scheduleMetaWrite()
  } finally {
    activeDownloads.delete(key)
  }
}

module.exports = {
  MAX_CACHE_BYTES,
  cacheImage,
  flushImageCacheMeta,
  getCachedImagePath,
  initializeImageCache,
  invalidateCachedImage,
  pruneCache
}
