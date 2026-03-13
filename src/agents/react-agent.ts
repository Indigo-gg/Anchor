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
import { getUnifiedToolByKey, getRouteSkillsDescription } from '@/services/tool-registry'
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
    type: 'quick_reply' | 'think' | 'deep_think' | 'clarify' | 'tool_call' | 'skill_call' | 'image'
    reply?: string  // quick_reply 或 clarify 时的直接回复
    tool?: string   // tool_call 或 skill_call 时的工具/技能名
    imageSize?: '1:1' | '16:9' | '9:16' | '4:3'  // image 时的尺寸偏好
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

// ============ Prompts ============

// 意图路由 Prompt（动态生成，注入当前角色的工具列表）
function getRoutePrompt(): string {
    const { getRouteToolsDescription, activeRole } = useRoleStore()
    const toolsDesc = getRouteToolsDescription()
    const hasTools = toolsDesc.length > 0
    const useCommon = activeRole.value.useCommonTools

    // V2: 获取外部 Skill 描述
    const skillsDesc = getRouteSkillsDescription(activeRole.value.toolKeys)
    const hasSkills = skillsDesc.length > 0

    // 构建工具类型说明
    let toolSection = ''
    if (hasTools) {
        toolSection = `\n- tool_call: 用户确认要使用某个工具（回复"好/可以/试试"且上文提到了工具）`
    }

    let skillSection = ''
    if (hasSkills) {
        skillSection = `\n- skill_call: 用户需要使用外部能力/技能（天气查询、代码、第三方服务等）`
    }

    let imageSection = ''
    if (useCommon) {
        imageSection = `\n- image: 明确要求生成图片`
    }

    let toolListSection = ''
    if (hasTools) {
        toolListSection = `\n\n可用工具：\n${toolsDesc}`
    }

    // V2: 合并外部 Skill 列表
    if (hasSkills) {
        toolListSection += `\n\n可用外部能力 (skill)：\n${skillsDesc}`
    }

    let imageSizeSection = ''
    if (useCommon) {
        imageSizeSection = `\n\n图片尺寸识别（仅 type=image 时）：
- "1:1": 正方形、方形、头像、头图
- "16:9": 横屏、横版、宽屏、桌面壁纸、电脑壁纸
- "9:16": 竖屏、竖版、手机壁纸、手机屏保
- "4:3": 4:3比例
- 用户未指定尺寸时不填 imageSize（默认正方形）`
    }

    return `你是意图路由器。只返回 JSON，不要回答问题。

当前角色：${activeRole.value.name}
角色定位：${activeRole.value.description}

分析对话上下文，判断用户意图：

类型：
- clarify: 意图不清需反问（太模糊/指代不明）
- quick_reply: 简单问候、一两句话能答（你好/谢谢/今天几号）
- think: 需要进行思考（日常对话/一般问题/随便聊聊）
- deep_think: 需要认真深入思考（复杂分析/深层问题/需要专业详细分析）${toolSection}${skillSection}${imageSection}

区分 think 和 deep_think：
- think: 简短问候、简单一两句就能回答的问题
- deep_think: 需要详细分析、多角度思考、专业建议的复杂问题${toolListSection}

输出格式：
{"type":"类型","reply":"quick_reply/clarify时填写（要符合当前角色的身份和风格）","tool":"tool_call/skill_call时填工具名","imageSize":"image时填尺寸"}${imageSizeSection}

示例：
用户说"你好" -> {"type":"quick_reply","reply":"你好！有什么可以帮你的吗？"}
用户说"随便聊聊" -> {"type":"think"}
用户说一个需要详细分析的复杂问题 -> {"type":"deep_think"}
用户说"东京天气怎么样" -> {"type":"skill_call","tool":"skill_weather"}`
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

// ============ 工具确认消息（从角色配置读取） ============

function generateConfirmMessage(tool: string): string {
    const { getToolConfirmMessage } = useRoleStore()
    return getToolConfirmMessage(tool)
}

// 用户已确认后的工具引导语（从角色配置读取）
function getToolWelcomeMessage(tool: string): string {
    const { getToolWelcomeMsg } = useRoleStore()
    return getToolWelcomeMsg(tool)
}

// 保存工具结果（代理到 role store -> tool-registry）
function saveToolResult(tool: string, result: Record<string, unknown>) {
    const { saveToolResult: save } = useRoleStore()
    save(tool, result)
}

// ============ 工具提示词（从角色配置动态获取） ============

function getToolPromptConfig(toolKey: string): { system: string; maxTurns: number } | null {
    const { getToolConfig } = useRoleStore()
    const tool = getToolConfig(toolKey)
    if (!tool) return null
    return { system: tool.systemPrompt, maxTurns: tool.maxTurns }
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
        // 如果在工具模式，跳过意图路由，直接使用 high 模型
        if (isInToolMode()) {
            console.log('[Agent] 内核态模式，跳过意图路由')
            return await handleToolModeChat(_userInput, onChunk)
        }

        try {
            // 阶段1：意图路由
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
                // 兜底：路由失败默认走 deep_think
                console.warn('[Agent] 路由失败，默认 deep_think:', e)
                route = { type: 'deep_think' }
            }

            // 阶段2：根据路由结果处理
            switch (route.type) {
                case 'quick_reply':
                    // 快速回复，直接返回
                    return [{
                        type: 'message',
                        content: route.reply || '你好呀 🌿'
                    }]

                case 'clarify':
                    // 澄清意图
                    return [{
                        type: 'message',
                        content: route.reply || '你可以说具体一点吗？'
                    }]

                case 'tool_call': {
                    // ★ web_search：不进入内核态，直接内联执行（类似 image 的处理方式）
                    if (route.tool === 'web_search') {
                        console.log('[Agent] 网络检索（内联执行）...')
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

                        // 1. 调用 Tavily 搜索
                        const searchResultText = await performWebSearch(userQuery)

                        await updateToolRecord(record, {
                            endTime: Date.now(),
                            status: 'success',
                            result: { text: searchResultText.slice(0, 500) }
                        })

                        // 2. 将搜索结果拼入上下文，交给深度思考模型总结回答
                        const enhancedHistory: LLMMessage[] = [
                            ...historyMessages,
                            {
                                role: 'system',
                                content: `以下是互联网检索到的最新信息。请直接用自然语言回答用户问题，绝对不要输出任何 JSON 格式。在回答末尾标注参考来源链接。\n\n${searchResultText}`
                            }
                        ]
                        return await handleComplexChat(enhancedHistory, 'complex', onChunk)
                    }

                    // 其他工具 -> 进入内核态
                    const toolPromptCfg = route.tool ? getToolPromptConfig(route.tool) : null
                    if (route.tool && toolPromptCfg) {
                        console.log('[Agent] 进入工具内核态:', route.tool)

                        // 检查用户是否已明确确认（如"好"、"试试"等）
                        const lastUserContent = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
                        const isConfirmation = /^(好|行|可以|试试|开始|嗯|ok|yes|是的|来吧|要|试一下|开始吧|来|试|走起|gogogo)/.test(lastUserContent.toLowerCase().trim())

                        // 进入内核态
                        const { startTool } = useSessionStore()
                        startTool(route.tool, toolPromptCfg.system, toolPromptCfg.maxTurns)

                        if (isConfirmation) {
                            // 用户已确认，直接开始工具对话
                            console.log('[Agent] 用户已确认，直接启动工具')
                            return [{
                                type: 'tool_start',
                                tool: route.tool,
                                content: getToolWelcomeMessage(route.tool)
                            }]
                        } else {
                            // 用户还没确认，发送确认消息
                            return [{
                                type: 'tool_start',
                                tool: route.tool,
                                content: generateConfirmMessage(route.tool)
                            }]
                        }
                    }
                    // 如果没有解析出工具名，走深度对话
                    console.log('[Agent] tool_call 但未识别工具，走深度对话')
                    return await handleComplexChat(historyMessages, 'simple', onChunk)
                }

                // V2: 外部 Skill 调用
                case 'skill_call': {
                    const skillKey = route.tool
                    if (skillKey) {
                        console.log('[Agent] 外部 Skill 调用:', skillKey)
                        return await handleSkillCall(skillKey, historyMessages, onChunk)
                    }
                    // 未识别 Skill，走深度对话
                    console.log('[Agent] skill_call 但未识别 Skill，走深度对话')
                    return await handleComplexChat(historyMessages, 'complex', onChunk)
                }

                case 'image':
                    // 图片生成
                    console.log('[Agent] 图片生成...', route.imageSize ? `尺寸: ${route.imageSize}` : '默认尺寸')
                    // 提取最后一条用户消息作为 prompt
                    const lastUserMsg = historyMessages.filter(m => m.role === 'user').pop()
                    const imagePrompt = lastUserMsg?.content || '生成一张美丽的图片'

                    // 转换尺寸格式
                    const sizeMap: Record<string, '1024x1024' | '1280x720' | '720x1280' | '1216x896'> = {
                        '1:1': '1024x1024',
                        '16:9': '1280x720',
                        '9:16': '720x1280',
                        '4:3': '1216x896'
                    }
                    const imageSize = route.imageSize ? sizeMap[route.imageSize] : '1024x1024'

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
                        return [{
                            type: 'image',
                            imageUrl: result.imageUrl,
                            content: '图片已生成 🎨'
                        }]
                    } else {
                        return [{
                            type: 'message',
                            content: result.error || '图片生成失败，请稍后再试'
                        }]
                    }

                case 'think':
                    // 轻度思考对话（使用 simple 模型）
                    console.log('[Agent] 轻度思考对话 (simple)...')
                    return await handleComplexChat(historyMessages, 'simple', onChunk)

                case 'deep_think':
                default:
                    // 深度思考对话（使用 complex 模型）
                    console.log('[Agent] 深度思考对话 (complex)...')
                    return await handleComplexChat(historyMessages, 'complex', onChunk)
            }
        } catch (error) {
            console.error('[Agent Error]', error)
            // 最终兜底：直接流式对话，不做任何判断
            console.log('[Agent] 最终兜底，直接对话...')
            return await handleFallbackChat(historyMessages, onChunk)
        }
    }

    // 深度对话处理（纯流式，不要求 JSON）
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

        return [{
            type: 'message',
            content: fullContent
        }]
    }

    // 纯流式对话（兜底）
    async function handleFallbackChat(
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { getFullSystemPrompt } = useRoleStore()
        const fallbackPrompt = `${getFullSystemPrompt()}

直接回复，不要用 JSON 格式。`

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

        return [{
            type: 'message',
            content: fullContent
        }]
    }

    // ========== V2: 外部 Skill 调用处理 ==========
    async function handleSkillCall(
        skillKey: string,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const skill = getUnifiedToolByKey(skillKey)
        if (!skill?.skillMeta) {
            console.warn('[Agent] 未找到 Skill 或无 skillMeta:', skillKey)
            return await handleComplexChat(historyMessages, 'complex', onChunk)
        }

        const hasBins = skill.skillMeta.requires?.bins && skill.skillMeta.requires.bins.length > 0

        if (hasBins) {
            // ★ 命令型 Skill：两阶段执行
            return await handleExecutableSkill(skill, historyMessages, onChunk)
        } else {
            // 知识型 Skill：保持 prompt-inject
            return await handlePromptInjectSkill(skill, historyMessages, onChunk)
        }
    }

    /** 命令型 Skill：命令提取 → 沙箱执行 → 结果回答 */
    async function handleExecutableSkill(
        skill: any,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { executeSkillCommand } = await import('@/services/skill-executor')
        const allowedBins = skill.skillMeta?.requires?.bins || []

        // 阶段1：让 LLM 提取需要执行的命令
        console.log('[Agent] Skill 命令提取阶段...')
        const extractPrompt = `你是命令提取器。根据用户的问题和下面的技能说明，提取需要执行的命令。

## 技能说明
${skill.skillMeta?.markdownBody || ''}

## 可用命令
只能使用以下命令: ${allowedBins.join(', ')}

## 输出格式
只返回 JSON，不要其他内容：
{"command": "命令名", "args": ["参数1", "参数2"]}

注意：
- args 数组中每个参数是一个独立的字符串
- URL 作为一个完整参数
- 不要使用 shell 管道或重定向`

        const lastUserMsg = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
        const extractMessages: LLMMessage[] = [
            { role: 'system', content: extractPrompt },
            { role: 'user', content: lastUserMsg }
        ]

        let cmdJson: { command: string; args: string[] }
        try {
            cmdJson = await structuredChat<{ command: string; args: string[] }>(extractMessages, { intent: 'fast' })
            console.log('[Agent] 提取的命令:', cmdJson)
        } catch (e) {
            console.warn('[Agent] 命令提取失败，回退到 prompt-inject:', e)
            return await handlePromptInjectSkill(skill as any, historyMessages, onChunk)
        }

        // 阶段2：沙箱执行
        console.log('[Agent] Skill 沙箱执行阶段...')
        const { currentSession } = useSessionStore()
        const { activeRole, getFullSystemPrompt } = useRoleStore()
        const record = await createToolRecord({
            sessionId: currentSession.value?.id,
            roleId: activeRole.value.id,
            toolName: skill.key as string,
            startTime: Date.now(),
            params: cmdJson,
            status: 'pending'
        })

        const execResult = await executeSkillCommand(
            skill.key!,
            cmdJson.command,
            cmdJson.args,
            allowedBins
        )

        await updateToolRecord(record, {
            endTime: Date.now(),
            status: execResult.ok ? 'success' : 'error',
            result: execResult,
            errorMessage: execResult.ok ? undefined : (execResult.error || execResult.stderr)
        })

        // 阶段3：将结果注入上下文，生成自然语言回答
        let resultText: string
        if (execResult.ok) {
            resultText = execResult.stdout || '（命令执行成功但无输出）'
        } else {
            resultText = `命令执行失败: ${execResult.error || execResult.stderr || '未知错误'}`
        }

        console.log('[Agent] Skill 执行结果:', resultText.slice(0, 200))

        const answerMessages: LLMMessage[] = [
            {
                role: 'system',
                content: `${getFullSystemPrompt()}\n\n以下是通过外部工具获取的真实数据。请根据数据用自然语言回答用户问题，不要输出 JSON 格式。如果数据中有乱码，尽量提取有用信息。`
            },
            ...historyMessages,
            {
                role: 'system',
                content: `【工具执行结果】:\n${resultText}`
            }
        ]

        let fullContent = ''
        await chatStream(answerMessages, {
            intent: 'simple',
            onChunk: (chunk, full) => {
                fullContent = full
                if (onChunk) onChunk(chunk)
            }
        })

        return [{
            type: 'message',
            content: fullContent
        }]
    }

    /** 知识型 Skill：prompt-inject 模式 */
    async function handlePromptInjectSkill(
        skill: any,
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const { getFullSystemPrompt } = useRoleStore()
        const systemPrompt = `${getFullSystemPrompt()}

## 当前启用的能力

${skill.skillMeta?.markdownBody || ''}

请根据以上能力描述，帮助用户完成任务。直接用自然语言回答，不要输出 JSON 格式。`

        const chatMessages: LLMMessage[] = [
            { role: 'system', content: systemPrompt },
            ...historyMessages
        ]

        let fullContent = ''
        await chatStream(chatMessages, {
            intent: 'complex',
            onChunk: (chunk, full) => {
                fullContent = full
                if (onChunk) onChunk(chunk)
            }
        })

        return [{
            type: 'message',
            content: fullContent
        }]
    }

    // ========== 内核态对话处理 ==========
    async function handleToolModeChat(
        userInput: string,
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const toolContext = getToolContext()
        if (!toolContext) {
            console.warn('[Agent] 内核态但无工具上下文，退出')
            endTool()
            return []
        }

        // 添加用户消息到工具上下文
        addToolMessage('user', userInput)

        // 检查是否达到轮数限制
        if (shouldToolEnd()) {
            console.log('[Agent] 工具轮数达到上限，强制生成结果')
        }

        // 使用工具专属提示词 + high 模型（从角色配置获取）
        const toolPromptConfig = getToolPromptConfig(toolContext.tool)
        if (!toolPromptConfig) {
            console.warn('[Agent] 未找到工具提示词配置:', toolContext.tool)
            endTool()
            return [{
                type: 'message',
                content: '工具配置异常，已退出。'
            }]
        }

        const messages: LLMMessage[] = [
            { role: 'system', content: toolPromptConfig.system },
            ...toolContext.conversationHistory.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }))
        ]

        let fullContent = ''
        await chatStream(messages, {
            intent: 'complex',  // 固定使用 high 模型
            onChunk: (chunk, full) => {
                fullContent = full
                if (onChunk) onChunk(chunk)
            }
        })

        // 添加助手回复到工具上下文
        addToolMessage('assistant', fullContent)

        // 检查是否返回了完成标记
        const completeMatch = fullContent.match(/\{[\s\S]*"complete"\s*:\s*true[\s\S]*\}/)
        if (completeMatch) {
            try {
                const result = JSON.parse(completeMatch[0])
                console.log('[Agent] 工具完成，返回结果:', result)

                // 记录执行
                const { currentSession } = useSessionStore()
                const { activeRole } = useRoleStore()
                await createToolRecord({
                    sessionId: currentSession.value?.id,
                    roleId: activeRole.value.id,
                    toolName: toolContext.tool,
                    startTime: Date.now(),
                    endTime: Date.now(),
                    params: { history: toolContext.conversationHistory },
                    result: result,
                    status: 'success'
                })

                // 退出内核态
                endTool()

                // ★ 拦截 web_search
                if (toolContext.tool === 'web_search' && result.query) {
                    console.log('[Agent] 开始进行网络检索:', result.query)

                    // 1. 调用真实的服务
                    const searchResultText = await performWebSearch(result.query)

                    // 2. 构建干净的上下文：只保留用户原始问题，去掉工具内部的 JSON 对话
                    const userMessages: LLMMessage[] = toolContext.conversationHistory
                        .filter(m => m.role === 'user')
                        .map(m => ({ role: 'user' as const, content: m.content }))

                    // 加入搜索结果作为系统上下文
                    const enhancedHistory: LLMMessage[] = [
                        ...userMessages,
                        {
                            role: 'system',
                            content: `【互联网检索结果，请结合以下事实信息客观详尽地回答用户问题，并在回答末尾标注参考来源的链接】：\n${searchResultText}`
                        }
                    ]

                    // 3. 抛给深度思考模型回答
                    return await handleComplexChat(enhancedHistory, 'complex', onChunk)
                }

                // 保存工具结果到对应存储服务
                saveToolResult(toolContext.tool, result)

                // 返回工具结果
                return [{
                    type: 'tool_result',
                    tool: toolContext.tool,
                    content: fullContent.replace(completeMatch[0], '').trim() || '分析完成',
                    resultData: result
                }]
            } catch (e) {
                console.warn('[Agent] 解析工具结果失败:', e)
            }
        }

        // 未完成，继续对话
        return [{
            type: 'message',
            content: fullContent
        }]
    }

    return { sendToAgent }
}
