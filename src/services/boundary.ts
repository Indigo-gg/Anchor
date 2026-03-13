/**
 * 边界练习数据服务
 * 管理边界梳理结果的存储和分析
 */

import { ref, computed } from 'vue'
import { appDb } from './db'

// 边界任务项
export interface BoundaryTask {
    label: string      // 标签（5字内）
    reason: string     // 解释
    score: number      // 可控度 0-10
}

// 边界练习记录
export interface BoundaryRecord {
    id: string
    timestamp: number
    context: string    // 练习背景/情境描述
    tasks: BoundaryTask[]
}

// 存储键
const STORAGE_KEY = 'anchor_boundary_records'
const MIGRATED_KEY = 'anchor_boundary_records_migrated'

// 响应式数据
const records = ref<BoundaryRecord[]>([])

// 初始化标识
let isInitializing = false

// 异步初始化
async function init() {
    if (isInitializing) return
    isInitializing = true

    await migrateFromLocalStorage()

    try {
        records.value = await appDb.boundaryRecords.reverse().toArray()
    } catch (e) {
        console.error('Failed to load boundary records from db:', e)
        records.value = []
    }
}

/** 从 localStorage 迁移历史数据到 IndexedDB */
async function migrateFromLocalStorage() {
    if (localStorage.getItem(MIGRATED_KEY)) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            const oldRecords: BoundaryRecord[] = JSON.parse(stored)
            if (Array.isArray(oldRecords) && oldRecords.length > 0) {
                console.log(`[Boundary] 正在将 ${oldRecords.length} 个边界记录迁移至底层数据库...`)
                await appDb.boundaryRecords.bulkPut(oldRecords)
            }
        } catch (e) {
            console.error('[Boundary] Migration failed:', e)
        }
    }
    
    localStorage.setItem(MIGRATED_KEY, 'true')
}

// 添加记录
function addRecord(tasks: BoundaryTask[], context: string = '') {
    const record: BoundaryRecord = {
        id: `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        context,
        tasks
    }

    records.value.unshift(record)
    appDb.boundaryRecords.put(JSON.parse(JSON.stringify(record))).catch(e => console.error('[Boundary] 保存记录失败', e))
    console.log('[Boundary] 保存练习记录:', record.id, tasks.length, '个任务')
    return record
}

// 获取最近的记录
const recentRecords = computed(() => {
    return records.value
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
})

// 获取所有"我的课题"（score >= 8）
const myTasks = computed(() => {
    const allTasks: Array<BoundaryTask & { recordId: string; timestamp: number }> = []

    for (const record of records.value) {
        for (const task of record.tasks) {
            if (task.score >= 8) {
                allTasks.push({
                    ...task,
                    recordId: record.id,
                    timestamp: record.timestamp
                })
            }
        }
    }

    return allTasks.sort((a, b) => b.timestamp - a.timestamp)
})

// 获取所有"他人课题"（score <= 3）
const otherTasks = computed(() => {
    const allTasks: Array<BoundaryTask & { recordId: string; timestamp: number }> = []

    for (const record of records.value) {
        for (const task of record.tasks) {
            if (task.score <= 3) {
                allTasks.push({
                    ...task,
                    recordId: record.id,
                    timestamp: record.timestamp
                })
            }
        }
    }

    return allTasks.sort((a, b) => b.timestamp - a.timestamp)
})

// 保存记录 (已被细分操作替代)

// 删除记录
function deleteRecord(id: string) {
    records.value = records.value.filter(r => r.id !== id)
    appDb.boundaryRecords.delete(id).catch(e => console.error('[Boundary] 删除记录失败', e))
}

// 清空所有记录
function clearRecords() {
    records.value = []
    appDb.boundaryRecords.clear().catch(e => console.error('[Boundary] 清空记录失败', e))
}

// 导出 composable
export function useBoundaryStore() {
    if (records.value.length === 0) {
        init()
    }

    return {
        records,
        recentRecords,
        myTasks,
        otherTasks,
        addRecord,
        deleteRecord,
        clearRecords
    }
}
