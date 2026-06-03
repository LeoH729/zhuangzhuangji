const { buildImageUrl, restoreCloudUrl } = require('./format.js')
const { cacheImage, getCachedImagePath } = require('./image-cache.js')

const IMAGE_STYLES = {
  HOME_CARD: 'home_card',
  DETAIL_BANNER: 'detail_banner',
  TASK_THUMB: 'task_thumb',
  RESULT_PREVIEW: 'result_preview'
}

const RETRY_DELAYS = [800, 1500, 3000]

function sameImage(a = {}, rawUrl = '', styleName = '') {
  return a.rawUrl === restoreCloudUrl(rawUrl) && a.styleName === styleName
}

function createImageState(rawUrl, styleName = '', oldState = null, options = {}) {
  const normalizedRawUrl = restoreCloudUrl(rawUrl || '')
  const maxRetry = typeof options.maxRetry === 'number' ? options.maxRetry : 3

  if (oldState && sameImage(oldState, normalizedRawUrl, styleName)) {
    return Object.assign({}, oldState, { maxRetry })
  }

  return {
    rawUrl: normalizedRawUrl,
    displayUrl: getCachedImagePath(normalizedRawUrl, styleName) || buildImageUrl(normalizedRawUrl, { styleName }),
    loaded: false,
    error: false,
    retryCount: 0,
    maxRetry,
    styleName,
    usingOriginalFallback: false
  }
}

function markImageLoaded(imageState = {}) {
  return Object.assign({}, imageState, {
    loaded: true,
    error: false
  })
}

function getRetryDelay(retryCount = 1) {
  return RETRY_DELAYS[Math.min(Math.max(retryCount - 1, 0), RETRY_DELAYS.length - 1)]
}

function getNextRetryState(imageState = {}) {
  const retryCount = (imageState.retryCount || 0) + 1
  const maxRetry = imageState.maxRetry || 3

  if (retryCount > maxRetry) {
    return Object.assign({}, imageState, {
      loaded: true,
      error: true,
      retryCount: maxRetry
    })
  }

  const useOriginal = retryCount === maxRetry
  return Object.assign({}, imageState, {
    loaded: false,
    error: false,
    retryCount,
    usingOriginalFallback: useOriginal,
    displayUrl: buildImageUrl(imageState.rawUrl, {
      styleName: imageState.styleName,
      retry: retryCount,
      useOriginal
    })
  })
}

module.exports = {
  IMAGE_STYLES,
  createImageState,
  markImageLoaded,
  cacheImage,
  getNextRetryState,
  getRetryDelay
}
