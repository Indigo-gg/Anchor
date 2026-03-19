/**
 * LLM 服务层 - 智能路由版 (Electron 代理版)
 * 
 * 特性：
 * - 通过 Electron 主进程转发请求，解决 CORS 问题
 * - 基于意图的模型路由
 * - V2: 从 llm-providers 获取提供商配置（支持多提供商切换）
 * - 适配 DeepSeek-R1 角色限制
 */

import { useProviderStore, type ModelIntent } from './llm-providers'

// ============ 类型定义 ============

export type { ModelIntent }

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

// 默认意图
const DEFAULT_INTENT: ModelIntent = 'simple'

// ============ 核心函数 ============

/**
 * 流式聊天请求
 */
export async function chatStream(
    messages: Message[],
    optionsOrCallback?: ChatOptions | ((chunk: string, fullContent: string) => void),
    legacyConfig?: Partial<LLMConfig>
): Promise<string> {
    let options: ChatOptions = {}
    if (typeof optionsOrCallback === 'function') {
        options = { onChunk: optionsOrCallback }
        if (legacyConfig) {
            const { getConfigForIntent } = useProviderStore()
            const defaults = getConfigForIntent('simple')
            return chatStreamWithConfig(messages, options.onChunk!, {
                baseURL: legacyConfig.baseURL || defaults.baseURL,
                model: legacyConfig.model || defaults.model,
                apiKey: legacyConfig.apiKey || defaults.apiKey
            })
        }
    } else if (optionsOrCallback) {
        options = optionsOrCallback
    }

    const intent = options.intent || DEFAULT_INTENT
    const onChunk = options.onChunk || (() => { })

    // V2: 从提供商配置获取
    const { getConfigForIntent } = useProviderStore()
    const config = getConfigForIntent(intent)

    return chatStreamWithConfig(messages, onChunk, config)
}

/**
 * 通过 Electron 主进程执行流式请求 (解决 CORS)
 */
async function chatStreamWithConfig(
    messages: Message[],
    onChunk: (chunk: string, fullContent: string) => void,
    config: LLMConfig
): Promise<string> {
    // 适配模型限制：DeepSeek-R1 只支持 user 角色
    let processedMessages = messages
    if (config.model.includes('deepseek-r1')) {
        processedMessages = messages.map(m => ({
            role: 'user',
            content: m.role === 'system' ? `[System Instruction] ${m.content}` : m.content
        }))
    }

    const requestId = Math.random().toString(36).substring(7)
    let fullContent = ''

    const body: any = {
        model: config.model,
        messages: processedMessages,
        temperature: config.model.includes('deepseek-r1') ? 0.6 : 0.7,
        stream: true
    }

    if (config.model.includes('qwen3') && !config.model.includes('qwen3.5')) {
        body.chat_template_kwargs = { enable_thinking: true }
    }

    console.log('[LLM Proxy Request]', { model: config.model, requestId })

    return new Promise((resolve, reject) => {
        const cleanup: (() => void)[] = []

        const stopListening = () => {
            cleanup.forEach(fn => fn())
        }

        // 监听 Chunk
        cleanup.push(window.electronAPI.llm.onChunk(requestId, (rawChunk: string) => {
            // 解析 SSE 数据
            const lines = rawChunk.split('\n')
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
                        // 忽略解析失败的行
                    }
                }
            }
        }))

        // 监听完成
        cleanup.push(window.electronAPI.llm.onDone(requestId, () => {
            stopListening()
            resolve(fullContent)
        }))

        // 监听错误
        cleanup.push(window.electronAPI.llm.onError(requestId, (error: string) => {
            stopListening()
            console.error('[LLM Proxy Error]', error)
            reject(new Error(error))
        }))

        // 发送请求
        window.electronAPI.llm.chatStream({ config, body, requestId })
    })
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
 */
export async function generateImage(
    prompt: string,
    _size: '1024x1024' | '1280x720' | '720x1280' | '1216x896' = '1024x1024'
): Promise<{ imageUrl?: string; error?: string }> {
    const messages: Message[] = [{ role: 'user', content: prompt }]

    try {
        const fullContent = await chat(messages, { intent: 'image' })

        const imageUrlMatch = fullContent.match(/!\[.*?\]\((.*?)\)/)
        if (imageUrlMatch && imageUrlMatch[1]) {
            return { imageUrl: imageUrlMatch[1] }
        }
        if (fullContent.startsWith('data:image')) {
            return { imageUrl: fullContent }
        }
        return { error: '无法解析图片响应' }
    } catch (e) {
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
    let trimmed = content.trim()

    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/) ||
        trimmed.match(/```\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
        trimmed = jsonMatch[1].trim()
    }

    try {
        return JSON.parse(trimmed)
    } catch {
        throw new Error('Failed to parse LLM response as JSON')
    }
}

// ============ 历史压缩 & 工具小结 (复用 chatStream) ============

export async function compressHistory(messages: Message[]): Promise<string> {
    if (messages.length === 0) return ''
    const historyText = messages.map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n')
    return chat([{ role: 'system', content: '请将以下对话历史压缩成100字以内的摘要。' }, { role: 'user', content: historyText }], { intent: 'fast' })
}

export async function summarizeTool(toolName: string, result: string): Promise<string> {
    return chat([{ role: 'system', content: '请用一句话总结工具使用结果。' }, { role: 'user', content: `工具：${toolName}\n结果：${result}` }], { intent: 'fast' })
}

// ============ Retrieval (Embedding & Reranking) ============

// 固定使用 cstcloud 提供的 bge-large-zh:latest 作为全局 Embedding
export async function getEmbedding(text: string): Promise<number[]> {
    const { providers } = useProviderStore()
    // 强制获取 cstcloud 的配置（因为指定要用它的 bge）
    const cstcloud = providers.value.find(p => p.id === 'cstcloud')
    if (!cstcloud) {
        throw new Error('未找到 cstcloud 配置，无法提供全局 embedding')
    }

    try {
        const body = {
            model: 'bge-large-zh:latest',
            input: text
        }
        
        const data = await window.electronAPI.llm.embedding({ config: cstcloud, body })

        if (data.data && data.data[0] && data.data[0].embedding) {
            return data.data[0].embedding
        }

        throw new Error('Embedding 解析失败: 返回数据格式不正确')
    } catch (e) {
        console.error('[Embedding] 获取向量失败:', e)
        throw e
    }
}

// 线上 Reranker
export async function rerank(query: string, documents: string[], topN: number = 5): Promise<{ index: number, relevance_score: number }[]> {
    const { getConfigForIntent } = useProviderStore()
    const config = getConfigForIntent('reranker')

    const body = {
        model: config.model,
        query,
        documents,
        top_n: topN,
        return_documents: false
    }

    const data = await window.electronAPI.llm.rerank({ config, body })
    return data.results || []
}
