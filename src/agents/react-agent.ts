/**
 * ReAct Agent - 意图路由 + 深度对话
 * 
 * 新架构：
 * 1. 意图路由层（fast模型）：快速分类 -> quick_reply / complex / clarify / image
 * 2. 对话处理层（simple/complex模型）：深度对话 + 工具判断
 */

import { chatStream, structuredChat, generateImage, type Message as LLMMessage } from '@/services/llm'
import { useMemoryStore } from '@/services/memory'
import { useSessionStore } from '@/services/session'
import { useRoleStore } from '@/services/role'
import { performWebSearch } from '@/services/web-search'
import { getUnifiedToolByKey, type UnifiedTool } from '@/services/tool-registry'
import { createToolRecord, updateToolRecord } from '@/services/db'

// ============ 类型定义 ============

export interface AgentResponse {
    type: 'message' | 'tool' | 'tool_confirm' | 'image' | 'tool_start' | 'tool_result'
    content?: string
    tool?: string
    params?: Record<string, unknown>
    thought?: string
    confirmMessage?: string
    imageUrl?: string
    resultData?: object  // 工具结果数据
}

// 意图路由结果
interface RouteResult {
    type: 'quick_reply' | 'think' | 'deep_think' | 'clarify' | 'skill_call' | 'image'
    reply?: string  // quick_reply 或 clarify 时的直接回复
    skill?: string  // skill_call 时的 skill 名
}

// ============ 工具确认状态 ============

let pendingToolConfirm: {
    tool: string
    params: Record<string, unknown>
} | null = null

export function confirmTool() {
    const pending = pendingToolConfirm
    pendingToolConfirm = null
    return pending
}

export function cancelToolConfirm() {
    pendingToolConfirm = null
}

// ============ Gemini 异步任务回调注册 ============

type TaskCallback = (event: string, data: any) => void
const geminiTaskCallbacks = new Map<string, TaskCallback>()

/** 注册任务完成回调 */
function registerTaskCallback(taskId: string, callback: TaskCallback) {
    geminiTaskCallbacks.set(taskId, callback)
}

/** 初始化 Gemini 任务 IPC 事件监听（应用启动时调用一次） */
export function setupGeminiTaskListener() {
    if (!window.electronAPI?.gemini?.onTaskEvent) return

    window.electronAPI.gemini.onTaskEvent((event: string, data: any) => {
        const taskId = data?.taskId
        if (!taskId) return

        console.log(`[Agent] Gemini 任务事件: ${event}, taskId: ${taskId}`)

        const callback = geminiTaskCallbacks.get(taskId)
        if (callback) {
            callback(event, data)
            // 任务结束后清理回调
            if (['completed', 'failed', 'cancelled'].includes(event)) {
                geminiTaskCallbacks.delete(taskId)
            }
        }
    })

    console.log('[Agent] Gemini 任务事件监听器已初始化')
}

// ============ Prompts ============

// 意图路由 Prompt（V3：极简化，只做分类 + 选择 skill 名）
function getRoutePrompt(): string {
    const { getRouteToolsDescription, activeRole } = useRoleStore()
    const skillsDesc = getRouteToolsDescription()
    const hasSkills = skillsDesc.length > 0
    const useCommon = activeRole.value.useCommonTools

    let skillSection = ''
    if (hasSkills) {
        skillSection = `\n- skill_call: 用户需要使用某个技能/工具`
    }

    let imageSection = ''
    if (useCommon) {
        imageSection = `\n- image: 明确要求生成图片`
    }

    let skillListSection = ''
    if (hasSkills) {
        skillListSection = `\n\n可用技能：\n${skillsDesc}`
    }

    return `你是意图路由器。只返回 JSON，不要回答问题。

当前角色：${activeRole.value.name}
角色定位：${activeRole.value.description}

分析对话上下文，判断用户意图：

类型：
- clarify: 意图不清需反问（太模糊/指代不明）
- quick_reply: 简单问候、一两句话能答（你好/谢谢/今天几号）
- think: 需要进行思考（日常对话/一般问题/随便聊聊）
- deep_think: 需要认真深入思考（复杂分析/深层问题/需要专业详细分析）${skillSection}${imageSection}

区分 think 和 deep_think：
- think: 简短问候、简单一两句就能回答的问题
- deep_think: 需要详细分析、多角度思考、专业建议的复杂问题${skillListSection}

输出格式：
{"type":"类型","reply":"quick_reply/clarify时填写（要符合当前角色的身份和风格）","skill":"skill_call时填 skill 名"}

示例：
用户说"你好" -> {"type":"quick_reply","reply":"你好！有什么可以帮你的吗？"}
用户说"随便聊聊" -> {"type":"think"}
用户说一个需要详细分析的复杂问题 -> {"type":"deep_think"}
用户说"东京天气怎么样" -> {"type":"skill_call","skill":"skill_weather"}
用户说"画一张猫咪" -> {"type":"image"}`
}

import { searchMemories } from '../services/memory-store'

// 深度对话 Prompt（从当前角色的 systemPrompt 读取）
async function getComplexPrompt(historyMessages: LLMMessage[] = []): Promise<string> {
    const { activeRole } = useRoleStore()
    const { formatMemoriesForPrompt } = useMemoryStore()

    // 从最近的对话中提取关键词或直接使用用户的 query 进行检索
    const recentText = historyMessages
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content)
        .join(' ')

    // 统一混合检索
    let memories: any[] = []
    try {
        memories = await searchMemories(recentText || '你好', activeRole.value.id, { limit: 5 })
        if (memories.length > 0) {
            console.log('[Memory] Hybrid Search found memories:', memories.length)
        }
    } catch (e) {
        console.warn('[Memory] Search failed:', e)
    }

    const memorySection = formatMemoriesForPrompt(memories)

    // 使用当前角色的 systemPrompt（包含全局 preamble）
    const { getFullSystemPrompt } = useRoleStore()
    let prompt = getFullSystemPrompt()

    // 注入压缩历史
    const { getContextMessages } = useSessionStore()
    const { compressed } = getContextMessages()
    if (compressed && compressed.length > 0) {
        prompt += `\n\n[之前的对话摘要]：\n${compressed.join('\n')}`
    }

    if (memorySection) {
        prompt += `\n\n用户记忆（自然融入对话，不要直接提及"我记得"）：\n${memorySection}`
    }

    return prompt
}



// 保存工具结果（代理到 role store -> tool-registry）
function saveToolResult(tool: string, result: Record<string, unknown>) {
    const { saveToolResult: save } = useRoleStore()
    save(tool, result)
}

// ============ Skill 配置查询 ============

/** 获取 Skill 的 system prompt 和 maxTurns（从 SKILL.md 的 markdownBody 读取） */
function getSkillPromptConfig(skillKey: string): { system: string; maxTurns: number } | null {
    const skill = getUnifiedToolByKey(skillKey)
    if (!skill?.skillMeta) return null
    return {
        system: skill.skillMeta.markdownBody,
        maxTurns: skill.skillMeta.kernelConfig?.maxTurns || 3
    }
}

// ============ Agent 主逻辑 ============

export function useAgentLoop() {
    const { isInToolMode, getToolContext, addToolMessage, endTool, shouldToolEnd } = useSessionStore()

    async function sendToAgent(
        _userInput: string,
        conversationHistory: { role: string; content: string }[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const historyMessages: LLMMessage[] = conversationHistory.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
        }))

        // ========== 内核态检查 ==========
        if (isInToolMode()) {
            console.log('[Agent] 内核态模式，跳过意图路由')
            return await handleToolModeChat(_userInput, onChunk)
        }

        try {
            console.log('[Agent] 意图路由...')
            let route: RouteResult
            try {
                const routeMessages: LLMMessage[] = [
                    { role: 'system', content: getRoutePrompt() },
                    ...historyMessages.slice(-4)
                ]
                route = await structuredChat<RouteResult>(routeMessages, { intent: 'fast' })
                console.log('[Agent Route]', route)
            } catch (e) {
                console.warn('[Agent] 路由失败，默认 deep_think:', e)
                route = { type: 'deep_think' }
            }

            switch (route.type) {
                case 'quick_reply':
                    return [{ type: 'message', content: route.reply || '你好呀 🌿' }]

                case 'clarify':
                    return [{ type: 'message', content: route.reply || '你可以说具体一点吗？' }]

                case 'skill_call': {
                    const skillKey = route.skill
                    if (!skillKey) {
                        console.log('[Agent] skill_call 但未识别 Skill，走深度对话')
                        return await handleComplexChat(historyMessages, 'complex', onChunk)
                    }

                    const skill = getUnifiedToolByKey(skillKey)
                    if (!skill) {
                        console.log('[Agent] 未找到 Skill:', skillKey, '走深度对话')
                        return await handleComplexChat(historyMessages, 'complex', onChunk)
                    }

                    console.log('[Agent] Skill 调用:', skillKey, 'execMode:', skill.execMode)

                    switch (skill.execMode) {
                        case 'kernel':
                            return await handleKernelSkill(skill, historyMessages)
                        case 'instant':
                            return await handleInstantSkill(skill, historyMessages, onChunk)
                        case 'command':
                            return await handleExecutableSkill(skill, historyMessages, onChunk)
                        case 'prompt-inject':
                        default:
                            return await handlePromptInjectSkill(skill, historyMessages, onChunk)
                    }
                }

                case 'image': {
                    console.log('[Agent] 图片生成（参数提取）...')
                    const lastUserMsg = historyMessages.filter(m => m.role === 'user').pop()
                    const imagePrompt = lastUserMsg?.content || '生成一张美丽的图片'

                    const imageSkill = getUnifiedToolByKey('skill_image_gen')
                    let imageSize: '1024x1024' | '1280x720' | '720x1280' | '1216x896' = '1024x1024'

                    if (imageSkill?.skillMeta?.markdownBody) {
                        try {
                            const sizeExtract = await structuredChat<{ imageSize?: string }>([
                                { role: 'system', content: `你是参数提取器。提取图片尺寸。\n\n${imageSkill.skillMeta.markdownBody}\n\n只返回 JSON: {"imageSize": "尺寸比例或空"}` },
                                { role: 'user', content: imagePrompt }
                            ], { intent: 'fast' })
                            const sizeMap: Record<string, '1024x1024' | '1280x720' | '720x1280' | '1216x896'> = {
                                '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1216x896'
                            }
                            if (sizeExtract.imageSize && sizeMap[sizeExtract.imageSize]) {
                                imageSize = sizeMap[sizeExtract.imageSize]
                            }
                        } catch (e) {
                            console.warn('[Agent] 图片尺寸提取失败，使用默认:', e)
                        }
                    }

                    const { currentSession: imageSession } = useSessionStore()
                    const { activeRole: imageRole } = useRoleStore()
                    const imgRecord = await createToolRecord({
                        sessionId: imageSession.value?.id,
                        roleId: imageRole.value.id,
                        toolName: 'image_gen',
                        startTime: Date.now(),
                        params: { prompt: imagePrompt, size: imageSize },
                        status: 'pending'
                    })

                    const result = await generateImage(imagePrompt, imageSize)

                    await updateToolRecord(imgRecord, {
                        endTime: Date.now(),
                        status: result.imageUrl ? 'success' : 'error',
                        result: result,
                        errorMessage: result.error
                    })

                    if (result.imageUrl) {
                        return [{ type: 'image', imageUrl: result.imageUrl, content: '图片已生成 🎨' }]
                    } else {
                        return [{ type: 'message', content: result.error || '图片生成失败，请稍后再试' }]
                    }
                }

                case 'think':
                    console.log('[Agent] 轻度思考对话 (simple)...')
                    return await handleComplexChat(historyMessages, 'simple', onChunk)

                case 'deep_think':
                default:
                    console.log('[Agent] 深度思考对话 (complex)...')
                    return await handleComplexChat(historyMessages, 'complex', onChunk)
            }
        } catch (error) {
            console.error('[Agent Error]', error)
            return await handleFallbackChat(historyMessages, onChunk)
        }
    }

    // ========== 基础对话处理器 ==========

    async function handleComplexChat(
        historyMessages: LLMMessage[],
        intent: 'simple' | 'complex',
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const prompt = await getComplexPrompt(historyMessages)
        const chatMessages: LLMMessage[] = [
            { role: 'system', content: prompt },
            ...historyMessages
        ]

        let fullContent = ''
        await chatStream(chatMessages, {
            intent: intent,
            onChunk: (chunk, full) => {
                fullContent = full
                if (onChunk) onChunk(chunk)
            }
        })

        return [{ type: 'message', content: fullContent }]
    }

    async function handleFallbackChat(
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { getFullSystemPrompt } = useRoleStore()
        const fallbackPrompt = `${getFullSystemPrompt()}\n\n直接回复，不要用 JSON 格式。`

        const chatMessages: LLMMessage[] = [
            { role: 'system', content: fallbackPrompt },
            ...historyMessages
        ]

        let fullContent = ''
        await chatStream(chatMessages, {
            intent: 'simple',
            onChunk: (chunk, full) => {
                fullContent = full
                if (onChunk) onChunk(chunk)
            }
        })

        return [{ type: 'message', content: fullContent }]
    }

    // ========== Skill 分发处理器 ==========

    /** 1. 内核态 Skill：拦截路由并进入专属内联上下文循环 */
    async function handleKernelSkill(
        skill: UnifiedTool,
        historyMessages: LLMMessage[]
    ): Promise<AgentResponse[]> {
        console.log('[Agent] 进入 Kernel Skill 内核态:', skill.key)
        
        const lastUserContent = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
        const isConfirmation = /^(好|行|可以|试试|开始|嗯|ok|yes|是的|来吧|要|试一下|开始吧|来|试|走起)/i.test(lastUserContent.trim())

        const kernelCfg = skill.skillMeta?.kernelConfig
        const { startTool } = useSessionStore()

        startTool(skill.key, skill.skillMeta?.markdownBody || '', kernelCfg?.maxTurns || 3)

        if (isConfirmation) {
            console.log('[Agent] 用户已确认 Kernel，直接启动')
            return [{
                type: 'tool_start',
                tool: skill.key,
                content: kernelCfg?.welcomeMessage || '好的，我们开始。'
            }]
        } else {
            return [{
                type: 'tool_start',
                tool: skill.key,
                content: kernelCfg?.confirmMessage || `需要运行 ${skill.name} 吗？`
            }]
        }
    }

    /** 2. 即时型 Skill (本身内部有参数提取和执行流) */
    async function handleInstantSkill(
        skill: UnifiedTool,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const handlerKey = skill.skillMeta?.handlerKey || skill.key

        // web_search
        if (handlerKey === 'web_search') {
            console.log('[Agent] 执行即时 Skill: web_search')
            const userQuery = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
            
            const { currentSession } = useSessionStore()
            const { activeRole } = useRoleStore()
            const record = await createToolRecord({
                sessionId: currentSession.value?.id,
                roleId: activeRole.value.id,
                toolName: 'web_search',
                startTime: Date.now(),
                params: { query: userQuery },
                status: 'pending'
            })

            const searchResultText = await performWebSearch(userQuery)

            await updateToolRecord(record, {
                endTime: Date.now(),
                status: 'success',
                result: { text: searchResultText.slice(0, 500) }
            })

            const enhancedHistory: LLMMessage[] = [
                ...historyMessages,
                {
                    role: 'system',
                    content: `以下是互联网检索到的最新信息。请直接用自然语言回答用户问题，绝对不要输出任何 JSON 格式。在回答末尾标注参考来源链接。\n\n${searchResultText}`
                }
            ]
            return await handleComplexChat(enhancedHistory, 'complex', onChunk)
        }
        
        // gemini_cli
        if (handlerKey === 'gemini_cli') {
            return await executeGeminiCliTask(skill, historyMessages, onChunk)
        }

        console.warn('[Agent] 未知的 instant skill handler:', handlerKey)
        return await handleComplexChat(historyMessages, 'complex', onChunk)
    }

    /** 3. 命令型 Skill (需要解析命令并运行本地二进制) */
    async function handleExecutableSkill(
        skill: UnifiedTool,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { executeSkillCommand } = await import('@/services/skill-executor')
        const allowedBins = skill.skillMeta?.requires?.bins || []

        console.log('[Agent] Skill 命令提取阶段...')
        const extractPrompt = `你是命令提取器。根据用户的问题提取命令。
## 技能说明
${skill.skillMeta?.markdownBody || ''}
## 可用命令
只能使用以下命令: ${allowedBins.join(', ')}
## 输出格式
只返回 JSON，不要其他内容：
{"command": "命令名", "args": ["参数1", "参数2"]}`
        
        const lastUserMsg = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
        let cmdJson: { command: string; args: string[] }
        try {
            cmdJson = await structuredChat<{ command: string; args: string[] }>(
                [{ role: 'system', content: extractPrompt }, { role: 'user', content: lastUserMsg }], 
                { intent: 'fast' }
            )
        } catch(e) {
            console.warn('[Agent] 命令提取失败，回退到 prompt-inject:', e)
            return await handlePromptInjectSkill(skill, historyMessages, onChunk)
        }

        const { currentSession } = useSessionStore()
        const { activeRole, getFullSystemPrompt } = useRoleStore()
        const record = await createToolRecord({
            sessionId: currentSession.value?.id,
            roleId: activeRole.value.id,
            toolName: skill.key,
            startTime: Date.now(),
            params: cmdJson,
            status: 'pending'
        })

        const execResult = await executeSkillCommand(skill.key, cmdJson.command, cmdJson.args, allowedBins)

        await updateToolRecord(record, {
            endTime: Date.now(),
            status: execResult.ok ? 'success' : 'error',
            result: execResult,
            errorMessage: execResult.ok ? undefined : (execResult.error || execResult.stderr)
        })

        const resultText = execResult.ok ? (execResult.stdout || '命令执行完成无输出') : `执行失败: ${execResult.error || execResult.stderr}`
        
        const answerMessages: LLMMessage[] = [
            { role: 'system', content: `${getFullSystemPrompt()}\n\n【外部工具执行结果】:\n${resultText}\n请根据执行结果回答用户问题。` },
            ...historyMessages
        ]

        let fullContent = ''
        await chatStream(answerMessages, { intent: 'simple', onChunk: (c, f) => { fullContent = f; if(onChunk) onChunk(c) } })

        return [{ type: 'message', content: fullContent }]
    }

    /** 4. 知识型/纯提示词注入 Skill */
    async function handlePromptInjectSkill(
        skill: UnifiedTool,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { getFullSystemPrompt } = useRoleStore()
        const sysPrompt = `${getFullSystemPrompt()}\n\n## 当前启用的能力\n${skill.skillMeta?.markdownBody || ''}\n请根据以上能力描述帮助用户完成任务。直接用自然语言回答。`
        
        const chatMsgs: LLMMessage[] = [{ role: 'system', content: sysPrompt }, ...historyMessages]
        let fullContent = ''
        await chatStream(chatMsgs, { intent: 'complex', onChunk: (c, f) => { fullContent = f; if(onChunk) onChunk(c) } })
        return [{ type: 'message', content: fullContent }]
    }

    // ========== Gemini CLI 异步任务执行 ==========
    
    async function executeGeminiCliTask(
        skill: UnifiedTool,
        historyMessages: LLMMessage[],
        _onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        console.log('[Agent] 提交 Gemini CLI 异步任务...')
        const userQuery = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
        const lastUserContent = userQuery

        // 轻量提取指令
        let compiledTask = userQuery
        try {
            const extResult = await structuredChat<{ task: string }>([
                { role: 'system', content: `提取真正的任务指令为一个脱离上下文也能看懂的完整独立长句。如果没有详细的任务指令说明直接返回原话。\n\n${skill.skillMeta?.markdownBody}\n\n只返回 JSON: {"task": "..."}` }, 
                { role: 'user', content: userQuery }
            ], { intent: 'fast' })
            compiledTask = extResult.task || userQuery
        } catch(e) {}

        const isConfirmation = /^(好|行|可以|试试|开始|嗯|ok|yes|是的|来吧|要|试一下|开始吧|来|试|走起|跑|直接跑|执行|直接执行)/i.test(lastUserContent.trim())
        
        if (!isConfirmation) {
            pendingToolConfirm = { tool: 'gemini_cli', params: { task: compiledTask } }
            return [{
                type: 'tool_confirm',
                tool: 'gemini_cli',
                confirmMessage: `这个任务我可以交给 Gemini CLI 来执行。它会在你的本地环境中运行，可以读写文件和执行命令。\n\n📋 **任务**: ${compiledTask.slice(0, 200)}\n\n确认执行吗？`
            }]
        }

        let actualTask = userQuery
        if (isConfirmation) {
            actualTask = (pendingToolConfirm?.params?.task as string) || historyMessages.filter(m => m.role === 'user').reverse()[1]?.content || userQuery
            pendingToolConfirm = null
        }

        const { currentSession } = useSessionStore()
        const { activeRole, getFullSystemPrompt } = useRoleStore()
        
        // 重点保护：在发起任务的瞬间，锁定发起者的上下文
        const targetSessionId = currentSession.value?.id
        const targetRoleId = activeRole.value.id
        const lockedSystemPrompt = getFullSystemPrompt()

        const record = await createToolRecord({
            sessionId: targetSessionId,
            roleId: targetRoleId,
            toolName: 'gemini_cli',
            startTime: Date.now(),
            params: { prompt: actualTask },
            status: 'pending'
        })

        try {
            const submitResult = await window.electronAPI.gemini.submitTask({ prompt: actualTask, yolo: true })
            if (!submitResult.taskId) throw new Error((submitResult as any).error || '任务提交失败')
            
            const taskId = submitResult.taskId
            console.log(`[Agent] 任务已提交: ${taskId}`)

            registerTaskCallback(taskId, async (event, data) => {
                if (event === 'completed') {
                    await updateToolRecord(record, { endTime: Date.now(), status: 'success', result: { output: data.result?.response?.slice(0, 2000) } })
                    
                    const answerMessages: LLMMessage[] = [
                        { role: 'system', content: `${lockedSystemPrompt}\n\n以下是 Gemini CLI 执行任务后的输出结果。请用自然语言总结回答用户，不要输出 JSON 格式。如果结果包含代码，用代码块格式化展示。` },
                        ...historyMessages,
                        { role: 'system', content: `【Gemini CLI 结果 (耗时${((data.result?.durationMs || 0)/1000).toFixed(1)}秒)】:\n${data.result?.response || data.result?.output || '（无输出）'}` }
                    ]

                    let fullContent = ''
                    await chatStream(answerMessages, { intent: 'simple', onChunk: (_chunk, full) => { fullContent = full } })
                    
                    window.dispatchEvent(new CustomEvent('gemini-result-ready', {
                        detail: { taskId, sessionId: targetSessionId, message: { type: 'message', content: fullContent } }
                    }))
                } else if (event === 'failed') {
                    await updateToolRecord(record, { endTime: Date.now(), status: 'error', errorMessage: data.error })
                    window.dispatchEvent(new CustomEvent('gemini-result-ready', { detail: { taskId, sessionId: targetSessionId, message: { type: 'message', content: `❌ Gemini CLI 任务失败: ${data.error || '未知错误'}` } } }))
                } else if (event === 'cancelled') {
                    await updateToolRecord(record, { endTime: Date.now(), status: 'error', errorMessage: '取消' })
                }
            })

            return [{
                type: 'gemini_task' as any,
                content: `🤖 Gemini CLI 任务已提交，正在后台执行...\n\n📋 **任务**: ${actualTask.slice(0, 200)}`,
                params: { taskId }
            }]
        } catch (e: any) {
             console.error('[Agent] Gemini CLI 提交失败:', e)
             await updateToolRecord(record, { endTime: Date.now(), status: 'error', errorMessage: e.message })
             return [{ type: 'message', content: `Gemini CLI 提交失败: ${e.message}` }]
        }
    }

    // ========== 内核态对话循坏 ==========

    async function handleToolModeChat(userInput: string, onChunk?: (chunk: string) => void): Promise<AgentResponse[]> {
        const toolContext = getToolContext()
        if (!toolContext) { 
            console.warn('[Agent] 内核态但无工具上下文，退出')
            endTool()
            return [] 
        }

        addToolMessage('user', userInput)
        
        if (shouldToolEnd()) {
            console.log('[Agent] 工具轮数达到上限，强制生成结果')
        }

        const toolPromptConfig = getSkillPromptConfig(toolContext.tool)
        if (!toolPromptConfig) { 
            console.warn('[Agent] 未找到工具配置:', toolContext.tool)
            endTool() 
            return [{ type: 'message', content: '工具配置异常，已退出。' }] 
        }

        const messages: LLMMessage[] = [
            { role: 'system', content: toolPromptConfig.system },
            ...toolContext.conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        ]

        let fullContent = ''
        await chatStream(messages, { 
            intent: 'complex', 
            onChunk: (chunk, full) => { 
                fullContent = full
                if(onChunk) onChunk(chunk) 
            } 
        })

        addToolMessage('assistant', fullContent)

        const completeMatch = fullContent.match(/\{[\s\S]*"complete"\s*:\s*true[\s\S]*\}/)
        if (completeMatch) {
            try {
                const result = JSON.parse(completeMatch[0])
                console.log('[Agent] 工具完成，返回结果:', result)

                const { currentSession } = useSessionStore()
                const { activeRole } = useRoleStore()
                await createToolRecord({ 
                    sessionId: currentSession.value?.id, 
                    roleId: activeRole.value.id, 
                    toolName: toolContext.tool, 
                    startTime: Date.now(), 
                    endTime: Date.now(), 
                    params: { history: toolContext.conversationHistory }, 
                    result, 
                    status: 'success' 
                })
                
                endTool()

                // Web Search 结果二次解读处理（在 Kernel 模式中执行网络搜索的退化逻辑，保留兼容）
                if (toolContext.tool === 'web_search' && result.query) {
                    const searchResultText = await performWebSearch(result.query)
                    const userMsgs: LLMMessage[] = toolContext.conversationHistory.filter(m => m.role === 'user').map(m => ({ role: 'user', content: m.content }))
                    const enhancedHistory: LLMMessage[] = [
                        ...userMsgs,
                        { role: 'system', content: `【互联网检索结果】\n${searchResultText}` }
                    ]
                    return await handleComplexChat(enhancedHistory, 'complex', onChunk)
                }

                saveToolResult(toolContext.tool, result)
                return [{ 
                    type: 'tool_result', 
                    tool: toolContext.tool, 
                    content: fullContent.replace(completeMatch[0], '').trim() || '执行完成', 
                    resultData: result 
                }]
            } catch (e) { 
                console.warn('[Agent] 解析结果失败:', e) 
            }
        }

        return [{ type: 'message', content: fullContent }]
    }

    return { sendToAgent }
}
