/**
 * 主进程 Skill 加载器
 * 负责扫描本地文件系统并返回解析后的 Skill 数据
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { app } from 'electron'

// ============ 类型定义 ============

interface SkillManifest {
    name: string
    description: string
    metadata?: {
        openclaw?: {
            emoji?: string
            os?: string[]
            requires?: {
                bins?: string[]
                env?: string[]
            }
        }
    }
}

/** 对应渲染进程中的 UnifiedTool 结构 */
export interface SkillData {
    key: string
    name: string
    icon: string
    description: string
    source: string
    execMode: string
    skillMeta: {
        markdownBody: string
        requires?: any
        platform?: string[]
    }
}

// ============ 路径配置 ============

function getBuiltinSkillsDir(): string {
    if (!app.isPackaged) {
        return path.resolve(process.cwd(), 'skills')
    }
    // 打包后，skills 目录通常在 resources 目录下
    // 假设 electron-builder 配置将其复制到了相应位置
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

        // 平台检查
        const platform = manifest.metadata?.openclaw?.os
        if (platform && platform.length > 0 && !platform.includes(process.platform)) {
            return null
        }

        return {
            key: `skill_${manifest.name}`,
            name: manifest.description || manifest.name,
            icon: manifest.metadata?.openclaw?.emoji || '🔧',
            description: manifest.description || '',
            source: 'openclaw-skill',
            execMode: 'prompt-inject',
            skillMeta: {
                markdownBody: content.trim(),
                requires: manifest.metadata?.openclaw?.requires,
                platform: manifest.metadata?.openclaw?.os,
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
        // 如果目录不存在，尝试创建（仅针对用户目录）
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

    // 合并并去重
    const merged = new Map<string, SkillData>()
    for (const s of builtinSkills) merged.set(s.key, s)
    for (const s of userSkills) merged.set(s.key, s)

    return Array.from(merged.values())
}
