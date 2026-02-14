<template>
  <div class="boundary-result">
    <div class="result-header">
      <span class="result-icon">🎯</span>
      <h3>课题分离结果</h3>
    </div>
    
    <p class="result-intro">距离核心越近，代表你的掌控力越强。</p>
    
    <div class="boundary-orbit-container">
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
          v-for="(item, idx) in computedTasks" 
          :key="'line-'+idx"
          x1="0" y1="0"
          :x2="item.x" :y2="item.y"
          class="connection-line"
          :class="{ mine: item.score >= 7, other: item.score < 4 }"
        />

        <!-- 节点 -->
        <g 
          v-for="(item, idx) in computedTasks" 
          :key="'node-'+idx"
          :transform="`translate(${item.x}, ${item.y})`"
          class="task-node"
          @click="selectedItem = item"
        >
          <circle r="4" class="node-dot" :class="item.classType" cx="0" cy="0" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface TaskItem {
  label: string
  reason: string
  score: number
}

interface ComputedTask extends TaskItem {
  x: number
  y: number
  width: number
  classType: 'mine' | 'shared' | 'other'
}

const props = defineProps<{
  analysis?: {
    tasks: TaskItem[]
  }
}>()

const selectedItem = ref<ComputedTask | null>(null)

const computedTasks = computed<ComputedTask[]>(() => {
  const tasks = props.analysis?.tasks || []
  return tasks.map((task, i) => {
    // 使用索引生成稳定的伪随机偏移（避免重复渲染时闪烁）
    const pseudoRandom = (seed: number) => ((seed * 9301 + 49297) % 233280) / 233280 - 0.5
    
    // 映射 score 到半径
    let r = 180 - (task.score / 10) * 130
    r += pseudoRandom(i * 17) * 20  // 稳定的随机偏移
    
    // 角度均匀分布
    const angle = i * 2.4 + pseudoRandom(i * 31) * 0.5  // 稳定的随机偏移
    
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    
    // 确定类型
    let classType: 'mine' | 'shared' | 'other' = 'other'
    if (task.score >= 8) classType = 'mine'
    else if (task.score >= 4) classType = 'shared'
    
    const textWidth = task.label.length * 14 + 20
    
    return { ...task, x, y, width: textWidth, classType }
  })
})
</script>

<style scoped>
.boundary-result {
  width: 100%;
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
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

.boundary-orbit-container {
  width: 100%;
  min-height: 350px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.orbit-svg {
  width: 100%;
  height: 100%;
  max-width: 400px;
  max-height: 400px;
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

.task-node {
  cursor: pointer;
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.task-node:hover {
  transform: scale(1.1);
}

.node-dot {
  fill: var(--bg-card);
  stroke-width: 2px;
}
.node-dot.mine { stroke: var(--accent); fill: var(--accent); }
.node-dot.shared { stroke: #fbbf24; fill: #fbbf24; }
.node-dot.other { stroke: var(--text-muted); fill: var(--text-muted); }

.node-bg {
  fill: var(--bg-card);
  stroke-width: 1px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
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
}
.task-node:hover .node-text { fill: var(--bg-primary); }

/* 弹窗 */
.item-detail-overlay {
  position: fixed;
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

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
