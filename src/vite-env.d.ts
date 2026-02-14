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
    }
}
