/**
 * 主进程 Skill 加载器
 * 
 * V3: 统一加载内置工具 + 外部 Skill
 * 所有能力均以 SKILL.md 文件形式定义在 skills/ 目录下，
 * 通过 frontmatter 字段区分 execMode (kernel / instant / command / prompt-inject)
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { app } from 'electron'

// ============ 类型定义 ============

interface SkillTrigger {
    keywords?: string[]
    description: string
}

interface SkillManifest {
    name: string
    description: string
    metadata?: {
        openclaw?: {
            emoji?: string
            os?: string[]
            exec_mode?: string
            max_turns?: number
            confirm_message?: string
            welcome_message?: string
            has_result_handler?: boolean
            handler_key?: string
            trigger?: SkillTrigger
            requires?: {
                bins?: string[]
                env?: string[]
            }
        }
    }
}

/** Kernel 模式配置 */
export interface KernelConfig {
    maxTurns: number
    confirmMessage: string
    welcomeMessage: string
    hasResultHandler: boolean
    handlerKey?: string
}

/** 对应渲染进程中的 UnifiedTool 结构 */
export interface SkillData {
    key: string
    name: string
    icon: string
    description: string
    source: string
    execMode: string          // 'kernel' | 'instant' | 'command' | 'prompt-inject'
    skillMeta: {
        markdownBody: string
        requires?: any
        platform?: string[]
        trigger?: SkillTrigger
        kernelConfig?: KernelConfig
        handlerKey?: string   // instant 类型的处理器标识
    }
}

// ============ 路径配置 ============

function getBuiltinSkillsDir(): string {
    if (!app.isPackaged) {
        return path.resolve(process.cwd(), 'skills')
    }
    return path.join(process.resourcesPath, 'skills')
}

function getUserSkillsDir(): string {
    return path.join(app.getPath('userData'), 'skills')
}

// ============ 加载逻辑 ============

function loadSkill(skillDir: string): SkillData | null {
    const filePath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(filePath)) return null

    try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const { data, content } = matter(raw)
        const manifest = data as SkillManifest

        if (!manifest.name) return null

        const oc = manifest.metadata?.openclaw

        // 平台检查
        const platform = oc?.os
        if (platform && platform.length > 0 && !platform.includes(process.platform)) {
            return null
        }

        // 解析 exec_mode，默认 prompt-inject（向后兼容）
        const execMode = oc?.exec_mode || 'prompt-inject'

        // 构建 kernel 配置（仅 kernel 类型需要）
        let kernelConfig: KernelConfig | undefined
        if (execMode === 'kernel') {
            kernelConfig = {
                maxTurns: oc?.max_turns || 3,
                confirmMessage: oc?.confirm_message || '要开始吗？',
                welcomeMessage: oc?.welcome_message || '好的，我们开始。',
                hasResultHandler: oc?.has_result_handler || false,
                handlerKey: oc?.handler_key,
            }
        }

        return {
            key: `skill_${manifest.name}`,
            name: manifest.description || manifest.name,
            icon: oc?.emoji || '🔧',
            description: manifest.description || '',
            source: 'openclaw-skill',
            execMode,
            skillMeta: {
                markdownBody: content.trim(),
                requires: oc?.requires,
                platform: oc?.os,
                trigger: oc?.trigger,
                kernelConfig,
                handlerKey: oc?.handler_key,
            }
        }
    } catch (e) {
        console.error('[SkillLoaderMain] Failed to load skill:', skillDir, e)
        return null
    }
}

function loadSkillsFromDir(dir: string): SkillData[] {
    const skills: SkillData[] = []
    if (!fs.existsSync(dir)) {
        try {
            if (dir.includes('userData')) fs.mkdirSync(dir, { recursive: true })
        } catch {}
        return skills
    }

    try {
        const entries = fs.readdirSync(dir)
        for (const entry of entries) {
            const entryPath = path.join(dir, entry)
            if (fs.statSync(entryPath).isDirectory()) {
                const skill = loadSkill(entryPath)
                if (skill) skills.push(skill)
            }
        }
    } catch (e) {
        console.error('[SkillLoaderMain] Error scanning dir:', dir, e)
    }

    return skills
}

/** 执行完整加载流程 */
export function handleLoadAllSkills(): SkillData[] {
    const builtinDir = getBuiltinSkillsDir()
    const userDir = getUserSkillsDir()

    const builtinSkills = loadSkillsFromDir(builtinDir)
    const userSkills = loadSkillsFromDir(userDir)

    // 合并并去重（用户目录优先覆盖内置）
    const merged = new Map<string, SkillData>()
    for (const s of builtinSkills) merged.set(s.key, s)
    for (const s of userSkills) merged.set(s.key, s)

    return Array.from(merged.values())
}
