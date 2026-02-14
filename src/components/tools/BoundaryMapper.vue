<template>
  <div class="boundary-mapper">
    <!-- 阶段一：场景输入 -->
    <div v-if="phase === 'input'" class="input-phase">
      <div class="phase-header">
        <span class="phase-icon">🛡️</span>
        <h3>建立清晰的边界</h3>
      </div>
      
      <p class="intro-text">遇到什么让你感到界限模糊或纠结的事情了吗？<br>请在下方输入框告诉我。</p>
      
      <div v-if="scenarioInput" class="user-input-display">
        {{ scenarioInput }}
      </div>
    </div>

    <!-- 阶段二：澄清对话 -->
    <div v-else-if="phase === 'clarification'" class="clarification-phase">
      <div class="phase-header">
        <span class="phase-icon">💭</span>
        <h3>梳理一下</h3>
      </div>
      
      <div class="chat-container">
        <div 
          v-for="(msg, idx) in clarificationMessages" 
          :key="idx"
          :class="['chat-message', msg.role]"
        >
          <div class="message-content">{{ msg.content }}</div>
        </div>
        
        <div v-if="isThinking" class="chat-message assistant">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <!-- 阶段三：边界图示 -->
    <div v-else-if="phase === 'visualization'" class="vis-phase">
      <div class="phase-header">
        <span class="phase-icon">�</span>
        <h3>课题星系图</h3>
      </div>
      
      <p class="vis-intro">距离核心越近，代表你的掌控力越强。</p>
      
      <div class="boundary-orbit-container" ref="containerRef">
        <svg class="orbit-svg" viewBox="-200 -200 400 400">
          <!-- 轨道背景 -->
          <circle r="60" class="orbit orbit-inner" cx="0" cy="0" />
          <circle r="120" class="orbit orbit-middle" cx="0" cy="0" />
          <circle r="180" class="orbit orbit-outer" cx="0" cy="0" />
          
          <!-- 轨道标签 -->
          <text x="0" y="-65" class="orbit-label">完全掌控</text>
          <text x="0" y="-125" class="orbit-label">部分影响</text>
          <text x="0" y="-185" class="orbit-label">无法控制</text>

          <!-- 核心 -->
          <circle r="20" class="core-sun" cx="0" cy="0">
            <animate attributeName="r" values="18;20;18" dur="4s" repeatCount="indefinite" />
          </circle>
          <text x="0" y="5" class="core-label">我</text>

          <!-- 连接线 -->
          <line 
            v-for="(item, idx) in allTasks" 
            :key="'line-'+idx"
            x1="0" y1="0"
            :x2="item.x" :y2="item.y"
            class="connection-line"
            :class="{ mine: item.score >= 7, other: item.score < 4 }"
          />

          <!-- 节点 -->
          <g 
            v-for="(item, idx) in allTasks" 
            :key="'node-'+idx"
            :transform="`translate(${item.x}, ${item.y})`"
            class="task-node"
            @click="showItemDetail(item)"
          >
            <!-- 节点光晕 -->
            <circle r="4" class="node-dot" :class="item.classType" cx="0" cy="0" />
            
            <!-- 标签胶囊 -->
            <rect 
              :x="-item.width/2" 
              y="-28" 
              :width="item.width" 
              height="24" 
              rx="12"
              class="node-bg" 
              :class="item.classType"
            />
            <text x="0" y="-12" class="node-text">{{ item.label }}</text>
          </g>
        </svg>
      </div>

      <!-- 详情弹窗 -->
      <transition name="fade">
        <div v-if="selectedItem" class="item-detail-overlay" @click="selectedItem = null">
          <div class="item-detail-card" @click.stop>
            <div class="card-header" :class="selectedItem.classType">
              <h4>{{ selectedItem.label }}</h4>
              <span class="score-badge">可控度 {{ selectedItem.score }}/10</span>
            </div>
            <p class="detail-reason">{{ selectedItem.reason }}</p>
            <p class="detail-advice" v-if="selectedItem.score < 5">💡 把精力收回到你能控制的事情上</p>
            <p class="detail-advice" v-else>💪这是你的责任，勇敢承担</p>
            <button class="close-btn" @click="selectedItem = null">关闭</button>
          </div>
        </div>
      </transition>
      
      <button class="complete-btn" @click="completeSession">
        完成练习
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { chatStream, type Message as LLMMessage } from '@/services/llm'
import { useInputBridge } from '@/services/input-bridge'

const emit = defineEmits<{
  complete: []
}>()

const { registerHandler, unregisterHandler } = useInputBridge()

type Phase = 'input' | 'clarification' | 'visualization'
const phase = ref<Phase>('input')

// 输入
const scenarioInput = ref('')

// 澄清
interface ChatMessage { role: 'user' | 'assistant'; content: string }
const clarificationMessages = ref<ChatMessage[]>([])
const isThinking = ref(false)
const turnCount = ref(0)
const MAX_TURNS = 2

// 注册输入桥接
onMounted(() => {
  registerHandler(handleUserInput, '请描述你的困扰...')
})

onUnmounted(() => {
  unregisterHandler()
})

async function handleUserInput(text: string) {
  if (phase.value === 'input') {
    scenarioInput.value = text
    await submitScenario()
  } else if (phase.value === 'clarification') {
    if (isThinking.value) return 
    clarificationMessages.value.push({ role: 'user', content: text })
    turnCount.value++
    
    if (turnCount.value >= MAX_TURNS) {
      unregisterHandler() // 停止接收输入
      await analyzeBoundary()
      return
    }
    
    await nextClarificationTurn()
  }
}

async function submitScenario() {
  phase.value = 'clarification'
  // 将初始描述也加入对话历史
  clarificationMessages.value.push({ role: 'user', content: scenarioInput.value })
  
  // 更新 placeholder
  registerHandler(handleUserInput, '请回答...')
  
  await startClarification()
}

async function startClarification() {
  isThinking.value = true
  
  const systemPrompt = `你是一个“边界整理师”。用户遇到了人际边界不清的问题。
目标：通过 2-3 个问题，理清事情的来龙去脉，以便进行“课题分离”。
原则：温和、客观、关注事实。
请针对用户的描述，提出一个澄清性问题，或者确认关键细节。`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: scenarioInput.value }
  ]
  
  let response = ''
  await chatStream(messages, {
    intent: 'simple',
    onChunk: (chunk) => {
      response += chunk
    }
  })
  
  clarificationMessages.value.push({ role: 'assistant', content: response })
  isThinking.value = false
}

async function nextClarificationTurn() {
  isThinking.value = true
  
  const systemPrompt = `继续帮助用户梳理边界。
请提出下一个澄清问题，或者如果信息足够，可以总结一下情况。
保持简短。`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...clarificationMessages.value
  ]
  
  let response = ''
  await chatStream(messages, {
    intent: 'simple',
    onChunk: (chunk) => {
      response += chunk
    }
  })
  
  clarificationMessages.value.push({ role: 'assistant', content: response })
  isThinking.value = false
}

// 视觉化
interface BoundaryItem {
  label: string
  reason: string
  score: number // 0-10
  x: number
  y: number
  width: number
  classType: 'mine' | 'shared' | 'other'
}

const allTasks = ref<BoundaryItem[]>([])
const selectedItem = ref<BoundaryItem | null>(null)

async function analyzeBoundary() {
  isThinking.value = true
  
  const systemPrompt = `根据对话，运用阿德勒“课题分离”原则分析。
将涉及的事项分为三个层次：
1. 核心圈（评分 8-10）：我的课题，我完全能控制（如我的行为、我的情绪反应）。
2. 影响圈（评分 4-7）：我有部分影响权，但不能完全控制（如沟通的效果、协作的氛围）。
3. 关注圈（评分 0-3）：他人的课题，我几乎无法控制（如别人的情绪、别人的决定、过去发生的事）。

返回 JSON：
{
  "tasks": [
    { "label": "简短标签(5字内)", "reason": "一句话解释为什么在这个分值", "score": 9 }
  ]
}
只返回 JSON。确保至少有 4-6 个不同的 task 以丰富画面。`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...clarificationMessages.value
  ]
  
  let response = ''
  await chatStream(messages, {
    intent: 'complex',
    onChunk: (chunk) => { response += chunk }
  })
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      calculatePositions(parsed.tasks)
      phase.value = 'visualization'
    }
  } catch (e) {
    console.warn('Analysis failed', e)
    // Fallback
    calculatePositions([
      { label: '我的回应', reason: '我只能控制自己', score: 9 },
      { label: '他人看法', reason: '无法控制', score: 2 }
    ])
    phase.value = 'visualization'
  }
  
  isThinking.value = false
}

// 布局计算
function calculatePositions(tasks: any[]) {
  const result: BoundaryItem[] = []
  
  // 按分数分组处理，为了分散角度
  tasks.forEach((task: any, i: number) => {
    // 映射 score 到半径
    // Score 10 -> R=0 (但为了显示，设为 40)
    // Score 0 -> R=180
    // r = 180 - (score / 10) * 140
    let r = 180 - (task.score / 10) * 130
    // 增加一点随机扰动避免太整齐
    r += (Math.random() - 0.5) * 20
    
    // 角度均匀分布 + 随机扰动
    // 使用黄金分割角来放置，避免重叠
    const angle = i * 2.4 + (Math.random() - 0.5) * 0.5
    
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    
    // 确定类型
    let type: 'mine' | 'shared' | 'other' = 'other'
    if (task.score >= 8) type = 'mine'
    else if (task.score >= 4) type = 'shared'
    
    // 估算文字宽度 (粗略)
    const textWidth = task.label.length * 14 + 20
    
    result.push({
      label: task.label,
      reason: task.reason,
      score: task.score,
      x,
      y,
      width: textWidth,
      classType: type
    })
  })
  
  allTasks.value = result
}

function showItemDetail(item: BoundaryItem) {
  selectedItem.value = item
}

function completeSession() {
  emit('complete')
}
</script>

<style scoped>
.boundary-mapper {
  width: 100%;
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.phase-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.phase-icon {
  font-size: 28px;
}

.phase-header h3 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

/* 输入阶段 */
.intro-text {
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.user-input-display {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 20px;
  font-style: italic;
}

/* 澄清阶段 */
.clarification-phase {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.chat-message {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  line-height: 1.5;
}

.chat-message.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--bg-primary);
}

.chat-message.assistant {
  align-self: flex-start;
  background: var(--bg-card);
  color: var(--text-primary);
}

/* 轨道视图 */
.vis-phase {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.vis-intro {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.boundary-orbit-container {
  flex: 1;
  width: 100%;
  min-height: 400px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

.orbit-svg {
  width: 100%;
  height: 100%;
  max-width: 500px;
  max-height: 500px;
  user-select: none;
}

.orbit {
  fill: none;
  stroke: var(--border);
  stroke-dasharray: 4 4;
  opacity: 0.5;
}

.orbit-label {
  fill: var(--text-muted);
  font-size: 10px;
  text-anchor: middle;
  opacity: 0.6;
}

.core-sun {
  fill: var(--accent);
  filter: drop-shadow(0 0 10px var(--accent));
}

.core-label {
  fill: var(--bg-primary);
  font-size: 10px;
  font-weight: bold;
  text-anchor: middle;
  pointer-events: none;
}

.connection-line {
  stroke: var(--border);
  stroke-width: 1;
  opacity: 0.3;
}

/* 节点样式 */
.task-node {
  cursor: pointer;
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.task-node:hover {
  transform: scale(1.1);
  z-index: 10;
}

.node-dot {
  fill: var(--bg-card);
  stroke-width: 2px;
}
.node-dot.mine { stroke: var(--accent); fill: var(--accent); }
.node-dot.shared { stroke: #fbbf24; fill: #fbbf24; } /* Amber */
.node-dot.other { stroke: var(--text-muted); fill: var(--text-muted); }

.node-bg {
  fill: var(--bg-card);
  stroke-width: 1px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
  transition: fill 0.2s;
}
.node-bg.mine { stroke: var(--accent); }
.node-bg.shared { stroke: #fbbf24; }
.node-bg.other { stroke: var(--text-muted); opacity: 0.8; }

.task-node:hover .node-bg.mine { fill: var(--accent); }
.task-node:hover .node-bg.shared { fill: #fbbf24; }
.task-node:hover .node-bg.other { fill: var(--text-muted); }

.node-text {
  fill: var(--text-primary);
  font-size: 12px;
  text-anchor: middle;
  transition: fill 0.2s;
}
.task-node:hover .node-text { fill: var(--bg-primary); }

/* 弹窗 */
.item-detail-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.item-detail-card {
  background: var(--bg-card);
  border-radius: 12px;
  width: 90%;
  max-width: 300px;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0,0,0,0.3);
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.card-header { padding: 16px; color: var(--bg-primary); }
.card-header.mine { background: var(--accent); }
.card-header.shared { background: #fbbf24; color: #4b3605; }
.card-header.other { background: var(--text-muted); color: var(--bg-primary); }

.card-header h4 { margin: 0 0 4px 0; font-size: 18px; }
.score-badge { font-size: 12px; opacity: 0.9; background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 4px; }

.detail-reason { padding: 16px; margin: 0; line-height: 1.5; font-size: 14px; color: var(--text-secondary); }
.detail-advice { padding: 0 16px 16px; margin: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); }

.close-btn {
  width: 100%;
  padding: 12px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
}
.close-btn:hover { background: var(--bg-secondary); }

@keyframes popIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.complete-btn {
  width: 100%;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  margin-top: auto;
}
.complete-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
