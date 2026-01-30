/**
 * LLM 服务层 - DashScope API 封装
 * 支持流式响应和回调
 */

export interface LLMConfig {
    baseURL: string
    model: string
    apiKey: string
}

export interface Message {
    role: 'system' | 'user' | 'assistant'
    content: string
}

// 默认配置
const DEFAULT_CONFIG: LLMConfig = {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'glm-4.5',
    apiKey: import.meta.env.VITE_DASHSCOPE_API_KEY || ''
}

/**
 * 流式聊天请求，支持实时回调
 */
export async function chatStream(
    messages: Message[],
    onChunk: (chunk: string, fullContent: string) => void,
    config: Partial<LLMConfig> = {}
): Promise<string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config }

    const response = await fetch(`${finalConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${finalConfig.apiKey}`
        },
        body: JSON.stringify({
            model: finalConfig.model,
            messages,
            temperature: 0.7,
            max_tokens: 1024,
            stream: true
        })
    })

    if (!response.ok) {
        const error = await response.text()
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

    return fullContent
}

/**
 * 普通聊天请求（等待完整响应）
 */
export async function chat(
    messages: Message[],
    config: Partial<LLMConfig> = {}
): Promise<string> {
    return chatStream(messages, () => { }, config)
}

/**
 * 发送请求并解析 JSON 响应
 */
export async function structuredChat<T>(
    messages: Message[],
    config: Partial<LLMConfig> = {}
): Promise<T> {
    const content = await chat(messages, config)
    const trimmed = content.trim()

    // 先尝试直接解析
    try {
        return JSON.parse(trimmed)
    } catch {
        // 继续尝试其他方式
    }

    // 尝试从 markdown 代码块中提取
    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/) ||
        trimmed.match(/```\s*([\s\S]*?)\s*```/)

    if (jsonMatch && jsonMatch[1]) {
        try {
            return JSON.parse(jsonMatch[1].trim())
        } catch (e) {
            console.error('Failed to parse JSON from code block:', jsonMatch[1])
        }
    }

    console.error('Failed to parse JSON, raw content:', trimmed)
    throw new Error('Failed to parse LLM response as JSON')
}
