/**
 * Gemini CLI 执行器 (V2)
 * 
 * 改造要点（相对 V1）：
 * 1. 使用 --output-format json 获取结构化输出，移除 ANSI 清洗
 * 2. 使用 -y (YOLO) 模式自动批准文件写入和命令执行
 * 3. 支持 stdin 管道注入上下文（多轮对话上文）
 * 4. 返回 ChildProcess 句柄供 TaskManager 管理生命周期
 * 5. 根据退出码（0/1/42/53）返回精确错误类型
 */

import { spawn, type ChildProcess } from 'child_process'
import { logger, LogCategory } from './logger'

// ============ 类型定义 ============

export interface GeminiRequest {
    prompt: string            // 文本指令
    context?: string          // 通过 stdin 管道注入的上下文（对话历史等）
    imagePaths?: string[]     // 可选: 图片文件路径列表
    workingDir?: string       // 可选: 工作目录
    yolo?: boolean            // 是否启用 -y 自动执行模式，默认 true
    timeoutMs?: number        // 自定义超时（毫秒）
}

export interface GeminiResult {
    ok: boolean
    response?: string         // JSON 模式下提取的回答正文
    output?: string           // 兼容旧接口：原始输出
    error?: string
    errorType?: 'api_error' | 'input_error' | 'turn_limit' | 'timeout' | 'unknown'
    exitCode?: number         // 原始退出码
    stats?: Record<string, unknown>  // JSON 模式下的统计信息
    durationMs?: number       // 执行耗时
}

// ============ 配置 ============

const DEFAULT_TIMEOUT_MS = 600_000   // 10 分钟超时
const MAX_OUTPUT_BYTES = 200_000     // 200KB 输出限制（JSON 模式输出更大）

// ============ 退出码映射 ============

function mapExitCode(code: number | null): GeminiResult['errorType'] {
    switch (code) {
        case 0: return undefined
        case 1: return 'api_error'
        case 42: return 'input_error'
        case 53: return 'turn_limit'
        default: return 'unknown'
    }
}

function getExitCodeMessage(code: number | null): string {
    switch (code) {
        case 1: return 'Gemini API 请求失败（网络错误或服务端异常）'
        case 42: return '输入参数无效（Prompt 格式错误）'
        case 53: return '对话轮次超限（任务过于复杂，Gemini 陷入循环）'
        default: return `进程异常退出 (code: ${code})`
    }
}

// ============ JSON 输出解析 ============

interface GeminiJsonOutput {
    response?: string
    stats?: Record<string, unknown>
    [key: string]: unknown
}

function parseJsonOutput(raw: string): GeminiJsonOutput | null {
    try {
        // 尝试直接解析整个输出
        return JSON.parse(raw.trim())
    } catch {
        // JSON 模式有时输出前面可能有非 JSON 内容，尝试找到第一个 { 开始解析
        const firstBrace = raw.indexOf('{')
        const lastBrace = raw.lastIndexOf('}')
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(raw.slice(firstBrace, lastBrace + 1))
            } catch {
                return null
            }
        }
        return null
    }
}

// ============ Prompt 构建 ============

function buildPrompt(request: GeminiRequest): string {
    let prompt = ''

    // 图片引用（使用 @path 语法）
    if (request.imagePaths && request.imagePaths.length > 0) {
        const imageRefs = request.imagePaths.map(p => `@${p}`).join(' ')
        prompt = `${imageRefs} `
    }

    prompt += request.prompt
    return prompt
}

// ============ 执行逻辑 ============

export interface ExecuteOptions {
    /** 收到 ChildProcess 句柄的回调（供 TaskManager 保存以支持取消） */
    onProcess?: (child: ChildProcess) => void
}

/**
 * 执行 Gemini CLI (V2)
 * 
 * - --output-format json：结构化输出
 * - -y：YOLO 模式，自动批准所有操作
 * - stdin 管道：注入上下文
 */
export function executeGemini(request: GeminiRequest, options?: ExecuteOptions): Promise<GeminiResult> {
    const startTime = Date.now()
    const prompt = buildPrompt(request)
    const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS
    const useYolo = request.yolo !== false  // 默认启用

    logger.info(LogCategory.APP, `[Gemini] 开始执行，prompt 长度: ${prompt.length}, yolo: ${useYolo}`)

    return new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let child: ChildProcess | null = null
        let settled = false

        const finish = (result: GeminiResult) => {
            if (settled) return
            settled = true
            result.durationMs = Date.now() - startTime
            logger.info(LogCategory.APP, `[Gemini] 执行完成，耗时 ${result.durationMs}ms，成功: ${result.ok}`)
            if (result.response) {
                logger.info(LogCategory.APP, `[Gemini] 回答内容 (前500字):\n${result.response.slice(0, 500)}`)
            }
            if (result.error) {
                logger.error(LogCategory.APP, `[Gemini] 错误: ${result.error}`)
            }
            resolve(result)
        }

        try {
            const cmdName = process.platform === 'win32' ? 'gemini.cmd' : 'gemini'

            // 构建参数列表
            const args = ['-p', prompt, '--output-format', 'json']
            if (useYolo) {
                args.push('-y')
            }

            child = spawn(cmdName, args, {
                cwd: request.workingDir || process.cwd(),
                env: {
                    ...process.env,
                    NO_COLOR: '1',
                    FORCE_COLOR: '0',
                },
                stdio: [
                    request.context ? 'pipe' : 'ignore',  // stdin：有上下文时用管道
                    'pipe',  // stdout
                    'pipe',  // stderr
                ],
                windowsHide: true,
                shell: false,
            })

            // 通知调用方 ChildProcess 句柄
            if (options?.onProcess && child) {
                options.onProcess(child)
            }

            // stdin 管道写入上下文
            if (request.context && child.stdin) {
                child.stdin.write(request.context)
                child.stdin.end()
            }

            // 超时控制
            const timer = setTimeout(() => {
                logger.warn(LogCategory.APP, `[Gemini] 执行超时 (${timeoutMs / 1000}s)`)
                child?.kill('SIGTERM')
                setTimeout(() => {
                    child?.kill('SIGKILL')
                }, 2000)
                finish({
                    ok: false,
                    output: stdout.slice(0, MAX_OUTPUT_BYTES) || undefined,
                    error: `执行超时 (${timeoutMs / 1000}秒)，已终止进程`,
                    errorType: 'timeout',
                })
            }, timeoutMs)

            // 收集 stdout
            child.stdout?.on('data', (data: Buffer) => {
                const chunk = data.toString()
                stdout += chunk
                if (stdout.length > MAX_OUTPUT_BYTES * 2) {
                    stdout = stdout.slice(-MAX_OUTPUT_BYTES)
                }
            })

            // 收集 stderr
            child.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString()
                if (stderr.length > MAX_OUTPUT_BYTES) {
                    stderr = stderr.slice(-MAX_OUTPUT_BYTES)
                }
            })

            // 进程退出
            child.on('close', (code) => {
                clearTimeout(timer)

                if (code === 0) {
                    // 成功：尝试 JSON 解析
                    const parsed = parseJsonOutput(stdout)
                    if (parsed) {
                        finish({
                            ok: true,
                            response: parsed.response || '（执行成功但无回答内容）',
                            output: parsed.response,  // 兼容旧接口
                            stats: parsed.stats as Record<string, unknown>,
                            exitCode: 0,
                        })
                    } else {
                        // JSON 解析失败，回退到纯文本
                        logger.warn(LogCategory.APP, '[Gemini] JSON 解析失败，回退到原始文本')
                        finish({
                            ok: true,
                            response: stdout.trim().slice(0, MAX_OUTPUT_BYTES) || '（执行成功但无输出）',
                            output: stdout.trim().slice(0, MAX_OUTPUT_BYTES),
                            exitCode: 0,
                        })
                    }
                } else {
                    // 失败：根据退出码分类
                    finish({
                        ok: false,
                        output: stdout.trim().slice(0, MAX_OUTPUT_BYTES) || undefined,
                        error: stderr.trim() || getExitCodeMessage(code),
                        errorType: mapExitCode(code),
                        exitCode: code ?? undefined,
                    })
                }
            })

            // 启动错误
            child.on('error', (err: Error) => {
                clearTimeout(timer)
                logger.error(LogCategory.APP, `[Gemini] 进程启动失败: ${err.message}`)

                let userFriendlyError = err.message
                if ((err as any).code === 'ENOENT') {
                    userFriendlyError = 'Gemini CLI 未安装或不在 PATH 中。请先安装: npm install -g @anthropic-ai/gemini-cli'
                }

                finish({
                    ok: false,
                    error: userFriendlyError,
                    errorType: 'unknown',
                })
            })
        } catch (e: any) {
            logger.error(LogCategory.APP, `[Gemini] 启动异常: ${e.message}`)
            finish({
                ok: false,
                error: `启动失败: ${e.message}`,
                errorType: 'unknown',
            })
        }
    })
}
