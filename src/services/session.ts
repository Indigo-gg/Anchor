/**
 * 会话存储服务
 * 管理历史会话和当前会话状态
 */

import { ref } from 'vue'

// 会话消息
export interface SessionMessage {
    role: 'user' | 'assistant'
    content: string
    tool?: string
    toolParams?: Record<string, unknown>
    timestamp: number
    // 新增：工具上下文标记
    toolContext?: {
        tool: string              // 当前工具
        isToolStart?: boolean     // 是否为工具启动消息
        isToolResult?: boolean    // 是否为工具结果
        resultData?: object       // 结果数据（用于渲染可视化）
    }
}

// Agent 思考记录
export interface AgentThought {
    timestamp: number
    thought: string
    action: string
}

// 工具上下文（内核态）
export interface ToolContext {
    tool: string              // 工具名称
    phase: string             // 当前阶段
    turnCount: number         // 对话轮数
    maxTurns: number          // 最大轮数
    systemPrompt: string      // 工具专属提示词
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>  // 工具内对话
}

// 会话
export interface Session {
    id: string
    roleId: string              // 所属角色 ID
    startTime: number
    endTime?: number
    messages: SessionMessage[]
    thoughts: AgentThought[]
    summary?: string  // 自动生成的摘要
    compressedHistory: string[]  // 压缩后的历史摘要
    roundCount: number  // 对话轮数计数
    contextWindowStart: number  // 上下文窗口起始索引（压缩后前移）
    toolContext?: ToolContext  // 当前会话独占的工具上下文（内核态）
}

import { appDb } from './db'
import { toRaw } from 'vue'

// 存储键 (用于迁移和少量设置)
const STORAGE_KEY = 'anchor_sessions'
const CURRENT_SESSION_KEY = 'anchor_current_session'
const SESSION_SETTINGS_KEY = 'anchor_session_settings'
const MIGRATED_KEY = 'anchor_sessions_migrated'

// 会话设置
export interface SessionSettings {
    contextWindowSize: number  // 上下文窗口大小（轮数），达到后触发压缩
}

const sessionSettings = ref<SessionSettings>({
    contextWindowSize: 5
})

// 当前会话
const currentSession = ref<Session | null>(null)

// 历史会话列表
const sessions = ref<Session[]>([])

// 初始化标识，避免重复启动
let isInitializing = false

// 异步初始化
async function init() {
    if (isInitializing) return
    isInitializing = true

    // ========== 1. 执行旧数据迁移 ==========
    await migrateFromLocalStorage()

    // ========== 2. 从 IndexedDB 加载当前会话 ==========
    const currentStored = localStorage.getItem(CURRENT_SESSION_KEY)
    if (currentStored) {
        try {
            currentSession.value = JSON.parse(currentStored)
            // 将 current 存入 indexedDB 并删除 localStorage (清理包袱)
            await appDb.sessions.put(JSON.parse(JSON.stringify(currentSession.value!)))
            localStorage.removeItem(CURRENT_SESSION_KEY)
        } catch (e) {
            console.error('Failed to parse legacy current session:', e)
        }
    }

    if (!currentSession.value) {
        // 尝试从 db 里把 "未结束" 的会话拿回作为 currentSession
        const activeSessions = await appDb.sessions.filter(s => !s.endTime).reverse().toArray()
        if (activeSessions.length > 0) {
            currentSession.value = activeSessions[0]
            // 把其他的未结束的强制归档
            for (let i = 1; i < activeSessions.length; i++) {
                activeSessions[i].endTime = Date.now()
                await appDb.sessions.put(JSON.parse(JSON.stringify(activeSessions[i])))
            }
        } else {
            // 没有未结束的，新开一个
            await startNewSession()
        }
    }

    // ========== 3. 从 IndexedDB 加载历史会话 ==========
    sessions.value = await appDb.sessions.orderBy('startTime').reverse().toArray()

    // ========== 4. 加载简易的会话设置 ==========
    const settingsStored = localStorage.getItem(SESSION_SETTINGS_KEY)
    if (settingsStored) {
        try {
            sessionSettings.value = { ...sessionSettings.value, ...JSON.parse(settingsStored) }
        } catch (e) {
            console.error('[Session] Failed to load settings:', e)
        }
    }
}

/** 迁移历史 localStorage 会话到 IndexedDB */
async function migrateFromLocalStorage() {
    if (localStorage.getItem(MIGRATED_KEY)) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            const oldSessions: Session[] = JSON.parse(stored)
            if (Array.isArray(oldSessions) && oldSessions.length > 0) {
                console.log(`[Session] 正在将 ${oldSessions.length} 条历史对话迁移至底层数据库...`)
                await appDb.sessions.bulkPut(oldSessions)
            }
        } catch (e) {
            console.error('[Session] Migration failed:', e)
        }
    }
    
    // 标记迁移成功，下次不再迁移
    localStorage.setItem(MIGRATED_KEY, 'true')
    // 可以考虑之后删除原始的 localStorage.removeItem(STORAGE_KEY)，暂时保留作为兜底
}

// 开始新会话
function startNewSession(roleId?: string) {
    // 如果有当前会话且有消息，先保存到历史
    if (currentSession.value && currentSession.value.messages.length > 0) {
        archiveCurrentSession()
    }

    // 创建新会话
    currentSession.value = {
        id: generateId(),
        roleId: roleId || currentSession.value?.roleId || 'anchor',
        startTime: Date.now(),
        messages: [],
        thoughts: [],
        compressedHistory: [],
        roundCount: 0,
        contextWindowStart: 0
    }
    
    // 只保留 currentSession.value，不预先塞入历史列表
    saveCurrentSession()
}

// 归档当前会话
async function archiveCurrentSession() {
    if (!currentSession.value || currentSession.value.messages.length === 0) return

    currentSession.value.endTime = Date.now()

    // 生成简单摘要（取第一条用户消息）
    const firstUserMsg = currentSession.value.messages.find(m => m.role === 'user')
    currentSession.value.summary = firstUserMsg?.content.slice(0, 50) || '空会话'

    // 确保所有必需字段存在
    const sessionToArchive: Session = {
        ...currentSession.value,
        thoughts: currentSession.value.thoughts || [],
        compressedHistory: currentSession.value.compressedHistory || [],
        roundCount: currentSession.value.roundCount || 0,
        contextWindowStart: currentSession.value.contextWindowStart || 0
    }

    // 添加到历史列表中（如果没在的话）
    if (!sessions.value.some(s => s.id === sessionToArchive.id)) {
        sessions.value.unshift(sessionToArchive)
    } else {
        const idx = sessions.value.findIndex(s => s.id === sessionToArchive.id)
        if (idx !== -1) sessions.value[idx] = sessionToArchive
    }
    
    // 异步更新数据库
    saveSessions([sessionToArchive])

    // 提取记忆（异步，不阻塞）
    extractMemoriesFromSession(currentSession.value.messages).catch(err => {
        console.error('[Session] Failed to extract memories:', err)
    })
}

// 从会话消息中提取记忆
async function extractMemoriesFromSession(messages: SessionMessage[]) {
    try {
        const { extractMemories } = await import('./memory')
        await extractMemories(
            messages.map(m => ({ role: m.role, content: m.content }))
        )
        console.log('[Session] Triggered memory extraction.')
    } catch (e) {
        console.warn('[Session] Failed to extract memories:', e)
    }
}

// 添加消息到当前会话
function addMessage(message: Omit<SessionMessage, 'timestamp'>) {
    if (!currentSession.value) startNewSession()

    const isFirstMessage = currentSession.value!.messages.length === 0

    currentSession.value!.messages.push({
        ...message,
        timestamp: Date.now()
    })

    if (isFirstMessage) {
        // 第一条消息产生时，正式将当前会话加入历史列表展示
        sessions.value.unshift(currentSession.value!)
    }

    // 计数对话轮次（用户消息为一轮），并更新角色的最后对话时间
    if (message.role === 'user') {
        currentSession.value!.roundCount++
        try {
            import('./role').then(({ useRoleStore }) => {
                const { touchRoleChat } = useRoleStore()
                if (currentSession.value?.roleId) {
                    touchRoleChat(currentSession.value.roleId)
                }
            })
        } catch (e) {
            console.warn('[Session] Failed to touch role chat time', e)
        }
    }

    saveCurrentSession()
}

// 跨会话追加消息（用于异步工具回调写入）
async function addMessageToSession(sessionId: string, message: Omit<SessionMessage, 'timestamp'>) {
    if (currentSession.value?.id === sessionId) {
        addMessage(message)
        return
    }
    const target = sessions.value.find(s => s.id === sessionId)
    if (target) {
        target.messages.push({ ...message, timestamp: Date.now() })
        saveSessions([target])
        return
    }
    const dbSession = await appDb.sessions.get(sessionId)
    if (dbSession) {
        dbSession.messages.push({ ...message, timestamp: Date.now() })
        await appDb.sessions.put(dbSession)
    }
}

// 检查是否需要压缩
function shouldCompress(): boolean {
    if (!currentSession.value) return false
    const windowSize = sessionSettings.value.contextWindowSize
    return currentSession.value.roundCount >= windowSize && currentSession.value.roundCount % windowSize === 0
}

import { getEmbedding } from './llm'
import { addMemoryDocument } from './memory-store'

// 添加压缩摘要
async function addCompressedSummary(summary: string) {
    if (!currentSession.value) return
    currentSession.value.compressedHistory.push(summary)
    currentSession.value.contextWindowStart = currentSession.value.messages.length
    currentSession.value.roundCount = 0
    saveCurrentSession()

    // 写入统一记忆存储
    const roleId = currentSession.value.roleId || 'default'
    let embedding: number[] | undefined
    try {
        embedding = await getEmbedding(summary)
    } catch (e) { console.warn('[Session] Embedding failed', e) }
    
    await addMemoryDocument({
        type: 'summary',
        roleId,
        content: summary,
        tags: ['摘要'],
        embedding,
        confidence: 1.0,
        source: currentSession.value.id
    })
}

// 添加工具小结
async function addToolSummary(toolName: string, summary: string) {
    if (!currentSession.value) return
    const content = `[${toolName}] ${summary}`
    currentSession.value.compressedHistory.push(content)
    saveCurrentSession()
    
    // 写入统一记忆存储
    const roleId = currentSession.value.roleId || 'default'
    let embedding: number[] | undefined
    try {
        embedding = await getEmbedding(content)
    } catch (e) { console.warn('[Session] Embedding failed', e) }

    await addMemoryDocument({
        type: 'tool',
        roleId,
        content,
        tags: ['工具', toolName],
        embedding,
        confidence: 1.0,
        source: currentSession.value.id
    })
}

// 获取带压缩历史的消息上下文（只返回窗口内的消息）
function getContextMessages(): { compressed: string[], recent: SessionMessage[] } {
    if (!currentSession.value) return { compressed: [], recent: [] }
    const start = currentSession.value.contextWindowStart || 0
    return {
        compressed: currentSession.value.compressedHistory,
        recent: currentSession.value.messages.slice(start)
    }
}

// 获取历史会话
function getSession(id: string): Session | undefined {
    return sessions.value.find(s => s.id === id)
}

// 删除历史会话
async function deleteSession(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id)
    await appDb.sessions.delete(id)
}

// 异步保存当前会话到 IndexedDB
function saveCurrentSession() {
    if (currentSession.value) {
        // toRaw 剥离 Vue Proxy，JSON round-trip 剥离嵌套 Proxy/函数等不可克隆属性
        const plain = JSON.parse(JSON.stringify(toRaw(currentSession.value)))
        appDb.sessions.put(plain).catch(e => {
            console.error('[Session] Failed to save current session to db:', e)
        })
    }
}

// 批量异步保存指定的会话到 IndexedDB
function saveSessions(sessionsList: Session[] = []) {
    if (sessionsList.length > 0) {
        const plainList = JSON.parse(JSON.stringify(sessionsList.map(s => toRaw(s))))
        appDb.sessions.bulkPut(plainList).catch(e => {
            console.error('[Session] Failed to save sessions array to db:', e)
        })
    }
}

// 生成 ID
function generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// 格式化时间
export function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ============ 工具上下文管理（内核态） ============

/**
 * 进入工具模式（内核态）
 */
function startTool(tool: string, systemPrompt: string, maxTurns: number = 3) {
    if (!currentSession.value) return
    currentSession.value.toolContext = {
        tool,
        phase: 'active',
        turnCount: 0,
        maxTurns,
        systemPrompt,
        conversationHistory: []
    }
    saveCurrentSession()
    console.log(`[Session] 进入内核态: ${tool}`)
}

/**
 * 退出工具模式（返回用户态）
 */
function endTool() {
    if (currentSession.value?.toolContext) {
        console.log(`[Session] 退出内核态: ${currentSession.value.toolContext.tool}`)
        currentSession.value.toolContext = undefined
        saveCurrentSession()
    }
}

/**
 * 是否在工具模式（内核态）
 */
function isInToolMode(): boolean {
    return currentSession.value?.toolContext !== undefined && currentSession.value?.toolContext !== null
}

/**
 * 获取当前工具上下文
 */
function getToolContext(): ToolContext | null {
    return currentSession.value?.toolContext || null
}

/**
 * 添加工具对话消息
 */
function addToolMessage(role: 'user' | 'assistant', content: string) {
    if (!currentSession.value?.toolContext) return
    currentSession.value.toolContext.conversationHistory.push({ role, content })
    if (role === 'user') {
        currentSession.value.toolContext.turnCount++
    }
    saveCurrentSession()
}

/**
 * 检查工具是否应该结束（轮数限制）
 */
function shouldToolEnd(): boolean {
    if (!currentSession.value?.toolContext) return false
    return currentSession.value.toolContext.turnCount >= currentSession.value.toolContext.maxTurns
}

// 获取某角色的历史会话
function getSessionsForRole(roleId: string): Session[] {
    return sessions.value.filter(s => s.roleId === roleId)
}

/**
 * 恢复角色最近的会话（用于角色切换）
 * 只保存当前会话状态，不归档、不提取记忆
 * 如果目标角色有历史会话，恢复最近一条；否则新建空会话
 */
function restoreLatestSession(roleId: string) {
    // 将当前会话暂存到历史列表（不归档、不提取记忆）
    if (currentSession.value && currentSession.value.messages.length > 0) {
        // 保存快照，不设 endTime，表示未正式结束
        const snapshot: Session = {
            ...currentSession.value,
            thoughts: currentSession.value.thoughts || [],
            compressedHistory: currentSession.value.compressedHistory || [],
            roundCount: currentSession.value.roundCount || 0,
            contextWindowStart: currentSession.value.contextWindowStart || 0
        }
        // 确保非空会话存在于历史列表中
        if (!sessions.value.some(s => s.id === snapshot.id)) {
            sessions.value.unshift(snapshot)
        } else {
            // 更新已有记录
            const idx = sessions.value.findIndex(s => s.id === snapshot.id)
            if (idx >= 0) sessions.value[idx] = snapshot
        }
        saveSessions([snapshot])
    } else if (currentSession.value && currentSession.value.messages.length === 0) {
         // 删除数据库中无用的空会话记录
         appDb.sessions.delete(currentSession.value.id).catch(e => console.warn('删除空会话失败', e))
         sessions.value = sessions.value.filter(s => s.id !== currentSession.value!.id)
    }

    // 查找目标角色最近的 **未归档** 会话（有 endTime 表示已归档）
    const roleSessions = sessions.value
        .filter(s => s.roleId === roleId && !s.endTime)
        .sort((a, b) => b.startTime - a.startTime)

    if (roleSessions.length > 0) {
        // 恢复最近会话（从列表中找到它并置于第一位，不再删除它而是把它设为 current）
        const latest = roleSessions[0]
        currentSession.value = { ...latest, endTime: undefined }
        saveCurrentSession()
        console.log('[Session] 恢复角色会话:', roleId, latest.id)
        
        // 如果是从非列表选中的会话恢复（比如这个会话已经在列表里），确保不在列表里就加一下（其实必然在）
    } else {
        // 没有历史，新建空会话（不触发归档）
        currentSession.value = {
            id: generateId(),
            roleId,
            startTime: Date.now(),
            messages: [],
            thoughts: [],
            compressedHistory: [],
            roundCount: 0,
            contextWindowStart: 0
        }
        saveCurrentSession()
        console.log('[Session] 角色无历史会话，新建:', roleId)
    }
}

// 导出 composable
export function useSessionStore() {
    // 首次使用时初始化
    if (!currentSession.value) {
        init()
    }

    return {
        currentSession,
        sessions,
        sessionSettings,
        startNewSession,
        addMessage,
        addMessageToSession,
        getSession,
        deleteSession,
        formatTime,
        shouldCompress,
        addCompressedSummary,
        addToolSummary,
        getContextMessages,
        // 角色会话管理
        getSessionsForRole,
        restoreLatestSession,
        // 工具模式（内核态）
        startTool,
        endTool,
        isInToolMode,
        getToolContext,
        addToolMessage,
        shouldToolEnd,
        // 设置
        saveSessionSettings
    }
}

// 保存会话设置
function saveSessionSettings() {
    localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(sessionSettings.value))
}
