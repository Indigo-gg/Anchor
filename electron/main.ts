import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'

// 设置独立的用户数据目录，避免与其他 Electron 应用的缓存冲突
app.setPath('userData', join(app.getPath('appData'), 'Anchor'))

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isAlwaysOnTop = false // 默认不置顶

const WINDOW_WIDTH = 480
const WINDOW_HEIGHT = 600

function createWindow() {
    mainWindow = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        frame: false,
        transparent: true,
        alwaysOnTop: isAlwaysOnTop,
        skipTaskbar: false, // 显示在任务栏
        resizable: false,
        show: false,
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    // 开发模式加载 Vite 服务器
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
        mainWindow.webContents.openDevTools({ mode: 'detach' })
    } else {
        mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }

    // 窗口关闭时隐藏到托盘而不是退出
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault()
            mainWindow?.hide()
        }
    })
}

// 创建一个简单的锚点图标
function createAnchorIcon() {
    // 创建 32x32 的图标
    const size = 32
    const canvas = Buffer.alloc(size * size * 4)

    // 薄荷绿色 #6ee7b7
    const r = 110, g = 231, b = 183, a = 255

    // 绘制一个简单的圆形作为图标
    const centerX = size / 2
    const centerY = size / 2
    const radius = size / 2 - 2

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - centerX
            const dy = y - centerY
            const distance = Math.sqrt(dx * dx + dy * dy)

            const idx = (y * size + x) * 4
            if (distance <= radius) {
                canvas[idx] = r     // R
                canvas[idx + 1] = g // G
                canvas[idx + 2] = b // B
                canvas[idx + 3] = a // A
            } else {
                canvas[idx] = 0
                canvas[idx + 1] = 0
                canvas[idx + 2] = 0
                canvas[idx + 3] = 0
            }
        }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray() {
    const icon = createAnchorIcon()

    tray = new Tray(icon)
    tray.setToolTip('Anchor - 正念辅助')

    updateTrayMenu()

    // 单击托盘图标显示/隐藏窗口
    tray.on('click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide()
        } else {
            showWindow()
        }
    })
}

function updateTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
        {
            label: mainWindow?.isVisible() ? '隐藏窗口' : '显示窗口',
            click: () => {
                if (mainWindow?.isVisible()) {
                    mainWindow.hide()
                } else {
                    showWindow()
                }
            }
        },
        { type: 'separator' },
        {
            label: isAlwaysOnTop ? '✓ 窗口置顶' : '  窗口置顶',
            click: () => {
                isAlwaysOnTop = !isAlwaysOnTop
                mainWindow?.setAlwaysOnTop(isAlwaysOnTop)
                updateTrayMenu()
            }
        },
        { type: 'separator' },
        {
            label: '退出 Anchor',
            click: () => {
                app.isQuitting = true
                app.quit()
            }
        }
    ])

    tray?.setContextMenu(contextMenu)
}

function showWindow() {
    if (!mainWindow) return

    // 计算窗口位置（屏幕右下角）
    const { screen } = require('electron')
    const display = screen.getPrimaryDisplay()

    const x = display.workArea.x + display.workArea.width - WINDOW_WIDTH - 20
    const y = display.workArea.y + display.workArea.height - WINDOW_HEIGHT - 20

    mainWindow.setPosition(x, y)
    mainWindow.show()
    mainWindow.focus()
    updateTrayMenu()
}

function hideWindow() {
    mainWindow?.hide()
    updateTrayMenu()
}

// 监听渲染进程的 IPC 消息
ipcMain.on('hide-window', () => {
    hideWindow()
})

// 扩展 app 类型
declare global {
    namespace Electron {
        interface App {
            isQuitting?: boolean
        }
    }
}

app.whenReady().then(() => {
    createWindow()
    createTray()

    // 注册全局热键 Ctrl+Alt+A
    globalShortcut.register('CommandOrControl+Alt+A', () => {
        if (mainWindow?.isVisible()) {
            hideWindow()
        } else {
            showWindow()
        }
    })

    // 启动时显示窗口
    showWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('will-quit', () => {
    globalShortcut.unregisterAll()
})
