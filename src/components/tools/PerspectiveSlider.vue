<template>
  <div class="slider-container">
    <!-- 当前视角文本 -->
    <div class="perspective-text" :style="{ background: bgGradient }">
      <p class="perspective-content">{{ currentPerspective }}</p>
    </div>

    <!-- 时间滑块 -->
    <div class="slider-track">
      <input
        type="range"
        v-model="currentIndex"
        :min="0"
        :max="timeScale.length - 1"
        step="1"
        class="slider-input"
      />
      <div class="slider-labels">
        <span
          v-for="(point, index) in timeScale"
          :key="index"
          :class="['label', { active: index === currentIndex }]"
        >
          {{ point.label }}
        </span>
      </div>
    </div>

    <!-- 完成按钮 -->
    <button class="done-btn" @click="$emit('complete')">
      我感觉好一点了
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface TimePoint {
  label: string
  perspective: string
}

const props = withDefaults(defineProps<{
  context?: string
  timeScale?: TimePoint[]
}>(), {
  context: '',
  timeScale: () => [
    { label: '现在', perspective: '当下的压力感觉很真实' },
    { label: '1周后', perspective: '这件事可能已经过去了' },
    { label: '1年后', perspective: '你可能已经忘记了具体的焦虑感' }
  ]
})

const emit = defineEmits<{
  complete: []
}>()

const currentIndex = ref(0)

const currentPerspective = computed(() => {
  return props.timeScale[currentIndex.value]?.perspective || ''
})

// 背景渐变：从红色（现在）到蓝色（未来）
const bgGradient = computed(() => {
  const progress = currentIndex.value / Math.max(props.timeScale.length - 1, 1)
  // 红色 -> 紫色 -> 蓝色
  const hue = 0 + progress * 220 // 0 = red, 220 = blue
  const saturation = 60 - progress * 20 // 逐渐柔和
  const lightness = 20 + progress * 5
  return `linear-gradient(135deg, 
    hsl(${hue}, ${saturation}%, ${lightness}%), 
    hsl(${hue + 30}, ${saturation - 10}%, ${lightness - 5}%))`
})
</script>

<style scoped>
.slider-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

/* 视角文本区域 */
.perspective-text {
  padding: 32px 24px;
  border-radius: var(--radius-lg);
  transition: background 0.5s ease;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.perspective-content {
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  text-align: center;
  opacity: 0.95;
}

/* 滑块轨道 */
.slider-track {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slider-input {
  width: 100%;
  height: 8px;
  -webkit-appearance: none;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  outline: none;
  cursor: pointer;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
  background: var(--accent);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: var(--shadow-glow);
  transition: transform 0.15s ease;
}

.slider-input::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

/* 标签 */
.slider-labels {
  display: flex;
  justify-content: space-between;
  padding: 0 4px;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.label.active {
  color: var(--accent);
  font-weight: 500;
}

/* 完成按钮 */
.done-btn {
  align-self: center;
  padding: 10px 20px;
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  font-size: 13px;
  border: 1px solid var(--border);
}

.done-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
</style>
