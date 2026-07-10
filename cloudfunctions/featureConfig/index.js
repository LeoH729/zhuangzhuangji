const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ZONES = ['boss', 'play']

function normalizeZone(zone) {
  return ZONES.includes(zone) ? zone : 'play'
}

function normalizePlacements(feature = {}) {
  if (Array.isArray(feature.placements) && feature.placements.length > 0) {
    return feature.placements
      .map(item => ({
        zone: normalizeZone(item && item.zone),
        group: String(item && item.group || '').trim()
      }))
      .filter(item => item.zone && item.group)
  }

  const legacyGroup = String(feature.group || '').trim()
  return legacyGroup ? [{ zone: 'play', group: legacyGroup }] : []
}

function matchesPlacement(feature = {}, zone = 'play', group = '') {
  if (!group) return false
  const placements = normalizePlacements(feature)
  return placements.some(item => item.zone === zone && item.group === group)
}

function getTimeMs(item = {}) {
  const value = item.createdAt || item.createTime
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  if (value.$date) return new Date(value.$date).getTime() || 0
  return new Date(value).getTime() || 0
}

function sortFeatures(features = []) {
  features.sort((a, b) => {
    const tagA = a.tag || 'normal'
    const tagB = b.tag || 'normal'
    const getTagWeight = (tag) => {
      if (tag === 'new') return 3
      if (tag === 'hot') return 2
      return 1
    }

    const weightA = getTagWeight(tagA)
    const weightB = getTagWeight(tagB)
    if (weightA !== weightB) return weightB - weightA

    const timeA = getTimeMs(a)
    const timeB = getTimeMs(b)
    if (tagA === 'new' || tagA === 'hot') return timeB - timeA

    const hangA = a.hang_count || 0
    const hangB = b.hang_count || 0
    if (hangA !== hangB) return hangB - hangA
    return timeB - timeA
  })
  return features
}

exports.main = async (event = {}) => {
  const { action, payload = {} } = event
  const collection = db.collection('ai_features')
  const zone = normalizeZone(payload.zone)

  try {
    switch (action) {
      case 'getGroups': {
        try {
          const groupRes = await db.collection('ai_groups').where({ status: 1, zone }).orderBy('sort', 'asc').get()
          if (groupRes.data && groupRes.data.length > 0) {
            const groups = groupRes.data.map(item => item.name).filter(Boolean)
            return { success: true, data: groups }
          }
        } catch (groupError) {
          console.warn('get ai_groups failed, fallback to feature placements', groupError)
        }

        const { data } = await collection.where({ status: 1 }).field({ group: true, placements: true }).get()
        const groupSet = new Set()
        ;(data || []).forEach(item => {
          normalizePlacements(item).forEach(placement => {
            if (placement.zone === zone && placement.group) groupSet.add(placement.group)
          })
        })
        return { success: true, data: [...groupSet] }
      }

      case 'getList': {
        const selectedGroup = String(payload.group || '').trim()
        if (!selectedGroup) {
          return { success: true, data: [] }
        }
        const res = await collection.where({ status: 1 }).get()
        const features = sortFeatures((res.data || []).filter(item => matchesPlacement(item, zone, selectedGroup)))
        return { success: true, data: features }
      }

      case 'getDetail': {
        const detailRes = await collection.doc(payload.id).get()
        return { success: true, data: detailRes.data }
      }

      case 'create': {
        const createRes = await collection.add({ data: { ...payload, createTime: db.serverDate() } })
        return { success: true, _id: createRes._id }
      }

      case 'update': {
        const updateRes = await collection.doc(payload.id).update({ data: { ...payload.data, updateTime: db.serverDate() } })
        return { success: true, updated: updateRes.stats.updated }
      }

      case 'delete': {
        const deleteRes = await collection.doc(payload.id).remove()
        return { success: true, removed: deleteRes.stats.removed }
      }

      default:
        return { success: false, error: 'Unknown action' }
    }
  } catch (e) {
    console.error(e)
    return { success: false, error: e.message }
  }
}
