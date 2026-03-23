<template>
  <div class="meihua-container">
    <!-- 已过期提示（从历史恢复） -->
    <div v-if="expired" class="expired-card">
      <div class="expired-icon">☸</div>
      <p>此次推演已因页面切换而中断</p>
      <button class="btn-primary complete-btn" @click="handleComplete">收起卷轴</button>
    </div>

    <!-- 纯结果展示模式 (作为 tool_result 恢复时) -->
    <div v-if="props.finalReport" class="chat-area">
      <div class="final-report message ai fade-in">
         <div class="content report-card">
           <h4>【心易照见】</h4>
           <div class="gua-info" v-if="divinationResult">
              <span class="tag">体: {{ divinationResult.tiGua }} ({{ divinationResult.tiElement }})</span>
              <span class="tag">用: {{ divinationResult.yongGua }} ({{ divinationResult.yongElement }})</span>
              <span class="tag relation">{{ divinationResult.relation }}</span>
           </div>
           <div class="report-text" v-html="formatMessage(finalReport)"></div>
         </div>
      </div>
    </div>

    <!-- 正常交互流程 -->
    <template v-else-if="!expired">
    <div class="header">
      <div class="title">
        <span class="icon">☯</span>
        <h3>心易照见 (梅花微卜)</h3>
      </div>
      <button class="close-btn" @click="handleComplete">×</button>
    </div>

    <div class="chat-area" ref="chatScroll">
      <div 
        v-for="(msg, idx) in chatHistory" 
        :key="idx"
        :class="['message', msg.role]"
      >
        <div class="content" v-html="formatMessage(msg.content)"></div>
      </div>
      
      <div v-if="isTyping" class="message ai typing">
        <div class="content">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
      
      <!-- Final Report -->
      <div v-if="finalReport" class="final-report message ai fade-in">
         <div class="content report-card">
           <h4>【心易照见】</h4>
           <div class="gua-info" v-if="divinationResult">
              <span class="tag">体: {{ divinationResult.tiGua }} ({{ divinationResult.tiElement }})</span>
              <span class="tag">用: {{ divinationResult.yongGua }} ({{ divinationResult.yongElement }})</span>
              <span class="tag relation">{{ divinationResult.relation }}</span>
           </div>
           <div class="report-text" v-html="formatMessage(finalReport)"></div>
           <button class="btn-primary complete-btn" @click="handleComplete">收起卷轴，结束照见</button>
         </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useInputBridge } from '@/services/input-bridge'
import { chat } from '@/services/llm'
import { calculateDivination, useMeihuaStore, type MeihuaDivinationResult } from '@/services/meihua'
import { marked } from 'marked'

const props = defineProps<{
  restored?: boolean
  finalReport?: string
  divinationResult?: MeihuaDivinationResult
}>()

const emit = defineEmits<{
  complete: [data?: object]
}>()

const { registerHandler, unregisterHandler } = useInputBridge()
const { addRecord } = useMeihuaStore()

// State
const chatHistory = ref<{role: 'ai'|'user', content: string}[]>([])
const isTyping = ref(false)
const round = ref(1) // 1: Init, 2: Deep div, 3: Final
const chatScroll = ref<HTMLElement | null>(null)
const expired = ref(false)

// Data
const userTrigger = ref('')
const divinationResult = ref<MeihuaDivinationResult | null>(props.divinationResult || null)
const finalReport = ref(props.finalReport || '')

const scrollToBottom = async () => {
  await nextTick()
  if (chatScroll.value) {
    chatScroll.value.scrollTop = chatScroll.value.scrollHeight
  }
}

const addMessage = async (role: 'ai'|'user', content: string) => {
  chatHistory.value.push({ role, content })
  await scrollToBottom()
}

const formatMessage = (text: string) => {
  return marked(text)
}

onMounted(async () => {
  // 纯结果展示模式
  if (props.finalReport) {
    expired.value = false
    return
  }

  // 从历史会话恢复时，显示已中断提示而不是重新开始
  if (props.restored) {
    expired.value = true
    return
  }

  // Take over input
  registerHandler(handleUserInput, "凭直觉输入你注意到的意象...")
  
  // Initial greeting
  isTyping.value = true
  setTimeout(async () => {
    isTyping.value = false
    await addMessage('ai', '静下心来。请深呼吸。<br/><br/>现在环顾你的四周，或者闭上眼睛倾听。告诉我，你第一眼注意到的静物，或者你听到的第一个声音是什么？')
  }, 1000)
})

onUnmounted(() => {
  unregisterHandler()
})

async function handleUserInput(text: string) {
  if (!text.trim() || isTyping.value || finalReport.value) return
  
  await addMessage('user', text)
  isTyping.value = true
  
  try {
    if (round.value === 1) {
      userTrigger.value = text
      await processRound1(text)
    } else if (round.value === 2) {
      await processRound2(text)
    }
  } catch (e) {
    console.error(e)
    isTyping.value = false
    await addMessage('ai', '推演时受了些干扰，不如我们稍后再试。')
  }
}

async function processRound1(input: string) {
  // 1. Extract Keywords using pure string output instead of JSON parsing to avoid complexity/errors
  const extractPrompt = `用户刚才说观察到了：“${input}”。请你从这句话中提炼出两个最核心的“物体/意象”名词。只能输出这两个名词，用逗号分隔，不要任何解释。`
  
  const keywordsStr = await chat([{role: 'system', content: '你是一个意象提取器。'}, {role: 'user', content: extractPrompt}])
  const keywords = keywordsStr.split(/[,，、 ]/).map(s => s.trim()).filter(Boolean)
  
  const kw1 = keywords[0] || '天'
  const kw2 = keywords[1] || '地'
  
  // 2. Calculate divination
  divinationResult.value = calculateDivination(kw1, kw2)
  console.log('[Meihua] 意象:', kw1, kw2, '排盘:', divinationResult.value)
  
  // 3. Generate first probing question
  const prompt = `
  你是一位深谙心理学与《梅花易数》的大师。用户刚才观察到的意象是：“${input}”。
  你在暗中排盘得到了卦象：体卦为【${divinationResult.value.tiGua}（${divinationResult.value.tiElement}）】，用卦为【${divinationResult.value.yongGua}（${divinationResult.value.yongElement}）】。
  体用关系是：${divinationResult.value.relation}。
  
  请结合用户看到的意象，和这个五行生克关系，向用户提出一个温和、有洞察力的心理探问。
  不要直接说出卦名，而是用隐喻。
  字数控制在60字内。
  `
  
  const reply = await chat([{ role: 'user', content: prompt }])
  isTyping.value = false
  await addMessage('ai', reply)
  
  // Next step is deep dive or final
  round.value = 2
  registerHandler(handleUserInput, "继续倾诉你的感受...")
}

async function processRound2(input: string) {
  // This is the final stage where we fetch RAG and show report
  // For now, we will hit the local sqlite for memories. Since we are in renderer, we use IPC.
  unregisterHandler() // We finish chatting
  
  const prompt = `
  你是一位《梅花易数》大师。这是我们刚才的微型对话沙龙总结。
  用户初始观测意象：“${userTrigger.value}”
  你的第一句探问后，用户的深层回答：“${input}”
  
  【内部卦象数据】
  体卦：${divinationResult.value?.tiGua}（代表用户当前状态，五行属${divinationResult.value?.tiElement}）
  用卦：${divinationResult.value?.yongGua}（代表外部客体/事件，五行属${divinationResult.value?.yongElement}）
  体用生克：${divinationResult.value?.relation}。
  
  请你现在“揭晓底牌”，给出一份【心易照见报告】。
  包含以下部分：
  1. 缘起：解释用户刚才看到的意象是如何投射他内心的。
  2. 易象揭秘：正式告诉他这是什么卦，代表什么能量的碰撞（比如金水相生，或者水火交战）。
  3. 万物十应破局：结合他的深层回答，给出一个具体、能落地的生活/行动建议来破除心理内耗。
  
  语气要充满古风禅意、不故弄玄虚但充满洞见。用 Markdown 格式输出。
  
  【极其重要】：这是本次照见的最终报告，结束后工具将关闭。你**绝对不要**在报告中或结尾向用户提出任何问题（如“你觉得呢”、“告诉我…”、“用一个字…”等），也不要暗示用户继续回答或互动。请用肯定、圆满的语气直接结束本次推演，并可附上一句郑重的结语或祝福语。
  `
  
  const report = await chat([{ role: 'user', content: prompt }])
  
  isTyping.value = false
  finalReport.value = report
  await scrollToBottom()
}

function handleComplete() {
  // 1. Save to Dexie
  if (divinationResult.value) {
    addRecord({
      trigger: userTrigger.value,
      input: chatHistory.value[chatHistory.value.length - 1]?.content || '',
      keywords: [], // optional
      divinationResult: divinationResult.value,
      chatHistory: chatHistory.value,
      finalReport: finalReport.value
    })
  }
  
  // 2. Release tool
  unregisterHandler()
  emit('complete', { 
    type: 'meihua_divination', 
    summary: '用户完成了一次梅花易数的情绪觉察与排盘，已得到破局建议。' 
  })
}
</script>

<style scoped>
.meihua-container {
  display: flex;
  flex-direction: column;
  height: 500px;
  background: rgba(26, 26, 26, 0.95);
  border: 1px solid rgba(255, 235, 180, 0.2);
  border-radius: 12px;
  overflow: hidden;
  color: #f0e6d2;
  font-family: 'STKaiti', 'KaiTi', serif;
}

/* 已过期/中断提示卡片 */
.expired-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  padding: 40px;
  text-align: center;
}

.expired-icon {
  font-size: 48px;
  color: rgba(212, 175, 55, 0.5);
}

.expired-card p {
  color: rgba(240, 230, 210, 0.6);
  font-size: 14px;
  letter-spacing: 1px;
  margin: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 235, 180, 0.1);
  background: rgba(0, 0, 0, 0.4);
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title .icon {
  font-size: 20px;
  color: #d4af37;
}

.title h3 {
  margin: 0;
  font-weight: normal;
  font-size: 16px;
  letter-spacing: 2px;
}

.close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 24px;
  cursor: pointer;
  transition: color 0.2s;
}

.close-btn:hover {
  color: white;
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  display: flex;
  gap: 12px;
  max-width: 95%;
}

.message.ai {
  align-self: flex-start;
}

.message.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.final-report {
  max-width: 100%;
  width: 100%;
}

.avatar {
  min-width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #d4af37;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #d4af37;
}

.message.user .content {
  background: rgba(212, 175, 55, 0.15);
  border: 1px solid rgba(212, 175, 55, 0.3);
  color: #fff;
  border-radius: 12px 2px 12px 12px;
}

.message.ai .content {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 2px 12px 12px 12px;
  line-height: 1.6;
}

.content {
  padding: 10px 14px;
  font-size: 14px;
  letter-spacing: 0.5px;
}

.report-card {
  background: linear-gradient(135deg, rgba(30,30,30,0.9), rgba(20,20,20,0.95)) !important;
  border: 1px solid #d4af37 !important;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  padding: 20px;
  width: 100%;
}

.report-card h4 {
  text-align: center;
  margin: 0 0 16px 0;
  color: #d4af37;
  font-size: 18px;
  letter-spacing: 4px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.3);
  padding-bottom: 10px;
}

.gua-info {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 16px;
}

.tag {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.2);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.tag.relation {
  background: rgba(212, 175, 55, 0.2);
  border-color: rgba(212, 175, 55, 0.5);
  color: #ffd700;
}

.complete-btn {
  margin-top: 20px;
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid #d4af37;
  color: #d4af37;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.3s;
  letter-spacing: 2px;
}

.complete-btn:hover {
  background: rgba(212, 175, 55, 0.1);
}

/* Typing animation */
.typing .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing .dot:nth-child(1) { animation-delay: -0.32s; }
.typing .dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.fade-in {
  animation: fadeIn 0.8s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
