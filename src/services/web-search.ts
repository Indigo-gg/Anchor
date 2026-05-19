/**
 * 网络检索服务
 * 
 * 封装 Tavily Search API，专门为大模型提供高质量的网页内容检索
 */

// 检索结果项接口
export interface SearchResult {
    title: string
    url: string
    content: string
}

import { ref } from 'vue'

const STORAGE_KEY = 'anchor_tavily_api_key'
export const tavilyApiKey = ref(localStorage.getItem(STORAGE_KEY) || (import.meta.env.DEV ? import.meta.env.VITE_TAVILY_API_KEY : '') || '')

export function setTavilyApiKey(key: string) {
    tavilyApiKey.value = key
    localStorage.setItem(STORAGE_KEY, key)
}

/**
 * 执行网络搜索，并格式化为供大模型参考的文本
 * @param query 搜索关键词
 * @returns 格式化后的参考内容
 */
export async function performWebSearch(query: string): Promise<string> {
    const apiKey = tavilyApiKey.value
    if (!apiKey) {
        console.error('[WebSearch] 缺少 Tavily API KEY 配置')
        return '【系统提示】：网络检索服务未配置 API Key。请在设置中配置 Tavily API Key。'
    }

    // Tavily API 限制 query 最大 400 字符，超长时智能截断
    const MAX_QUERY_LENGTH = 380
    if (query.length > MAX_QUERY_LENGTH) {
        console.warn(`[WebSearch] Query 过长 (${query.length} 字符)，截断至 ${MAX_QUERY_LENGTH}`)
        let truncated = query.slice(0, MAX_QUERY_LENGTH)
        // 尝试在最后一个空格/中文标点处断开，避免截在词中间
        const lastBreak = Math.max(
            truncated.lastIndexOf(' '),
            truncated.lastIndexOf('，'),
            truncated.lastIndexOf('。'),
            truncated.lastIndexOf('？'),
            truncated.lastIndexOf('！'),
            truncated.lastIndexOf('、')
        )
        if (lastBreak > MAX_QUERY_LENGTH * 0.5) {
            truncated = truncated.slice(0, lastBreak)
        }
        query = truncated
    }

    try {
        console.log(`[WebSearch] 开始搜索: "${query}"`)
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                search_depth: 'basic',
                include_answer: false,    // 我们自己用大模型回答，不需要他的生成的短答案
                max_results: 3            // 取前 3 个最相关的结果即可
            })
        })

        if (!res.ok) {
            const errStr = await res.text()
            console.error('[WebSearch] 接口调用错误:', res.status, errStr)
            return `【系统提示】：网络检索请求失败（状态码：${res.status}）。请根据你的已有知识提供回答。`
        }

        const data = await res.json()

        if (!data.results || data.results.length === 0) {
            console.log('[WebSearch] 未搜索到相关内容')
            return '【系统提示】：本次检索未能找到最新的相关资料。请根据你的已有知识提供回答。'
        }

        // 把搜索结果组装成易于大模型阅读的纯文本格式
        const resultText = data.results.map((r: SearchResult, index: number) => {
            return `[${index + 1}] 标题: ${r.title}\n内容: ${r.content}\n来源: ${r.url}`
        }).join('\n\n')

        console.log(`[WebSearch] 搜索成功，提取 ${data.results.length} 条摘要`)
        return resultText

    } catch (e: any) {
        console.error('[WebSearch] 执行搜索时发生异常:', e)
        return `【系统提示】：网络检索服务发生网络错误(${e.message})。请根据你的已有知识提供回答。`
    }
}
