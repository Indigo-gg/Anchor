/**
 * 记忆服务 - 长期用户画像与洞察管理
 * 
 * 记忆类型：
 * - Profile: 长期稳定的用户画像（核心价值观、应对方式）
 * - Pattern: 中期发现的行为/情绪模式
 * - Episode: 短期情境记忆（有时效性）
 */

import { ref } from 'vue'
import { chat } from './llm'

// ============ 类型定义 ============

export type MemoryType = 'profile' | 'pattern' | 'episode'

export interface MemoryItem {
    id: string
    type: MemoryType
    content: string           // 精简的记忆内容（<50字）
    evidence: string[]        // 来源对话摘要
    confidence: number        // 置信度 0-1
    createdAt: number
    lastReinforced: number    // 最后被强化的时间
    tags: string[]            // 语义标签
}

export interface MemorySettings {
    enabled: boolean
    rememberEpisodes: boolean
    retentionDays: number
}

// ============ 存储 ============

const STORAGE_KEY = 'anchor_memories'
const SETTINGS_KEY = 'anchor_memory_settings'

const memories = ref<MemoryItem[]>([])
const settings = ref<MemorySettings>({
    enabled: true,
    rememberEpisodes: true,
    retentionDays: 30
})

// 初始化
function init() {
    // 加载记忆
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            memories.value = JSON.parse(stored)
        } catch (e) {
            console.error('[Memory] Failed to load memories:', e)
            memories.value = []
        }
    }

    // 加载设置
    const settingsStored = localStorage.getItem(SETTINGS_KEY)
    if (settingsStored) {
        try {
            settings.value = { ...settings.value, ...JSON.parse(settingsStored) }
        } catch (e) {
            console.error('[Memory] Failed to load settings:', e)
        }
    }

    // 清理过期记忆
    cleanupExpired()
}

// 保存
function saveMemories() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories.value))
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value))
}

// ============ 记忆提取 ============

const EXTRACT_PROMPT = `你是记忆助手。从对话中提取值得记住的**客观事实**。

只记录：
1. 用户明确提到的事实（职业、家庭、喜好、习惯）→ type: "profile"
2. 用户描述的具体事件（正在发生的事情）→ type: "episode"  
3. 用户表达的明确感受或需求（不要揣测）→ type: "pattern"

规则：
- **只记录用户明确说的**，不要推断、分析或揣测
- **不要灾难化**，比如"累"不等于"极低能量状态"
- **不要贴标签**，用用户自己的话
- 每条记忆内容<50字
- 最多提取2条，宁缺毋滥
- 无明显事实时返回空数组 []

示例：
- 用户说"今天工作好累" → 记录"最近工作压力大"（事实），不要记录"处于极低能量状态"（揣测）
- 用户说"我妈总是催我结婚" → 记录"母亲催婚"（事实），不要记录"与父母关系紧张"（揣测）

返回 JSON 数组（只返回 JSON）：
[{ "type": "profile|pattern|episode", "content": "...", "tags": [...], "evidence": "原话摘要" }]
`

interface ExtractedMemory {
    type: MemoryType
    content: string
    tags: string[]
    evidence: string
}

/**
 * 从对话中提取记忆
 */
export async function extractMemories(
    messages: { role: string; content: string }[]
): Promise<MemoryItem[]> {
    if (!settings.value.enabled || messages.length < 2) return []

    const conversationText = messages
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
        .join('\n')

    try {
        const response = await chat([
            { role: 'system', content: EXTRACT_PROMPT },
            { role: 'user', content: conversationText }
        ], { intent: 'fast' })

        // 解析 JSON
        const jsonMatch = response.match(/\[[\s\S]*\]/)
        if (!jsonMatch) return []

        const extracted: ExtractedMemory[] = JSON.parse(jsonMatch[0])
        const now = Date.now()

        return extracted.map(item => ({
            id: `mem_${now}_${Math.random().toString(36).slice(2, 6)}`,
            type: item.type,
            content: item.content,
            evidence: [item.evidence],
            confidence: 0.5, // 初始置信度
            createdAt: now,
            lastReinforced: now,
            tags: item.tags
        }))
    } catch (e) {
        console.error('[Memory] Failed to extract memories:', e)
        return []
    }
}

// ============ 记忆管理 ============

/**
 * 添加新记忆（自动去重合并）
 */
export function addMemory(newMemory: MemoryItem) {
    // 检查是否有相似记忆
    const similar = memories.value.find(m =>
        m.type === newMemory.type &&
        isSimilar(m.content, newMemory.content)
    )

    if (similar) {
        // 合并：提升置信度，添加证据
        similar.confidence = Math.min(similar.confidence + 0.15, 1.0)
        similar.evidence.push(...newMemory.evidence)
        similar.lastReinforced = Date.now()
        // 只保留最近5条证据
        if (similar.evidence.length > 5) {
            similar.evidence = similar.evidence.slice(-5)
        }
        console.log('[Memory] Reinforced:', similar.content, 'confidence:', similar.confidence)
    } else {
        // 新增
        memories.value.push(newMemory)
        console.log('[Memory] Added new:', newMemory.content)
    }

    saveMemories()
}

/**
 * 批量添加记忆
 */
export function addMemories(newMemories: MemoryItem[]) {
    newMemories.forEach(addMemory)
}

/**
 * 删除记忆
 */
export function deleteMemory(id: string) {
    memories.value = memories.value.filter(m => m.id !== id)
    saveMemories()
}

/**
 * 清空所有记忆
 */
export function clearAllMemories() {
    memories.value = []
    saveMemories()
}

// ============ 记忆检索 ============

/**
 * 获取相关记忆（用于注入 prompt）
 */
export function getRelevantMemories(
    contextTags: string[] = [],
    limit: number = 5
): MemoryItem[] {
    const now = Date.now()

    return memories.value
        .map(m => {
            // 计算时间衰减
            const daysSince = (now - m.lastReinforced) / (1000 * 60 * 60 * 24)
            const timeDecay = Math.pow(0.95, daysSince / 30)

            // 计算相关性
            const tagMatch = contextTags.length > 0
                ? m.tags.filter(t => contextTags.includes(t)).length / Math.max(m.tags.length, 1)
                : 0.5

            // 综合得分
            const score = m.confidence * timeDecay * (0.5 + 0.5 * tagMatch)

            return { memory: m, score }
        })
        .filter(item => item.score > 0.2) // 过滤低分
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.memory)
}

/**
 * 获取所有记忆（用于 UI 展示）
 */
export function getAllMemories(): MemoryItem[] {
    return [...memories.value].sort((a, b) => b.lastReinforced - a.lastReinforced)
}

/**
 * 格式化记忆用于注入 prompt
 */
export function formatMemoriesForPrompt(mems: MemoryItem[]): string {
    if (mems.length === 0) return ''

    const profiles = mems.filter(m => m.type === 'profile')
    const patterns = mems.filter(m => m.type === 'pattern')
    const episodes = mems.filter(m => m.type === 'episode')

    const sections: string[] = []

    if (profiles.length > 0) {
        sections.push(`[用户画像]\n${profiles.map(m => `- ${m.content}`).join('\n')}`)
    }
    if (patterns.length > 0) {
        sections.push(`[行为模式]\n${patterns.map(m => `- ${m.content}`).join('\n')}`)
    }
    if (episodes.length > 0) {
        sections.push(`[近期事件]\n${episodes.map(m => `- ${m.content}`).join('\n')}`)
    }

    return sections.join('\n\n')
}

// ============ 工具函数 ============

/**
 * 从文本中提取关键词（用于记忆检索）
 */
export function extractKeywords(text: string): string[] {
    // 关键词词典：用户可能提到的重要话题
    const keywordPatterns: Record<string, string[]> = {
        '家庭': ['妈', '爸', '父', '母', '家', '亲', '兄弟', '姐妹', '老公', '老婆', '孩子', '儿子', '女儿'],
        '工作': ['工作', '上班', '老板', '同事', '公司', '项目', '加班', '职场', '开会', '领导'],
        '情绪': ['焦虑', '抑郁', '难过', '开心', '压力', '累', '烦', '崩溃', '低落', '愤怒', '生气'],
        '关系': ['朋友', '恋爱', '分手', '吵架', '冲突', '矛盾', '边界', '付出', '委屈'],
        '自我': ['自己', '我', '选择', '决定', '困惑', '迷茫', '目标', '意义', '价值'],
        '健康': ['睡眠', '失眠', '睡不着', '吃', '身体', '运动', '休息', '疲惫']
    }

    const foundTags: string[] = []
    const lowerText = text.toLowerCase()

    for (const [tag, keywords] of Object.entries(keywordPatterns)) {
        for (const keyword of keywords) {
            if (lowerText.includes(keyword)) {
                foundTags.push(tag)
                break  // 每个标签只加一次
            }
        }
    }

    return foundTags
}

function isSimilar(a: string, b: string): boolean {
    // 简单的相似度判断：关键词重叠
    const wordsA = new Set(a.split(/\s+/))
    const wordsB = new Set(b.split(/\s+/))
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size
    return intersection / union > 0.5
}

function cleanupExpired() {
    if (!settings.value.rememberEpisodes) {
        // 如果禁用了 episode，删除所有 episode
        memories.value = memories.value.filter(m => m.type !== 'episode')
    }

    const maxAge = settings.value.retentionDays * 24 * 60 * 60 * 1000
    const now = Date.now()

    memories.value = memories.value.filter(m => {
        // Episode 有过期时间
        if (m.type === 'episode') {
            return now - m.createdAt < maxAge
        }
        // Profile 和 Pattern 不过期，但低置信度会被清理
        if (m.confidence < 0.2) {
            return false
        }
        return true
    })

    saveMemories()
}

// ============ 导出 ============

export function useMemoryStore() {
    if (memories.value.length === 0) {
        init()
    }

    return {
        memories,
        settings,
        extractMemories,
        addMemory,
        addMemories,
        deleteMemory,
        clearAllMemories,
        getRelevantMemories,
        getAllMemories,
        formatMemoriesForPrompt,
        extractKeywords,
        saveSettings
    }
}
