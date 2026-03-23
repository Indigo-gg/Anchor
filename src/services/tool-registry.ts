/**
 * 工具注册表
 * 
 * V3: 纯统一模型，所有能力均通过 SKILL.md 加载
 * 
 * - 内置工具定义已迁移到 skills/ 目录下的 SKILL.md 文件
 * - 本文件只保留：统一工具模型类型、注册/查询方法、结果处理器
 */

import { useBoundaryStore } from '@/services/boundary'
import { useEnergyStore } from '@/services/energy'

// ============ 类型定义 ============

/** 工具来源 */
export type ToolSource = 'openclaw-skill'

/** 工具执行模式 */
export type ToolExecMode =
    | 'kernel'          // 多轮对话内核态 (进入 Kernel Mode)
    | 'instant'         // 即时工具 (单次执行，如 image_gen / web_search / gemini_cli)
    | 'command'         // 命令型 Skill (提取命令 → 沙箱执行 → 总结)
    | 'prompt-inject'   // 知识型 Skill (注入 system prompt, 由 Agent 自行回答)
    | 'ui'              // 独立 UI 交互组件 (渲染前端组件接管交互)

/** 触发条件 (用于路由描述) */
export interface SkillTrigger {
    keywords?: string[]
    description: string
}

/** Kernel 模式配置 */
export interface KernelConfig {
    maxTurns: number
    confirmMessage: string
    welcomeMessage: string
    hasResultHandler: boolean
    handlerKey?: string
}

/** OpenClaw Skill 元信息 */
export interface SkillMeta {
    markdownBody: string        // Skill 的 Markdown 正文 (注入 prompt / systemPrompt)
    requires?: {                // 依赖检查
        bins?: string[]
        env?: string[]
    }
    platform?: string[]         // 平台限制 ['darwin', 'linux', 'win32']
    trigger?: SkillTrigger      // 路由触发描述
    kernelConfig?: KernelConfig // kernel 模式配置
    handlerKey?: string         // instant 类型的处理器标识
}

/** 统一工具定义 */
export interface UnifiedTool {
    key: string
    name: string
    icon: string
    description: string
    source: ToolSource
    execMode: ToolExecMode

    // Skill 元信息
    skillMeta?: SkillMeta
}

// ============ 统一工具注册表 ============

let allTools: UnifiedTool[] = []

/** 注册工具 (由 skill-loader 调用) */
export function registerExternalTools(tools: UnifiedTool[]) {
    allTools = tools
    console.log('[ToolRegistry] 已注册工具:', tools.map(t => `${t.icon} ${t.key} (${t.execMode})`))
}

/** 获取所有已注册工具 */
export function getExternalTools(): UnifiedTool[] {
    return [...allTools]
}

// ============ 查询方法 ============

/** 通过 key 获取统一工具 */
export function getUnifiedToolByKey(key: string): UnifiedTool | undefined {
    return allTools.find(t => t.key === key)
}

/** 获取所有已注册工具（别名，用于 UI） */
export function getAllTools(): UnifiedTool[] {
    return [...allTools]
}

/**
 * 获取角色可用的 Skill 列表
 * @param toolKeys 角色配置中启用的 skill key 列表（如果为空或未定义，返回所有）
 */
export function getSkillsForRole(toolKeys?: string[]): UnifiedTool[] {
    if (!toolKeys || toolKeys.length === 0) {
        return [...allTools]
    }
    // 将 toolKeys 中的非 skill_ 前缀 key 转换为 skill_ 前缀
    const normalizedKeys = toolKeys.map(k => k.startsWith('skill_') ? k : `skill_${k}`)
    return allTools.filter(t => normalizedKeys.includes(t.key))
}

/**
 * 生成意图路由 Skill 描述
 * 用于注入路由 prompt，格式为: - skill_xxx: 描述
 */
export function getRouteSkillsDescription(toolKeys?: string[]): string {
    const skills = getSkillsForRole(toolKeys)
    if (skills.length === 0) return ''
    return skills
        .filter(s => s.skillMeta?.trigger?.description)
        .map(s => `- ${s.key}: ${s.skillMeta!.trigger!.description}`)
        .join('\n')
}

/** 执行工具结果处理器（集中式，根据 handlerKey 分发） */
export function executeResultHandler(handlerKey: string, result: Record<string, unknown>) {
    try {
        switch (handlerKey) {
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
                console.log('[ToolRegistry] values_compass 进入 quiz 模式，context:', result.context)
                break
            }
            default:
                return  // 无需处理
        }
        console.log('[ToolRegistry] 工具结果已处理:', handlerKey)
    } catch (e) {
        console.warn('[ToolRegistry] 结果处理失败:', handlerKey, e)
    }
}
