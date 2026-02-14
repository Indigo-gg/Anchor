<template>
  <div class="radar-chart-container" ref="container">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <!-- 背景网格 -->
      <g class="radar-grid">
        <path
          v-for="level in levels"
          :key="`level-${level}`"
          :d="getPathForLevel(level)"
          fill="none"
          stroke="var(--border)"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <!-- 轴线 -->
        <line
          v-for="(point, index) in axesPoints"
          :key="`axis-${index}`"
          :x1="center"
          :y1="center"
          :x2="point.x"
          :y2="point.y"
          stroke="var(--border)"
          stroke-width="1"
        />
      </g>

      <!-- 数据多边形 -->
      <path
        :d="dataPath"
        fill="var(--accent)"
        fill-opacity="0.2"
        stroke="var(--accent)"
        stroke-width="2"
        class="radar-area"
      />

      <!-- 数据点 -->
      <circle
        v-for="(point, index) in dataPoints"
        :key="`point-${index}`"
        :cx="point.x"
        :cy="point.y"
        r="3"
        fill="var(--accent)"
        stroke="var(--bg-primary)"
        stroke-width="1"
      />

      <!-- 标签 -->
      <text
        v-for="(point, index) in labelPoints"
        :key="`label-${index}`"
        :x="point.x"
        :y="point.y"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="var(--text-secondary)"
        font-size="10"
        class="radar-label"
      >
        {{ data[index].label }}
      </text>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue'

const props = withDefaults(defineProps<{
  data: { label: string; value: number; max?: number }[] // value: 0-max
  size?: number
  max?: number
  levels?: number
}>(), {
  size: 200,
  max: 5,
  levels: 3
})

const { data, size, max, levels } = toRefs(props)

const center = computed(() => size.value / 2)
const radius = computed(() => (size.value / 2) - 30) // 留出标签空间

// 计算角度
const angleSlice = computed(() => (Math.PI * 2) / data.value.length)

// 辅助函数：计算坐标
function getCoordinates(value: number, index: number, maxVal: number) {
  const angle = index * angleSlice.value - Math.PI / 2
  const r = (value / maxVal) * radius.value
  return {
    x: center.value + Math.cos(angle) * r,
    y: center.value + Math.sin(angle) * r
  }
}

// 网格路径
function getPathForLevel(level: number) {
  const levelValue = (max.value / levels.value) * level
  return data.value.map((_, i) => {
    const { x, y } = getCoordinates(levelValue, i, max.value)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ') + 'Z'
}

// 轴线端点
const axesPoints = computed(() => {
  return data.value.map((_, i) => getCoordinates(max.value, i, max.value))
})

// 数据多边形路径
const dataPath = computed(() => {
  if (!data.value.length) return ''
  return data.value.map((d, i) => {
    const val = Math.min(d.value, max.value)
    const { x, y } = getCoordinates(val, i, max.value)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ') + 'Z'
})

// 数据点坐标
const dataPoints = computed(() => {
  return data.value.map((d, i) => {
    const val = Math.min(d.value, max.value)
    return getCoordinates(val, i, max.value)
  })
})

// 标签与数值坐标（比最大值稍微往外一点）
const labelPoints = computed(() => {
  return data.value.map((_d, i) => {
    const angle = i * angleSlice.value - Math.PI / 2
    const r = radius.value + 15
    return {
      x: center.value + Math.cos(angle) * r,
      y: center.value + Math.sin(angle) * r
    }
  })
})
</script>

<style scoped>
.radar-chart-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 10px;
}

.radar-area {
  transition: all 0.5s ease;
}

.radar-label {
  font-family: inherit;
  font-size: 10px;
}
</style>
