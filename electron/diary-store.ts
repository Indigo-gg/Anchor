/**
 * 日记数据存储服务 (主进程)
 * 
 * 功能：
 * 1. SQLite 持久化日记数据 (diary_entries 表)
 * 2. Excel 导入 (调用 diary plugin 解析 → 写入 SQLite)
 * 3. 关键词 + 元信息搜索
 * 4. 数据统计概览
 * 5. 返回格式化条目供渲染进程写入记忆系统
 */

import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { logger, LogCategory } from './logger'

// ============ 类型定义 ============

interface DiarySearchParams {
    keyword?: string
    startDate?: string
    endDate?: string
    project?: string
    timeRange?: string
    weekday?: string
    limit?: number
    offset?: number
}

interface DiaryEntry {
    id: string
    time: string
    timestamp: number
    ganshou: string
    plain_text: string
    tiyan: string
    xinqing: string
    shanggexiangmu: string
    chixushijian: string
    duration_min: number
    chengjiu: number
    year: number
    month: number
    weekday: string
    time_range: string
    raw_json: string
}

// ============ 表初始化 ============

function initDiaryTable(db: Database.Database) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS diary_entries (
            id TEXT PRIMARY KEY,
            time TEXT,
            timestamp INTEGER,
            ganshou TEXT,
            plain_text TEXT,
            tiyan TEXT,
            xinqing TEXT,
            shanggexiangmu TEXT,
            chixushijian TEXT,
            duration_min INTEGER,
            chengjiu INTEGER DEFAULT 0,
            year INTEGER,
            month INTEGER,
            weekday TEXT,
            time_range TEXT,
            raw_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_diary_timestamp ON diary_entries(timestamp);
        CREATE INDEX IF NOT EXISTS idx_diary_project ON diary_entries(shanggexiangmu);
        CREATE INDEX IF NOT EXISTS idx_diary_year_month ON diary_entries(year, month);
    `)
    logger.info(LogCategory.FILE, 'diary_entries 表初始化完成')
}

// ============ 导入逻辑 ============

/**
 * 将 enriched 记录写入 SQLite
 * 使用 INSERT OR REPLACE 实现覆盖更新
 */
function insertRecords(db: Database.Database, enrichedRecords: any[]): number {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO diary_entries 
        (id, time, timestamp, ganshou, plain_text, tiyan, xinqing, 
         shanggexiangmu, chixushijian, duration_min, chengjiu,
         year, month, weekday, time_range, raw_json)
        VALUES 
        (@id, @time, @timestamp, @ganshou, @plain_text, @tiyan, @xinqing,
         @shanggexiangmu, @chixushijian, @duration_min, @chengjiu,
         @year, @month, @weekday, @time_range, @raw_json)
    `)

    const insertMany = db.transaction((records: any[]) => {
        let count = 0
        for (const record of records) {
            stmt.run({
                id: record._meta_id || record._id || `diary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                time: record.time || '',
                timestamp: record._meta_timestamp || new Date(record.time).getTime() || 0,
                ganshou: record.ganshou || '',
                plain_text: record._meta_plain_text || '',
                tiyan: record.tiyan || record._meta_emotion_raw || '',
                xinqing: record.xinqing || '',
                shanggexiangmu: record.shanggexiangmu || record._meta_project || '',
                chixushijian: record.chixushijian || '',
                duration_min: record._meta_duration_min || 0,
                chengjiu: record._meta_has_achievement ? 1 : 0,
                year: record._meta_year || 0,
                month: record._meta_month || 0,
                weekday: record._meta_weekday || '',
                time_range: record._meta_time_range || '',
                raw_json: JSON.stringify(record)
            })
            count++
        }
        return count
    })

    return insertMany(enrichedRecords)
}

// ============ 搜索逻辑 ============

function buildSearchQuery(params: DiarySearchParams): { sql: string, values: any[] } {
    const conditions: string[] = []
    const values: any[] = []

    if (params.keyword) {
        conditions.push('plain_text LIKE ?')
        values.push(`%${params.keyword}%`)
    }

    if (params.startDate) {
        const startTs = new Date(params.startDate).getTime()
        if (!isNaN(startTs)) {
            conditions.push('timestamp >= ?')
            values.push(startTs)
        }
    }

    if (params.endDate) {
        const endTs = new Date(params.endDate).getTime()
        if (!isNaN(endTs)) {
            conditions.push('timestamp <= ?')
            values.push(endTs)
        }
    }

    if (params.project) {
        conditions.push('shanggexiangmu LIKE ?')
        values.push(`%${params.project}%`)
    }

    if (params.timeRange) {
        conditions.push('time_range = ?')
        values.push(params.timeRange)
    }

    if (params.weekday) {
        conditions.push('weekday = ?')
        values.push(params.weekday)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(params.limit || 20, 1), 50)
    const offset = params.offset || 0

    const sql = `SELECT * FROM diary_entries ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    values.push(limit, offset)

    return { sql, values }
}

function formatEntryForAI(entry: DiaryEntry) {
    return {
        date: `${entry.time} ${entry.weekday} ${entry.time_range}`.trim(),
        project: entry.shanggexiangmu || '未分类',
        content: (entry.plain_text || '').substring(0, 200),
        mood: entry.tiyan || '',
        duration: entry.chixushijian || ''
    }
}

// ============ 主入口 ============

export function setupDiaryStore(db: Database.Database) {
    initDiaryTable(db)

    // ---------- 导入 Excel ----------
    ipcMain.handle('diary:import-excel', async (_event, filePath: string) => {
        try {
            logger.info(LogCategory.FILE, `[Diary] 开始导入: ${filePath}`)

            // 动态导入 diary plugin (ES module)
            // @ts-ignore - JS module without type declarations
            const { importExcelToJson } = await import('../src/plugin/diary/importer.js')

            const result = importExcelToJson(filePath, {
                skipInvalid: true,
                autoEnrich: true
            })

            if (!result.enrichedRecords || result.enrichedRecords.length === 0) {
                return {
                    success: true,
                    message: '导入完成，但没有有效记录',
                    stats: result.validation.stats
                }
            }

            // 写入 SQLite
            const insertedCount = insertRecords(db, result.enrichedRecords)

            logger.info(LogCategory.FILE, `[Diary] 导入完成: ${insertedCount} 条记录已写入`)

            return {
                success: true,
                message: `导入成功，共 ${insertedCount} 条记录已存储`,
                stats: {
                    ...result.validation.stats,
                    inserted: insertedCount
                },
                warnings: result.validation.warnings?.slice(0, 5) || [],
                errors: result.validation.errors?.slice(0, 5) || []
            }
        } catch (error: any) {
            logger.error(LogCategory.FILE, `[Diary] 导入失败: ${error.message}`, error)
            return {
                success: false,
                message: `导入失败: ${error.message}`,
                error: error.message
            }
        }
    })

    // ---------- 关键词搜索 ----------
    ipcMain.handle('diary:search', async (_event, params: DiarySearchParams) => {
        try {
            const { sql, values } = buildSearchQuery(params)

            // 查询总数
            const conditions: string[] = []
            const countValues: any[] = []

            if (params.keyword) {
                conditions.push('plain_text LIKE ?')
                countValues.push(`%${params.keyword}%`)
            }
            if (params.startDate) {
                const ts = new Date(params.startDate).getTime()
                if (!isNaN(ts)) { conditions.push('timestamp >= ?'); countValues.push(ts) }
            }
            if (params.endDate) {
                const ts = new Date(params.endDate).getTime()
                if (!isNaN(ts)) { conditions.push('timestamp <= ?'); countValues.push(ts) }
            }
            if (params.project) {
                conditions.push('shanggexiangmu LIKE ?')
                countValues.push(`%${params.project}%`)
            }
            if (params.timeRange) {
                conditions.push('time_range = ?'); countValues.push(params.timeRange)
            }
            if (params.weekday) {
                conditions.push('weekday = ?'); countValues.push(params.weekday)
            }

            const countWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
            const totalRow = db.prepare(`SELECT COUNT(*) as total FROM diary_entries ${countWhere}`).get(...countValues) as any
            const total = totalRow?.total || 0

            // 执行搜索
            const entries = db.prepare(sql).all(...values) as DiaryEntry[]

            const formattedEntries = entries.map(formatEntryForAI)

            // 生成 AI 友好摘要
            let summary = `共找到 ${total} 条日记记录，本次返回 ${entries.length} 条。`
            if (entries.length > 0) {
                const first = entries[entries.length - 1]
                const last = entries[0]
                summary += ` 时间跨度: ${first.time?.substring(0, 10)} ~ ${last.time?.substring(0, 10)}。`
            }

            return {
                query: params,
                total,
                returned: entries.length,
                hasMore: total > (params.offset || 0) + entries.length,
                entries: formattedEntries,
                summary
            }
        } catch (error: any) {
            logger.error(LogCategory.FILE, `[Diary] 搜索失败: ${error.message}`, error)
            return {
                query: params,
                total: 0,
                returned: 0,
                hasMore: false,
                entries: [],
                summary: `搜索出错: ${error.message}`
            }
        }
    })

    // ---------- 数据统计 ----------
    ipcMain.handle('diary:get-stats', async () => {
        try {
            const totalRow = db.prepare('SELECT COUNT(*) as total FROM diary_entries').get() as any
            const total = totalRow?.total || 0

            if (total === 0) {
                return {
                    total: 0,
                    message: '当前没有导入任何日记数据',
                    timeRange: null,
                    projects: []
                }
            }

            const rangeRow = db.prepare('SELECT MIN(time) as earliest, MAX(time) as latest FROM diary_entries').get() as any
            const projectRows = db.prepare(
                'SELECT shanggexiangmu, COUNT(*) as count FROM diary_entries WHERE shanggexiangmu != "" GROUP BY shanggexiangmu ORDER BY count DESC LIMIT 20'
            ).all() as any[]

            return {
                total,
                message: `已导入 ${total} 条日记记录`,
                timeRange: {
                    earliest: rangeRow?.earliest || '',
                    latest: rangeRow?.latest || ''
                },
                projects: projectRows.map((r: any) => ({ name: r.shanggexiangmu, count: r.count }))
            }
        } catch (error: any) {
            logger.error(LogCategory.FILE, `[Diary] 统计失败: ${error.message}`, error)
            return { total: 0, message: `统计出错: ${error.message}`, timeRange: null, projects: [] }
        }
    })

    // ---------- 获取记录用于写入记忆系统 ----------
    ipcMain.handle('diary:get-for-memory', async (_event, ids?: string[]) => {
        try {
            let entries: DiaryEntry[]
            if (ids && ids.length > 0) {
                const placeholders = ids.map(() => '?').join(',')
                entries = db.prepare(`SELECT * FROM diary_entries WHERE id IN (${placeholders})`).all(...ids) as DiaryEntry[]
            } else {
                // 返回所有（导入后一次性同步到记忆系统）
                entries = db.prepare('SELECT * FROM diary_entries').all() as DiaryEntry[]
            }

            return entries.map(entry => ({
                diaryId: entry.id,
                content: `[${entry.time?.substring(0, 10)} ${entry.weekday} ${entry.time_range}] [${entry.shanggexiangmu || '未分类'}] ${entry.plain_text || entry.ganshou || ''}`.substring(0, 500),
                tags: ['日记', entry.shanggexiangmu, entry.tiyan].filter(Boolean),
                metadata: {
                    diaryId: entry.id,
                    time: entry.time,
                    project: entry.shanggexiangmu,
                    timestamp: entry.timestamp
                }
            }))
        } catch (error: any) {
            logger.error(LogCategory.FILE, `[Diary] 获取记忆格式数据失败: ${error.message}`, error)
            return []
        }
    })

    // ---------- 清空日记数据 ----------
    ipcMain.handle('diary:clear', async () => {
        try {
            db.prepare('DELETE FROM diary_entries').run()
            logger.info(LogCategory.FILE, '[Diary] 所有日记数据已清空')
            return { success: true, message: '日记数据已清空' }
        } catch (error: any) {
            logger.error(LogCategory.FILE, `[Diary] 清空失败: ${error.message}`, error)
            return { success: false, message: `清空失败: ${error.message}` }
        }
    })

    logger.info(LogCategory.APP, '[Diary] 日记存储服务已初始化')
}
