// 云函数：定时清理过期的生成记录和对应的云存储文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 保留天数（超过此天数的记录和文件将被清理）
const RETENTION_DAYS = 30
// 每批处理的最大记录数
const BATCH_SIZE = 100

exports.main = async (event, context) => {
    console.log('[cleanup] 开始执行过期生成记录清理任务')

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
    console.log('[cleanup] 清理早于:', cutoff.toISOString())

    let totalDeleted = 0
    let totalFilesDeleted = 0
    let hasMore = true

    while (hasMore) {
        // 查询过期记录
        const res = await db.collection('generation_history')
            .where({ createdAt: _.lt(cutoff) })
            .limit(BATCH_SIZE)
            .get()

        const records = res.data || []
        if (records.length === 0) {
            hasMore = false
            break
        }

        // 收集需要删除的云存储文件ID
        const fileIDs = []
        for (const record of records) {
            if (record.resultUrl && record.resultUrl.startsWith('cloud://')) {
                fileIDs.push(record.resultUrl)
            }
            if (record.photoUrl && record.photoUrl.startsWith('cloud://')) {
                fileIDs.push(record.photoUrl)
            }
        }

        // 批量删除云存储文件（每次最多50个）
        if (fileIDs.length > 0) {
            const chunks = []
            for (let i = 0; i < fileIDs.length; i += 50) {
                chunks.push(fileIDs.slice(i, i + 50))
            }
            for (const chunk of chunks) {
                try {
                    await cloud.deleteFile({ fileList: chunk })
                    totalFilesDeleted += chunk.length
                    console.log('[cleanup] 已删除文件:', chunk.length)
                } catch (err) {
                    console.error('[cleanup] 删除文件出错:', err)
                }
            }
        }

        // 批量删除数据库记录
        const ids = records.map(r => r._id)
        for (const id of ids) {
            try {
                await db.collection('generation_history').doc(id).remove()
                totalDeleted++
            } catch (err) {
                console.error('[cleanup] 删除记录出错:', id, err)
            }
        }

        // 如果查询结果不足一批，说明没有更多了
        if (records.length < BATCH_SIZE) {
            hasMore = false
        }
    }

    // 同样清理 points_history 中的过期流水记录
    let totalPointsHistoryDeleted = 0
    hasMore = true
    while (hasMore) {
        const res = await db.collection('points_history')
            .where({ createdAt: _.lt(cutoff) })
            .limit(BATCH_SIZE)
            .get()

        const records = res.data || []
        if (records.length === 0) {
            hasMore = false
            break
        }

        for (const record of records) {
            try {
                await db.collection('points_history').doc(record._id).remove()
                totalPointsHistoryDeleted++
            } catch (err) {
                console.error('[cleanup] 删除流水记录出错:', record._id, err)
            }
        }

        if (records.length < BATCH_SIZE) {
            hasMore = false
        }
    }

    const summary = `清理完成: 生成记录 ${totalDeleted} 条, 云存储文件 ${totalFilesDeleted} 个, 流水记录 ${totalPointsHistoryDeleted} 条`
    console.log('[cleanup]', summary)
    return { success: true, message: summary }
}
