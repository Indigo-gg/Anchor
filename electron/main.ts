import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { logger, LogCategory } from './logger'

// 设置独立的用户数据目录，避免与其他 Electron 应用的缓存冲突
app.setPath('userData', join(app.getPath('appData'), 'Anchor'))

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isAlwaysOnTop = false // 默认不置顶

// 获取当前开机自启动状态
function getAutoLaunchEnabled(): boolean {
    return app.getLoginItemSettings().openAtLogin
}

const WINDOW_WIDTH = 480
const WINDOW_HEIGHT = 600

function createWindow() {
    // 获取图标路径
    const iconPath = process.env.VITE_DEV_SERVER_URL
        ? join(__dirname, '../icon.png')
        : join(__dirname, '../icon.png')

    mainWindow = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        frame: false,
        transparent: true,
        alwaysOnTop: isAlwaysOnTop,
        skipTaskbar: false, // 显示在任务栏
        resizable: false,
        show: false,
        icon: iconPath,  // 设置窗口图标
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
        mainWindow.loadFile(join(__dirname, '../dist-renderer/index.html'))
    }

    // 窗口关闭时隐藏到托盘而不是退出
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault()
            mainWindow?.hide()
            logger.info(LogCategory.WINDOW, '窗口隐藏到托盘')
        }
    })

    logger.info(LogCategory.WINDOW, '主窗口创建完成')
}


function createTray() {
    // 使用 icon.png 作为托盘图标
    const iconPath = process.env.VITE_DEV_SERVER_URL
        ? join(__dirname, '../icon.png')
        : join(__dirname, '../icon.png')
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })

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
    const isAutoLaunch = getAutoLaunchEnabled()
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
                logger.info(LogCategory.TRAY, `窗口置顶: ${isAlwaysOnTop}`)
            }
        },
        {
            label: isAutoLaunch ? '✓ 开机自启动' : '  开机自启动',
            click: () => {
                const newState = !isAutoLaunch
                app.setLoginItemSettings({
                    openAtLogin: newState
                })
                updateTrayMenu()
                logger.info(LogCategory.TRAY, `开机自启动: ${newState}`)
            }
        },
        { type: 'separator' },
        {
            label: '退出 Anchor',
            click: () => {
                logger.info(LogCategory.APP, '用户退出应用')
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
    logger.info(LogCategory.WINDOW, '显示窗口')
    updateTrayMenu()
}

function hideWindow() {
    mainWindow?.hide()
    logger.info(LogCategory.WINDOW, '隐藏窗口')
    updateTrayMenu()
}

// 监听渲染进程的 IPC 消息
ipcMain.on('hide-window', () => {
    hideWindow()
})

// 监听渲染进程的日志消息
ipcMain.on('log', (_event, level: string, category: string, message: string, data?: unknown) => {
    switch (level) {
        case 'INFO':
            logger.info(category, message, data)
            break
        case 'WARN':
            logger.warn(category, message, data)
            break
        case 'ERROR':
            logger.error(category, message, data)
            break
        default:
            logger.info(category, message, data)
    }
})

// 扩展 app 类型
declare global {
    namespace Electron {
        interface App {
            isQuitting?: boolean
        }
    }
}

// ========== 能量检测定时器 ==========
let energyTimers: NodeJS.Timeout[] = []

// 生成今日的随机提醒时间点
function generateEnergyReminders() {
    const now = new Date()
    const startHour = 9
    const endHour = 23
    const targetCount = 10
    const minInterval = 60 * 60 * 1000 // 1小时最小间隔

    // 清除之前的定时器
    energyTimers.forEach(t => clearTimeout(t))
    energyTimers = []

    // 计算今日剩余时间范围
    const todayStart = new Date(now)
    todayStart.setHours(startHour, 0, 0, 0)

    const todayEnd = new Date(now)
    todayEnd.setHours(endHour, 0, 0, 0)

    // 如果当前时间已经过了结束时间，等明天再安排
    if (now >= todayEnd) {
        const tomorrowStart = new Date(todayStart)
        tomorrowStart.setDate(tomorrowStart.getDate() + 1)
        const msUntilTomorrow = tomorrowStart.getTime() - now.getTime()
        setTimeout(generateEnergyReminders, msUntilTomorrow)
        console.log('[Energy] 今日已结束，明天再提醒')
        return
    }

    // 确定开始时间
    const effectiveStart = now > todayStart ? now : todayStart
    const availableMs = todayEnd.getTime() - effectiveStart.getTime()

    // 计算可以安排多少个提醒
    const maxReminders = Math.floor(availableMs / minInterval)
    const reminderCount = Math.min(targetCount, maxReminders)

    if (reminderCount <= 0) {
        console.log('[Energy] 今日剩余时间不足，不安排提醒')
        return
    }

    // 生成随机时间点
    const times: number[] = []
    const segment = availableMs / reminderCount

    for (let i = 0; i < reminderCount; i++) {
        const segmentStart = effectiveStart.getTime() + i * segment
        const segmentEnd = segmentStart + segment
        const randomTime = segmentStart + Math.random() * (segmentEnd - segmentStart - minInterval / 2)
        times.push(randomTime)
    }

    // 设置定时器
    times.forEach((time, idx) => {
        const delay = time - now.getTime()
        if (delay > 0) {
            const timer = setTimeout(() => {
                triggerEnergyReminder()
            }, delay)
            energyTimers.push(timer)
            console.log(`[Energy] 第 ${idx + 1} 次提醒将在 ${new Date(time).toLocaleTimeString()} 触发`)
        }
    })

    // 安排明天的提醒
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)
    const msUntilTomorrow = tomorrowStart.getTime() - now.getTime()
    setTimeout(generateEnergyReminders, msUntilTomorrow)
}

function triggerEnergyReminder() {
    logger.info(LogCategory.ENERGY, '触发能量检测提醒')

    // 发送通知到渲染进程
    mainWindow?.webContents.send('energy-reminder')

    // 如果窗口隐藏，闪烁托盘图标
    if (!mainWindow?.isVisible()) {
        tray?.setToolTip('⚡ 记录一下现在的能量状态')
    }
}

// 监听渲染进程请求显示能量工具
ipcMain.on('show-energy-audit', () => {
    showWindow()
    mainWindow?.webContents.send('open-energy-audit')
})

// ========== 文件保存功能 ==========

// JSON 文件保存
ipcMain.handle('save-json-file', async (_event, fileName: string, content: string) => {
    try {
        const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
            title: '保存 JSON 文件',
            defaultPath: join(app.getPath('downloads'), fileName),
            filters: [
                { name: 'JSON 文件', extensions: ['json'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        })

        if (canceled || !filePath) return { success: false }

        await writeFile(filePath, content, 'utf-8')
        logger.info(LogCategory.FILE, `JSON 已保存: ${filePath}`)
        return { success: true, path: filePath }
    } catch (err) {
        logger.error(LogCategory.FILE, 'JSON 保存失败', err)
        throw err
    }
})

// 图片保存（Base64）
ipcMain.handle('save-image', async (_event, fileName: string, base64Data: string) => {
    try {
        const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
            title: '保存图片',
            defaultPath: join(app.getPath('downloads'), fileName),
            filters: [
                { name: 'PNG 图片', extensions: ['png'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        })

        if (canceled || !filePath) return { success: false }

        const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Image, 'base64')

        await writeFile(filePath, buffer)
        logger.info(LogCategory.FILE, `图片已保存: ${filePath}`)
        return { success: true, path: filePath }
    } catch (err) {
        logger.error(LogCategory.FILE, '图片保存失败', err)
        throw err
    }
})

app.whenReady().then(() => {
    logger.info(LogCategory.APP, '应用启动', { version: app.getVersion() })
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

    // 启动能量检测定时器
    generateEnergyReminders()

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
