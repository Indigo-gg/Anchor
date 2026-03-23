<template>
  <div class="breathing-container">
    <div v-if="expired" class="expired-card">
      <div class="expired-icon">🌬️</div>
      <p>本次呼吸练习已结束</p>
    </div>
    <template v-else>
      <!-- 中心呼吸圆圈 -->
      <div class="breathing-circle-wrapper">
      <!-- 光晕层 -->
      <div class="breathing-halo" :class="phase"></div>
      
      <!-- 核心圆 -->
      <div class="breathing-core" :class="phase">
        <div class="circle-content">
          <span class="phase-text">{{ phaseText }}</span>
          <span class="timer-text" v-if="isActive">{{ phaseTimer }}</span>
        </div>
      </div>
    </div>
    
    <div v-if="isActive" class="progress-info">
      剩余 {{ formatTime(duration - totalTime) }}
    </div>

      <!-- 控制按钮 -->
      <button class="breathing-btn" @click="toggleBreathing">
        {{ isActive ? '结束练习' : '开始呼吸' }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  pattern?: '4-4-4' | '4-7-8' | 'box'
  duration?: number
  restored?: boolean
}>(), {
  pattern: '4-4-4',
  duration: 120 // 默认120秒
})

const expired = ref(props.restored || false)

const emit = defineEmits<{
  complete: []
}>()

// 呼吸模式配置
const patterns: Record<string, { inhale: number; hold: number; exhale: number }> = {
  '4-4-4': { inhale: 4, hold: 4, exhale: 4 },
  '4-7-8': { inhale: 4, hold: 7, exhale: 8 },
  'box': { inhale: 4, hold: 4, exhale: 4 }
}

const config = computed(() => patterns[props.pattern] || patterns['4-4-4'])

// 状态
const isActive = ref(false)
const phase = ref<'inhale' | 'hold' | 'exhale' | 'ready'>('ready')
const phaseTimer = ref(0)
const totalTime = ref(0)
let intervalId: number | null = null

// 实际持续时间（保底 60s，防止 LLM 传错）
const actualDuration = computed(() => Math.max(props.duration || 60, 60))

// 文字引导
const phaseText = computed(() => {
  if (!isActive.value) return '点击开始'
  switch (phase.value) {
    case 'ready': return '准备...'
    case 'inhale': return '吸气'
    case 'hold': return '保持'
    case 'exhale': return '呼气'
  }
})

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function toggleBreathing() {
  if (isActive.value) {
    stopBreathing()
    handleComplete()
  } else {
    startBreathing()
  }
}

function handleComplete() {
  expired.value = true
  emit('complete')
}

function startBreathing() {
  isActive.value = true
  phase.value = 'inhale' // 直接开始
  phaseTimer.value = config.value.inhale
  totalTime.value = 0

  if (intervalId) clearInterval(intervalId)
  
  intervalId = window.setInterval(() => {
    phaseTimer.value--
    totalTime.value++

    // 检查是否完成
    if (totalTime.value >= actualDuration.value) {
      stopBreathing()
      handleComplete()
      return
    }

    // 切换阶段
    if (phaseTimer.value <= 0) {
      rotatePhase()
    }
  }, 1000)
}

function rotatePhase() {
  if (phase.value === 'inhale') {
    if (config.value.hold > 0) {
      phase.value = 'hold'
      phaseTimer.value = config.value.hold
    } else {
      // 兼容没有 hold 的模式（虽然目前都有）
      phase.value = 'exhale'
      phaseTimer.value = config.value.exhale
    }
  } else if (phase.value === 'hold') {
    phase.value = 'exhale'
    phaseTimer.value = config.value.exhale
  } else if (phase.value === 'exhale') {
    phase.value = 'inhale'
    phaseTimer.value = config.value.inhale
  }
}

function stopBreathing() {
  isActive.value = false
  phase.value = 'ready'
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>

<style scoped>
.breathing-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 30px;
  padding: 40px 20px;
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.breathing-circle-wrapper {
  position: relative;
  width: 240px;
  height: 240px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 光晕层 */
.breathing-halo {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.2;
  filter: blur(20px);
  transform: scale(0.8);
  transition: all 4s ease-in-out;
}

/* 核心圆 */
.breathing-core {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 2px solid var(--accent);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
  transition: all 4s ease-in-out;
}

/* 动画定义 */
.breathing-halo.inhale {
  transform: scale(1.5);
  opacity: 0.4;
}
.breathing-core.inhale {
  transform: scale(1.1);
  background: var(--accent-soft); 
  border-color: var(--accent);
}

.breathing-halo.hold {
  transform: scale(1.5); /* 保持膨胀状态 */
  opacity: 0.4;
}
.breathing-core.hold {
  transform: scale(1.1);
  background: var(--accent-soft);
}

.breathing-halo.exhale {
  transform: scale(0.8);
  opacity: 0.1;
}
.breathing-core.exhale {
  transform: scale(1);
  background: var(--bg-secondary);
}

.circle-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.phase-text {
  font-size: 24px;
  font-weight: 500;
  color: var(--text-primary);
}

.timer-text {
  font-size: 18px;
  color: var(--text-muted);
  font-family: monospace;
}

.progress-info {
  font-size: 14px;
  color: var(--text-secondary);
}

.breathing-btn {
  padding: 12px 32px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.breathing-btn:hover {
  background: var(--bg-secondary);
  border-color: var(--accent);
  color: var(--accent);
}

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
</style>
