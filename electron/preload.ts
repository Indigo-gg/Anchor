import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 隐藏窗口
    hideWindow: () => ipcRenderer.send('hide-window'),

    // 存储相关
    store: {
        get: (key: string) => ipcRenderer.invoke('store-get', key),
        set: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value)
    }
})
