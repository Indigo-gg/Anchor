/**
 * 日记服务 (渲染进程)
 *
 * 封装日记工具的完整能力：
 * 1. Excel 导入 → SQLite + 记忆系统（双写）
 * 2. 关键词搜索（主进程 SQL）
 * 3. 语义搜索（复用 memory-store 混合检索）
 * 4. 数据统计
 */

import {
    addMemoryDocument,
    searchMemories,
    type SearchOptions
} from './memory-store'
import { getEmbedding } from './llm'

declare const window: any

// ============ 类型定义 ============

export interface DiarySearchParams {
    keyword?: string
    startDate?: string
    endDate?: string
    project?: string
    timeRange?: string
    weekday?: string
    limit?: number
    offset?: number
}

export interface DiarySearchResult {
    query: DiarySearchParams
    total: number
    returned: number
    hasMore: boolean
    entries: Array<{
        date: string
        project: string
        content: string
        mood: string
        duration: string
    }>
    summary: string
}

// ============ 导入 ============

/**
 * 从 Excel 导入日记数据
 * 
 * 流程：
 * 1. 调用主进程解析 Excel → 写入 SQLite (diary_entries)
 * 2. 获取格式化条目 → 批量写入记忆系统 (addMemoryDocument)
 * 
 * @param filePath Excel 文件的绝对路径
 * @param roleId 当前角色 ID（用于记忆系统隔离）
 */
export async function importDiaryFromExcel(filePath: string, roleId?: string) {
    // Step 1: 主进程导入到 SQLite
    const importResult = await window.electronAPI.diary.importExcel(filePath)

    if (!importResult.success) {
        return importResult
    }

    // Step 2: 获取格式化条目用于记忆系统
    const currentRoleId = roleId || await getCurrentRoleId()
    const memoryEntries = await window.electronAPI.diary.getForMemory()

    if (memoryEntries && memoryEntries.length > 0) {
        console.log(`[DiaryService] 开始将 ${memoryEntries.length} 条日记写入记忆系统...`)

        let successCount = 0
        let failCount = 0

        for (const entry of memoryEntries) {
            try {
                // 生成 embedding（可能失败，不阻断整体流程）
                let embedding: number[] | undefined
                try {
                    embedding = await getEmbedding(entry.content)
                } catch {
                    // embedding 失败不影响写入
                }

                await addMemoryDocument({
                    type: 'episode',
                    roleId: currentRoleId,
                    content: entry.content,
                    tags: entry.tags,
                    embedding,
                    confidence: 0.9,
                    source: 'diary_import',
                    metadata: entry.metadata
                })
                successCount++
            } catch (e) {
                failCount++
                console.warn(`[DiaryService] 记忆写入失败: ${entry.diaryId}`, e)
            }
        }

        console.log(`[DiaryService] 记忆写入完成: 成功 ${successCount}，失败 ${failCount}`)

        importResult.memorySync = {
            total: memoryEntries.length,
            success: successCount,
            failed: failCount
        }
    }

    return importResult
}

// ============ 关键词搜索 ============

/**
 * 关键词+元信息精确搜索
 * 直接走主进程 SQL 查询
 */
export async function searchDiary(params: DiarySearchParams): Promise<DiarySearchResult> {
    return await window.electronAPI.diary.search(params)
}

// ============ 语义搜索 ============

/**
 * 语义搜索日记（复用记忆系统的混合检索）
 * 
 * 使用 BM25 + Embedding 召回 → RRF 融合 → Reranker 精排
 * 只返回来源为 diary_import 的记忆条目
 * 
 * @param query 自然语言查询
 * @param roleId 角色 ID
 * @param limit 最大返回条数，默认 20
 */
export async function searchDiarySemantic(
    query: string,
    roleId?: string,
    limit: number = 20
): Promise<{
    results: Array<{
        content: string
        tags: string[]
        metadata: any
        confidence: number
    }>
    total: number
    summary: string
}> {
    const currentRoleId = roleId || await getCurrentRoleId()

    const options: SearchOptions = {
        limit: Math.min(limit, 50)
    }

    try {
        const allResults = await searchMemories(query, currentRoleId, options)

        // 过滤出日记来源的记忆
        const diaryResults = allResults.filter(doc => doc.source === 'diary_import')

        const formatted = diaryResults.map(doc => ({
            content: doc.content,
            tags: doc.tags,
            metadata: doc.metadata,
            confidence: doc.confidence
        }))

        let summary = `语义搜索 "${query}" 找到 ${formatted.length} 条相关日记。`
        if (formatted.length > 0) {
            summary += ` 涉及标签: ${[...new Set(formatted.flatMap(f => f.tags))].slice(0, 5).join('、')}。`
        }

        return {
            results: formatted,
            total: formatted.length,
            summary
        }
    } catch (e: any) {
        console.error('[DiaryService] 语义搜索失败:', e)
        return {
            results: [],
            total: 0,
            summary: `语义搜索失败: ${e.message}`
        }
    }
}

// ============ 统计 ============

/**
 * 获取日记数据统计概览
 */
export async function getDiaryStats() {
    return await window.electronAPI.diary.getStats()
}

// ============ 清空 ============

/**
 * 清空所有日记数据（SQLite + 记忆系统中的日记条目）
 */
export async function clearDiaryData() {
    return await window.electronAPI.diary.clear()
}

// ============ 辅助函数 ============

async function getCurrentRoleId(): Promise<string> {
    try {
        const { useRoleStore } = await import('./role')
        const { activeRoleId } = useRoleStore()
        return activeRoleId.value || 'anchor'
    } catch {
        return 'anchor'
    }
}
