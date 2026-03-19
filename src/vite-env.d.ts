/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

interface Window {
    electronAPI: {
        hideWindow: () => void
        saveImage: (fileName: string, base64Data: string) => Promise<{ success: boolean; path?: string }>
        saveJsonFile: (fileName: string, content: string) => Promise<{ success: boolean; path?: string }>
        selectAndCopyFile: () => Promise<{ success: boolean; path?: string; fileName?: string; error?: string; canceled?: boolean }>
        openExternal: (url: string) => Promise<void>
        store: {
            get: (key: string) => Promise<unknown>
            set: (key: string, value: unknown) => Promise<void>
        }
        log: {
            info: (category: string, message: string, data?: unknown) => void
            warn: (category: string, message: string, data?: unknown) => void
            error: (category: string, message: string, data?: unknown) => void
        }
        energy: {
            showAudit: () => void
            onReminder: (callback: () => void) => () => void
            onOpenAudit: (callback: () => void) => () => void
        }
        loadSkills: () => Promise<any[]>
        installSkill: (name: string, content: string) => Promise<{ success: boolean; error?: string }>
        uninstallSkill: (name: string) => Promise<{ success: boolean; error?: string }>
        execSkillCommand: (params: {
            skillKey: string
            command: string
            args: string[]
            allowedBins: string[]
        }) => Promise<{ ok: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string }>

        // Gemini CLI 异步任务 API (V2)
        gemini: {
            /** 提交异步任务，立即返回 taskId 和队列位置 */
            submitTask: (request: {
                prompt: string
                context?: string
                imagePaths?: string[]
                workingDir?: string
                yolo?: boolean
                timeoutMs?: number
            }) => Promise<{ taskId: string; position: number } | { taskId: null; error: string }>

            /** 取消任务 */
            cancelTask: (taskId: string) => Promise<{ ok: boolean; message: string }>

            /** 查询任务状态 */
            getTaskStatus: (taskId: string) => Promise<{
                id: string
                status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'
                createdAt: number
                startedAt?: number
                completedAt?: number
                result?: {
                    ok: boolean
                    response?: string
                    output?: string
                    error?: string
                    errorType?: string
                    durationMs?: number
                }
            } | undefined>

            /** 监听所有任务事件，返回清理函数 */
            onTaskEvent: (callback: (event: string, data: any) => void) => () => void
        }

        llm: {
            rerank: (params: any) => Promise<any>
            embedding: (params: any) => Promise<any>
            chatStream: (params: any) => void
            onChunk: (requestId: string, callback: (chunk: string) => void) => () => void
            onDone: (requestId: string, callback: () => void) => () => void
            onError: (requestId: string, callback: (error: string) => void) => () => void
        }
    }
}
