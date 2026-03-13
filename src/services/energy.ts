/**
 * 能量数据服务
 * 管理每日能量记录和统计分析
 */

import { ref, computed } from 'vue'
import { appDb } from './db'

// 能量记录
export interface EnergyRecord {
    id: string
    timestamp: number
    level: 1 | 2 | 3 | 4  // 1=低, 2=中低, 3=中高, 4=满
    activity: string
    activityType?: string  // 快捷选项类型
}

// 存储键
const STORAGE_KEY = 'anchor_energy_records'
const MIGRATED_KEY = 'anchor_energy_records_migrated'

// 响应式数据
const records = ref<EnergyRecord[]>([])

// 初始化标识
let isInitializing = false

// 异步初始化
async function init() {
    if (isInitializing) return
    isInitializing = true

    await migrateFromLocalStorage()

    try {
        records.value = await appDb.energyRecords.reverse().toArray()
    } catch (e) {
        console.error('Failed to load energy records from db:', e)
        records.value = []
    }
}

/** 迁移历史 localStorage 会话到 IndexedDB */
async function migrateFromLocalStorage() {
    if (localStorage.getItem(MIGRATED_KEY)) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            const oldRecords: EnergyRecord[] = JSON.parse(stored)
            if (Array.isArray(oldRecords) && oldRecords.length > 0) {
                console.log(`[Energy] 正在将 ${oldRecords.length} 个能量记录迁移至底层数据库...`)
                await appDb.energyRecords.bulkPut(oldRecords)
            }
        } catch (e) {
            console.error('[Energy] Migration failed:', e)
        }
    }
    
    localStorage.setItem(MIGRATED_KEY, 'true')
}

// 添加记录
function addRecord(level: 1 | 2 | 3 | 4, activity: string, activityType?: string) {
    const record: EnergyRecord = {
        id: `energy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        level,
        activity,
        activityType
    }

    // 插入最前面保持顺序与 reverse().toArray() 一致
    records.value.unshift(record)
    appDb.energyRecords.put(JSON.parse(JSON.stringify(record))).catch(e => console.error('[Energy] 保存记录失败', e))
    return record
}

// 获取今日记录
const todayRecords = computed(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.getTime()

    return records.value.filter(r => r.timestamp >= todayStart)
})

// 获取本周记录
const weekRecords = computed(() => {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    weekAgo.setHours(0, 0, 0, 0)

    return records.value.filter(r => r.timestamp >= weekAgo.getTime())
})

// 计算平均能量
function getAverageLevel(recordList: EnergyRecord[]): number {
    if (recordList.length === 0) return 0
    const sum = recordList.reduce((acc, r) => acc + r.level, 0)
    return sum / recordList.length
}

// 按小时分组统计
function getHourlyStats(recordList: EnergyRecord[]): { hour: number; avgLevel: number; count: number }[] {
    const hourMap = new Map<number, { sum: number; count: number }>()

    for (const record of recordList) {
        const hour = new Date(record.timestamp).getHours()
        const existing = hourMap.get(hour) || { sum: 0, count: 0 }
        hourMap.set(hour, { sum: existing.sum + record.level, count: existing.count + 1 })
    }

    return Array.from(hourMap.entries())
        .map(([hour, { sum, count }]) => ({
            hour,
            avgLevel: sum / count,
            count
        }))
        .sort((a, b) => a.hour - b.hour)
}

// 按活动类型分组统计
function getActivityStats(recordList: EnergyRecord[]): { type: string; avgLevel: number; count: number }[] {
    const typeMap = new Map<string, { sum: number; count: number }>()

    for (const record of recordList) {
        const type = record.activityType || '其他'
        const existing = typeMap.get(type) || { sum: 0, count: 0 }
        typeMap.set(type, { sum: existing.sum + record.level, count: existing.count + 1 })
    }

    return Array.from(typeMap.entries())
        .map(([type, { sum, count }]) => ({
            type,
            avgLevel: sum / count,
            count
        }))
        .sort((a, b) => b.count - a.count)
}

// 删除记录
function deleteRecord(id: string) {
    records.value = records.value.filter(r => r.id !== id)
    appDb.energyRecords.delete(id).catch(e => console.error('[Energy] 删除记录失败', e))
}

// 清空所有记录
function clearRecords() {
    records.value = []
    appDb.energyRecords.clear().catch(e => console.error('[Energy] 清空数据库失败', e))
}

// 活动类型选项
export const ACTIVITY_TYPES = [
    { value: 'creative', label: '创造', emoji: '🎨' },
    { value: 'reading', label: '阅读', emoji: '📖' },
    { value: 'working', label: '干活', emoji: '💼' },
    { value: 'slacking', label: '摸鱼', emoji: '🐟' },
    { value: 'meeting', label: '开会', emoji: '🗣️' },
    { value: 'social', label: '社交', emoji: '👥' },
    { value: 'rest', label: '休息', emoji: '😴' },
    { value: 'exercise', label: '运动', emoji: '🏃' },
    { value: 'eating', label: '吃饭', emoji: '🍜' },
]

// 能量等级选项
export const ENERGY_LEVELS = [
    { value: 4, label: '满', emoji: '⚡⚡⚡' },
    { value: 3, label: '中高', emoji: '⚡⚡' },
    { value: 2, label: '中低', emoji: '⚡' },
    { value: 1, label: '低', emoji: '🔋' },
]

// 导出 composable
export function useEnergyStore() {
    // 首次使用时初始化
    if (records.value.length === 0) {
        init()
    }

    return {
        records,
        todayRecords,
        weekRecords,
        addRecord,
        deleteRecord,
        clearRecords,
        getAverageLevel,
        getHourlyStats,
        getActivityStats
    }
}
