<template>
  <div class="energy-result">
    <div class="result-header">
      <span class="result-icon">⚡</span>
      <h3>能量状态分析</h3>
    </div>
    
    <!-- 三维能量条 -->
    <div class="energy-bars">
      <div class="energy-item">
        <div class="energy-label">
          <span class="energy-emoji">💪</span>
          <span>身体能量</span>
        </div>
        <div class="energy-bar">
          <div class="energy-fill" :style="{ width: (body / 10 * 100) + '%' }"></div>
        </div>
        <span class="energy-value">{{ body }}/10</span>
      </div>
      
      <div class="energy-item">
        <div class="energy-label">
          <span class="energy-emoji">💭</span>
          <span>情绪能量</span>
        </div>
        <div class="energy-bar">
          <div class="energy-fill emotion" :style="{ width: (emotion / 10 * 100) + '%' }"></div>
        </div>
        <span class="energy-value">{{ emotion }}/10</span>
      </div>
      
      <div class="energy-item">
        <div class="energy-label">
          <span class="energy-emoji">🎯</span>
          <span>动力能量</span>
        </div>
        <div class="energy-bar">
          <div class="energy-fill motivation" :style="{ width: (motivation / 10 * 100) + '%' }"></div>
        </div>
        <span class="energy-value">{{ motivation }}/10</span>
      </div>
    </div>
    
    <!-- 总体评分 -->
    <div class="overall-score">
      <div class="score-circle" :class="overallLevel">
        <span class="score-value">{{ overall }}</span>
      </div>
      <div class="score-text">
        <span class="score-label">综合能量</span>
        <span class="score-desc">{{ levelDescription }}</span>
      </div>
    </div>
    
    <p class="result-summary" v-if="summary">{{ summary }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  energy?: {
    body: number
    emotion: number
    motivation: number
    summary?: string
  }
}>()

const body = computed(() => props.energy?.body || 5)
const emotion = computed(() => props.energy?.emotion || 5)
const motivation = computed(() => props.energy?.motivation || 5)
const summary = computed(() => props.energy?.summary || '')

const overall = computed(() => {
  return Math.round((body.value + emotion.value + motivation.value) / 3)
})

const overallLevel = computed(() => {
  if (overall.value >= 7) return 'high'
  if (overall.value >= 4) return 'medium'
  return 'low'
})

const levelDescription = computed(() => {
  if (overall.value >= 8) return '状态很棒！'
  if (overall.value >= 6) return '状态良好'
  if (overall.value >= 4) return '需要休息'
  return '需要照顾自己'
})
</script>

<style scoped>
.energy-result {
  width: 100%;
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.result-icon {
  font-size: 24px;
}

.result-header h3 {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.energy-bars {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.energy-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.energy-label {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 90px;
  font-size: 13px;
  color: var(--text-secondary);
}

.energy-emoji {
  font-size: 16px;
}

.energy-bar {
  flex: 1;
  height: 10px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.energy-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.energy-fill.emotion {
  background: #f472b6;
}

.energy-fill.motivation {
  background: #fbbf24;
}

.energy-value {
  width: 40px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: right;
}

.overall-score {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.score-circle {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 600;
  color: white;
}

.score-circle.high { background: linear-gradient(135deg, #10b981, #34d399); }
.score-circle.medium { background: linear-gradient(135deg, #f59e0b, #fbbf24); }
.score-circle.low { background: linear-gradient(135deg, #ef4444, #f87171); }

.score-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.score-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.score-desc {
  font-size: 13px;
  color: var(--text-muted);
}

.result-summary {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  text-align: center;
}
</style>
