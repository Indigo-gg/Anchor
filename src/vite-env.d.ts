/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

interface Window {
    electronAPI: {
        hideWindow: () => void
        store: {
            get: (key: string) => Promise<unknown>
            set: (key: string, value: unknown) => Promise<void>
        }
    }
}
