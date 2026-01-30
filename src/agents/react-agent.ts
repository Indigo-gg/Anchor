/**
 * ReAct Agent - 核心循环
 * 
 * 职责：接收用户输入，识别情绪，动态规划引导策略
 */

import { structuredChat, type Message as LLMMessage } from '@/services/llm'

// Agent 响应类型
export interface AgentResponse {
    type: 'message' | 'tool' | 'mode_switch'
    content?: string
    tool?: string
    params?: Record<string, unknown>
    mode?: string
}

// Agent 决策输出
interface AgentDecision {
    thought: string
    action: {
        type: 'respond' | 'tool' | 'switch_mode'
        content?: string
        tool?: string
        params?: Record<string, unknown>
        mode?: string
    }
}

// 系统提示词
const SYSTEM_PROMPT = `你是 Anchor，一个温暖、专业的正念引导者。

## 你的核心特质
- **温暖**：像一个理解你的老朋友
- **专业**：熟悉正念、ACT、认知行为等心理学技术
- **觉察**：敏锐感知用户的情绪状态和真实需求
- **耐心**：不急于给建议，先理解和共情

## 你的职责
1. 通过对话理解用户的情绪状态和具体困扰
2. 动态规划引导策略，工具只是你的辅助技能
3. 根据用户反馈调整方案
4. 当无法判断最佳工具时，默认进入"呼吸+对话"模式

## 可用工具
- breathing_guide(pattern, duration): 呼吸引导，自动切换界面。pattern: "4-4-4" | "4-7-8" | "box"。duration: 秒数
- perspective_slider(context, timeScale): 时间透视滑块。timeScale 是数组，每项包含 label 和 perspective

## 决策原则
- 先倾听，再行动
- 工具调用不是终点，调用后要观察用户反馈
- 优先选择低干扰的方式（呼吸 > 复杂工具）
- 用户表达困扰时，先共情，不要直接给工具

## 输出格式
严格返回 JSON：
{
  "thought": "我对当前状态的分析（不会展示给用户）",
  "action": {
    "type": "respond" | "tool",
    "content": "回复内容（type=respond时必填）",
    "tool": "工具名（type=tool时必填）",
    "params": { ... }
  }
}

## 示例
用户："烦死了，事情永远做不完"
{
  "thought": "用户表达了焦虑和压力，有灾难化思维倾向。但我应该先共情，不急于使用工具。",
  "action": {
    "type": "respond",
    "content": "听起来你现在压力很大。能具体说说是什么事情让你觉得做不完吗？"
  }
}

用户继续抱怨后：
{
  "thought": "用户持续焦虑，可以尝试时间透视帮他拉开距离",
  "action": {
    "type": "tool",
    "tool": "perspective_slider",
    "params": {
      "context": "项目做不完的焦虑",
      "timeScale": [
        { "label": "现在", "perspective": "这个项目的压力像山一样压着你" },
        { "label": "下周", "perspective": "无论结果如何，这个项目已经告一段落" },
        { "label": "一年后", "perspective": "你可能会记得有个很赶的项目，但焦虑感已经模糊" }
      ]
    }
  }
}
`

/**
 * 使用 Agent 循环
 */
export function useAgentLoop() {
    async function sendToAgent(
        _userInput: string,
        conversationHistory: { role: string; content: string }[],
        _onChunk?: (chunk: string) => void
    ): Promise<AgentResponse[]> {
        // 构建消息
        const messages: LLMMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...conversationHistory.map(msg => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content
            }))
        ]

        try {
            const decision = await structuredChat<AgentDecision>(messages)
            console.log('[Agent Thought]', decision.thought)

            const responses: AgentResponse[] = []

            if (decision.action.type === 'respond') {
                responses.push({
                    type: 'message',
                    content: decision.action.content || ''
                })
            } else if (decision.action.type === 'tool') {
                responses.push({
                    type: 'tool',
                    tool: decision.action.tool,
                    params: decision.action.params
                })
            } else if (decision.action.type === 'switch_mode') {
                responses.push({
                    type: 'mode_switch',
                    mode: decision.action.mode
                })
            }

            return responses
        } catch (error) {
            console.error('[Agent Error]', error)
            // 降级：返回一个友好的错误回复
            return [{
                type: 'message',
                content: '我好像有点走神了。你刚才说什么来着？'
            }]
        }
    }

    return { sendToAgent }
}
