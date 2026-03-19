/**
 * 记忆服务 - 长期用户画像与洞察管理
 */

import { ref } from 'vue'
import { chat, getEmbedding } from './llm'
import { 
    addMemoryDocument, 
    getMemoriesByRole, 
    deleteMemoryDocument, 
    clearMemoriesByRole, 
    migrateFromLocalStorage,
    type MemoryDocument,
    type MemoryDocType
} from './memory-store'

// ============ 类型定义 ============

export type MemoryType = MemoryDocType

export interface MemorySettings {
    enabled: boolean
    rememberEpisodes: boolean
    retentionDays: number // 当前废弃过期清理，全保留
}

// ============ 存储 ============

const SETTINGS_KEY = 'anchor_memory_settings'

const memories = ref<MemoryDocument[]>([])
const settings = ref<MemorySettings>({
    enabled: true,
    rememberEpisodes: true,
    retentionDays: 30
})

let isInitialized = false

// 初始化
async function init() {
    if (isInitialized) return
    isInitialized = true
    
    // 数据迁移
    await migrateFromLocalStorage()

    // 加载设置
    const settingsStored = localStorage.getItem(SETTINGS_KEY)
    if (settingsStored) {
        try {
            settings.value = { ...settings.value, ...JSON.parse(settingsStored) }
        } catch (e) {
            console.error('[Memory] Failed to load settings:', e)
        }
    }
    
    await loadMemories()
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
    type: MemoryDocType
    content: string
    tags: string[]
    evidence: string
}

/**
 * 从对话中提取记忆并存入统一存储
 */
export async function extractMemories(
    messages: { role: string; content: string }[],
    roleId?: string
) {
    if (!settings.value.enabled || messages.length < 2) return

    // 获取当前角色 ID
    let currentRoleId = roleId || 'anchor'
    if (!roleId) {
        try {
            const { useRoleStore } = await import('./role')
            const { activeRoleId } = useRoleStore()
            currentRoleId = activeRoleId.value
        } catch { /* 忽略 */ }
    }

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
        if (!jsonMatch) return

        const extracted: ExtractedMemory[] = JSON.parse(jsonMatch[0])

        for (const item of extracted) {
            let embedding: number[] | undefined
            try {
                embedding = await getEmbedding(item.content)
            } catch (e) {
                console.warn('[Memory] Embedding failed for extracted memory')
            }
            
            await addMemoryDocument({
                type: item.type,
                roleId: currentRoleId,
                content: item.content,
                tags: item.tags,
                embedding,
                confidence: 0.5,
                source: 'llm_extract',
                metadata: { evidence: [item.evidence] }
            })
            console.log('[Memory] Added new memory document:', item.content)
        }
        
        await loadMemories(currentRoleId)
    } catch (e) {
        console.error('[Memory] Failed to extract memories:', e)
    }
}

// ============ 记忆管理 ============

/**
 * 加载角色记忆供 UI 组件消费
 */
export async function loadMemories(roleId?: string) {
    let currentRoleId = roleId
    if (!currentRoleId) {
        try {
            const { useRoleStore } = await import('./role')
            const { activeRoleId } = useRoleStore()
            currentRoleId = activeRoleId.value
        } catch { currentRoleId = 'anchor' }
    }
    memories.value = await getMemoriesByRole(currentRoleId!)
}

/**
 * 删除记忆
 */
export async function deleteMemory(id: string, roleId?: string) {
    let targetRole = roleId
    if (!targetRole) {
        // 如果未传，尝试从被删除的记忆中获取
        const mem = memories.value.find(m => m.id === id)
        targetRole = mem?.roleId || 'anchor'
    }
    
    await deleteMemoryDocument(id, targetRole)
    await loadMemories(targetRole)
}

/**
 * 清空指定角色所有记忆
 */
export async function clearAllMemories(roleId?: string) {
    let targetRole = roleId
    if (!targetRole) {
        try {
            const { useRoleStore } = await import('./role')
            const { activeRoleId } = useRoleStore()
            targetRole = activeRoleId.value
        } catch { targetRole = 'anchor' }
    }
    
    await clearMemoriesByRole(targetRole!)
    await loadMemories(targetRole)
}

/**
 * 获取所有记忆的只读引用 (供模板渲染用)
 */
export function getAllMemories() {
    return memories.value
}

// ============ 获取格式化上下文 ============

/**
 * 格式化记忆用于注入 prompt
 */
export function formatMemoriesForPrompt(mems: MemoryDocument[]): string {
    if (mems.length === 0) return ''

    const profiles = mems.filter(m => m.type === 'profile')
    const patterns = mems.filter(m => m.type === 'pattern')
    const episodes = mems.filter(m => m.type === 'episode')
    const facts = mems.filter(m => m.type === 'fact' || m.type === 'summary')

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
    if (facts.length > 0) {
        sections.push(`[重要事实]\n${facts.map(m => `- ${m.content}`).join('\n')}`)
    }

    return sections.join('\n\n')
}

// ============ 导出 ============

export function useMemoryStore() {
    // 首次获取时触发异步初始化
    if (!isInitialized) {
        init().catch(console.error)
    }

    // 监听角色切换，重新加载对应角色的记忆
    import('./role').then(({ useRoleStore }) => {
        const { activeRoleId } = useRoleStore()
        import('vue').then(({ watch }) => {
            watch(activeRoleId, (newRole) => {
                if (newRole) {
                    loadMemories(newRole).catch(console.error)
                }
            })
        })
    }).catch(console.error)

    return {
        memories,
        settings,
        extractMemories,
        deleteMemory,
        clearAllMemories,
        getAllMemories,
        formatMemoriesForPrompt,
        saveSettings,
        loadMemories
    }
}
