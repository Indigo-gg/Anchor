/**
 * Skill 执行代理 (渲染进程)
 * 
 * 封装主进程沙箱执行器的 IPC 调用，
 * 提供给 Agent 使用的简洁接口。
 */

export interface SkillExecResult {
    ok: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

/**
 * 执行 Skill 命令（通过主进程沙箱）
 * 
 * @param skillKey Skill 标识（如 skill_weather）
 * @param command 命令名（如 curl）
 * @param args 命令参数
 * @param allowedBins 白名单命令列表（从 Skill 的 requires.bins 获取）
 */
export async function executeSkillCommand(
    skillKey: string,
    command: string,
    args: string[],
    allowedBins: string[]
): Promise<SkillExecResult> {
    console.log(`[SkillExecutor] ${skillKey} → ${command} ${args.join(' ')}`)
    try {
        const result = await window.electronAPI.execSkillCommand({
            skillKey,
            command,
            args,
            allowedBins,
        })
        console.log(`[SkillExecutor] 结果:`, result.ok ? '成功' : result.error)
        return result
    } catch (e: any) {
        console.error('[SkillExecutor] IPC 调用失败:', e)
        return { ok: false, error: e.message || '执行失败' }
    }
}
