<template>
  <div class="values-result">
    <div class="result-header">
      <span class="result-icon">🧭</span>
      <h3>价值观画像</h3>
    </div>
    
    <p class="result-intro">基于施瓦茨价值观模型的分析结果</p>
    
    <!-- 施瓦茨环形图 -->
    <div class="schwartz-circle">
      <svg viewBox="-150 -150 300 300" class="circle-svg">
        <!-- 背景圆环 -->
        <circle r="120" cx="0" cy="0" class="bg-circle" />
        <circle r="80" cx="0" cy="0" class="bg-circle inner" />
        <circle r="40" cx="0" cy="0" class="bg-circle core" />
        
        <!-- 维度扇区 -->
        <g v-for="(dim, idx) in displayDimensions" :key="dim.key">
          <path 
            :d="getWedgePath(idx, dim.value)"
            :class="['wedge', getIntensityClass(dim.value)]"
          />
          <text
            :x="getLabelPosition(idx).x"
            :y="getLabelPosition(idx).y"
            class="dimension-label"
            :class="{ active: dim.value > 0 }"
          >
            {{ dim.emoji }} {{ dim.label }}
          </text>
        </g>
        
        <!-- 中心文字 -->
        <text x="0" y="5" class="center-text">我</text>
      </svg>
    </div>
    
    <!-- 维度列表 -->
    <div class="dimension-list">
      <div 
        v-for="dim in sortedDimensions" 
        :key="dim.key"
        class="dimension-item"
        :class="getIntensityClass(dim.value)"
      >
        <span class="dim-emoji">{{ dim.emoji }}</span>
        <span class="dim-label">{{ dim.label }}</span>
        <div class="dim-bar-bg">
          <div class="dim-bar-fill" :style="{ width: (dim.value / 10 * 100) + '%' }"></div>
        </div>
        <span class="dim-value">{{ dim.value.toFixed(1) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SCHWARTZ_DIMENSIONS } from '@/services/values'

const props = defineProps<{
  scores?: Record<string, number>
}>()

// 展示的维度数据
const displayDimensions = computed(() => {
  return SCHWARTZ_DIMENSIONS.map(dim => ({
    key: dim.key,
    label: dim.label,
    emoji: dim.emoji,
    value: props.scores?.[dim.key] || 0
  }))
})

// 按得分排序
const sortedDimensions = computed(() => {
  return [...displayDimensions.value].sort((a, b) => b.value - a.value)
})

// 计算扇形路径
function getWedgePath(index: number, value: number): string {
  const total = 10
  const angle = (2 * Math.PI) / total
  const startAngle = index * angle - Math.PI / 2
  const endAngle = startAngle + angle
  
  const innerR = 40
  const outerR = 40 + (value / 10) * 80
  
  const x1 = Math.cos(startAngle) * innerR
  const y1 = Math.sin(startAngle) * innerR
  const x2 = Math.cos(startAngle) * outerR
  const y2 = Math.sin(startAngle) * outerR
  const x3 = Math.cos(endAngle) * outerR
  const y3 = Math.sin(endAngle) * outerR
  const x4 = Math.cos(endAngle) * innerR
  const y4 = Math.sin(endAngle) * innerR
  
  const largeArc = angle > Math.PI ? 1 : 0
  
  return `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1} ${y1} Z`
}

// 计算标签位置
function getLabelPosition(index: number): { x: number; y: number } {
  const total = 10
  const angle = (index * 2 * Math.PI) / total - Math.PI / 2 + Math.PI / total
  const r = 135
  return {
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r + 4
  }
}

// 根据得分返回强度类名
function getIntensityClass(value: number): string {
  if (value >= 7) return 'high'
  if (value >= 4) return 'medium'
  if (value > 0) return 'low'
  return 'none'
}
</script>

<style scoped>
.values-result {
  width: 100%;
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
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

.result-intro {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.schwartz-circle {
  width: 100%;
  max-width: 320px;
  margin: 0 auto 20px;
}

.circle-svg {
  width: 100%;
  height: auto;
}

.bg-circle {
  fill: none;
  stroke: var(--border);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.3;
}

.wedge {
  fill: var(--accent);
  opacity: 0.1;
  transition: all 0.3s ease;
}

.wedge.high {
  opacity: 0.8;
  fill: var(--accent);
}

.wedge.medium {
  opacity: 0.5;
  fill: #a78bfa;
}

.wedge.low {
  opacity: 0.25;
  fill: #c4b5fd;
}

.dimension-label {
  font-size: 8px;
  text-anchor: middle;
  fill: var(--text-muted);
}

.dimension-label.active {
  fill: var(--text-primary);
  font-weight: 500;
}

.center-text {
  font-size: 14px;
  text-anchor: middle;
  fill: var(--accent);
  font-weight: bold;
}

.dimension-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dimension-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border-left: 3px solid transparent;
}

.dimension-item.high {
  border-left-color: var(--accent);
}

.dimension-item.medium {
  border-left-color: #a78bfa;
}

.dimension-item.low {
  border-left-color: #c4b5fd;
}

.dim-emoji {
  font-size: 16px;
}

.dim-label {
  font-size: 13px;
  color: var(--text-primary);
  width: 40px;
}

.dim-bar-bg {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.dim-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #a78bfa);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.dim-value {
  font-size: 12px;
  color: var(--text-muted);
  width: 28px;
  text-align: right;
}
</style>
