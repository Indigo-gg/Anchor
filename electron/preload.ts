import { contextBridge, ipcRenderer } from 'electron'

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
        ipcRenderer.invoke('save-image', fileName, base64Data)
})
