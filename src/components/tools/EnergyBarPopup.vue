<template>
  <div 
    class="energy-popup-card"
    @mouseenter="pauseCountdown"
    @mouseleave="resumeCountdown"
  >
    <!-- 顶部极细倒计时进度条 -->
    <div class="countdown-bar-wrapper">
      <div 
        class="countdown-bar" 
        :style="{ width: `${(timeLeft / 15) * 100}%` }"
      ></div>
    </div>

    <!-- 头部温馨引导 -->
    <header class="card-header">
      <div class="header-left">
        <span class="pulse-dot">⚡</span>
        <span class="header-title">这一刻，你的能量如何？</span>
      </div>
      <button class="close-btn" @click="closePopup" title="稍后提醒">×</button>
    </header>

    <!-- 1. 能量等级按钮组 -->
    <div class="level-selector">
      <button
        v-for="level in levels"
        :key="level.value"
        :class="['level-btn', { active: selectedLevel === level.value }]"
        @click="selectedLevel = level.value"
      >
        <span class="btn-emoji">{{ level.emoji }}</span>
        <span class="btn-label">{{ level.label }}</span>
      </button>
    </div>

    <!-- 2. 原因选择与输入 -->
    <div class="reason-section">
      <!-- 快捷标签推荐 -->
      <div class="quick-tags">
        <button
          v-for="tag in quickTags"
          :key="tag.text"
          :class="['tag-btn', { active: selectedTags.includes(tag.text) }]"
          @click="toggleTag(tag.text)"
        >
          {{ tag.emoji }} {{ tag.text }}
        </button>
      </div>

      <!-- 自定义手动输入 -->
      <div class="custom-reason-wrapper">
        <input
          v-model="customReason"
          type="text"
          placeholder="或输入当下的状态原因（可不填，默认无）..."
          class="custom-reason-input"
          @keydown.enter="submit"
        />
      </div>
    </div>

    <!-- 3. 底部正念与动作栏 -->
    <footer class="card-footer">
      <div class="mindfulness-quote" :title="quote">
        💡 <span>{{ quote }}</span>
      </div>
      
      <button 
        class="submit-btn" 
        :disabled="selectedLevel === null"
        @click="submit"
      >
        确认记录
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useEnergyStore } from '@/services/energy'
import quotesData from '@/services/mindful-quotes.json'

const { addRecord } = useEnergyStore()

// 能量级别定义 (配合 Emoji，比之前更柔和精美)
const levels = [
  { value: 4, label: '活力满格', emoji: '🔋✨' },
  { value: 3, label: '状态良好', emoji: '⚡😊' },
  { value: 2, label: '微感疲惫', emoji: '⏳☕' },
  { value: 1, label: '能量低谷', emoji: '🪫🧘' }
]

// 精选的快捷标签
const quickTags = [
  { text: '工作干活', emoji: '💼' },
  { text: '放松休息', emoji: '☕' },
  { text: '学习创作', emoji: '🎨' },
  { text: '纯属摸鱼', emoji: '🐟' },
  { text: '饭后饱腹', emoji: '🍜' },
  { text: '熬夜犯困', emoji: '🥱' }
]

// 交互状态
const selectedLevel = ref<number | null>(null)
const selectedTags = ref<string[]>([])
const customReason = ref('')
const quote = ref('')

// 倒计时状态（15 秒）
const timeLeft = ref(15)
let countdownTimer: NodeJS.Timeout | null = null

// 随机正念语录
function fetchRandomQuote() {
  const index = Math.floor(Math.random() * quotesData.length)
  quote.value = quotesData[index]
}

// 倒计时控制
function startCountdown() {
  stopCountdown()
  timeLeft.value = 15
  countdownTimer = setInterval(() => {
    timeLeft.value--
    if (timeLeft.value <= 0) {
      stopCountdown()
      closePopup()
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function pauseCountdown() {
  stopCountdown()
}

function resumeCountdown() {
  // 如果已经填了或者已经倒计时结束就不重启
  if (timeLeft.value > 0) {
    countdownTimer = setInterval(() => {
      timeLeft.value--
      if (timeLeft.value <= 0) {
        stopCountdown()
        closePopup()
      }
    }, 1000)
  }
}

// 标签交互
function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag)
  if (idx > -1) {
    selectedTags.value.splice(idx, 1)
  } else {
    selectedTags.value.push(tag)
  }
}

// 关闭悬浮条
function closePopup() {
  stopCountdown()
  // @ts-ignore
  window.electronAPI?.energy?.hideEnergyBar?.()
}

// 提交记录
function submit() {
  if (selectedLevel.value === null) return
  
  // 拼接原因
  const tagsStr = selectedTags.value.join('、')
  const customStr = customReason.value.trim()
  
  let finalReason = '无'
  if (tagsStr && customStr) {
    finalReason = `${tagsStr} (${customStr})`
  } else if (tagsStr) {
    finalReason = tagsStr
  } else if (customStr) {
    finalReason = customStr
  }

  // 映射快捷活动类型 (仅映射第一个选中的 tag 便于原本的数据统计)
  let activityType = 'other'
  if (selectedTags.value.includes('工作干活')) activityType = 'working'
  else if (selectedTags.value.includes('学习创作')) activityType = 'creative'
  else if (selectedTags.value.includes('纯属摸鱼')) activityType = 'slacking'
  else if (selectedTags.value.includes('放松休息')) activityType = 'rest'
  else if (selectedTags.value.includes('饭后饱腹')) activityType = 'eating'

  // 添加到 IndexedDB
  addRecord(
    selectedLevel.value as 1 | 2 | 3 | 4,
    finalReason,
    activityType
  )

  closePopup()
}

onMounted(() => {
  fetchRandomQuote()
  startCountdown()

  // 监听主进程的重新开始倒计时信号
  // @ts-ignore
  const unsubscribe = window.electronAPI?.energy?.onStartCountdown?.(() => {
    fetchRandomQuote()
    startCountdown()
    selectedLevel.value = null
    selectedTags.value = []
    customReason.value = ''
  })

  onUnmounted(() => {
    stopCountdown()
    unsubscribe?.()
  })
})
</script>

<style scoped>
/* 悬浮窗整体容器 - 高端毛玻璃/HSL 渐变 */
.energy-popup-card {
  width: 100%;
  height: 100vh; /* 撑满整个悬浮窗口 */
  box-sizing: border-box;
  padding: 16px;
  background: linear-gradient(135deg, hsla(245, 60%, 15%, 0.85), hsla(275, 55%, 12%, 0.9));
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  color: #f1f1f1;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes slide-in {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 顶部细进度条 */
.countdown-bar-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
}

.countdown-bar {
  height: 100%;
  background: linear-gradient(90deg, #bb86fc, #03dac6);
  transition: width 0.1s linear;
}

/* 头部 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-dot {
  font-size: 16px;
  display: inline-block;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(187, 134, 252, 0.5)); }
  50% { transform: scale(1.15); filter: drop-shadow(0 0 8px rgba(187, 134, 252, 0.9)); }
  100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(187, 134, 252, 0.5)); }
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  background: linear-gradient(90deg, #e0e0e0, #ffffff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: #ff4d4f;
}

/* 能量等级选择区 */
.level-selector {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.level-btn {
  flex: 1;
  padding: 10px 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.level-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(187, 134, 252, 0.4);
  transform: translateY(-2px);
}

.level-btn.active {
  background: linear-gradient(135deg, rgba(187, 134, 252, 0.25), rgba(3, 218, 198, 0.15));
  border-color: rgba(187, 134, 252, 0.7);
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(187, 134, 252, 0.25);
  transform: translateY(-2px);
}

.btn-emoji {
  font-size: 20px;
}

.btn-label {
  font-size: 11px;
}

/* 原因推荐与输入 */
.reason-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.quick-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-btn {
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.2);
}

.tag-btn.active {
  background: rgba(3, 218, 198, 0.15);
  border-color: #03dac6;
  color: #03dac6;
  font-weight: 500;
}

.custom-reason-wrapper {
  width: 100%;
}

.custom-reason-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #ffffff;
  font-size: 12px;
  transition: all 0.2s ease;
}

.custom-reason-input:focus {
  outline: none;
  background: rgba(0, 0, 0, 0.35);
  border-color: rgba(187, 134, 252, 0.6);
  box-shadow: 0 0 8px rgba(187, 134, 252, 0.2);
}

/* 底部正念和确认按钮 */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 4px;
}

.mindfulness-quote {
  flex: 1;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.submit-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, #bb86fc, #985eff);
  color: #121212;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 10px rgba(187, 134, 252, 0.3);
}

.submit-btn:hover:not(:disabled) {
  transform: scale(1.03);
  background: linear-gradient(135deg, #c397ff, #a575ff);
  box-shadow: 0 4px 14px rgba(187, 134, 252, 0.45);
}

.submit-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
  box-shadow: none;
}
</style>
