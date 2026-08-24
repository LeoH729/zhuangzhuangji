const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const miniProgramRoot = path.join(root, 'miniprogram')
const read = file => {
  const projectFile = path.join(root, file)
  const filePath = fs.existsSync(projectFile) ? projectFile : path.join(miniProgramRoot, file)
  return fs.readFileSync(filePath, 'utf8')
}

test('home APIs are cached, allowlisted and backward compatible', () => {
  const source = read('cloudfunctions/featureConfig/index.js')
  assert.match(source, /feature_home_cache/)
  assert.match(source, /CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/)
  assert.match(source, /case 'getHome'/)
  assert.match(source, /case 'getGroups'/)
  assert.match(source, /case 'getList'/)
  ;['_id', 'name', 'home_banner', 'points_cost', 'tag', 'hang_count', 'la_count', 'user_hang_count', 'user_la_count']
    .forEach(field => assert.match(source, new RegExp(`${field}: true`)))
  assert.equal(/CACHE_SCHEMA_VERSION\s*=\s*1/.test(source), false)
  assert.doesNotMatch(source, /toHomeCard[\s\S]{0,300}prompt/)
})

test('admin mutations invalidate derived home caches', () => {
  const source = read('cloudfunctions/adminApi/index.js')
  assert.match(source, /invalidateHomeCache/)
  assert.match(source, /rebuildHomeCache/)
  assert.match(source, /withHomeCacheInvalidation\(\(\) => publishFeature/)
  assert.match(source, /withHomeCacheInvalidation\(\(\) => saveRecommendationOrder/)
})

test('startup critical path contains no login, points or task restore', () => {
  const source = read('app.js')
  const onLaunch = source.match(/onLaunch\(options = \{\}\) \{([\s\S]*?)\n  \},/)
  assert.ok(onLaunch)
  assert.doesNotMatch(onLaunch[1], /getUserOpenId|initPointsData|checkAdminRole|restoreGenerationWatcher/)
  assert.match(source, /onHomeContentReady\(\)/)
  assert.match(source, /startDeferredBootstrap\(\)/)
})

test('home uses one getHome request, in-flight reuse and first-eight render', () => {
  const source = read('utils/zone-page.js')
  assert.match(source, /action: 'getHome'/)
  assert.doesNotMatch(source, /action: 'getGroups'|action: 'getList'/)
  assert.match(source, /inFlightRequests/)
  assert.match(source, /FIRST_RENDER_COUNT\s*=\s*8/)
  assert.match(source, /createIntersectionObserver/)
})

test('image cache avoids synchronous filesystem and storage operations', () => {
  const source = read('utils/image-cache.js')
  assert.doesNotMatch(source, /getStorageSync|setStorageSync|accessSync|mkdirSync|unlinkSync|saveFileSync/)
  assert.match(source, /META_WRITE_DELAY_MS\s*=\s*2000/)
  assert.match(source, /initializeImageCache/)
  assert.match(source, /invalidateCachedImage/)
})

test('heavy pages are subpackages and ad/payment code is isolated', () => {
  const appConfig = JSON.parse(read('app.json'))
  const packageNames = new Set((appConfig.subpackages || []).map(item => item.name))
  ;['feature', 'analyzing', 'result', 'points', 'generation-history'].forEach(name => assert.ok(packageNames.has(name)))
  assert.ok(appConfig.pages.includes('pages/boss-zone/boss-zone'))
  assert.ok(appConfig.pages.includes('pages/play-zone/play-zone'))
  assert.ok(appConfig.pages.includes('pages/profile/profile'))
  assert.match(read('pages/points/points.js'), /require\('\.\/virtual-payment\.js'\)/)
  assert.match(read('pages/analyzing/analyzing.js'), /require\('\.\/interstitial-ad\.js'\)/)
  assert.doesNotMatch(read('app.js'), /interstitial-ad|createInterstitialAd/)
})

test('V1.4.8 keeps the play-zone diagnostic banner without new-user ad preload', () => {
  const adConfig = read('utils/ad-config.js')
  const experiment = read('utils/ad-experiment.js')
  const zonePage = read('utils/zone-page.js')
  const homeMarkup = read('pages/boss-zone/boss-zone.wxml')
  assert.match(adConfig, /play_top_external_1069/)
  assert.match(adConfig, /play_top_internal/)
  assert.match(experiment, /externalDiagnosticBannerEnabled:\s*true/)
  assert.match(experiment, /internalDiagnosticBannerEnabled:\s*true/)
  assert.match(experiment, /newUserGiftPreloadEnabled:\s*false/)
  assert.doesNotMatch(experiment, /getStorageSync|setStorageSync/)
  assert.match(zonePage, /zone === 'play'/)
  assert.match(zonePage, /Number\(launchOptions\.scene \|\| 0\) === 1069/)
  assert.match(homeMarkup, /diagnosticBannerEnabled/)
  assert.match(homeMarkup, /ad-type="banner"/)
  assert.ok(homeMarkup.indexOf('class="group-filter') < homeMarkup.indexOf('class="diagnostic-banner-slot'))
  assert.ok(homeMarkup.indexOf('class="diagnostic-banner-slot') < homeMarkup.indexOf('class="waterfall'))
})

test('generation watcher uses owner-scoped batch status API', () => {
  assert.match(read('app.js'), /action: 'getTaskStatuses'/)
  const helper = read('cloudfunctions/aiGenerate/taskHelpers.js')
  assert.match(helper, /async function getTaskStatuses/)
  assert.match(helper, /_openid: openid, _id: _\.in\(ids\)/)
  assert.match(helper, /ids\.length > 20/)
})

test('rating counts remain visible on home cards and feature details', () => {
  const homeMarkup = read('pages/boss-zone/boss-zone.wxml')
  const detailMarkup = read('pages/feature/feature.wxml')
  ;[homeMarkup, detailMarkup].forEach(markup => {
    assert.match(markup, /hang_count/)
    assert.match(markup, /la_count/)
    assert.match(markup, />👍<\/text>/)
    assert.match(markup, />👎<\/text>/)
    assert.doesNotMatch(markup, />夯<\/text>|>拉<\/text>/)
  })
})

test('reward modal assets preload versioned CloudBase PNGs with a stable local cache and fallback', () => {
  const markup = read('components/reward-modal/reward-modal.wxml')
  const assets = ['images/reward-modal/queue-people.svg']
  assets.forEach(asset => {
    assert.match(markup, new RegExp(`/${asset.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`))
    assert.equal(fs.existsSync(path.join(miniProgramRoot, asset)), true)
  })
  const loader = read('utils/reward-assets.js')
  const component = read('components/reward-modal/reward-modal.js')
  assert.match(markup, /src="\{\{backgroundPath\}\}"/)
  assert.match(markup, /usingFallback/)
  assert.match(markup, /usingFallback \? 'reward-modal-card-fallback' : ''/)
  assert.match(loader, /reward-assets\/v1\.4\.8\/new-user-gift-bg-4b34144b\.png/)
  assert.match(loader, /reward-assets\/v1\.4\.8\/generation-boost-bg-f2f97dfe\.png/)
  assert.match(loader, /wx\.cloud\.downloadFile/)
  assert.match(loader, /wx\.env\.USER_DATA_PATH/)
  assert.match(loader, /wx\.getImageInfo/)
  assert.doesNotMatch(loader, /getStorageSync|setStorageSync|accessSync|saveFileSync/)
  assert.match(component, /getRewardAssetPath/)
  assert.match(read('app.js'), /preloadRewardAsset\('gift'\)/)
  assert.match(read('pages/feature/feature.js'), /preloadRewardAsset\('boost'\)/)
  assert.equal(fs.existsSync(path.join(miniProgramRoot, 'images/reward-modal/new-user-gift-bg.png')), false)
  assert.equal(fs.existsSync(path.join(miniProgramRoot, 'images/reward-modal/generation-boost-bg.png')), false)
  assert.equal(fs.existsSync(path.join(root, 'assets-source/reward-modal/new-user-gift-bg.png')), true)
  assert.equal(fs.existsSync(path.join(root, 'assets-source/reward-modal/generation-boost-bg.png')), true)
  const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.aac', '.m4a', '.ogg'])
  let mediaBytes = 0
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const itemPath = path.join(directory, entry.name)
    if (entry.isDirectory()) visit(itemPath)
    else if (mediaExtensions.has(path.extname(entry.name).toLowerCase())) mediaBytes += fs.statSync(itemPath).size
  })
  visit(miniProgramRoot)
  assert.ok(mediaBytes <= 200 * 1024, `packaged media must not exceed 200 KiB; received ${mediaBytes} bytes`)
  assert.doesNotMatch(markup, /src="\{\{[^\n]+reward-modal/)
  assert.doesNotMatch(markup, /reward-modal\/[^"']+\.webp/)
  assert.doesNotMatch(markup, /新人好礼背景|加速生成背景/)
})

test('pack configuration excludes non-miniprogram source trees and keeps SWC off', () => {
  const config = JSON.parse(read('project.config.json'))
  const ignores = new Set(config.packOptions.ignore.map(item => item.value))
  ;[
    'cloudrun/**', 'tests/**', 'web-app/**', 'admin-web/**', 'cloudfunctions/**', 'docs/**', 'scripts/**', '.tmp/**',
    'miniprogram/config/admin-v21-indexes.json', 'miniprogram/config/mcporter.json'
  ].forEach(value => assert.ok(ignores.has(value)))
  assert.equal(config.miniprogramRoot, 'miniprogram/')
  assert.equal(config.setting.ignoreDevUnusedFiles, true)
  assert.equal(config.setting.swc, false)
  assert.equal(config.setting.disableSWC, true)
})
