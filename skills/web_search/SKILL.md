---
name: web_search
description: "通过互联网搜索实时信息等"
metadata:
  openclaw:
    emoji: "🌐"
    exec_mode: instant
    handler_key: web_search
    trigger:
      keywords: ["搜一下", "上网查", "最新", "新闻", "网络", "搜索", "查一下"]
      description: "当用户询问实时信息、新闻或你不确定的外部事实时使用"
---
## 功能说明

通过 Tavily API 搜索互联网获取最新信息，并将搜索结果交给深度思考模型总结回答。

## 执行流程

1. 从用户消息中提取搜索关键词
2. 调用 Tavily 搜索 API
3. 将搜索结果注入上下文，由 LLM 生成自然语言回答
4. 在回答末尾标注参考来源链接
