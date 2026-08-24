const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const miniProgramRoot = path.join(root, 'miniprogram')
const read = (relativePath) => {
  const projectFile = path.join(root, relativePath)
  const filePath = fs.existsSync(projectFile) ? projectFile : path.join(miniProgramRoot, relativePath)
  return fs.readFileSync(filePath, 'utf8')
}

test('public model and template endpoints cannot mutate configuration', () => {
  const modelConfig = read('cloudfunctions/modelConfig/index.js')
  const featureConfig = read('cloudfunctions/featureConfig/index.js')
  assert.match(modelConfig, /case 'create':[\s\S]*ADMIN_ONLY/)
  assert.match(featureConfig, /case 'create':[\s\S]*ADMIN_ONLY/)
  assert.match(modelConfig, /delete copy\.api_key/)
})

test('public points recharge is disabled and internal recharge needs a token', () => {
  const points = read('cloudfunctions/points/index.js')
  assert.match(points, /case 'recharge':[\s\S]*FORBIDDEN/)
  assert.match(points, /case 'internalRecharge'/)
  assert.match(points, /INTERNAL_FUNCTION_TOKEN/)
})

test('save panel distinguishes click, success and failure for original and HD variants', () => {
  const resultPage = read('pages/result/result.js')
  for (const name of ['original_save_click', 'hd_save_click', 'hd_save_failed']) {
    assert.match(resultPage, new RegExp(name))
  }
  assert.match(resultPage, /_save_succeeded/)
  assert.match(resultPage, /_save_failed/)
  const openPanelBlock = resultPage.slice(resultPage.indexOf('saveImage()'), resultPage.indexOf('reportSaveEvent('))
  assert.doesNotMatch(openPanelBlock, /original_save_click/)
})

test('operations dashboard standard events and attribution fields are wired in the mini program', () => {
  const app = read('app.js')
  const analytics = read('utils/analytics.js')
  const zonePage = read('utils/zone-page.js')
  const feature = read('pages/feature/feature.js')
  const analyzing = read('pages/analyzing/analyzing.js')
  const result = read('pages/result/result.js')
  const ingest = read('cloudfunctions/analyticsIngest/index.js')
  const aggregate = read('cloudfunctions/analyticsAggregate/index.js')
  const allClientSource = [app, analytics, feature, analyzing, result].join('\n')

  ;[
    'app_open', 'template_detail_view', 'template_generate_click',
    'generation_submitted', 'generation_succeeded', 'generation_failed',
    'original_save_click', 'original_save_succeeded', 'original_save_failed',
    'hd_save_click', 'hd_save_succeeded', 'hd_save_failed'
  ].forEach(eventName => {
    assert.match(`${allClientSource}\n${ingest}`, new RegExp(eventName))
    assert.match(ingest, new RegExp(`'${eventName}'`))
  })

  assert.match(zonePage, /sourceGroup=/)
  assert.match(feature, /this\.data\.sourceGroup \|\| feature\.group/)
  assert.match(feature, /this\.data\.sourceZone \|\| feature\.placements/)
  assert.match(result, /category_id: this\.data\.sourceGroup/)
  assert.match(result, /zone: this\.data\.sourceZone/)
  assert.match(analytics, /session_id/)
  assert.match(analytics, /channel: classifyChannel/)
  assert.match(app, /version: '1\.4\.8'/)
  assert.match(aggregate, /source: _\.neq\('admin_debug'\)/)
})

test('feedback no longer collects or exposes contact details', () => {
  const feedbackPage = [
    read('pages/feedback/feedback.js'),
    read('pages/feedback/feedback.wxml'),
    read('pages/feedback-list/feedback-list.js'),
    read('pages/feedback-list/feedback-list.wxml')
  ].join('\n')
  const feedbackFunction = read('cloudfunctions/feedback/index.js')
  const operationsPanel = read('admin-web/src/v2/OperationsPanels.jsx')
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const listStart = adminApi.indexOf('async function listFeedbacks')
  const listEnd = adminApi.indexOf('async function updateFeedback', listStart)
  const listBlock = adminApi.slice(listStart, listEnd)

  assert.doesNotMatch(feedbackPage, /\b(?:email|phone|contact)\b|联系方式|手机号|邮箱/i)
  assert.doesNotMatch(feedbackFunction, /\b(?:email|phone|contact)\b/i)
  assert.doesNotMatch(operationsPanel, /maskContact|联系方式|item\.(?:email|phone|contact)/i)
  assert.doesNotMatch(listBlock, /keywordFields:\s*\[[^\]]*(?:email|phone|contact)/i)
  assert.match(listBlock, /delete safeItem\.email/)
  assert.match(listBlock, /delete safeItem\.phone/)
  assert.match(listBlock, /delete safeItem\.contact/)
})

test('analytics ingestion is allowlisted and idempotent', () => {
  const ingest = read('cloudfunctions/analyticsIngest/index.js')
  assert.match(ingest, /ALLOWED_EVENTS/)
  assert.match(ingest, /runTransaction/)
  assert.match(ingest, /doc\(item\.eventId\)/)
  assert.doesNotMatch(ingest, /prompt|image_url|nickname/i)
})

test('generated image save status reuses precise save-success events and preserves historical unknowns', () => {
  const ingest = read('cloudfunctions/analyticsIngest/index.js')
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const adminWeb = read('admin-web/src/main.jsx')
  const imageCenter = read('admin-web/src/v2/V22Panels.jsx')
  assert.match(ingest, /field === 'result_id'[\s\S]{0,120}source\.history_id \|\| source\.historyId/)
  assert.match(adminApi, /analyticsEvents: 'analytics_events'/)
  assert.match(adminApi, /startsWith\('generated_results\/'\)/)
  assert.match(adminApi, /original_save_succeeded/)
  assert.match(adminApi, /hd_save_succeeded/)
  assert.match(adminApi, /saveStatus: 'unknown'/)
  assert.match(adminApi, /saveStatus: saved \? 'saved' : 'not_saved'/)
  assert.match(adminApi, /collectEvents\('generationId', generationIds\)/)
  assert.match(adminApi, /supportsPreciseSaveTracking/)
  assert.match(adminWeb, />是否被保存<\/th>/)
  assert.match(adminWeb, /历史版本没有精确保存成功埋点/)
  assert.match(imageCenter, />是否被保存<\/th>/)
  assert.match(imageCenter, /imageSaveText/)
})

test('HD save rate uses HD clicks divided by original clicks and null for zero denominator', () => {
  const analytics = read('cloudfunctions/adminAnalytics/index.js')
  const aggregate = read('cloudfunctions/analyticsAggregate/index.js')
  assert.match(analytics, /hdSaveRate: ratio\(hdClicks, originalClicks\)/)
  assert.match(aggregate, /hd_save_rate: rate\(hdClicks, originalClicks\)/)
  assert.match(aggregate, /denominator > 0 \? numerator \/ denominator : null/)
})

test('V2.2 template publication uses one-pass field validation without version or test gates', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const publishStart = adminApi.indexOf('async function publishFeature')
  const publishEnd = adminApi.indexOf('async function scheduleTemplatePublish', publishStart)
  const publishBlock = adminApi.slice(publishStart, publishEnd)
  const dispatchStart = adminApi.indexOf('async function dispatch')
  const dispatchBlock = adminApi.slice(dispatchStart)
  assert.match(publishBlock, /checkFeaturePublish/)
  assert.match(publishBlock, /validation\.errors/)
  assert.doesNotMatch(publishBlock, /VERSION_NOTE_REQUIRED|testCount < 5|recordTemplateVersion/)
  assert.doesNotMatch(dispatchBlock, /case 'listTemplateVersions'|case 'rollbackTemplate'|case 'scheduleTemplatePublish'/)
})

test('V2.2 rating is transactional and maintains real compatibility counters', () => {
  const generation = read('cloudfunctions/aiGenerate/index.js')
  const adminApi = read('cloudfunctions/adminApi/index.js')
  assert.match(generation, /runTransaction/)
  assert.match(generation, /user_hang_count/)
  assert.match(generation, /hang_count/)
  assert.match(adminApi, /async function rebuildTemplateRatingCounts/)
  assert.match(adminApi, /generationHistory/)
})

test('V2 contract documents and scheduled rollup are registered', () => {
  const config = JSON.parse(read('cloudbaserc.json'))
  const names = config.functions.map((item) => item.name)
  for (const name of ['analyticsIngest', 'analyticsAggregate', 'adminAnalytics', 'adminApi']) {
    assert.ok(names.includes(name), `${name} should be deployed`)
  }
  assert.ok(!names.includes('templatePublishScheduler'), 'V2.2 must stop deploying the scheduled template publisher')
  for (const doc of ['后台重制产品方案V2.md', '后台统一命名与数据字典.md', '小程序埋点与运营指标规范V2.md']) {
    assert.ok(fs.existsSync(path.join(root, 'docs', doc)), `${doc} should exist`)
  }
})

test('V2.1 template drafts remain drafts and can be unassigned', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const adminWeb = read('admin-web/src/main.jsx')
  assert.match(adminApi, /lifecycle_status: 'draft'/)
  assert.match(adminApi, /is_unassigned: isUnassigned/)
  assert.match(adminApi, /LEGACY_WRITE_DISABLED/)
  assert.match(adminWeb, /\['', '全部模板'\]/)
  assert.match(adminWeb, /\['unassigned', '未归类'\]/)
})

test('V2.1 admin removes native dialogs and uses Chinese status mapping', () => {
  const files = ['admin-web/src/main.jsx', 'admin-web/src/v2/OperationsPanels.jsx', 'admin-web/src/v2/ui.jsx']
  const source = files.map(read).join('\n')
  assert.doesNotMatch(source, /window\.(confirm|prompt|alert)\s*\(/)
  assert.match(source, /succeeded: '成功'/)
  assert.match(source, /ConfirmDialogHost/)
  assert.match(read('admin-web/index.html'), /AI 造梦馆运营后台/)
})

test('V2.1 user list uses database pagination instead of reading the whole collection', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const start = adminApi.indexOf('async function listUsers')
  const end = adminApi.indexOf('async function revealSensitiveValue', start)
  const block = adminApi.slice(start, end)
  assert.match(block, /orderBy\(safeSortBy, sortOrder\)\.skip\(/)
  assert.match(block, /\.limit\(pageSize\)/)
  assert.doesNotMatch(block, /while \(true\)|for \(let skip/)
})

test('user list ignores empty min/max points filters and is strictly read-only', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const start = adminApi.indexOf('async function listUsers')
  const end = adminApi.indexOf('async function revealSensitiveValue', start)
  const block = adminApi.slice(start, end)
  const enrichStart = adminApi.indexOf('async function enrichUserRows')
  const enrichBlock = adminApi.slice(enrichStart, start)
  assert.match(adminApi, /function parseOptionalNumber/)
  assert.match(block, /parseOptionalNumber\(filters.minPoints\)/)
  assert.match(block, /parseOptionalNumber\(filters.maxPoints\)/)
  assert.match(enrichBlock, /const points = readUserPoints\(item\)/)
  assert.doesNotMatch(enrichBlock, /sumHistoryPoints|COLLECTIONS\.users|\.update\(|\.set\(/)
  const usersPanel = read('admin-web/src/main.jsx')
  assert.match(usersPanel, /minPoints !== '' \? \{ minPoints \}/)
})

test('V2.1 password reset is super-admin controlled and forces a password change', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  assert.match(adminApi, /SUPER_ADMIN_ACTIONS[^\n]*resetAdminPassword/)
  assert.match(adminApi, /SELF_RESET_FORBIDDEN/)
  assert.match(adminApi, /passwordResetRequired: true/)
  assert.match(adminApi, /30 \* 60 \* 1000/)
  assert.match(adminApi, /PASSWORD_RESET_REQUIRED/)
})

test('V2.1 audit redacts sensitive fields and exposes business labels', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  assert.match(adminApi, /api\[_-\]\?key\|password\|token\|secret\|openid\|phone\|email\|url\|banner\|prompt/)
  assert.match(adminApi, /actionLabel: ACTION_LABELS\[action\]/)
  assert.match(adminApi, /changeSummary: sanitized/)
})

test('generation ratio follows explicit input, template config, then prompt before 1:1 fallback', () => {
  const taskHelpers = read('cloudfunctions/aiGenerate/taskHelpers.js')
  assert.match(taskHelpers, /function extractAspectRatioFromPrompt/)
  assert.match(taskHelpers, /templateAspectRatio \|\| promptAspectRatio \|\| '1:1'/)
  assert.doesNotMatch(taskHelpers, /normalizeAspectRatio\(feature\.size, '1:1'\)/)
})

test('V2.2 dashboard separates business date from the 7/15/30 day trend window', () => {
  const analytics = read('cloudfunctions/adminAnalytics/index.js')
  const dashboard = read('admin-web/src/v2/DashboardPanel.jsx')
  assert.match(analytics, /business_date/)
  assert.match(analytics, /\[7, 15, 30\]/)
  assert.match(analytics, /generation_performance/)
  assert.match(dashboard, /近15天/)
  assert.match(dashboard, /业务日期/)
  assert.doesNotMatch(dashboard, /自定义/)
})

test('V2.2 recommendation ordering is per zone+group and ignores rating counters', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const featureConfig = read('cloudfunctions/featureConfig/index.js')
  const panel = read('admin-web/src/v2/V22Panels.jsx')
  const saveStart = adminApi.indexOf('async function saveRecommendationOrder')
  const saveEnd = adminApi.indexOf('function normalizeFeaturePayload', saveStart)
  const saveBlock = adminApi.slice(saveStart, saveEnd)
  assert.match(saveBlock, /请选择有效的专区/)
  assert.match(saveBlock, /请选择有效的分类/)
  assert.match(saveBlock, /featureMatchesGroup/)
  assert.match(saveBlock, /tag: next\.tag/)
  assert.doesNotMatch(adminApi, /请选择有效的专区和推荐标识/)
  assert.match(adminApi, /async function migrateRecommendationOrderV22/)
  assert.match(adminApi, /recommendationOrderMigration: 'v2\.2'/)
  assert.match(featureConfig, /function getPlacementSortOrder\(feature = \{\}, zone = 'play', group = ''\)/)
  assert.match(featureConfig, /sortFeatures\(published.filter\(item => matchesPlacement\(item, zone, selectedGroup\)\), zone, selectedGroup\)/)
  assert.match(featureConfig, /localeCompare/)
  assert.match(featureConfig, /async function listPublishedFeatures/)
  assert.doesNotMatch(featureConfig, /getTagWeight/)
  assert.doesNotMatch(featureConfig, /tag === 'new'/)
  const sortStart = featureConfig.indexOf('function sortFeatures')
  const sortEnd = featureConfig.indexOf('function toHomeCard', sortStart)
  const sortBlock = featureConfig.slice(sortStart, sortEnd)
  assert.doesNotMatch(sortBlock, /hang_count|la_count/)
  assert.match(panel, /推荐标识只作为标签，不影响排序/)
  assert.match(panel, /listGroups/)
  assert.match(panel, /draft_tag/)
  assert.match(panel, /categoryId: selectedGroup/)
  assert.doesNotMatch(panel, /aria-selected=\{badge ===/)
})

test('user list enriches points and last reason labels', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const usersPanel = read('admin-web/src/main.jsx')
  const points = read('cloudfunctions/points/index.js')
  const virtualPayment = read('cloudfunctions/virtualPayment/index.js')
  assert.match(adminApi, /async function enrichUserRows/)
  assert.match(adminApi, /lastReasonLabel/)
  assert.match(adminApi, /后台同步用户/)
  assert.match(adminApi, /星光充值/)
  assert.match(adminApi, /COLLECTIONS\.pointsHistory/)
  assert.match(usersPanel, /item\.lastReasonLabel \|\| item\.lastReason/)
  assert.match(points, /lastReason: reason \|\| 'recharge'/)
  assert.match(virtualPayment, /lastReason: `recharge_vp_\$\{order\.amount\}`/)
})

test('admin operations expose requested full user ids and lifetime generation counts', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const main = read('admin-web/src/main.jsx')
  const imageCenter = read('admin-web/src/v2/V22Panels.jsx')
  const operations = read('admin-web/src/v2/OperationsPanels.jsx')
  assert.match(adminApi, /successfulGenerationCount/)
  assert.match(adminApi, /COLLECTIONS\.generationHistory[\s\S]{0,240}\.aggregate\(\)/)
  assert.match(main, />生图次数<\/th>/)
  assert.match(main, /item\.successfulGenerationCount/)
  assert.match(imageCenter, /item\.generatedOpenid \|\| item\._openid \|\| '—'/)
  assert.doesNotMatch(imageCenter, /maskIdentifier\(item\.generatedOpenid/)
  assert.match(operations, /item\._openid \|\| '—'/)
  assert.doesNotMatch(operations, /maskIdentifier\(item\._openid\)/)
})

test('image center resolves full uploader or generator id for input and result images', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const main = read('admin-web/src/main.jsx')
  const imageCenter = read('admin-web/src/v2/V22Panels.jsx')
  assert.match(adminApi, /\{ photoUrl: _\.in\(candidates\) \}/)
  assert.match(adminApi, /\{ originalImages: _\.in\(candidates\) \}/)
  assert.match(adminApi, /\{ imageUrls: _\.in\(candidates\) \}/)
  assert.match(adminApi, /ownerOpenid:/)
  assert.match(main, />上传\/生成用户<\/th>/)
  assert.match(imageCenter, />上传\/生成用户<\/th>/)
  assert.match(imageCenter, /item\.ownerOpenid \|\| item\.generatedOpenid/)
})

test('payment dashboard supports today and does not treat zero optional events as missing tracking', () => {
  const analytics = read('cloudfunctions/adminAnalytics/index.js')
  const dashboard = read('admin-web/src/v2/DashboardPanel.jsx')
  assert.match(analytics, /\[1, 7, 15, 30\]/)
  assert.match(analytics, /const supportedEvents = new Set\(requiredEvents\)/)
  assert.match(dashboard, /<option value="1">今日<\/option>/)
})

test('points recharge analytics events are allowlisted and aggregated', () => {
  const ingest = read('cloudfunctions/analyticsIngest/index.js')
  const analytics = read('cloudfunctions/adminAnalytics/index.js')
  const dashboard = read('admin-web/src/v2/DashboardPanel.jsx')
  const pointsPage = read('pages/points/points.js')
  for (const name of ['points_page_view', 'recharge_click', 'recharge_succeeded', 'recharge_failed']) {
    assert.match(ingest, new RegExp(name))
    assert.match(pointsPage, new RegExp(name))
  }
  assert.match(ingest, /package_id/)
  assert.match(ingest, /failure_stage/)
  assert.match(analytics, /payment_performance/)
  assert.match(analytics, /failure_details/)
  assert.match(analytics, /payment_days/)
  assert.match(dashboard, /星光套餐/)
  assert.match(dashboard, /购买失败原因/)
  assert.match(dashboard, /dashboard-three-column/)
})

test('V2.2 image center separates user and operations images and protects referenced files', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const panel = read('admin-web/src/v2/V22Panels.jsx')
  assert.match(adminApi, /USER_IMAGE_PREFIXES/)
  assert.match(adminApi, /OPERATIONS_IMAGE_PREFIXES/)
  assert.match(adminApi, /scope === 'operations'/)
  assert.match(adminApi, /getImageReferences\(asset\)/)
  assert.match(adminApi, /listOperationsStorageAssets/)
  assert.match(adminApi, /Pictures/)
  assert.match(panel, /用户图片/)
  assert.match(panel, /运营图片/)
  assert.match(panel, /scope: 'operations'/)
  assert.match(panel, /Pictures\//)
  assert.match(panel, /accept="image\/\*"/)
  assert.match(panel, /multiple/)
  assert.match(panel, /createImageAssets/)
  assert.match(adminApi, /TEMP_FILE_URL_BATCH_SIZE = 20/)
  assert.match(adminApi, /async function getTempFileUrls/)
  assert.doesNotMatch(adminApi, /fileList\.slice\(0, 50\)/)
})

test('V2.2 admin uses the streamlined panels and updated navigation order', () => {
  const main = read('admin-web/src/main.jsx')
  const panel = read('admin-web/src/v2/V22Panels.jsx')
  assert.match(main, /TemplatesV22Panel/)
  assert.match(main, /RecommendationV22Panel/)
  assert.match(main, /ImagesV22Panel/)
  assert.ok(main.indexOf("label: '推荐位与排序'") < main.indexOf("label: '分类管理'"))
  assert.match(panel, /保存草稿/)
  assert.match(panel, /发布到小程序/)
  assert.match(panel, /CoverThumb/)
  assert.match(panel, /status-chip \$\{state\.key\}/)
  assert.match(panel, /function modelOptionLabel[\s\S]*return modelCallIdOf\(item\) \|\| '未填写调用ID'/)
  assert.match(panel, /请选择模型调用ID/)
  assert.doesNotMatch(panel, /版本说明|定时发布|至少完成5组/)
})

test('template list supports createdAt sort and inline placement editing', () => {
  const adminApi = read('cloudfunctions/adminApi/index.js')
  const panel = read('admin-web/src/v2/V22Panels.jsx')
  assert.match(adminApi, /safeSortBy = \['updatedAt', 'createdAt'/)
  assert.match(adminApi, /if \(current.has_draft && current.draft_data/)
  assert.match(panel, /创建时间/)
  assert.match(panel, /toggleSort\('createdAt'\)/)
  assert.match(panel, /function PlacementQuickEdit/)
  assert.match(panel, /updateTemplatePlacement/)
  assert.match(panel, /type="checkbox"/)
})
