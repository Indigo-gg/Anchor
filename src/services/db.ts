import Dexie, { type Table } from 'dexie'
import type { Session } from './session'
import type { RoleDefinition } from './role'
import type { EnergyRecord } from './energy'
import type { BoundaryRecord } from './boundary'
import type { ValueSession } from './values'

// 定义工具记录的类型 (对应用户的要求)
export interface ToolRecord {
    id: string
    sessionId?: string    // 属于哪个会话（可选）
    roleId?: string       // 在哪个角色下执行（可选）
    toolName: string      // 工具名称（例如 'web_search', 'boundary_mapper'）
    startTime: number     // 开始时间
    endTime?: number      // 结束时间
    params: any           // 工具调用的入参
    result?: any          // 工具调用的返回结果
    status: 'pending' | 'success' | 'error'
    errorMessage?: string // 错误信息
}

export class AnchorAppDatabase extends Dexie {
    sessions!: Table<Session, string>
    roles!: Table<RoleDefinition, string>
    energyRecords!: Table<EnergyRecord, string>
    boundaryRecords!: Table<BoundaryRecord, string>
    valuesRecords!: Table<ValueSession, string>
    toolRecords!: Table<ToolRecord, string>

    constructor() {
        super('AnchorAppDatabase')
        // 定义索引字段（只需要被 where 筛选或 sort 的字段）
        this.version(1).stores({
            sessions: 'id, roleId, startTime',
            roles: 'id, isBuiltin, createdAt',
            energyRecords: 'id, timestamp, level, activityType',
            boundaryRecords: 'id, timestamp',
            valuesRecords: 'id, timestamp',
            toolRecords: 'id, sessionId, roleId, toolName, startTime, status'
        })
    }
}

export const appDb = new AnchorAppDatabase()

// 工具使用记录埋点辅助函数
export async function createToolRecord(data: Omit<ToolRecord, 'id' | 'status'> & { status?: ToolRecord['status'] }) {
    const record: ToolRecord = {
        ...data,
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        status: data.status || 'success'
    }
    await appDb.toolRecords.put(record).catch(e => console.error('[DB] Failed to save tool record:', e))
    return record
}

export async function updateToolRecord(record: ToolRecord, updates: Partial<ToolRecord>) {
    Object.assign(record, updates)
    await appDb.toolRecords.put(record).catch(e => console.error('[DB] Failed to update tool record:', e))
    return record
}
