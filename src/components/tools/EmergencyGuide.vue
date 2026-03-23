<template>
  <div class="emergency-guide">
    <!-- 已过期提示（从历史恢复） -->
    <div v-if="expired" class="expired-card">
      <div class="expired-icon">🌿</div>
      <p>本次引导练习已结束</p>
    </div>

    <!-- 正常阶段流程 -->
    <template v-else>
      <!-- 阶段一：Grounding 5-4-3-2-1 -->
      <div v-if="phase === 'grounding'" class="grounding-phase">
      <div class="phase-header">
        <span class="phase-icon">🌿</span>
        <h3>让我们先冷静下来</h3>
      </div>
      
      <div class="grounding-prompt">
        <p class="prompt-text">{{ currentPrompt }}</p>
        <p class="prompt-hint" v-if="currentHint">{{ currentHint }}</p>
      </div>
      
      <div class="grounding-progress">
        <div 
          v-for="step in 5" 
          :key="step" 
          :class="['progress-dot', { active: step <= 6 - groundingStep, completed: step < 6 - groundingStep }]"
        >
          {{ 6 - step }}
        </div>
      </div>
    </div>

    <!-- 阶段二：Clarification -->
    <div v-else-if="phase === 'clarification'" class="clarification-phase">
      <div class="phase-header">
        <span class="phase-icon">💭</span>
        <h3>好多了。让我们聊聊</h3>
      </div>
      
      <div class="clarification-chat">
        <div 
          v-for="(msg, idx) in clarificationMessages" 
          :key="idx"
          :class="['chat-message', msg.role]"
        >
          <div class="message-content" v-html="msg.content"></div>
        </div>
        
        <div v-if="isThinking" class="chat-message assistant">
          <div class="thinking-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 阶段三：ACT Reframing -->
    <div v-else-if="phase === 'reframing'" class="reframing-phase">
      <div class="phase-header">
        <span class="phase-icon">✨</span>
        <h3>换个角度看看</h3>
      </div>
      
      <div class="reframe-cards">
        <div 
          v-for="(item, idx) in reframeItems" 
          :key="idx"
          :class="['reframe-card', { visible: idx <= currentReframeIndex, dissolving: item.dissolving }]"
          @click="dissolveCard(idx)"
        >
          <div class="cognition">{{ item.cognition }}</div>
          <div class="reframe">{{ item.reframe }}</div>
          <div class="tap-hint" v-if="idx === currentReframeIndex && !item.dissolving">点击消融</div>
        </div>
      </div>
      
      <button 
        v-if="allDissolving" 
        class="continue-btn"
        @click="goToFeedback"
      >
        继续
      </button>
    </div>

    <!-- 阶段四：Feedback -->
    <div v-else-if="phase === 'feedback'" class="feedback-phase">
      <div class="phase-header">
        <span class="phase-icon">🌸</span>
        <h3>引导结束了</h3>
      </div>
      
      <p class="feedback-prompt">刚才的引导对你有帮助吗？</p>
      
      <div class="feedback-options">
        <button 
          v-for="option in feedbackOptions" 
          :key="option.value"
          :class="['feedback-btn', { selected: selectedFeedback === option.value }]"
          @click="submitFeedback(option.value)"
        >
          <span class="feedback-emoji">{{ option.emoji }}</span>
          <span>{{ option.label }}</span>
        </button>
      </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { chatStream, type Message as LLMMessage } from '@/services/llm'
import { useInputBridge } from '@/services/input-bridge'

const props = defineProps<{
  context?: string
  emotion?: string
  restored?: boolean
}>()

const emit = defineEmits<{
  complete: [feedback: string, sessionData: object]
}>()

// 阶段状态
type Phase = 'grounding' | 'clarification' | 'reframing' | 'feedback'
const phase = ref<Phase>('grounding')

// ========== Grounding 阶段 ==========
const groundingStep = ref(5) // 5-4-3-2-1
const groundingInput = ref('')
const groundingResponses = ref<string[]>([])

const groundingPrompts = [
  { prompt: '环顾你的周围', hint: '打出 5 个你能看到的东西', placeholder: '杯子、电脑、窗户...' },
  { prompt: '感受你的触觉', hint: '打出 4 个你能摸到的质感', placeholder: '凉的、光滑的、柔软的...' },
  { prompt: '倾听周围的声音', hint: '打出 3 个你能听到的声音', placeholder: '风扇、键盘、呼吸...' },
  { prompt: '回忆一下', hint: '打出 2 个你喜欢的气味', placeholder: '咖啡、雨后、花香...' },
  { prompt: '最后一步', hint: '打出 1 个你现在能控制的事情', placeholder: '喝口水、深呼吸...' },
]

const currentPrompt = computed(() => groundingPrompts[5 - groundingStep.value]?.prompt || '')
const currentHint = computed(() => groundingPrompts[5 - groundingStep.value]?.hint || '')
const inputPlaceholder = computed(() => groundingPrompts[5 - groundingStep.value]?.placeholder || '')

function submitGrounding() {
  if (!groundingInput.value.trim()) return
  
  groundingResponses.value.push(groundingInput.value)
  groundingInput.value = ''
  
  if (groundingStep.value > 1) {
    groundingStep.value--
  } else {
    // 完成 grounding，进入 clarification
    phase.value = 'clarification'
    startClarification()
  }
}

// ========== Clarification 阶段 ==========
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
const clarificationMessages = ref<ChatMessage[]>([])
const clarificationInput = ref('')
const isThinking = ref(false)
const clarificationTurns = ref(0)
const maxClarificationTurns = 3

async function startClarification() {
  isThinking.value = true
  
  const systemPrompt = `你是一个温暖的正念引导者。用户刚刚完成了 5-4-3-2-1 着陆练习。
现在你需要：
1. 简短地肯定他们做得很好
2. 温柔地询问是什么让他们感到困扰
3. 保持简短，不要说太多

直接回复，不要用 JSON。回复控制在 2-3 句话。`

  // 把 grounding 阶段的回答作为上下文
  const groundingContext = groundingResponses.value.length > 0
    ? `用户在着陆练习中的回答：${groundingResponses.value.join('；')}`
    : '用户刚完成了着陆练习'

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: groundingContext }
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

async function submitClarification() {
  if (!clarificationInput.value.trim() || isThinking.value) return
  
  const userMessage = clarificationInput.value
  clarificationMessages.value.push({ role: 'user', content: userMessage })
  clarificationInput.value = ''
  clarificationTurns.value++
  
  if (clarificationTurns.value >= maxClarificationTurns) {
    // 达到轮数上限，进行认知分析并进入 reframing
    await analyzeAndReframe()
    return
  }
  
  isThinking.value = true
  
  const systemPrompt = `你是一个温暖的正念引导者。继续倾听用户，并温柔地追问。
目标是帮助用户表达出他们的核心困扰。
保持简短，2-3 句话。不要急于给建议。`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...clarificationMessages.value.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
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

const { registerHandler, unregisterHandler } = useInputBridge()

const expired = ref(props.restored || false)

onMounted(() => {
  if (expired.value) return
  updateGlobalInput()
})

onUnmounted(() => {
  unregisterHandler()
})

function updateGlobalInput() {
  if (phase.value === 'grounding') {
    registerHandler(handleGlobalInput, inputPlaceholder.value)
  } else if (phase.value === 'clarification') {
    registerHandler(handleGlobalInput, '说说你的感受...')
  } else {
    unregisterHandler()
  }
}

watch([phase, inputPlaceholder], () => {
  updateGlobalInput()
})

async function handleGlobalInput(text: string) {
  if (!text.trim()) return
  if (phase.value === 'grounding') {
    groundingInput.value = text
    submitGrounding()
  } else if (phase.value === 'clarification') {
    if (isThinking.value) return
    clarificationInput.value = text
    await submitClarification()
  }
}

// ========== ACT Reframing 阶段 ==========
interface ReframeItem {
  cognition: string
  reframe: string
  dissolving: boolean
}
const reframeItems = ref<ReframeItem[]>([])
const currentReframeIndex = ref(0)

const allDissolving = computed(() => 
  reframeItems.value.length > 0 && 
  reframeItems.value.every(item => item.dissolving)
)

async function analyzeAndReframe() {
  isThinking.value = true
  
  const systemPrompt = `分析用户的对话，识别 1-3 个认知扭曲或痛苦的核心想法。
对每个想法，用 ACT（接纳承诺疗法）的方式进行温柔的重新解读。

返回 JSON 数组：
[
  {
    "cognition": "用户的核心痛苦想法（简短）",
    "reframe": "ACT 式的温柔解读（以'我注意到...'开头）"
  }
]

只返回 JSON，不要其他内容。`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...clarificationMessages.value.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
  ]
  
  let response = ''
  await chatStream(messages, {
    intent: 'complex',
    onChunk: (chunk) => {
      response += chunk
    }
  })
  
  try {
    // 尝试解析 JSON
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      reframeItems.value = parsed.map((item: any) => ({
        cognition: item.cognition,
        reframe: item.reframe,
        dissolving: false
      }))
    }
  } catch (e) {
    // 解析失败，使用默认内容
    reframeItems.value = [{
      cognition: '当前的困难让我感到很痛苦',
      reframe: '我注意到，我正在经历一段困难的时刻。这种感受是真实的，但它不会永远持续。',
      dissolving: false
    }]
  }
  
  isThinking.value = false
  phase.value = 'reframing'
}

function dissolveCard(idx: number) {
  if (idx !== currentReframeIndex.value) return
  
  reframeItems.value[idx].dissolving = true
  
  setTimeout(() => {
    if (currentReframeIndex.value < reframeItems.value.length - 1) {
      currentReframeIndex.value++
    }
  }, 800)
}

function goToFeedback() {
  phase.value = 'feedback'
}

// ========== Feedback 阶段 ==========
const selectedFeedback = ref('')
const feedbackOptions = [
  { value: 'helpful', emoji: '😌', label: '有帮助' },
  { value: 'neutral', emoji: '😐', label: '还好' },
  { value: 'not-helpful', emoji: '😕', label: '没太大感觉' },
]

function submitFeedback(value: string) {
  selectedFeedback.value = value
  
  // 收集会话数据
  const sessionData = {
    type: 'tool_session',
    tool: 'emergency_guide',
    timestamp: new Date().toISOString(),
    phases: {
      grounding: {
        completed: true,
        responses: groundingResponses.value
      },
      clarification: {
        turns: clarificationMessages.value
      },
      reframing: {
        items: reframeItems.value.map(i => ({ cognition: i.cognition, reframe: i.reframe }))
      }
    },
    user_feedback: value
  }
  
  setTimeout(() => {
    emit('complete', value, sessionData)
    expired.value = true
    unregisterHandler()
  }, 500)
}
</script>

<style scoped>
.emergency-guide {
  width: 100%;
  padding: 16px;
}

/* 阶段头部 */
.phase-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
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

/* ========== Grounding 阶段 ========== */
.grounding-phase {
  animation: fadeIn 0.3s ease;
}

.grounding-prompt {
  text-align: center;
  margin-bottom: 24px;
}

.prompt-text {
  font-size: 20px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.prompt-hint {
  font-size: 14px;
  color: var(--accent);
}

.grounding-input {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.grounding-input textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  color: var(--text-primary);
  font-size: 14px;
  resize: none;
}

.grounding-input textarea:focus {
  border-color: var(--accent);
  outline: none;
}

.submit-btn {
  padding: 12px 20px;
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.grounding-progress {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.progress-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 500;
  background: var(--bg-secondary);
  color: var(--text-muted);
  transition: all 0.3s ease;
}

.progress-dot.active {
  background: var(--accent);
  color: var(--bg-primary);
}

.progress-dot.completed {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ========== Clarification 阶段 ========== */
.clarification-phase {
  animation: fadeIn 0.3s ease;
}

.clarification-chat {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.thinking-dots {
  display: flex;
  gap: 4px;
}

.thinking-dots span {
  width: 8px;
  height: 8px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite;
}

.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

.clarification-input {
  display: flex;
  gap: 12px;
}

.clarification-input textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  color: var(--text-primary);
  font-size: 14px;
  resize: none;
}

/* ========== Reframing 阶段 ========== */
.reframing-phase {
  animation: fadeIn 0.3s ease;
}

.reframe-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.reframe-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.5s ease;
  cursor: pointer;
  position: relative;
}

.reframe-card.visible {
  opacity: 1;
  transform: translateY(0);
}

.reframe-card.dissolving {
  opacity: 0;
  transform: scale(0.95);
  filter: blur(4px);
}

.cognition {
  font-size: 18px;
  color: var(--text-primary);
  margin-bottom: 12px;
  font-weight: 500;
}

.reframe {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.tap-hint {
  position: absolute;
  bottom: 8px;
  right: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.continue-btn {
  width: 100%;
  padding: 14px;
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
}

/* ========== Feedback 阶段 ========== */
.feedback-phase {
  animation: fadeIn 0.3s ease;
  text-align: center;
}

.feedback-prompt {
  font-size: 16px;
  color: var(--text-secondary);
  margin-bottom: 24px;
}

.feedback-options {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.feedback-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-size: 14px;
  transition: all 0.2s ease;
}

.feedback-btn:hover {
  border-color: var(--accent);
}

.feedback-btn.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.feedback-emoji {
  font-size: 28px;
}

/* 已过期提示卡片 */
.expired-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  gap: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
}

.expired-icon {
  font-size: 40px;
  opacity: 0.8;
}

.expired-card p {
  color: var(--text-secondary);
  font-size: 15px;
  margin: 0;
}

/* 动画 */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}
</style>
