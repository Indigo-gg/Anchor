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
    startTime: number
    endTime?: number
    messages: SessionMessage[]
    thoughts: AgentThought[]
    summary?: string  // 自动生成的摘要
    compressedHistory: string[]  // 压缩后的历史摘要
    roundCount: number  // 对话轮数计数
}

// 存储键
const STORAGE_KEY = 'anchor_sessions'
const CURRENT_SESSION_KEY = 'anchor_current_session'

// 当前会话
const currentSession = ref<Session | null>(null)

// 历史会话列表
const sessions = ref<Session[]>([])

// 工具上下文（内核态）
const activeToolContext = ref<ToolContext | null>(null)

// 初始化
function init() {
    // 加载历史会话
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            sessions.value = JSON.parse(stored)
        } catch (e) {
            console.error('Failed to load sessions:', e)
            sessions.value = []
        }
    }

    // 加载当前会话
    const currentStored = localStorage.getItem(CURRENT_SESSION_KEY)
    if (currentStored) {
        try {
            currentSession.value = JSON.parse(currentStored)
        } catch (e) {
            console.error('Failed to load current session:', e)
            startNewSession()
        }
    } else {
        startNewSession()
    }
}

// 开始新会话
function startNewSession() {
    // 如果有当前会话且有消息，先保存到历史
    if (currentSession.value && currentSession.value.messages.length > 0) {
        archiveCurrentSession()
    }

    // 创建新会话
    currentSession.value = {
        id: generateId(),
        startTime: Date.now(),
        messages: [],
        thoughts: [],
        compressedHistory: [],
        roundCount: 0
    }
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
        roundCount: currentSession.value.roundCount || 0
    }

    // 添加到历史
    sessions.value.unshift(sessionToArchive)
    saveSessions()

    // 提取记忆（异步，不阻塞）
    extractMemoriesFromSession(currentSession.value.messages).catch(err => {
        console.error('[Session] Failed to extract memories:', err)
    })
}

// 从会话消息中提取记忆
async function extractMemoriesFromSession(messages: SessionMessage[]) {
    try {
        const { extractMemories, addMemories } = await import('./memory')
        const newMemories = await extractMemories(
            messages.map(m => ({ role: m.role, content: m.content }))
        )
        if (newMemories.length > 0) {
            addMemories(newMemories)
            console.log('[Session] Extracted memories:', newMemories.length)
        }
    } catch (e) {
        console.warn('[Session] Failed to extract memories:', e)
    }
}

// 添加消息到当前会话
function addMessage(message: Omit<SessionMessage, 'timestamp'>) {
    if (!currentSession.value) startNewSession()

    currentSession.value!.messages.push({
        ...message,
        timestamp: Date.now()
    })

    // 计数对话轮次（用户消息为一轮）
    if (message.role === 'user') {
        currentSession.value!.roundCount++
    }

    saveCurrentSession()
}

// 检查是否需要压缩
function shouldCompress(): boolean {
    if (!currentSession.value) return false
    return currentSession.value.roundCount >= 5 && currentSession.value.roundCount % 5 === 0
}

// 添加压缩摘要
function addCompressedSummary(summary: string) {
    if (!currentSession.value) return
    currentSession.value.compressedHistory.push(summary)
    // 清空已压缩的消息（保留最近2轮）
    const keepCount = 4 // 保留最近2轮（每轮2条消息）
    if (currentSession.value.messages.length > keepCount) {
        currentSession.value.messages = currentSession.value.messages.slice(-keepCount)
    }
    saveCurrentSession()
}

// 添加工具小结
function addToolSummary(toolName: string, summary: string) {
    if (!currentSession.value) return
    currentSession.value.compressedHistory.push(`[${toolName}] ${summary}`)
    saveCurrentSession()
}

// 获取带压缩历史的消息上下文
function getContextMessages(): { compressed: string[], recent: SessionMessage[] } {
    if (!currentSession.value) return { compressed: [], recent: [] }
    return {
        compressed: currentSession.value.compressedHistory,
        recent: currentSession.value.messages
    }
}

// 添加 Agent 思考记录
function addThought(thought: string, action: string) {
    if (!currentSession.value) return

    currentSession.value.thoughts.push({
        timestamp: Date.now(),
        thought,
        action
    })
    saveCurrentSession()
}

// 获取历史会话
function getSession(id: string): Session | undefined {
    return sessions.value.find(s => s.id === id)
}

// 删除历史会话
function deleteSession(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id)
    saveSessions()
}

// 保存当前会话
function saveCurrentSession() {
    if (currentSession.value) {
        localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(currentSession.value))
    }
}

// 保存历史会话
function saveSessions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.value))
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
    activeToolContext.value = {
        tool,
        phase: 'active',
        turnCount: 0,
        maxTurns,
        systemPrompt,
        conversationHistory: []
    }
    console.log(`[Session] 进入内核态: ${tool}`)
}

/**
 * 退出工具模式（返回用户态）
 */
function endTool() {
    if (activeToolContext.value) {
        console.log(`[Session] 退出内核态: ${activeToolContext.value.tool}`)
        activeToolContext.value = null
    }
}

/**
 * 是否在工具模式（内核态）
 */
function isInToolMode(): boolean {
    return activeToolContext.value !== null
}

/**
 * 获取当前工具上下文
 */
function getToolContext(): ToolContext | null {
    return activeToolContext.value
}

/**
 * 添加工具对话消息
 */
function addToolMessage(role: 'user' | 'assistant', content: string) {
    if (!activeToolContext.value) return
    activeToolContext.value.conversationHistory.push({ role, content })
    if (role === 'user') {
        activeToolContext.value.turnCount++
    }
}

/**
 * 检查工具是否应该结束（轮数限制）
 */
function shouldToolEnd(): boolean {
    if (!activeToolContext.value) return false
    return activeToolContext.value.turnCount >= activeToolContext.value.maxTurns
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
        activeToolContext,
        startNewSession,
        addMessage,
        addThought,
        getSession,
        deleteSession,
        formatTime,
        shouldCompress,
        addCompressedSummary,
        addToolSummary,
        getContextMessages,
        // 工具模式（内核态）
        startTool,
        endTool,
        isInToolMode,
        getToolContext,
        addToolMessage,
        shouldToolEnd
    }
}
