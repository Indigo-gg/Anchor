<template>
  <div class="tool-container">
    <!-- 呼吸引导 -->
    <BreathingGuide 
      v-if="tool === 'breathing_guide'" 
      v-bind="params as any" 
      @complete="$emit('complete')"
    />
    
    <!-- 时间尺度拉杆 -->
    <PerspectiveSlider
      v-else-if="tool === 'perspective_slider'"
      v-bind="params as any"
      @complete="$emit('complete')"
    />
    
    <!-- 未实现的工具占位 -->
    <div v-else class="tool-placeholder">
      <span class="tool-icon">🔧</span>
      <span>{{ tool }} 工具加载中...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import BreathingGuide from './tools/BreathingGuide.vue'
import PerspectiveSlider from './tools/PerspectiveSlider.vue'

defineProps<{
  tool: string
  params?: Record<string, unknown>
}>()

defineEmits<{
  complete: []
}>()
</script>

<style scoped>
.tool-container {
  width: 100%;
}

.tool-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 13px;
}

.tool-icon {
  font-size: 16px;
}
</style>
