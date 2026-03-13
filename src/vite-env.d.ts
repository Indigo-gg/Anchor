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
        llm: {
            rerank: (params: any) => Promise<any>
            chatStream: (params: any) => void
            onChunk: (requestId: string, callback: (chunk: string) => void) => () => void
            onDone: (requestId: string, callback: () => void) => () => void
            onError: (requestId: string, callback: (error: string) => void) => () => void
        }
    }
}
