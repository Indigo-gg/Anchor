<template>
  <div class="breathing-container">
    <!-- 呼吸圆圈 -->
    <div class="breathing-circle" :class="phase">
      <div class="inner-circle"></div>
    </div>

    <!-- 引导文字 -->
    <div class="breathing-text">{{ phaseText }}</div>

    <!-- 进度 -->
    <div class="breathing-progress">
      <div class="progress-bar" :style="{ width: progressPercent + '%' }"></div>
    </div>

    <!-- 控制按钮 -->
    <button class="breathing-btn" @click="toggleBreathing">
      {{ isActive ? '结束' : '开始呼吸' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  pattern?: '4-4-4' | '4-7-8' | 'box'
  duration?: number
}>(), {
  pattern: '4-4-4',
  duration: 120 // 默认2分钟
})

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
const phase = ref<'inhale' | 'hold' | 'exhale'>('inhale')
const phaseTimer = ref(0)
const totalTime = ref(0)
let intervalId: number | null = null

const phaseText = computed(() => {
  if (!isActive.value) return '准备好了吗？'
  switch (phase.value) {
    case 'inhale': return '吸气...'
    case 'hold': return '保持...'
    case 'exhale': return '呼气...'
  }
})

const progressPercent = computed(() => {
  if (!isActive.value) return 0
  return Math.min((totalTime.value / props.duration) * 100, 100)
})

function toggleBreathing() {
  if (isActive.value) {
    stopBreathing()
    emit('complete')
  } else {
    startBreathing()
  }
}

function startBreathing() {
  isActive.value = true
  phase.value = 'inhale'
  phaseTimer.value = 0
  totalTime.value = 0

  intervalId = window.setInterval(() => {
    phaseTimer.value++
    totalTime.value++

    // 检查是否完成
    if (totalTime.value >= props.duration) {
      stopBreathing()
      emit('complete')
      return
    }

    // 切换阶段
    if (phase.value === 'inhale' && phaseTimer.value >= config.value.inhale) {
      phase.value = 'hold'
      phaseTimer.value = 0
    } else if (phase.value === 'hold' && phaseTimer.value >= config.value.hold) {
      phase.value = 'exhale'
      phaseTimer.value = 0
    } else if (phase.value === 'exhale' && phaseTimer.value >= config.value.exhale) {
      phase.value = 'inhale'
      phaseTimer.value = 0
    }
  }, 1000)
}

function stopBreathing() {
  isActive.value = false
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
  gap: 24px;
  padding: 24px 16px;
  width: 100%;
}

/* 呼吸圆圈 */
.breathing-circle {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: var(--accent-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 4s ease-in-out;
}

.breathing-circle.inhale {
  transform: scale(1.2);
}

.breathing-circle.hold {
  transform: scale(1.2);
}

.breathing-circle.exhale {
  transform: scale(0.8);
}

.inner-circle {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: var(--shadow-glow);
}

/* 引导文字 */
.breathing-text {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  min-height: 28px;
}

/* 进度条 */
.breathing-progress {
  width: 100%;
  height: 4px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 1s linear;
}

/* 控制按钮 */
.breathing-btn {
  padding: 12px 24px;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-full);
  font-size: 14px;
  border: 1px solid var(--border);
}

.breathing-btn:hover {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
</style>
