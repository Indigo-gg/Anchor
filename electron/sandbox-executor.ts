/**
 * 沙箱化命令执行器
 * 
 * 为 Skill 系统提供安全的命令执行能力。
 * 安全策略：白名单命令、参数过滤、超时控制、输出截断、无 shell 注入。
 */

import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { logger, LogCategory } from './logger'

// ============ 类型定义 ============

export interface SandboxPolicy {
    allowedBins: string[]       // 白名单命令列表
    timeoutMs: number           // 执行超时（毫秒）
    maxOutputBytes: number      // 最大输出字节数
}

export interface ExecutionResult {
    ok: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

// ============ 安全策略 ============

/** 默认策略 */
const DEFAULT_POLICY: Omit<SandboxPolicy, 'allowedBins'> = {
    timeoutMs: 10_000,          // 10 秒超时
    maxOutputBytes: 10_240,     // 10KB 输出限制
}

/** 
 * 危险参数模式（正则匹配）
 * 
 * 因为使用 execFile（无 shell），参数中的普通文本不会被执行。
 * 这里只拦截可能在某些边缘情况下构成注入的模式。
 */
const BLOCKED_ARG_PATTERNS: RegExp[] = [
    /&&/,                       // Shell AND 链接
    /\|\|/,                     // Shell OR 链接
    /`/,                        // 反引号执行
    /\$\(/,                     // 子 shell 执行
]

/** 全局命令黑名单（即使在 allowedBins 中也不能执行） */
const GLOBAL_BLOCKED_BINS = new Set([
    'rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot',
    'mkfs', 'fdisk', 'dd', 'powershell', 'cmd', 'bash',
    'sh', 'zsh', 'fish', 'node', 'python', 'python3',
    'pip', 'npm', 'npx', 'reg', 'regedit', 'taskkill',
])

// ============ 验证逻辑 ============

/**
 * 验证命令是否安全
 */
export function validateCommand(
    command: string,
    args: string[],
    policy: SandboxPolicy
): { valid: boolean; reason?: string } {
    // 1. 提取命令基础名（去路径）
    const baseName = command.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()

    // 2. 全局黑名单检查
    if (GLOBAL_BLOCKED_BINS.has(baseName)) {
        return { valid: false, reason: `命令 "${baseName}" 在全局黑名单中` }
    }

    // 3. 白名单检查
    const allowedLower = policy.allowedBins.map(b => b.toLowerCase())
    if (!allowedLower.includes(baseName)) {
        return { valid: false, reason: `命令 "${baseName}" 不在白名单 [${policy.allowedBins.join(', ')}] 中` }
    }

    // 4. 参数安全检查
    const fullArgStr = args.join(' ')
    for (const pattern of BLOCKED_ARG_PATTERNS) {
        if (pattern.test(fullArgStr)) {
            return { valid: false, reason: `参数包含危险模式: ${pattern.source}` }
        }
    }

    return { valid: true }
}

// ============ 执行逻辑 ============

/**
 * 在沙箱中执行命令
 */
export function executeInSandbox(
    command: string,
    args: string[],
    allowedBins: string[]
): Promise<ExecutionResult> {
    const policy: SandboxPolicy = {
        ...DEFAULT_POLICY,
        allowedBins,
    }

    // 安全验证
    const validation = validateCommand(command, args, policy)
    if (!validation.valid) {
        logger.warn(LogCategory.APP, `[Sandbox] 命令被拦截: ${validation.reason}`)
        return Promise.resolve({
            ok: false,
            error: `安全检查未通过: ${validation.reason}`,
        })
    }

    logger.info(LogCategory.APP, `[Sandbox] 执行: ${command} ${args.join(' ')}`)

    return new Promise((resolve) => {
        try {
            const child = execFile(
                command,
                args,
                {
                    timeout: policy.timeoutMs,
                    maxBuffer: policy.maxOutputBytes,
                    cwd: tmpdir(),
                    // 清理环境变量，只保留必要的
                    env: {
                        PATH: process.env.PATH || '',
                        HOME: process.env.HOME || process.env.USERPROFILE || '',
                        TEMP: process.env.TEMP || tmpdir(),
                        TMP: process.env.TMP || tmpdir(),
                        // Windows 需要 SystemRoot
                        SystemRoot: process.env.SystemRoot || '',
                        LANG: 'zh_CN.UTF-8',
                    },
                    windowsHide: true,  // Windows 下隐藏命令窗口
                },
                (error, stdout, stderr) => {
                    if (error) {
                        // 超时
                        if ((error as any).killed) {
                            logger.warn(LogCategory.APP, `[Sandbox] 命令超时被终止`)
                            resolve({
                                ok: false,
                                error: `命令执行超时 (${policy.timeoutMs / 1000}s)`,
                                stdout: stdout?.slice(0, policy.maxOutputBytes),
                                stderr: stderr?.slice(0, policy.maxOutputBytes),
                            })
                            return
                        }

                        // 输出过大
                        if ((error as any).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                            logger.warn(LogCategory.APP, `[Sandbox] 输出超出限制`)
                            resolve({
                                ok: true,  // 命令本身可能成功了
                                stdout: stdout?.slice(0, policy.maxOutputBytes) + '\n...(输出被截断)',
                                stderr: stderr?.slice(0, policy.maxOutputBytes),
                                exitCode: 0,
                            })
                            return
                        }

                        // 其他错误
                        logger.warn(LogCategory.APP, `[Sandbox] 执行出错: ${error.message}`)
                        resolve({
                            ok: false,
                            error: error.message,
                            stdout: stdout?.slice(0, policy.maxOutputBytes),
                            stderr: stderr?.slice(0, policy.maxOutputBytes),
                            exitCode: (error as any).code,
                        })
                        return
                    }

                    logger.info(LogCategory.APP, `[Sandbox] 执行成功，输出 ${stdout?.length || 0} 字节`)
                    resolve({
                        ok: true,
                        stdout: stdout?.slice(0, policy.maxOutputBytes),
                        stderr: stderr?.slice(0, policy.maxOutputBytes),
                        exitCode: 0,
                    })
                }
            )
        } catch (e: any) {
            logger.error(LogCategory.APP, `[Sandbox] 启动失败: ${e.message}`)
            resolve({
                ok: false,
                error: `命令启动失败: ${e.message}`,
            })
        }
    })
}
