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
import { useBoundaryStore } from '@/services/boundary'
import { useValuesStore } from '@/services/values'
import { useEnergyStore } from '@/services/energy'

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
    type: 'quick_reply' | 'think' | 'deep_think' | 'clarify' | 'tool_call' | 'image'
    reply?: string  // quick_reply 或 clarify 时的直接回复
    tool?: string   // tool_call 时的工具名
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

// 意图路由 Prompt（快速分类）
const ROUTE_PROMPT = `你是意图路由器。只返回 JSON，不要回答问题。

分析对话上下文，判断用户意图：

类型：
- clarify: 意图不清需反问（太模糊/指代不明）
- quick_reply: 简单问候、一句话能答（你好/谢谢/今天几号）
- think: 需要稍微思考（日常对话/简单烦恼/随便聊聊）
- deep_think: 需要认真深入思考（复杂情绪/人生困惑/深层心理/需要共情分析）
- tool_call: 用户确认要使用某个工具（回复"好/可以/试试"且上文提到了工具）
- image: 明确要求生成图片

区分 think 和 deep_think：
- think: "今天有点累" "工作好烦" "最近睡的不好"
- deep_think: "我不知道活着有什么意义" "和父母的关系让我很痛苦" "我感觉自己很失败"

可用工具：
- breathing_guide: 呼吸练习/放松
- boundary_mapper: 边界梳理/人际问题
- emergency_guide: 着陆练习/情绪急救
- energy_audit: 能量状态
- values_compass: 价值观探索

输出格式：
{"type":"类型","reply":"quick_reply/clarify时填写","tool":"tool_call时填工具名","imageSize":"image时填尺寸"}

图片尺寸识别（仅 type=image 时）：
- "1:1": 正方形、方形、头像、头图
- "16:9": 横屏、横版、宽屏、桌面壁纸、电脑壁纸
- "9:16": 竖屏、竖版、手机壁纸、手机屏保
- "4:3": 4:3比例
- 用户未指定尺寸时不填 imageSize（默认正方形）

示例：
用户说"你好" -> {"type":"quick_reply","reply":"你好呀 🌿"}
用户说"今天工作好累" -> {"type":"think"}
用户说"我很焦虑，不知道该怎么办" -> {"type":"deep_think"}
助手问"要不做个呼吸练习？"用户回"好" -> {"type":"tool_call","tool":"breathing_guide"}
用户说"帮我画一张横屏的山水画" -> {"type":"image","imageSize":"16:9"}`

// 深度对话 Prompt（纯对话，不要求 JSON）
function getComplexPrompt(historyMessages: LLMMessage[] = []): string {
    const { getRelevantMemories, formatMemoriesForPrompt, extractKeywords } = useMemoryStore()

    // 从最近的对话中提取关键词
    const recentText = historyMessages
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content)
        .join(' ')
    const contextTags = extractKeywords(recentText)

    // 使用语义标签检索相关记忆
    const memories = getRelevantMemories(contextTags, 5)
    const memorySection = formatMemoriesForPrompt(memories)

    if (contextTags.length > 0) {
        console.log('[Memory] 检索标签:', contextTags, '找到记忆:', memories.length)
    }

    let prompt = `你是 Anchor，温暖的正念引导者。

特质：温暖、共情、不说教、先倾听
风格：像朋友聊天，自然亲切

回复原则：
- 每次回复要完整表达想法，不要话说一半
- 保持简洁但不要过于精简，该说清楚的要说清楚
- 2-4句话为宜，复杂话题可以适当多说
- 不要用列表或格式化输出，就像聊天一样

如果用户情况适合某个工具，可以自然地建议（但不是必须）：
- 人际边界问题 -> 可以建议"要不我们来梳理一下边界？"
- 想放松 -> 可以建议"要不一起做个呼吸练习？"
- 情绪崩溃 -> 可以建议"要不先做个着陆练习？"

直接回复，不要用 JSON 格式。`

    if (memorySection) {
        prompt += `

用户记忆（自然融入对话，不要直接提及"我记得"）：
${memorySection}`
    }

    return prompt
}

// ============ 工具确认消息 ============

function generateConfirmMessage(tool: string): string {
    const messages: Record<string, string> = {
        emergency_guide: '我感觉到你现在可能很难受。如果你愿意，我可以带你做一个简单的着陆练习，帮助你先平静下来。要试试吗？',
        breathing_guide: '我们可以一起做个呼吸练习，帮助你放松一下。现在开始？',
        boundary_mapper: '听起来这个情况涉及到你和他人的边界。我可以带你梳理一下，看看哪些是你能控制的。要试试吗？',
        energy_audit: '要不我们先看看你现在的能量状态？这能帮助我们更好地了解你的情况。',
        values_compass: '我们可以一起探索一下你内心真正看重的是什么。愿意试试吗？'
    }
    return messages[tool] || `我觉得「${tool}」可能对你有帮助。要试试吗？`
}

// 用户已确认后的工具引导语（直接开始）
function getToolWelcomeMessage(tool: string): string {
    const messages: Record<string, string> = {
        emergency_guide: '好的，我们来做一个简单的着陆练习。先深呼吸，告诉我现在你身边能看到什么？',
        breathing_guide: '好的，让我们开始。先找一个舒服的姿势，准备好了告诉我。',
        boundary_mapper: '好的，我们来梳理一下。先告诉我，你想探讨的是哪段关系？或者是什么具体的情境让你感到边界被侵犯？',
        energy_audit: '好的，先和我说说你现在的感受。身体累吗？情绪如何？',
        values_compass: '好的，我们来探索一下。最近有什么事情让你在做决定时感到纠结吗？'
    }
    return messages[tool] || '好的，我们开始吧。先说说你的具体情况？'
}

// 保存工具结果到对应存储服务
function saveToolResult(tool: string, result: Record<string, unknown>) {
    try {
        switch (tool) {
            case 'boundary_mapper': {
                const { addRecord } = useBoundaryStore()
                const analysis = result.analysis as { tasks?: Array<{ label: string; reason: string; score: number }> }
                if (analysis?.tasks) {
                    addRecord(analysis.tasks, '')
                }
                break
            }
            case 'values_compass': {
                // values_compass 使用卡片式评估，数据保存由 ValuesQuiz 组件内部处理
                // 这里只处理情境收集完成的信号，不保存数据
                console.log('[Agent] values_compass 进入 quiz 模式，context:', result.context)
                break
            }
            case 'energy_audit': {
                const { addRecord } = useEnergyStore()
                const energy = result.energy as { body?: number; emotion?: number; motivation?: number; summary?: string }
                if (energy) {
                    // 计算综合能量等级 (1-4)
                    const avgScore = ((energy.body || 5) + (energy.emotion || 5) + (energy.motivation || 5)) / 3
                    const level = avgScore >= 8 ? 4 : avgScore >= 6 ? 3 : avgScore >= 4 ? 2 : 1
                    addRecord(level as 1 | 2 | 3 | 4, energy.summary || 'AI能量评估', 'ai_analysis')
                }
                break
            }
        }
        console.log('[Agent] 工具结果已保存:', tool)
    } catch (e) {
        console.warn('[Agent] 保存工具结果失败:', e)
    }
}

// ============ 工具专属提示词 ============

const TOOL_PROMPTS: Record<string, { system: string; maxTurns: number }> = {
    boundary_mapper: {
        system: `你是"边界整理师"。帮助用户梳理人际边界问题。

流程：
1. 通过 2-5 个问题理清事情的来龙去脉（具体轮数由你判断，信息足够即可结束）
2. 了解：发生了什么、涉及谁、用户的感受、用户想要什么
3. 当信息足够时，返回分析结果

原则：温和、客观、关注事实。每次只问一个问题。不要急于结束，确保理解清楚再总结。

当信息足够时，返回 JSON：
{"complete": true, "analysis": {"tasks": [{"label": "标签5字内", "reason": "一句话解释", "score": 0-10}]}}
score: 8-10=我的课题(完全掌控), 4-7=部分影响, 0-3=他人课题(无法控制)

如果还需要收集信息，直接用文本回复，不要用 JSON。`,
        maxTurns: 6
    },
    values_compass: {
        system: `你是"价值观向导"。帮助用户准备价值观评估。

流程：
1. 通过 1-2 个问题了解用户想要探索的情境（例如：工作决策、人际关系、生活选择）
2. 当你了解清楚情境后，返回准备开始评估

原则：简洁友好，快速收集情境即可。

当情境收集完成时，返回 JSON：
{"complete": true, "mode": "quiz", "context": "用户情境的简要描述"}

如果还需要了解情境，直接用文本回复，不要用 JSON。`,
        maxTurns: 3
    },
    energy_audit: {
        system: `你是"能量评估师"。帮助用户了解当前的能量状态。

通过 2-4 个问题了解（具体轮数由你判断）：
- 身体状态（睡眠、食欲、精力）
- 情绪状态
- 最近的压力来源

原则：温和询问，不要急于结束。

当信息足够时，返回 JSON：
{"complete": true, "energy": {"body": 1-10, "emotion": 1-10, "motivation": 1-10, "summary": "简短总结"}}

如果还需要收集信息，直接用文本回复，不要用 JSON。`,
        maxTurns: 5
    },
    breathing_guide: {
        system: `你是"呼吸引导师"。引导用户进行放松呼吸。

直接开始引导，不需要多问。返回：
{"complete": true, "guide": "ready"}

用温暖的语言告诉用户我们即将开始。`,
        maxTurns: 1
    },
    emergency_guide: {
        system: `你是"着陆引导师"。帮助用户在情绪危机时稳定下来。

直接开始引导，不需要多问。返回：
{"complete": true, "guide": "ready"}

用平静、温和的语气告诉用户我们即将开始。`,
        maxTurns: 1
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
                    { role: 'system', content: ROUTE_PROMPT },
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
                        content: route.reply || '你好呀 🌿',
                        thought: 'quick_reply'
                    }]

                case 'clarify':
                    // 澄清意图
                    return [{
                        type: 'message',
                        content: route.reply || '你可以说具体一点吗？',
                        thought: 'clarify'
                    }]

                case 'tool_call':
                    // 用户确认要使用工具 -> 进入内核态
                    if (route.tool && TOOL_PROMPTS[route.tool]) {
                        console.log('[Agent] 进入工具内核态:', route.tool)
                        const toolConfig = TOOL_PROMPTS[route.tool]

                        // 检查用户是否已明确确认（如"好"、"试试"等）
                        const lastUserContent = historyMessages.filter(m => m.role === 'user').pop()?.content || ''
                        const isConfirmation = /^(好|行|可以|试试|开始|嗯|ok|yes|是的|来吧|要|试一下|开始吧|来|试|走起|gogogo)/.test(lastUserContent.toLowerCase().trim())

                        // 进入内核态
                        const { startTool } = useSessionStore()
                        startTool(route.tool, toolConfig.system, toolConfig.maxTurns)

                        if (isConfirmation) {
                            // 用户已确认，直接开始工具对话（返回工具的引导语）
                            console.log('[Agent] 用户已确认，直接启动工具')
                            return [{
                                type: 'tool_start',
                                tool: route.tool,
                                content: getToolWelcomeMessage(route.tool),
                                thought: 'tool_start_confirmed'
                            }]
                        } else {
                            // 用户还没确认，发送确认消息
                            return [{
                                type: 'tool_start',
                                tool: route.tool,
                                content: generateConfirmMessage(route.tool),
                                thought: 'tool_start'
                            }]
                        }
                    }
                    // 如果没有解析出工具名，走深度对话
                    console.log('[Agent] tool_call 但未识别工具，走深度对话')
                    return await handleComplexChat(historyMessages, 'simple', onChunk)

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

                    const result = await generateImage(imagePrompt, imageSize)
                    if (result.imageUrl) {
                        return [{
                            type: 'image',
                            imageUrl: result.imageUrl,
                            content: '图片已生成 🎨',
                            thought: 'image'
                        }]
                    } else {
                        return [{
                            type: 'message',
                            content: result.error || '图片生成失败，请稍后再试',
                            thought: 'image_error'
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
        const prompt = getComplexPrompt(historyMessages)
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
            content: fullContent,
            thought: intent === 'complex' ? 'deep_think_reply' : 'think_reply'
        }]
    }

    // 纯流式对话（兜底）
    async function handleFallbackChat(
        historyMessages: LLMMessage[],
        onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        const fallbackPrompt = `你是 Anchor，温暖的正念引导者。
特质：温暖、共情、不说教、先倾听
风格：简短、自然、像朋友聊天
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
            content: fullContent,
            thought: 'fallback'
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

        // 使用工具专属提示词 + high 模型
        const toolPromptConfig = TOOL_PROMPTS[toolContext.tool]
        if (!toolPromptConfig) {
            console.warn('[Agent] 未找到工具提示词配置:', toolContext.tool)
            endTool()
            return [{
                type: 'message',
                content: '工具配置异常，已退出。',
                thought: 'tool_error'
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

                // 退出内核态
                endTool()

                // 保存工具结果到对应存储服务
                saveToolResult(toolContext.tool, result)

                // 返回工具结果
                return [{
                    type: 'tool_result',
                    tool: toolContext.tool,
                    content: fullContent.replace(completeMatch[0], '').trim() || '分析完成',
                    resultData: result,
                    thought: 'tool_complete'
                }]
            } catch (e) {
                console.warn('[Agent] 解析工具结果失败:', e)
            }
        }

        // 未完成，继续对话
        return [{
            type: 'message',
            content: fullContent,
            thought: 'tool_conversation'
        }]
    }

    return { sendToAgent }
}
