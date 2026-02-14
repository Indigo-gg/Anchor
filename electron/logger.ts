import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, existsSync, mkdirSync } from 'fs'

// 日志级别
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

// 日志目录
const LOG_DIR = join(app.getPath('userData'), 'logs')

// 确保日志目录存在
function ensureLogDir() {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true })
    }
}

// 获取当前日期的日志文件路径
function getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return join(LOG_DIR, `anchor-${date}.log`)
}

// 格式化日志消息
function formatMessage(level: LogLevel, category: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString()
    let logLine = `[${timestamp}] [${level}] [${category}] ${message}`

    if (data !== undefined) {
        try {
            const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
            logLine += `\n  Data: ${dataStr}`
        } catch {
            logLine += `\n  Data: [无法序列化]`
        }
    }

    return logLine + '\n'
}

// 写入日志
function writeLog(level: LogLevel, category: string, message: string, data?: unknown) {
    try {
        ensureLogDir()
        const logLine = formatMessage(level, category, message, data)
        const logFile = getLogFilePath()
        appendFileSync(logFile, logLine, 'utf-8')

        // 同时输出到控制台（开发模式）
        if (process.env.VITE_DEV_SERVER_URL) {
            console.log(logLine.trim())
        }
    } catch (err) {
        console.error('写入日志失败:', err)
    }
}

// 日志模块导出
export const logger = {
    // 调试信息
    debug: (category: string, message: string, data?: unknown) => {
        writeLog('DEBUG', category, message, data)
    },

    // 普通信息
    info: (category: string, message: string, data?: unknown) => {
        writeLog('INFO', category, message, data)
    },

    // 警告信息
    warn: (category: string, message: string, data?: unknown) => {
        writeLog('WARN', category, message, data)
    },

    // 错误信息
    error: (category: string, message: string, data?: unknown) => {
        writeLog('ERROR', category, message, data)
    },

    // 获取日志目录路径
    getLogDir: () => LOG_DIR
}

// 预定义的日志类别
export const LogCategory = {
    APP: 'App',           // 应用生命周期
    WINDOW: 'Window',     // 窗口操作
    TRAY: 'Tray',         // 托盘操作
    USER: 'User',         // 用户操作
    ENERGY: 'Energy',     // 能量检测
    CHAT: 'Chat',         // 对话
    TOOL: 'Tool',         // 工具使用
    ERROR: 'Error'        // 错误
}
