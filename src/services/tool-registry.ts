/**
 * 工具注册表
 * 
 * 将工具从角色定义中解耦，提供统一的工具元信息管理。
 * 每个工具定义包含：基础信息、分类、触发条件、对话配置、输入输出 Schema。
 * 
 * V2: 引入 UnifiedTool 统一模型，支持内置工具 + OpenClaw Skills
 */

import { useBoundaryStore } from '@/services/boundary'
import { useEnergyStore } from '@/services/energy'

// ============ 类型定义 ============

/** 工具作用域 */
export type ToolScope = 'common' | 'exclusive'

/** 工具类型 */
export type ToolType = 'interactive' | 'instant' | 'visualization'

/** 工具来源 */
export type ToolSource = 'builtin' | 'openclaw-skill'

/** 工具执行模式 */
export type ToolExecMode =
    | 'kernel'          // 内置交互工具 (进入 Kernel Mode 多轮对话)
    | 'instant'         // 内置即时工具 (单次执行)
    | 'prompt-inject'   // OpenClaw Skill (注入 system prompt, 由 Agent 自行调用)

/** OpenClaw Skill 元信息 */
export interface SkillMeta {
    markdownBody: string        // Skill 的 Markdown 正文 (注入 prompt)
    requires?: {                // 依赖检查
        bins?: string[]
        env?: string[]
    }
    platform?: string[]         // 平台限制 ['darwin', 'linux', 'win32']
}

/** 工具触发条件 */
export interface ToolTrigger {
    keywords: string[]        // 关键词匹配（用于意图路由提示）
    description: string       // 自然语言描述（注入路由 prompt）
}

/** JSON Schema 简化描述 */
export interface ToolFieldSchema {
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array'
    description: string
    required?: boolean
}

/** 工具输入输出 Schema */
export interface ToolIOSchema {
    input: ToolFieldSchema[]
    output: ToolFieldSchema[]
}

/** 工具元信息 (内置工具) */
export interface ToolMeta {
    key: string
    name: string
    icon: string
    description: string

    // 分类
    type: ToolType
    scope: ToolScope
    ownerRoleId?: string          // exclusive 时绑定的角色 ID

    // 触发
    trigger: ToolTrigger

    // 对话配置
    systemPrompt: string
    maxTurns: number
    confirmMessage: string
    welcomeMessage: string

    // 输入输出 Schema
    ioSchema: ToolIOSchema

    // 是否有结果处理逻辑（集中在 executeResultHandler 中实现）
    hasResultHandler: boolean
}

/** 统一工具定义 (内置 + 外部) */
export interface UnifiedTool {
    key: string
    name: string
    icon: string
    description: string
    source: ToolSource
    execMode: ToolExecMode

    // 内置工具字段 (source === 'builtin')
    builtinMeta?: ToolMeta

    // OpenClaw Skill 字段 (source === 'openclaw-skill')
    skillMeta?: SkillMeta
}

// ============ 内置工具注册表 ============

const TOOL_REGISTRY: ToolMeta[] = [
    {
        key: 'breathing_guide',
        name: '静默呼吸',
        icon: '🌬️',
        description: '呼吸练习/放松',
        type: 'instant',
        scope: 'common',
        trigger: {
            keywords: ['呼吸', '放松', '冥想', '深呼吸', '平静'],
            description: '呼吸练习/放松'
        },
        systemPrompt: `你是"呼吸引导师"。引导用户进行放松呼吸。

直接开始引导，不需要多问。返回：
{"complete": true, "guide": "ready"}

用温暖的语言告诉用户我们即将开始。`,
        maxTurns: 1,
        confirmMessage: '我们可以一起做个呼吸练习，帮助你放松一下。现在开始？',
        welcomeMessage: '好的，让我们开始。先找一个舒服的姿势，准备好了告诉我。',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成', required: true },
                { name: 'guide', type: 'string', description: '引导状态', required: true }
            ]
        },
        hasResultHandler: false
    },
    {
        key: 'boundary_mapper',
        name: '边界整理',
        icon: '🧭',
        description: '边界梳理/人际问题',
        type: 'interactive',
        scope: 'common',
        trigger: {
            keywords: ['边界', '人际', '关系', '侵犯', '控制', '课题分离'],
            description: '边界梳理/人际问题'
        },
        systemPrompt: `你是"边界整理师"。帮助用户梳理人际边界问题。

流程：
1. 通过 2-5 个问题理清事情的来龙去脉（具体轮数由你判断，信息足够即可结束）
2. 了解：发生了什么、涉及谁、用户的感受、用户想要什么
3. 当信息足够时，返回分析结果

原则：温和、客观、关注事实。每次只问一个问题。不要急于结束，确保理解清楚再总结。

当信息足够时，返回 JSON：
{"complete": true, "analysis": {"tasks": [{"label": "标签5字内", "reason": "一句话解释", "score": 0-10}]}}
score: 8-10=我的课题(完全掌控), 4-7=部分影响, 0-3=他人课题(无法控制)

如果还需要收集信息，直接用文本回复，不要用 JSON。`,
        maxTurns: 6,
        confirmMessage: '听起来这个情况涉及到你和他人的边界。我可以带你梳理一下，看看哪些是你能控制的。要试试吗？',
        welcomeMessage: '好的，我们来梳理一下。先告诉我，你想探讨的是哪段关系？或者是什么具体的情境让你感到边界被侵犯？',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成', required: true },
                { name: 'analysis', type: 'object', description: '分析结果，包含 tasks 数组', required: true }
            ]
        },
        hasResultHandler: true
    },
    {
        key: 'emergency_guide',
        name: '急救引导',
        icon: '🚨',
        description: '着陆练习/情绪急救',
        type: 'instant',
        scope: 'common',
        trigger: {
            keywords: ['着陆', '急救', '崩溃', '恐慌', '焦虑发作', '难受'],
            description: '着陆练习/情绪急救'
        },
        systemPrompt: `你是"着陆引导师"。帮助用户在情绪危机时稳定下来。

直接开始引导，不需要多问。返回：
{"complete": true, "guide": "ready"}

用平静、温和的语气告诉用户我们即将开始。`,
        maxTurns: 1,
        confirmMessage: '我感觉到你现在可能很难受。如果你愿意，我可以带你做一个简单的着陆练习，帮助你先平静下来。要试试吗？',
        welcomeMessage: '好的，我们来做一个简单的着陆练习。先深呼吸，告诉我现在你身边能看到什么？',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成', required: true },
                { name: 'guide', type: 'string', description: '引导状态', required: true }
            ]
        },
        hasResultHandler: false
    },
    {
        key: 'energy_audit',
        name: '能量检测',
        icon: '⚡',
        description: '能量状态',
        type: 'interactive',
        scope: 'common',
        trigger: {
            keywords: ['能量', '精力', '疲惫', '累', '状态'],
            description: '能量状态'
        },
        systemPrompt: `你是"能量评估师"。帮助用户了解当前的能量状态。

通过 2-4 个问题了解（具体轮数由你判断）：
- 身体状态（睡眠、食欲、精力）
- 情绪状态
- 最近的压力来源

原则：温和询问，不要急于结束。

当信息足够时，返回 JSON：
{"complete": true, "energy": {"body": 1-10, "emotion": 1-10, "motivation": 1-10, "summary": "简短总结"}}

如果还需要收集信息，直接用文本回复，不要用 JSON。`,
        maxTurns: 5,
        confirmMessage: '要不我们先看看你现在的能量状态？这能帮助我们更好地了解你的情况。',
        welcomeMessage: '好的，先和我说说你现在的感受。身体累吗？情绪如何？',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成', required: true },
                { name: 'energy', type: 'object', description: '能量评估结果，包含 body/emotion/motivation (1-10) 和 summary', required: true }
            ]
        },
        hasResultHandler: true
    },
    {
        key: 'values_compass',
        name: '价值观雷达',
        icon: '🧭',
        description: '价值观探索',
        type: 'interactive',
        scope: 'common',
        trigger: {
            keywords: ['价值观', '纠结', '选择困难', '什么重要'],
            description: '价值观探索'
        },
        systemPrompt: `你是"价值观向导"。帮助用户准备价值观评估。

流程：
1. 通过 1-2 个问题了解用户想要探索的情境（例如：工作决策、人际关系、生活选择）
2. 当你了解清楚情境后，返回准备开始评估

原则：简洁友好，快速收集情境即可。

当情境收集完成时，返回 JSON：
{"complete": true, "mode": "quiz", "context": "用户情境的简要描述"}

如果还需要了解情境，直接用文本回复，不要用 JSON。`,
        maxTurns: 3,
        confirmMessage: '我们可以一起探索一下你内心真正看重的是什么。愿意试试吗？',
        welcomeMessage: '好的，我们来探索一下。最近有什么事情让你在做决定时感到纠结吗？',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成', required: true },
                { name: 'mode', type: 'string', description: '模式（quiz）', required: true },
                { name: 'context', type: 'string', description: '用户情境描述', required: true }
            ]
        },
        hasResultHandler: true
    },
    {
        key: 'web_search',
        name: '网络检索',
        icon: '🌐',
        description: '通过互联网搜索实时信息、新闻、百科等',
        type: 'instant',
        scope: 'common',
        trigger: {
            keywords: ['搜一下', '上网查', '最新', '新闻', '网络', '搜索', '查一下'],
            description: '当用户询问实时信息、新闻或你不确定的外部事实时使用'
        },
        systemPrompt: `你是"检索分析员"。你需要根据用户问题，提取用于搜索引擎的搜索关键词。

直接返回 JSON 格式，不要回答其他内容：
{"complete": true, "query": "提取出的核心搜索词"}

只提取名词和核心动词，去掉无用的助词。`,
        maxTurns: 1,
        confirmMessage: '这个问题我可以上网查一下最新信息，可以吗？',
        welcomeMessage: '好的，正在连网检索...',
        ioSchema: {
            input: [],
            output: [
                { name: 'complete', type: 'boolean', description: '是否完成提取', required: true },
                { name: 'query', type: 'string', description: '提取出的搜索查询词', required: true }
            ]
        },
        hasResultHandler: false
    },
    {
        key: 'image_gen',
        name: '图片生成',
        icon: '🖼️',
        description: '生成图片',
        type: 'instant',
        scope: 'common',
        trigger: {
            keywords: ['画', '生成图片', '图片', '壁纸', '头像'],
            description: '生成图片'
        },
        systemPrompt: '',
        maxTurns: 0,
        confirmMessage: '',
        welcomeMessage: '',
        ioSchema: {
            input: [
                { name: 'prompt', type: 'string', description: '图片描述', required: true },
                { name: 'imageSize', type: 'string', description: '图片尺寸比例', required: false }
            ],
            output: [
                { name: 'imageUrl', type: 'string', description: '生成的图片 URL', required: true }
            ]
        },
        hasResultHandler: false
    }
]

// ============ 外部工具注册表 (V2: OpenClaw Skills) ============

let externalTools: UnifiedTool[] = []

/** 注册外部工具 (由 skill-loader 调用) */
export function registerExternalTools(tools: UnifiedTool[]) {
    externalTools = tools
    console.log('[ToolRegistry] 已注册外部工具:', tools.map(t => t.key))
}

/** 获取所有外部工具 */
export function getExternalTools(): UnifiedTool[] {
    return [...externalTools]
}

// ============ 查询方法 ============

/** 通过 key 获取内置工具 */
export function getToolByKey(key: string): ToolMeta | undefined {
    return TOOL_REGISTRY.find(t => t.key === key)
}

/** 通过 key 获取统一工具 (内置 + 外部) */
export function getUnifiedToolByKey(key: string): UnifiedTool | undefined {
    // 先找内置
    const builtin = TOOL_REGISTRY.find(t => t.key === key)
    if (builtin) {
        return builtinToUnified(builtin)
    }
    // 再找外部
    return externalTools.find(t => t.key === key)
}

/** 内置 ToolMeta → UnifiedTool */
function builtinToUnified(tool: ToolMeta): UnifiedTool {
    return {
        key: tool.key,
        name: tool.name,
        icon: tool.icon,
        description: tool.description,
        source: 'builtin',
        execMode: tool.type === 'interactive' ? 'kernel' : 'instant',
        builtinMeta: tool,
    }
}

/** 获取指定 scope 的工具 */
export function getToolsByScope(scope: ToolScope): ToolMeta[] {
    return TOOL_REGISTRY.filter(t => t.scope === scope)
}

/**
 * 获取角色可用的工具列表
 * @param roleId 角色 ID
 * @param toolKeys 角色配置的工具 key 列表
 * @param useCommonTools 是否启用通用工具
 */
export function getToolsForRole(roleId: string, toolKeys: string[], useCommonTools: boolean): ToolMeta[] {
    const tools: ToolMeta[] = []

    for (const key of toolKeys) {
        // 跳过外部 Skill key (以 skill_ 前缀标识)
        if (key.startsWith('skill_')) continue

        const tool = getToolByKey(key)
        if (!tool) continue

        // exclusive 工具只允许 owner 角色使用
        if (tool.scope === 'exclusive' && tool.ownerRoleId !== roleId) continue

        // 图片生成受 useCommonTools 开关控制
        if (tool.key === 'image_gen' && !useCommonTools) continue

        tools.push(tool)
    }

    return tools
}

/**
 * 获取所有已安装的外部 Skills（自动发现，不需要 toolKeys 声明）
 */
export function getSkillsForRole(_toolKeys?: string[]): UnifiedTool[] {
    return [...externalTools]
}

/** 获取所有已注册的内置工具（用于 UI 展示） */
export function getAllTools(): ToolMeta[] {
    return [...TOOL_REGISTRY]
}

/**
 * 获取角色在编辑器中可选择的内置工具
 * 通用工具所有角色都可选，exclusive 只有 owner 可见
 */
export function getSelectableToolsForRole(roleId: string): ToolMeta[] {
    return TOOL_REGISTRY.filter(t =>
        t.scope === 'common' || t.ownerRoleId === roleId
    )
}

/** 生成意图路由工具描述（用于注入 prompt，内置工具部分） */
export function getRouteToolsDescriptionFromRegistry(toolKeys: string[], roleId: string, useCommonTools: boolean): string {
    const tools = getToolsForRole(roleId, toolKeys, useCommonTools)
        .filter(t => t.key !== 'image_gen')  // 图片生成在路由中单独处理
    if (tools.length === 0) return ''
    return tools.map(t => `- ${t.key}: ${t.trigger.description}`).join('\n')
}

/** 生成意图路由外部 Skill 描述（用于注入 prompt，自动包含所有已安装 Skill） */
export function getRouteSkillsDescription(_toolKeys?: string[]): string {
    const skills = getSkillsForRole()
    if (skills.length === 0) return ''
    return skills.map(s => `- ${s.key}: ${s.description}`).join('\n')
}

/** 执行工具结果处理器（集中式，替代各工具的内联 handler） */
export function executeResultHandler(toolKey: string, result: Record<string, unknown>) {
    try {
        switch (toolKey) {
            case 'boundary_mapper': {
                const { addRecord } = useBoundaryStore()
                const analysis = result.analysis as { tasks?: Array<{ label: string; reason: string; score: number }> }
                if (analysis?.tasks) {
                    addRecord(analysis.tasks, '')
                }
                break
            }
            case 'energy_audit': {
                const { addRecord } = useEnergyStore()
                const energy = result.energy as { body?: number; emotion?: number; motivation?: number; summary?: string }
                if (energy) {
                    const avgScore = ((energy.body || 5) + (energy.emotion || 5) + (energy.motivation || 5)) / 3
                    const level = avgScore >= 8 ? 4 : avgScore >= 6 ? 3 : avgScore >= 4 ? 2 : 1
                    addRecord(level as 1 | 2 | 3 | 4, energy.summary || 'AI能量评估', 'ai_analysis')
                }
                break
            }
            case 'values_compass': {
                // values_compass 使用卡片式评估，数据保存由 ValuesQuiz 组件内部处理
                console.log('[ToolRegistry] values_compass 进入 quiz 模式，context:', result.context)
                break
            }
            default:
                return  // 无需处理
        }
        console.log('[ToolRegistry] 工具结果已处理:', toolKey)
    } catch (e) {
        console.warn('[ToolRegistry] 结果处理失败:', toolKey, e)
    }
}
