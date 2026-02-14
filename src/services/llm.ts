/**
 * LLM 服务层 - 智能路由版
 * 
 * 特性：
 * - 基于意图的模型路由 (fast/simple/complex/image)
 * - 自动降级策略
 * - 历史消息压缩
 * - 工具结果小结
 */

// ============ 类型定义 ============

export type ModelIntent = 'fast' | 'simple' | 'complex' | 'image'

export interface LLMConfig {
    baseURL: string
    model: string
    apiKey: string
}

export interface Message {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface ChatOptions {
    intent?: ModelIntent
    onChunk?: (chunk: string, fullContent: string) => void
}

// ============ 服务配置 ============

// 主服务：本地 Gemini
const PRIMARY_PROVIDER = {
    name: 'Local Gemini',
    baseURL: 'http://127.0.0.1:8045/v1',
    apiKey: import.meta.env.ANTI_DASHSCOPE_API_KEY || '',
    models: {
        fast: 'gemini-3-flash',
        simple: 'gemini-3-pro-low',
        complex: 'gemini-3-pro-high',
        image: 'gemini-3-pro-image'
    } as Record<ModelIntent, string>
}

// 降级服务：DashScope
const FALLBACK_PROVIDER = {
    name: 'DashScope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: import.meta.env.VITE_ANTI_DASHSCOPE_API_KEY || '',
    model: 'glm-4.5'
}

// 默认意图
const DEFAULT_INTENT: ModelIntent = 'simple'

// ============ 核心函数 ============

/**
 * 流式聊天请求
 * @param messages 消息列表
 * @param optionsOrCallback 选项或回调函数（兼容旧 API）
 */
export async function chatStream(
    messages: Message[],
    optionsOrCallback?: ChatOptions | ((chunk: string, fullContent: string) => void),
    legacyConfig?: Partial<LLMConfig>
): Promise<string> {
    // 兼容旧 API: chatStream(messages, onChunk, config)
    let options: ChatOptions = {}
    if (typeof optionsOrCallback === 'function') {
        options = { onChunk: optionsOrCallback }
        if (legacyConfig) {
            // 如果传了 legacyConfig，使用旧逻辑
            return chatStreamWithConfig(messages, options.onChunk!, {
                baseURL: legacyConfig.baseURL || PRIMARY_PROVIDER.baseURL,
                model: legacyConfig.model || PRIMARY_PROVIDER.models.simple,
                apiKey: legacyConfig.apiKey || PRIMARY_PROVIDER.apiKey
            })
        }
    } else if (optionsOrCallback) {
        options = optionsOrCallback
    }

    const intent = options.intent || DEFAULT_INTENT
    const onChunk = options.onChunk || (() => { })

    // 图片意图不支持降级
    if (intent === 'image') {
        return chatStreamWithConfig(messages, onChunk, {
            baseURL: PRIMARY_PROVIDER.baseURL,
            model: PRIMARY_PROVIDER.models.image,
            apiKey: PRIMARY_PROVIDER.apiKey
        })
    }

    // 尝试主服务
    try {
        return await chatStreamWithConfig(messages, onChunk, {
            baseURL: PRIMARY_PROVIDER.baseURL,
            model: PRIMARY_PROVIDER.models[intent],
            apiKey: PRIMARY_PROVIDER.apiKey
        })
    } catch (error) {
        console.warn(`[LLM] Primary service failed, falling back to ${FALLBACK_PROVIDER.name}:`, error)

        // 降级到备用服务
        if (FALLBACK_PROVIDER.apiKey) {
            return chatStreamWithConfig(messages, onChunk, {
                baseURL: FALLBACK_PROVIDER.baseURL,
                model: FALLBACK_PROVIDER.model,
                apiKey: FALLBACK_PROVIDER.apiKey
            })
        }

        throw error
    }
}

/**
 * 实际执行流式请求
 */
async function chatStreamWithConfig(
    messages: Message[],
    onChunk: (chunk: string, fullContent: string) => void,
    config: LLMConfig
): Promise<string> {
    // 请求日志
    console.log('[LLM Request]', {
        model: config.model,
        baseURL: config.baseURL,
        messageCount: messages.length,
        messages: messages.map(m => ({
            role: m.role,
            contentPreview: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : '')
        }))
    })

    const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0.7,
            max_tokens: 2048,
            stream: true
        })
    })

    if (!response.ok) {
        const error = await response.text()
        console.error('[LLM Error]', { status: response.status, error })
        throw new Error(`LLM API error: ${response.status} - ${error}`)
    }

    if (!response.body) {
        throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
            if (line.trim() === '' || line.trim() === 'data: [DONE]') continue
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6))
                    const content = data.choices?.[0]?.delta?.content || ''
                    if (content) {
                        fullContent += content
                        onChunk(content, fullContent)
                    }
                } catch (e) {
                    console.warn('Failed to parse SSE line:', line)
                }
            }
        }
    }

    // 响应日志
    console.log('[LLM Response]', {
        contentLength: fullContent.length,
        contentPreview: fullContent.slice(0, 200) + (fullContent.length > 200 ? '...' : '')
    })

    return fullContent
}

/**
 * 普通聊天请求（等待完整响应）
 */
export async function chat(
    messages: Message[],
    options?: ChatOptions
): Promise<string> {
    return chatStream(messages, { ...options, onChunk: () => { } })
}

/**
 * 图片生成请求
 * 返回 base64 图片数据或图片 URL
 * @param size 图片尺寸，支持: "1024x1024" (1:1), "1280x720" (16:9), "720x1280" (9:16), "1216x896" (4:3)
 */
export async function generateImage(
    prompt: string,
    size: '1024x1024' | '1280x720' | '720x1280' | '1216x896' = '1024x1024'
): Promise<{ imageUrl?: string; error?: string }> {
    console.log('[LLM] 图片生成请求:', prompt, '尺寸:', size)

    try {
        const response = await fetch(`${PRIMARY_PROVIDER.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${PRIMARY_PROVIDER.apiKey}`
            },
            body: JSON.stringify({
                model: PRIMARY_PROVIDER.models.image,
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 2048,
                // 关键参数：指定图片尺寸以触发图片生成
                size: size
            })
        })

        if (!response.ok) {
            const error = await response.text()
            console.error('[LLM Image Error]', error)
            return { error: `图片生成失败: ${response.status}` }
        }

        const data = await response.json()
        const content = data.choices?.[0]?.message?.content || ''

        // 尝试从响应中提取图片 URL 或 base64
        // Gemini 图片模型通常返回 markdown 格式的图片
        const imageUrlMatch = content.match(/!\[.*?\]\((.*?)\)/)
        if (imageUrlMatch && imageUrlMatch[1]) {
            return { imageUrl: imageUrlMatch[1] }
        }

        // 检查是否是 base64 数据
        if (content.startsWith('data:image')) {
            return { imageUrl: content }
        }

        // 如果响应中包含 base64 图片标记
        const base64Match = content.match(/data:image\/\w+;base64,[A-Za-z0-9+/=]+/)
        if (base64Match) {
            return { imageUrl: base64Match[0] }
        }

        console.log('[LLM Image] 无法解析图片响应:', content.slice(0, 200))
        return { error: '无法解析图片响应' }
    } catch (e) {
        console.error('[LLM Image Error]', e)
        return { error: '图片生成请求失败' }
    }
}

/**
 * 发送请求并解析 JSON 响应
 */
export async function structuredChat<T>(
    messages: Message[],
    options?: ChatOptions
): Promise<T> {
    const content = await chat(messages, options)

    // 处理空响应
    if (!content || content.trim().length === 0) {
        console.warn('[LLM] Empty response received')
        throw new Error('LLM returned empty response')
    }

    let trimmed = content.trim()

    // 从 markdown 代码块中提取（优先处理）
    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/) ||
        trimmed.match(/```\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
        trimmed = jsonMatch[1].trim()
    }

    // 尝试直接解析
    try {
        return JSON.parse(trimmed)
    } catch {
        // 继续尝试修复
    }

    // 尝试修复被截断的 JSON
    const fixedJson = tryFixTruncatedJson(trimmed)
    if (fixedJson) {
        try {
            return JSON.parse(fixedJson)
        } catch {
            // 继续
        }
    }

    console.error('Failed to parse JSON, raw content:', trimmed)
    throw new Error('Failed to parse LLM response as JSON')
}

/**
 * 尝试修复被截断的 JSON
 */
function tryFixTruncatedJson(json: string): string | null {
    // 移除可能的尾部不完整内容
    let fixed = json

    // 如果是对象，确保以 { 开头
    if (!fixed.startsWith('{') && !fixed.startsWith('[')) {
        const objStart = fixed.indexOf('{')
        const arrStart = fixed.indexOf('[')
        const start = objStart >= 0 && arrStart >= 0
            ? Math.min(objStart, arrStart)
            : Math.max(objStart, arrStart)
        if (start >= 0) {
            fixed = fixed.slice(start)
        } else {
            return null
        }
    }

    // 计算括号平衡
    let braceCount = 0
    let bracketCount = 0
    let inString = false
    let escape = false

    for (const char of fixed) {
        if (escape) {
            escape = false
            continue
        }
        if (char === '\\') {
            escape = true
            continue
        }
        if (char === '"') {
            inString = !inString
            continue
        }
        if (inString) continue

        if (char === '{') braceCount++
        if (char === '}') braceCount--
        if (char === '[') bracketCount++
        if (char === ']') bracketCount--
    }

    // 如果字符串没闭合，尝试闭合
    if (inString) {
        fixed += '"'
    }

    // 补充缺失的闭合括号
    while (bracketCount > 0) {
        fixed += ']'
        bracketCount--
    }
    while (braceCount > 0) {
        fixed += '}'
        braceCount--
    }

    return fixed
}

// ============ 历史压缩 ============

const COMPRESS_PROMPT = `你是一个对话压缩专家。请将以下对话历史压缩成一段简洁的摘要，保留关键信息和上下文。
输出要求：
- 第一人称视角（用户）
- 保留对话的关键主题和情感
- 100字以内

对话历史：
`

/**
 * 压缩历史消息
 */
export async function compressHistory(messages: Message[]): Promise<string> {
    if (messages.length === 0) return ''

    const historyText = messages
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
        .join('\n')

    const response = await chat([
        { role: 'system', content: COMPRESS_PROMPT },
        { role: 'user', content: historyText }
    ], { intent: 'fast' })

    return response
}

// ============ 工具小结 ============

const SUMMARIZE_PROMPT = `请用一句话总结这个工具的使用结果，作为对话上下文的一部分。
格式：[工具名] 做了什么
`

/**
 * 生成工具使用小结
 */
export async function summarizeTool(toolName: string, result: string): Promise<string> {
    const response = await chat([
        { role: 'system', content: SUMMARIZE_PROMPT },
        { role: 'user', content: `工具：${toolName}\n结果：${result}` }
    ], { intent: 'fast' })

    return `[${toolName}] ${response}`
}
