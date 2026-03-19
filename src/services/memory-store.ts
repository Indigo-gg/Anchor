/**
 * 记忆统一存储层 - IndexedDB 实现
 * 
 * 核心功能：
 * 1. 统一管理各类持久化知识（属性、模式、事件、工具结果、压缩摘要）
 * 2. 提供基于 BM25 的本地关键词检索（基于 wink-bm25-text-search）
 * 3. 严格的角色隔离
 */

import Dexie from 'dexie'
// @ts-ignore
import bm25 from 'wink-bm25-text-search'
import { getEmbedding, rerank } from './llm'

export type MemoryDocType = 'fact' | 'pattern' | 'episode' | 'summary' | 'tool' | 'profile'

export interface MemoryDocument {
    id: string
    type: MemoryDocType
    roleId: string               // 角色隔离的关键字段
    content: string              // 文本内容
    tags: string[]               // 语义标签
    embedding?: number[]         // 向量（可选）
    confidence: number           // 置信度 0-1
    source: string               // 来源标识（sessionId / toolName）
    createdAt: number            // 产生时间
    metadata?: Record<string, unknown>  // 扩展字段
}

declare const window: any;

// ============ 数据迁移 (Dexie -> SQLite) ============

export async function migrateFromDexie() {
    const migratedKey = 'anchor_memories_sqlite_migrated'
    if (localStorage.getItem(migratedKey)) return

    try {
        const dexieDb = new Dexie('AnchorMemoryDatabase')
        dexieDb.version(1).stores({
            memories: 'id, roleId, [roleId+type], createdAt'
        })
        
        // Wait for dexie to be ready to check if table exists and has records
        if (!dexieDb.tables.find(t => t.name === 'memories')) {
            localStorage.setItem(migratedKey, 'true')
            return
        }

        const count = await dexieDb.table('memories').count()
        if (count === 0) {
            localStorage.setItem(migratedKey, 'true')
            return
        }
        
        console.log(`[MemoryStore] 发现 Dexie 历史数据 ${count} 条，准备迁移到 SQLite...`)
        const allDocs = await dexieDb.table('memories').toArray()
        for (const doc of allDocs) {
            // Because addMemory API accepts full memory object
            await window.electronAPI.db.addMemory(doc)
        }
        console.log('[MemoryStore] SQLite 迁移成功，清理旧数据库。')
        await dexieDb.delete() // Drop the Dexie database
        localStorage.setItem(migratedKey, 'true')
    } catch (e) {
        console.warn('[MemoryStore] 迁移到 SQLite 跳过或失败:', e)
        localStorage.setItem(migratedKey, 'true') // skip next time
    }
}

// 启动时自动迁移
migrateFromDexie().catch(console.error)

// ============ BM25 内存索引引擎 ============

// 每个 roleId 维护一个独立的 BM25 引擎，实现严格隔离，且支持重新构建（解决 wink-bm25 不支持 delete 的问题）
const bmeEngines = new Map<string, any>()
const loadedRoles = new Set<string>()

/** 中英分词器 */
function tokenize(text: string): string[] {
    if (!text) return []
    // 使用 Intl.Segmenter 进行智能分词
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
        return Array.from(segmenter.segment(text))
            // 中文分词后包含标点，我们过滤掉纯标点（保留包含任何字母或中文字符的词）
            .filter(s => s.isWordLike || /[\u4e00-\u9fa5]/.test(s.segment))
            .map(s => s.segment.toLowerCase())
    }
    // Fallback: 简单的匹配
    return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function createEngine() {
    const engine = bm25()
    engine.defineConfig({ fldWeights: { content: 1, tags: 2 } })
    engine.definePrepTasks([ tokenize ])
    return engine
}

/** 确保当前角色的 BM25 索引已加载到内存 */
export async function ensureRoleIndexLoaded(roleId: string) {
    if (loadedRoles.has(roleId)) return

    const docs = await getMemoriesByRole(roleId)

    const engine = createEngine()

    if (docs.length > 0) {
        docs.forEach(doc => {
            engine.addDoc({ content: doc.content, tags: doc.tags.join(' ') }, doc.id)
        })
    }

    try {
        engine.consolidate()
    } catch (e) {
        console.warn(`[MemoryStore] BM25 consolidate skipped for role ${roleId}:`, e)
    }

    bmeEngines.set(roleId, engine)
    loadedRoles.add(roleId)
    if (docs.length > 0) {
        console.log(`[MemoryStore] Role ${roleId} BM25 index built with ${docs.length} docs.`)
    }
}

// ============ CRUD 操作 ============

/** 添加记忆文档 */
export async function addMemoryDocument(doc: Omit<MemoryDocument, 'id' | 'createdAt'>): Promise<MemoryDocument> {
    const memory: MemoryDocument = {
        ...doc,
        id: crypto.randomUUID(),
        createdAt: Date.now()
    }
    
    await window.electronAPI.db.addMemory(memory)
    
    // 如果该角色的索引已加载，追加到索引中
    if (loadedRoles.has(doc.roleId)) {
        const engine = bmeEngines.get(doc.roleId)
        engine.addDoc({ content: memory.content, tags: memory.tags.join(' ') }, memory.id)
        try {
            engine.consolidate()
        } catch (e) {
            console.warn(`[MemoryStore] BM25 consolidate skipped after add for role ${doc.roleId}`)
        }
    }
    
    return memory
}

/** 获取某个角色的所有记忆 */
export async function getMemoriesByRole(roleId: string): Promise<MemoryDocument[]> {
    const records = await window.electronAPI.db.getMemories(roleId)
    return records.map((r: any) => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : [],
        embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined
    }))
}

/** 删除记忆（需重建角色的 BM25 索引） */
export async function deleteMemoryDocument(id: string, roleId: string) {
    await window.electronAPI.db.deleteMemory(id, roleId)
    
    // 清除内存索引标志，下次搜索时自动重建
    loadedRoles.delete(roleId)
    bmeEngines.delete(roleId)
}

/** 清空指定角色的所有记忆 */
export async function clearMemoriesByRole(roleId: string) {
    await window.electronAPI.db.clearMemories(roleId)
    
    loadedRoles.delete(roleId)
    bmeEngines.delete(roleId)
}

// ============ 检索入口预留 ============

/** 基于 BM25 的纯文本检索 */
export async function searchMemoriesByBM25(query: string, roleId: string, limit: number = 20): Promise<MemoryDocument[]> {
    await ensureRoleIndexLoaded(roleId)
    const engine = bmeEngines.get(roleId)
    
    let results: [string, number][]
    try {
        results = engine.search(query, limit)
    } catch (e) {
        // 引擎可能没有成功 consolidate（文档太少等），返回空结果即可
        console.warn(`[MemoryStore] BM25 search failed for role ${roleId}, returning empty:`, e)
        return []
    }
    
    if (results.length === 0) return []
    
    const ids = results.map(r => r[0])
    // IndexedDB 的 bulkGet 不保证顺序，需要自己排序
    const allRoleDocs = await getMemoriesByRole(roleId)
    const docs = allRoleDocs.filter(d => ids.includes(d.id))
    
    // 只返回找到的文档，并按 BM25 分数排序
    const validDocs = docs.filter(d => Boolean(d)) as MemoryDocument[]
    const idToScore = new Map(results)
    
    return validDocs.sort((a, b) => (idToScore.get(b.id) || 0) - (idToScore.get(a.id) || 0))
}

// ============ 数据迁移 ============

/** 从 localStorage 迁移旧数据 */
export async function migrateFromLocalStorage() {
    const STORAGE_KEY = 'anchor_memories'
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return
    
    // 检查是否已经迁移过
    const migratedKey = 'anchor_memories_migrated_v2'
    if (localStorage.getItem(migratedKey)) return
    
    try {
        const oldMemories = JSON.parse(stored)
        if (!Array.isArray(oldMemories) || oldMemories.length === 0) {
            localStorage.setItem(migratedKey, 'true')
            return
        }
        
        console.log(`[MemoryStore] 发现旧版本数据，准备迁移 ${oldMemories.length} 条记忆...`)
        
        for (const old of oldMemories) {
            await addMemoryDocument({
                type: old.type || 'episode',
                roleId: old.roleId || 'default',
                content: old.content || '',
                tags: old.tags || [],
                confidence: old.confidence || 0.8,
                source: 'migration_v2',
                metadata: { evidence: old.evidence || [] }
            })
        }
        
        localStorage.setItem(migratedKey, 'true')
        console.log('[MemoryStore] 旧数据迁移完成。')
    } catch (e) {
        console.error('[MemoryStore] 迁移旧数据失败:', e)
    }
}

// ============ 余弦相似度计算 ============

function cosineSimilarity(A: number[], B: number[]): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < A.length; i++) {
        dotProduct += A[i] * B[i]
        normA += A[i] * A[i]
        normB += B[i] * B[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 基于 Embedding 的向量检索

export async function searchMemoriesByVector(query: string, roleId: string, limit: number = 20): Promise<{doc: MemoryDocument, score: number}[]> {
    const docs = await getMemoriesByRole(roleId)
    // 过滤掉没有向量的文档
    const docsWithVec = docs.filter(d => d.embedding && d.embedding.length > 0)
    if (docsWithVec.length === 0) return []

    try {
        const queryEmbedding = await getEmbedding(query)
        const scored = docsWithVec.map(doc => {
            const score = cosineSimilarity(queryEmbedding, doc.embedding!)
            return { doc, score }
        })
        return scored.sort((a, b) => b.score - a.score).slice(0, limit)
    } catch (e) {
        console.warn('[MemoryStore] 向量检索失败 (可能没有配置 embedding 模型):', e)
        return []
    }
}

// ============ RRF 融合 ============

function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
    const scores = new Map<string, number>()
    for (const list of lists) {
        list.forEach((id, rank) => {
            scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1))
        })
    }
    return scores
}

// ============ 统一混合检索 ============

export interface SearchOptions {
    limit?: number
    timeRange?: { start: number; end: number }
}

export async function searchMemories(query: string, roleId: string, options: SearchOptions = {}): Promise<MemoryDocument[]> {
    const limit = options.limit || 5
    
    // 1. 两路召回
    const [bm25Docs, vectorResults] = await Promise.all([
        searchMemoriesByBM25(query, roleId, 20),
        searchMemoriesByVector(query, roleId, 20)
    ])
    
    // 2. RRF 融合
    const bm25Ids = bm25Docs.map(d => d.id)
    const vectorIds = vectorResults.map(r => r.doc.id)
    
    const fusedScores = reciprocalRankFusion([bm25Ids, vectorIds])
    
    // 将所有召回的文档放入一个 map 中去重
    const allDocsMap = new Map<string, MemoryDocument>()
    bm25Docs.forEach(d => allDocsMap.set(d.id, d))
    vectorResults.forEach(r => allDocsMap.set(r.doc.id, r.doc))
    
    // 3. 根据 RRF 分数排序并截取 candidate
    let sortedDocs = Array.from(allDocsMap.values())
        .map(doc => ({ doc, score: fusedScores.get(doc.id) || 0 }))
        .sort((a, b) => b.score - a.score)
        .map(item => item.doc)
        
    // 时间过滤
    if (options.timeRange) {
        const { start, end } = options.timeRange
        sortedDocs = sortedDocs.filter(d => d.createdAt >= start && d.createdAt <= end)
    }
    
    // 我们保留 10 个去精排
    const candidateDocs = sortedDocs.slice(0, Math.max(limit * 2, 10))
    if (candidateDocs.length === 0) return []
    
    // 4. Reranking (如果配置了)
    try {
        const docTexts = candidateDocs.map(d => `[${d.type}] ${d.content}`)
        const rerankResults = await rerank(query, docTexts, limit)
        
        if (rerankResults && rerankResults.length > 0) {
            // 根据 rerank 的 index 重新排序，并截取 limit 个
            return rerankResults.map(r => candidateDocs[r.index]).filter(Boolean)
        }
    } catch (e) {
        console.warn('[MemoryStore] 精排失败，降级使用 RRF 结果:', e)
    }
    
    return candidateDocs.slice(0, limit)
}
