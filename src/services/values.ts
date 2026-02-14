/**
 * 价值观数据服务 - 基于施瓦茨价值观模型
 * Schwartz's Theory of Basic Human Values
 */

import { ref, computed } from 'vue'

// ============ 施瓦茨10维度 ============

export interface SchwartzDimension {
    key: string
    label: string
    english: string
    emoji: string
    description: string
    opposites: string[]  // 对立维度
    neighbors: string[]  // 相邻维度
}

// 施瓦茨价值观环形结构（顺时针排列）
export const SCHWARTZ_DIMENSIONS: SchwartzDimension[] = [
    {
        key: 'self-direction',
        label: '自主',
        english: 'Self-Direction',
        emoji: '🧭',
        description: '独立思考、创造、探索',
        opposites: ['conformity', 'tradition', 'security'],
        neighbors: ['universalism', 'stimulation']
    },
    {
        key: 'stimulation',
        label: '激励',
        english: 'Stimulation',
        emoji: '⚡',
        description: '刺激、新奇、挑战',
        opposites: ['security', 'conformity', 'tradition'],
        neighbors: ['self-direction', 'hedonism']
    },
    {
        key: 'hedonism',
        label: '享乐',
        english: 'Hedonism',
        emoji: '🎉',
        description: '快乐、感官满足、享受生活',
        opposites: ['conformity', 'tradition'],
        neighbors: ['stimulation', 'achievement']
    },
    {
        key: 'achievement',
        label: '成就',
        english: 'Achievement',
        emoji: '🏆',
        description: '个人成功、能力展示',
        opposites: ['benevolence', 'universalism'],
        neighbors: ['hedonism', 'power']
    },
    {
        key: 'power',
        label: '权力',
        english: 'Power',
        emoji: '👑',
        description: '社会地位、控制资源和他人',
        opposites: ['universalism', 'benevolence'],
        neighbors: ['achievement', 'security']
    },
    {
        key: 'security',
        label: '安全',
        english: 'Security',
        emoji: '🛡️',
        description: '安全、稳定、社会秩序',
        opposites: ['self-direction', 'stimulation'],
        neighbors: ['power', 'conformity']
    },
    {
        key: 'conformity',
        label: '遵从',
        english: 'Conformity',
        emoji: '🤝',
        description: '遵守规范、克制冲动',
        opposites: ['self-direction', 'stimulation', 'hedonism'],
        neighbors: ['security', 'tradition']
    },
    {
        key: 'tradition',
        label: '传统',
        english: 'Tradition',
        emoji: '🏛️',
        description: '尊重传统、谦逊、虔诚',
        opposites: ['self-direction', 'stimulation', 'hedonism'],
        neighbors: ['conformity', 'benevolence']
    },
    {
        key: 'benevolence',
        label: '博爱',
        english: 'Benevolence',
        emoji: '💕',
        description: '关心亲近的人、忠诚、宽容',
        opposites: ['power', 'achievement'],
        neighbors: ['tradition', 'universalism']
    },
    {
        key: 'universalism',
        label: '普世',
        english: 'Universalism',
        emoji: '🌍',
        description: '理解和包容所有人、保护自然',
        opposites: ['power', 'achievement'],
        neighbors: ['benevolence', 'self-direction']
    }
]

// 获取维度信息
export function getDimension(key: string): SchwartzDimension | undefined {
    return SCHWARTZ_DIMENSIONS.find(d => d.key === key)
}

// ============ 数据存储 ============

export interface ValueChoice {
    id: string
    timestamp: number
    scenario: string      // 情境描述
    chosenOption: string  // 用户选择的选项文本
    dimension: string     // 对应的价值维度 key
    sessionId: string     // 评估会话ID
}

export interface ValueSession {
    id: string
    timestamp: number
    context: string       // 用户描述的情境背景
    choices: ValueChoice[]
    scores: Record<string, number>  // 各维度得分
}

const STORAGE_KEY = 'anchor_schwartz_values'

const sessions = ref<ValueSession[]>([])

function init() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            sessions.value = JSON.parse(stored)
        } catch (e) {
            console.error('Failed to load values sessions:', e)
            sessions.value = []
        }
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.value))
}

// 添加新会话
function addSession(context: string): ValueSession {
    const session: ValueSession = {
        id: `vs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        context,
        choices: [],
        scores: {}
    }
    sessions.value.push(session)
    saveData()
    return session
}

// 添加选择到会话
function addChoice(sessionId: string, scenario: string, chosenOption: string, dimension: string) {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return

    const choice: ValueChoice = {
        id: `vc_${Date.now()}`,
        timestamp: Date.now(),
        scenario,
        chosenOption,
        dimension,
        sessionId
    }
    session.choices.push(choice)
    saveData()
    return choice
}

// 完成会话并计算得分
function completeSession(sessionId: string): Record<string, number> {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return {}

    // 统计各维度选择次数
    const counts: Record<string, number> = {}
    for (const choice of session.choices) {
        counts[choice.dimension] = (counts[choice.dimension] || 0) + 1
    }

    // 转换为1-10分（基于选择次数占比）
    const total = session.choices.length
    const scores: Record<string, number> = {}

    for (const dim of SCHWARTZ_DIMENSIONS) {
        const count = counts[dim.key] || 0
        // 归一化到1-10分
        scores[dim.key] = Math.round((count / total) * 10 * 10) / 10 || 0
    }

    session.scores = scores
    saveData()
    console.log('[Values] 会话完成:', sessionId, scores)
    return scores
}

// 获取累积各维度得分（所有会话加权平均）
const dimensionScores = computed(() => {
    const totals: Record<string, { sum: number; count: number }> = {}

    for (const session of sessions.value) {
        for (const [key, score] of Object.entries(session.scores)) {
            if (!totals[key]) totals[key] = { sum: 0, count: 0 }
            totals[key].sum += score
            totals[key].count += 1
        }
    }

    const result: Record<string, number> = {}
    for (const dim of SCHWARTZ_DIMENSIONS) {
        const t = totals[dim.key]
        result[dim.key] = t ? Math.round(t.sum / t.count * 10) / 10 : 0
    }
    return result
})

// 获取雷达图数据（环形排列）
const radarData = computed(() => {
    return SCHWARTZ_DIMENSIONS.map(dim => ({
        key: dim.key,
        dimension: dim.label,  // 添加 dimension 字段以兼容 SettingsDrawer
        label: dim.label,
        emoji: dim.emoji,
        value: dimensionScores.value[dim.key] || 0
    }))
})

// 获取最近会话
const recentSessions = computed(() => {
    return sessions.value
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
})

function clearData() {
    sessions.value = []
    saveData()
}

// ============ 导出 ============

export function useValuesStore() {
    if (sessions.value.length === 0) {
        init()
    }

    return {
        sessions,
        recentSessions,
        dimensionScores,
        radarData,  // 改名以匹配 SettingsDrawer
        addSession,
        addChoice,
        completeSession,
        clearData,
        getDimension,
        SCHWARTZ_DIMENSIONS
    }
}
