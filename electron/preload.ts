import { contextBridge, ipcRenderer, shell } from 'electron'

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 隐藏窗口
    hideWindow: () => ipcRenderer.send('hide-window'),

    // 存储相关
    store: {
        get: (key: string) => ipcRenderer.invoke('store-get', key),
        set: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value)
    },

    // 日志相关
    log: {
        info: (category: string, message: string, data?: unknown) =>
            ipcRenderer.send('log', 'INFO', category, message, data),
        warn: (category: string, message: string, data?: unknown) =>
            ipcRenderer.send('log', 'WARN', category, message, data),
        error: (category: string, message: string, data?: unknown) =>
            ipcRenderer.send('log', 'ERROR', category, message, data)
    },

    // 能量检测相关
    energy: {
        // 请求显示能量工具
        showAudit: () => ipcRenderer.send('show-energy-audit'),
        // 监听能量提醒
        onReminder: (callback: () => void) => {
            ipcRenderer.on('energy-reminder', callback)
            return () => ipcRenderer.removeListener('energy-reminder', callback)
        },
        // 监听打开能量工具
        onOpenAudit: (callback: () => void) => {
            ipcRenderer.on('open-energy-audit', callback)
            return () => ipcRenderer.removeListener('open-energy-audit', callback)
        }
    },

    // 文件保存相关
    saveJsonFile: (fileName: string, content: string) =>
        ipcRenderer.invoke('save-json-file', fileName, content),

    saveImage: (fileName: string, base64Data: string) =>
        ipcRenderer.invoke('save-image', fileName, base64Data),

    // 在系统浏览器中打开链接
    openExternal: (url: string) => shell.openExternal(url),

    // Skills 相关
    loadSkills: () => ipcRenderer.invoke('load-skills'),
    installSkill: (name: string, content: string) => ipcRenderer.invoke('install-skill', { name, content }),
    uninstallSkill: (name: string) => ipcRenderer.invoke('uninstall-skill', name),
    execSkillCommand: (params: { skillKey: string; command: string; args: string[]; allowedBins: string[] }) =>
        ipcRenderer.invoke('exec-skill-command', params),

    // LLM 相关 (解决 CORS)
    llm: {
        rerank: (params: any) => ipcRenderer.invoke('llm-rerank', params),
        chatStream: (params: any) => ipcRenderer.send('llm-chat-stream', params),
        onChunk: (requestId: string, callback: (chunk: string) => void) => {
            const listener = (_: any, chunk: string) => callback(chunk)
            ipcRenderer.on(`llm-chunk-${requestId}`, listener)
            return () => ipcRenderer.removeListener(`llm-chunk-${requestId}`, listener)
        },
        onDone: (requestId: string, callback: () => void) => {
            const listener = () => callback()
            ipcRenderer.on(`llm-done-${requestId}`, listener)
            return () => ipcRenderer.removeListener(`llm-done-${requestId}`, listener)
        },
        onError: (requestId: string, callback: (error: string) => void) => {
            const listener = (_: any, error: string) => callback(error)
            ipcRenderer.on(`llm-error-${requestId}`, listener)
            return () => ipcRenderer.removeListener(`llm-error-${requestId}`, listener)
        }
    }
})
