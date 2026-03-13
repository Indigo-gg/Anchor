import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { logger, LogCategory } from './logger'
import { handleLoadAllSkills } from './skill-loader'
import { executeInSandbox } from './sandbox-executor'

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

// ========== Skill 加载功能 ==========

ipcMain.handle('load-skills', async () => {
    try {
        return handleLoadAllSkills()
    } catch (err) {
        logger.error(LogCategory.APP, 'Skills 加载失败', err)
        return []
    }
})

ipcMain.handle('install-skill', async (_event, { name, content }) => {
    try {
        const skillDir = join(app.getPath('userData'), 'skills', name)
        const skillFile = join(skillDir, 'SKILL.md')

        const { mkdir, writeFile } = require('fs/promises')
        await mkdir(skillDir, { recursive: true })
        await writeFile(skillFile, content, 'utf-8')

        logger.info(LogCategory.APP, `技能安装成功: ${name}`)
        return { success: true }
    } catch (err: any) {
        logger.error(LogCategory.APP, `技能安装失败: ${name}`, err)
        return { success: false, error: err.message }
    }
})

ipcMain.handle('uninstall-skill', async (_event, name) => {
    try {
        // 简单起见，name 应该是技能文件夹名
        const skillDir = join(app.getPath('userData'), 'skills', name.replace('skill_', ''))
        const { rm } = require('fs/promises')
        await rm(skillDir, { recursive: true, force: true })

        logger.info(LogCategory.APP, `技能卸载成功: ${name}`)
        return { success: true }
    } catch (err: any) {
        logger.error(LogCategory.APP, `技能卸载失败: ${name}`, err)
        return { success: false, error: err.message }
    }
})

// ========== Skill 命令执行（沙箱） ==========

ipcMain.handle('exec-skill-command', async (_event, { skillKey, command, args, allowedBins }) => {
    logger.info(LogCategory.APP, `[Sandbox] Skill "${skillKey}" 请求执行: ${command} ${(args || []).join(' ')}`)
    try {
        const result = await executeInSandbox(command, args || [], allowedBins || [])
        return result
    } catch (err: any) {
        logger.error(LogCategory.APP, `[Sandbox] 执行异常: ${err.message}`)
        return { ok: false, error: err.message }
    }
})

// ========== LLM 代理功能 (解决 CORS) ==========

const LLM_REQUEST_TIMEOUT = 120_000  // 120 秒超时（大模型首 token 可能较慢）
const LLM_MAX_RETRIES = 2            // 最多重试 2 次

ipcMain.on('llm-chat-stream', async (event, { config, body, requestId }) => {
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT)

        try {
            if (attempt > 0) {
                logger.warn(LogCategory.APP, `LLM 请求第 ${attempt} 次重试...`, { requestId })
            } else {
                // 首次请求打印详细参数
                logger.info(LogCategory.APP, `[LLM] Requesting ${config.baseURL}/chat/completions`, { 
                    model: body.model,
                    stream: body.stream,
                    requestId
                })
            }

            const response = await fetch(`${config.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify(body),
                signal: controller.signal
            })

            clearTimeout(timeout)

            if (!response.ok) {
                const errorText = await response.text()
                logger.error(LogCategory.APP, `[LLM] 服务端返回 HTTP ${response.status}`, { errorText })
                // HTTP 错误不重试（如 400/401/500 等服务端明确拒绝）
                event.sender.send(`llm-error-${requestId}`, errorText)
                return
            }

            if (!response.body) {
                event.sender.send(`llm-error-${requestId}`, 'Response body is null')
                return
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()

            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    event.sender.send(`llm-done-${requestId}`)
                    break
                }
                const chunk = decoder.decode(value, { stream: true })
                event.sender.send(`llm-chunk-${requestId}`, chunk)
            }

            // 成功完成，跳出重试循环
            return
        } catch (err: any) {
            clearTimeout(timeout)

            const isTimeout = err.code === 'UND_ERR_HEADERS_TIMEOUT'
                || err.name === 'AbortError'
                || err.cause?.code === 'UND_ERR_HEADERS_TIMEOUT'

            if (isTimeout && attempt < LLM_MAX_RETRIES) {
                // 超时可重试，继续下一轮
                logger.warn(LogCategory.APP, `LLM 请求超时 (attempt ${attempt + 1}/${LLM_MAX_RETRIES + 1})`, { requestId })
                continue
            }

            // 不可重试或已用完重试次数
            logger.error(LogCategory.APP, 'LLM 代理请求失败', err)
            event.sender.send(`llm-error-${requestId}`, err.message)
            return
        }
    }
})

// ========== LLM Reranker 代理 (解决 CORS) ==========

ipcMain.handle('llm-rerank', async (_event, { config, body }) => {
    try {
        // 大多数 OpenAI 兼容平台的 reranker endpoint 是 /v1/rerank
        // config.baseURL 通常是 /v1，如果包含 /v1 就不需要再加，或者我们这里直接用用户给的 /rerank 但相对于 baseURL.
        // 注意用户提供的 baseURL 一般是 https://api.xxx.com/v1, 所以端点是 /rerank
        const url = config.baseURL.endsWith('/v1') ? config.baseURL.replace(/\/v1$/, '/v1/rerank') : `${config.baseURL}/rerank`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Reranker API Error: ${response.status} ${errorText}`)
        }

        return await response.json()
    } catch (err: any) {
        logger.error(LogCategory.APP, 'Reranker 代理请求失败', err.message)
        throw err
    }
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
