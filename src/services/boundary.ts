/**
 * 边界练习数据服务
 * 管理边界梳理结果的存储和分析
 */

import { ref, computed } from 'vue'

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

// 响应式数据
const records = ref<BoundaryRecord[]>([])

// 初始化
function init() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            records.value = JSON.parse(stored)
        } catch (e) {
            console.error('Failed to load boundary records:', e)
            records.value = []
        }
    }
}

// 添加记录
function addRecord(tasks: BoundaryTask[], context: string = '') {
    const record: BoundaryRecord = {
        id: `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        context,
        tasks
    }

    records.value.push(record)
    saveRecords()
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

// 保存记录
function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.value))
}

// 删除记录
function deleteRecord(id: string) {
    records.value = records.value.filter(r => r.id !== id)
    saveRecords()
}

// 清空所有记录
function clearRecords() {
    records.value = []
    saveRecords()
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
