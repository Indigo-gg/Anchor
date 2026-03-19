/**
 * Gemini CLI 异步任务管理器
 * 
 * 职责：
 * 1. FIFO 任务队列，按顺序执行（避免并发 spawn 过多进程）
 * 2. 任务生命周期管理：pending → running → completed/failed/timeout/cancelled
 * 3. 超时控制和取消功能
 * 4. IPC 事件推送：任务状态变更时主动通知渲染进程
 * 5. 保留最近 N 个已完成任务的结果供查询
 */

import { type ChildProcess } from 'child_process'
import { type BrowserWindow } from 'electron'
import { executeGemini, type GeminiRequest, type GeminiResult } from './gemini-executor'
import { logger, LogCategory } from './logger'

// ============ 类型定义 ============

export interface TaskRequest {
    prompt: string
    context?: string           // stdin 注入的上下文
    imagePaths?: string[]
    workingDir?: string
    yolo?: boolean             // 默认 true
    timeoutMs?: number         // 默认 180_000
}

export interface GeminiTask {
    id: string
    request: TaskRequest
    status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'
    createdAt: number
    startedAt?: number
    completedAt?: number
    result?: GeminiResult
    childProcess?: ChildProcess
}

type TaskEventType = 'queued' | 'started' | 'completed' | 'failed' | 'cancelled'

// ============ 任务管理器 ============

export class GeminiTaskManager {
    private queue: GeminiTask[] = []
    private currentTask: GeminiTask | null = null
    private completedTasks: GeminiTask[] = []
    private mainWindow: BrowserWindow | null = null
    private taskCounter = 0

    private readonly MAX_COMPLETED_HISTORY = 20

    /** 绑定主窗口引用（用于 IPC 事件推送） */
    setMainWindow(win: BrowserWindow) {
        this.mainWindow = win
    }

    /** 获取当前窗口引用 */
    getMainWindow(): BrowserWindow | null {
        return this.mainWindow
    }

    // ========== 公共 API ==========

    /** 提交任务到队列，立即返回 taskId */
    submitTask(request: TaskRequest): { taskId: string; position: number } {
        const taskId = this.generateTaskId()

        const task: GeminiTask = {
            id: taskId,
            request,
            status: 'pending',
            createdAt: Date.now(),
        }

        this.queue.push(task)
        const position = this.queue.length

        logger.info(LogCategory.APP, `[TaskManager] 任务入队: ${taskId}, 队列位置: ${position}`)

        // 推送事件
        this.emitEvent('queued', { taskId, position })

        // 尝试处理下一个
        this.processNext()

        return { taskId, position }
    }

    /** 取消任务 */
    cancelTask(taskId: string): { ok: boolean; message: string } {
        // 检查是否是当前正在执行的任务
        if (this.currentTask?.id === taskId) {
            logger.info(LogCategory.APP, `[TaskManager] 取消执行中的任务: ${taskId}`)

            // 杀掉子进程
            if (this.currentTask.childProcess) {
                this.currentTask.childProcess.kill('SIGTERM')
                setTimeout(() => {
                    this.currentTask?.childProcess?.kill('SIGKILL')
                }, 2000)
            }

            this.currentTask.status = 'cancelled'
            this.currentTask.completedAt = Date.now()
            this.archiveTask(this.currentTask)

            this.emitEvent('cancelled', { taskId })

            this.currentTask = null
            this.processNext()

            return { ok: true, message: '任务已取消' }
        }

        // 检查是否在队列中
        const idx = this.queue.findIndex(t => t.id === taskId)
        if (idx >= 0) {
            const removed = this.queue.splice(idx, 1)[0]
            removed.status = 'cancelled'
            removed.completedAt = Date.now()
            this.archiveTask(removed)

            logger.info(LogCategory.APP, `[TaskManager] 取消排队中的任务: ${taskId}`)
            this.emitEvent('cancelled', { taskId })

            return { ok: true, message: '任务已从队列中移除' }
        }

        return { ok: false, message: '未找到该任务' }
    }

    /** 查询任务状态 */
    getTaskStatus(taskId: string): GeminiTask | undefined {
        // 当前任务
        if (this.currentTask?.id === taskId) {
            return this.sanitizeTask(this.currentTask)
        }
        // 队列中
        const queued = this.queue.find(t => t.id === taskId)
        if (queued) return this.sanitizeTask(queued)
        // 已完成历史
        const completed = this.completedTasks.find(t => t.id === taskId)
        if (completed) return this.sanitizeTask(completed)

        return undefined
    }

    /** 应用退出时清理所有任务 */
    cleanup() {
        logger.info(LogCategory.APP, '[TaskManager] 清理所有任务...')

        if (this.currentTask?.childProcess) {
            this.currentTask.childProcess.kill('SIGKILL')
        }
        this.currentTask = null
        this.queue = []
    }

    // ========== 内部逻辑 ==========

    private async processNext() {
        // 正在执行则排队等待
        if (this.currentTask) return

        const task = this.queue.shift()
        if (!task) return

        this.currentTask = task
        task.status = 'running'
        task.startedAt = Date.now()

        logger.info(LogCategory.APP, `[TaskManager] 开始执行任务: ${task.id}`)
        this.emitEvent('started', { taskId: task.id })

        try {
            const geminiRequest: GeminiRequest = {
                prompt: task.request.prompt,
                context: task.request.context,
                imagePaths: task.request.imagePaths,
                workingDir: task.request.workingDir,
                yolo: task.request.yolo,
                timeoutMs: task.request.timeoutMs,
            }

            const result = await executeGemini(geminiRequest, {
                onProcess: (child) => {
                    task.childProcess = child
                },
            })

            // 任务可能在执行期间被取消（cancelTask 会修改 status）
            const wasCancelled = task.status as string === 'cancelled'
            if (wasCancelled) return

            task.result = result
            task.completedAt = Date.now()

            if (result.ok) {
                task.status = 'completed'
                logger.info(LogCategory.APP, `[TaskManager] 任务完成: ${task.id}, 耗时 ${result.durationMs}ms`)
                this.emitEvent('completed', {
                    taskId: task.id,
                    result: {
                        ok: true,
                        response: result.response,
                        output: result.output,
                        stats: result.stats,
                        durationMs: result.durationMs,
                    },
                })
            } else {
                task.status = result.errorType === 'timeout' ? 'timeout' : 'failed'
                logger.warn(LogCategory.APP, `[TaskManager] 任务失败: ${task.id}, 类型: ${result.errorType}, 错误: ${result.error}`)
                this.emitEvent('failed', {
                    taskId: task.id,
                    error: result.error,
                    errorType: result.errorType,
                    exitCode: result.exitCode,
                    partialOutput: result.output?.slice(0, 2000),
                    durationMs: result.durationMs,
                })
            }
        } catch (e: any) {
            if ((task.status as string) !== 'cancelled') {
                task.status = 'failed'
                task.completedAt = Date.now()
                task.result = { ok: false, error: e.message, errorType: 'unknown' }
                logger.error(LogCategory.APP, `[TaskManager] 任务异常: ${task.id}, ${e.message}`)
                this.emitEvent('failed', {
                    taskId: task.id,
                    error: e.message,
                    errorType: 'unknown',
                })
            }
        } finally {
            this.archiveTask(task)
            this.currentTask = null
            // 处理下一个排队任务
            this.processNext()
        }
    }

    private archiveTask(task: GeminiTask) {
        // 清除进程引用（不可序列化）
        task.childProcess = undefined
        this.completedTasks.unshift(task)
        // 限制历史记录数
        if (this.completedTasks.length > this.MAX_COMPLETED_HISTORY) {
            this.completedTasks = this.completedTasks.slice(0, this.MAX_COMPLETED_HISTORY)
        }
    }

    private sanitizeTask(task: GeminiTask): GeminiTask {
        // 返回不含 childProcess 的副本
        const { childProcess, ...rest } = task
        return rest as GeminiTask
    }

    private emitEvent(event: TaskEventType, data: Record<string, unknown>) {
        const channel = `gemini:task-${event}`
        try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send(channel, data)
                logger.info(LogCategory.APP, `[TaskManager] 推送事件: ${channel}`)
            }
        } catch (e: any) {
            logger.warn(LogCategory.APP, `[TaskManager] 事件推送失败: ${channel}, ${e.message}`)
        }
    }

    private generateTaskId(): string {
        this.taskCounter++
        const ts = Date.now().toString(36)
        const rand = Math.random().toString(36).slice(2, 6)
        return `gt_${ts}_${rand}_${this.taskCounter}`
    }
}

// ============ 单例导出 ============

export const taskManager = new GeminiTaskManager()
