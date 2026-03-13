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

/**
 * 执行网络搜索，并格式化为供大模型参考的文本
 * @param query 搜索关键词
 * @returns 格式化后的参考内容
 */
export async function performWebSearch(query: string): Promise<string> {
    const apiKey = import.meta.env.VITE_TAVILY_API_KEY
    if (!apiKey) {
        console.error('[WebSearch] 缺少 VITE_TAVILY_API_KEY 配置')
        return '【系统提示】：由于未配置 VITE_TAVILY_API_KEY，网络检索服务不可用。请提醒系统管理员进行配置。'
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
