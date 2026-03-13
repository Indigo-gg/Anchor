/**
 * OpenClaw Skill 加载器 (渲染进程代理版)
 * 
 * 通过 Electron IPC 请求主进程加载 skills 目录，
 * 转换为 UnifiedTool 注册到工具注册表。
 */

import { registerExternalTools, type UnifiedTool } from '@/services/tool-registry'

/** 加载所有可用 Skills (内置 + 用户自定义) */
export async function loadAllSkills(): Promise<UnifiedTool[]> {
    console.log('[SkillLoader] 请求主进程加载 Skills...')
    try {
        const skills = await window.electronAPI.loadSkills()
        console.log('[SkillLoader] 已加载 Skills:', skills.map(s => `${s.icon} ${s.key}`))
        return skills as UnifiedTool[]
    } catch (e) {
        console.error('[SkillLoader] 加载 Skills 失败:', e)
        return []
    }
}

/** 初始化: 加载并注册所有 Skills */
export async function initSkills() {
    const skills = await loadAllSkills()
    registerExternalTools(skills)
    return skills
}

/** 安装新技能 (从 Markdown 内容) */
export async function installSkill(name: string, content: string): Promise<boolean> {
    const result = await window.electronAPI.installSkill(name, content)
    if (result.success) {
        await reloadSkills()
        return true
    }
    return false
}

/** 卸载技能 */
export async function uninstallSkill(key: string): Promise<boolean> {
    const result = await window.electronAPI.uninstallSkill(key)
    if (result.success) {
        await reloadSkills()
        return true
    }
    return false
}

/** 重新加载 Skills (用于 UI 中的"刷新"按钮) */
export async function reloadSkills(): Promise<UnifiedTool[]> {
    const skills = await loadAllSkills()
    registerExternalTools(skills)
    return skills
}
