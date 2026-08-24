const REWARD_ASSET_CACHE_DIR = 'reward-assets-v1.4.8'

const REWARD_ASSETS = {
  gift: {
    fileID: 'cloud://cloudbase-5gmfinom29f48930.636c-cloudbase-5gmfinom29f48930-1380597463/reward-assets/v1.4.8/new-user-gift-bg-4b34144b.png',
    fileName: 'new-user-gift-bg-4b34144b.png',
    expectedBytes: 114459
  },
  boost: {
    fileID: 'cloud://cloudbase-5gmfinom29f48930.636c-cloudbase-5gmfinom29f48930-1380597463/reward-assets/v1.4.8/generation-boost-bg-f2f97dfe.png',
    fileName: 'generation-boost-bg-f2f97dfe.png',
    expectedBytes: 94936
  }
}

const readyPaths = {}
const activePreloads = {}

function canUseRewardAssetCache() {
  return typeof wx !== 'undefined' && wx.cloud && wx.cloud.downloadFile && wx.getFileSystemManager && wx.env && wx.env.USER_DATA_PATH
}

function getFs() {
  return wx.getFileSystemManager()
}

function getCacheDir() {
  return `${wx.env.USER_DATA_PATH}/${REWARD_ASSET_CACHE_DIR}`
}

function getTargetPath(asset) {
  return `${getCacheDir()}/${asset.fileName}`
}

function ensureDir() {
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
    getFs().getFileInfo({ filePath, success: result => resolve(Number(result.size || 0)), fail: () => resolve(0) })
  })
}

function removeFile(filePath) {
  return new Promise(resolve => {
    getFs().unlink({ filePath, complete: resolve })
  })
}

function saveFile(tempFilePath, filePath) {
  return new Promise(resolve => {
    getFs().saveFile({ tempFilePath, filePath, success: () => resolve(true), fail: () => resolve(false) })
  })
}

function predecodeImage(src) {
  return new Promise(resolve => {
    if (!wx.getImageInfo) return resolve(false)
    wx.getImageInfo({ src, success: () => resolve(true), fail: () => resolve(false) })
  })
}

async function loadRewardAsset(variant) {
  const asset = REWARD_ASSETS[variant]
  if (!asset || !canUseRewardAssetCache()) return ''

  const dirReady = await ensureDir()
  if (!dirReady) return ''

  const targetPath = getTargetPath(asset)
  const cachedSize = await getFileSize(targetPath)
  if (cachedSize === asset.expectedBytes) {
    const decoded = await predecodeImage(targetPath)
    if (decoded) {
      readyPaths[variant] = targetPath
      return targetPath
    }
  }

  if (cachedSize) await removeFile(targetPath)

  let downloaded = null
  try {
    downloaded = await wx.cloud.downloadFile({ fileID: asset.fileID })
  } catch (_) {
    return ''
  }
  if (!downloaded || !downloaded.tempFilePath) return ''

  const downloadedSize = await getFileSize(downloaded.tempFilePath)
  if (downloadedSize !== asset.expectedBytes) return ''

  const saved = await saveFile(downloaded.tempFilePath, targetPath)
  if (!saved) return ''
  const decoded = await predecodeImage(targetPath)
  if (!decoded) {
    await removeFile(targetPath)
    return ''
  }

  readyPaths[variant] = targetPath
  return targetPath
}

function preloadRewardAsset(variant) {
  if (readyPaths[variant]) return Promise.resolve(readyPaths[variant])
  if (activePreloads[variant]) return activePreloads[variant]
  activePreloads[variant] = loadRewardAsset(variant).finally(() => {
    delete activePreloads[variant]
  })
  return activePreloads[variant]
}

function getRewardAssetPath(variant) {
  return readyPaths[variant] || ''
}

module.exports = {
  REWARD_ASSETS,
  getRewardAssetPath,
  preloadRewardAsset
}
