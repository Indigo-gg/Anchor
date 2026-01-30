/**
 * 会话存储服务
 * 管理历史会话和当前会话状态
 */

import { ref, watch } from 'vue'

// 会话消息
export interface SessionMessage {
    role: 'user' | 'assistant'
    content: string
    tool?: string
    toolParams?: Record<string, unknown>
    timestamp: number
}

// Agent 思考记录
export interface AgentThought {
    timestamp: number
    thought: string
    action: string
}

// 会话
export interface Session {
    id: string
    startTime: number
    endTime?: number
    messages: SessionMessage[]
    thoughts: AgentThought[]
    summary?: string  // 自动生成的摘要
}

// 存储键
const STORAGE_KEY = 'anchor_sessions'
const CURRENT_SESSION_KEY = 'anchor_current_session'

// 当前会话
const currentSession = ref<Session | null>(null)

// 历史会话列表
const sessions = ref<Session[]>([])

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
        thoughts: []
    }
    saveCurrentSession()
}

// 归档当前会话
function archiveCurrentSession() {
    if (!currentSession.value || currentSession.value.messages.length === 0) return

    currentSession.value.endTime = Date.now()

    // 生成简单摘要（取第一条用户消息）
    const firstUserMsg = currentSession.value.messages.find(m => m.role === 'user')
    currentSession.value.summary = firstUserMsg?.content.slice(0, 50) || '空会话'

    // 添加到历史
    sessions.value.unshift({ ...currentSession.value })
    saveSessions()
}

// 添加消息到当前会话
function addMessage(message: Omit<SessionMessage, 'timestamp'>) {
    if (!currentSession.value) startNewSession()

    currentSession.value!.messages.push({
        ...message,
        timestamp: Date.now()
    })
    saveCurrentSession()
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

// 导出 composable
export function useSessionStore() {
    // 首次使用时初始化
    if (!currentSession.value) {
        init()
    }

    return {
        currentSession,
        sessions,
        startNewSession,
        addMessage,
        addThought,
        getSession,
        deleteSession,
        formatTime
    }
}
