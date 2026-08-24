const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ZONES = ['boss', 'play']
const CACHE_COLLECTION = 'feature_home_cache'
// Bump whenever the cached home-card contract changes so old documents are rebuilt.
const CACHE_SCHEMA_VERSION = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const HOME_QUERY_FIELDS = {
  _id: true,
  status: true,
  name: true,
  home_banner: true,
  points_cost: true,
  tag: true,
  hang_count: true,
  la_count: true,
  user_hang_count: true,
  user_la_count: true,
  placements: true,
  group: true
}
const DETAIL_FIELDS = [
  '_id', 'status', 'name', 'detail_banner', 'upload_count', 'points_cost',
  'enable_upscale_print', 'template_type', 'input_fields', 'publishedVersionId',
  'group', 'placements', 'tag', 'hang_count', 'la_count',
  'user_hang_count', 'user_la_count'
]

function normalizeZone(zone) {
  return ZONES.includes(zone) ? zone : 'play'
}

function normalizePlacements(feature = {}) {
  if (Array.isArray(feature.placements) && feature.placements.length > 0) {
    return feature.placements
      .map(item => ({
        zone: normalizeZone(item && item.zone),
        group: String(item && (item.group || item.category_id) || '').trim(),
        sort_order: Math.max(Number(item && (item.sort_order ?? item.sortOrder)) || 0, 0)
      }))
      .filter(item => item.zone && item.group)
  }

  const legacyGroup = String(feature.group || '').trim()
  return legacyGroup ? [{ zone: 'play', group: legacyGroup, sort_order: 0 }] : []
}

function matchesPlacement(feature = {}, zone = 'play', group = '') {
  if (!group) return false
  return normalizePlacements(feature).some(item => item.zone === zone && item.group === group)
}

function getPlacementSortOrder(feature = {}, zone = 'play', group = '') {
  const groupName = String(group || '').trim()
  const placement = normalizePlacements(feature).find(item => item.zone === zone && (!groupName || item.group === groupName))
  const value = placement && Number(placement.sort_order)
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER
}

function sortFeatures(features = [], zone = 'play', group = '') {
  return features.sort((a, b) => {
    const sortA = getPlacementSortOrder(a, zone, group)
    const sortB = getPlacementSortOrder(b, zone, group)
    if (sortA !== sortB) return sortA - sortB
    return String(a._id || '').localeCompare(String(b._id || ''))
  })
}

function toHomeCard(feature = {}) {
  const hangCount = normalizeRatingCount(feature.user_hang_count, feature.hang_count)
  const laCount = normalizeRatingCount(feature.user_la_count, feature.la_count)
  return {
    _id: feature._id,
    name: String(feature.name || ''),
    home_banner: String(feature.home_banner || ''),
    points_cost: Math.max(Number(feature.points_cost) || 0, 0),
    tag: ['new', 'hot'].includes(feature.tag) ? feature.tag : 'normal',
    // Keep both contracts during the V1/V2 compatibility period. The online
    // V1.4.7 client reads the legacy fields and otherwise renders them as zero.
    hang_count: hangCount,
    la_count: laCount,
    user_hang_count: hangCount,
    user_la_count: laCount
  }
}

function normalizeRatingCount(primaryValue, legacyValue) {
  const primary = Number(primaryValue)
  const legacy = Number(legacyValue)
  const value = Number.isFinite(primary) ? primary : legacy
  return Math.max(Number.isFinite(value) ? value : 0, 0)
}

function sanitizeDetail(feature = {}) {
  const result = {}
  DETAIL_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(feature, field)) result[field] = feature[field]
  })
  return result
}

function cacheDocumentId(zone, group) {
  return crypto.createHash('sha1').update(`${zone}\n${group}`).digest('hex')
}

function isFreshCache(cache = {}) {
  const expiresAt = cache.expires_at instanceof Date
    ? cache.expires_at.getTime()
    : Date.parse(cache.expires_at || '')
  return cache.schema_version === CACHE_SCHEMA_VERSION && Array.isArray(cache.items) && expiresAt > Date.now()
}

async function listPublishedFeatures(collection, fields = HOME_QUERY_FIELDS) {
  const all = []
  for (let skip = 0; ; skip += 100) {
    let query = collection.where({ status: 1 }).skip(skip).limit(100)
    if (fields) query = query.field(fields)
    const res = await query.get()
    all.push(...(res.data || []))
    if (!res.data || res.data.length < 100) break
  }
  return all
}

async function getGroupsForZone(zone, featureCollection) {
  try {
    const groupRes = await db.collection('ai_groups')
      .where({ status: 1, zone })
      .orderBy('sort', 'asc')
      .field({ name: true })
      .get()
    if (groupRes.data && groupRes.data.length > 0) {
      return groupRes.data.map(item => item.name).filter(Boolean)
    }
  } catch (groupError) {
    console.warn('[featureConfig] get groups failed, falling back to published placements', groupError && groupError.message)
  }

  const published = await listPublishedFeatures(featureCollection)
  const groupSet = new Set()
  published.forEach(item => {
    normalizePlacements(item).forEach(placement => {
      if (placement.zone === zone && placement.group) groupSet.add(placement.group)
    })
  })
  return [...groupSet]
}

async function buildHomeList(featureCollection, zone, selectedGroup) {
  const published = await listPublishedFeatures(featureCollection)
  return sortFeatures(published.filter(item => matchesPlacement(item, zone, selectedGroup)), zone, selectedGroup).map(toHomeCard)
}

async function getHomeList(featureCollection, zone, group) {
  const id = cacheDocumentId(zone, group)
  try {
    const cachedRes = await db.collection(CACHE_COLLECTION).doc(id).get()
    if (cachedRes.data && isFreshCache(cachedRes.data)) {
      return { items: cachedRes.data.items, cacheStatus: 'hit', updatedAt: cachedRes.data.rebuilt_at || null }
    }
  } catch (_) { }

  const items = await buildHomeList(featureCollection, zone, group)
  const rebuiltAt = new Date()
  try {
    await db.collection(CACHE_COLLECTION).doc(id).set({
      data: {
        schema_version: CACHE_SCHEMA_VERSION,
        zone,
        category: group,
        items,
        expires_at: new Date(Date.now() + CACHE_TTL_MS),
        rebuilt_at: rebuiltAt
      }
    })
    return { items, cacheStatus: 'rebuilt', updatedAt: rebuiltAt }
  } catch (cacheError) {
    console.warn('[featureConfig] cache write failed', cacheError && cacheError.message)
    return { items, cacheStatus: 'fallback', updatedAt: rebuiltAt }
  }
}

exports.main = async (event = {}) => {
  const { action, payload = {} } = event
  const collection = db.collection('ai_features')
  const zone = normalizeZone(payload.zone)

  try {
    switch (action) {
      case 'getGroups': {
        const groups = await getGroupsForZone(zone, collection)
        return { success: true, data: groups }
      }

      case 'getList': {
        const selectedGroup = String(payload.group || '').trim()
        if (!selectedGroup) return { success: true, data: [] }
        const result = await getHomeList(collection, zone, selectedGroup)
        return { success: true, data: result.items }
      }

      case 'getHome': {
        const groups = await getGroupsForZone(zone, collection)
        const requestedGroup = String(payload.category || payload.group || '').trim()
        const currentGroup = groups.includes(requestedGroup) ? requestedGroup : (groups[0] || '')
        const result = currentGroup
          ? await getHomeList(collection, zone, currentGroup)
          : { items: [], cacheStatus: 'missing', updatedAt: null }
        return {
          success: true,
          data: {
            zone,
            groups,
            current_group: currentGroup,
            items: result.items,
            updated_at: result.updatedAt,
            cache_status: result.cacheStatus
          }
        }
      }

      case 'getDetail': {
        const id = String(payload.id || '').trim()
        if (!id) return { success: false, code: 'BAD_REQUEST', error: 'Missing template id' }
        const detailRes = await collection.doc(id).get()
        if (!detailRes.data || Number(detailRes.data.status) !== 1) {
          return { success: false, code: 'NOT_FOUND', error: 'Template unavailable' }
        }
        return { success: true, data: sanitizeDetail(detailRes.data) }
      }

      case 'create':
      case 'update':
      case 'delete':
        return { success: false, code: 'ADMIN_ONLY', error: 'Template writes are only available in the admin API' }

      default:
        return { success: false, error: 'Unknown action' }
    }
  } catch (error) {
    console.error('[featureConfig] request failed', { action, message: error && error.message })
    return { success: false, error: error.message }
  }
}
