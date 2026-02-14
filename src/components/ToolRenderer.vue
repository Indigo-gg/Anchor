<template>
  <div class="tool-container">
    <!-- 呼吸引导 -->
    <BreathingGuide 
      v-if="tool === 'breathing_guide'" 
      v-bind="params as any" 
      @complete="$emit('complete')"
    />
    
    <!-- 急救引导器 -->
    <EmergencyGuide
      v-else-if="tool === 'emergency_guide'"
      v-bind="params as any"
      @complete="handleEmergencyComplete"
    />
    
    <!-- 能量检测 - 结果模式 -->
    <EnergyResult
      v-else-if="tool === 'energy_audit' && params?.energy"
      :energy="params.energy as any"
    />
    
    <!-- 能量检测 - 完整模式（兼容） -->
    <EnergyAudit
      v-else-if="tool === 'energy_audit'"
      @complete="$emit('complete')"
    />
    
    <!-- 价值观 - Quiz 卡片模式 -->
    <ValuesQuiz
      v-else-if="tool === 'values_compass' && params?.mode === 'quiz'"
      :context="(params.context as string) || ''"
      :session-id="quizSessionId"
      @complete="handleQuizComplete"
    />
    
    <!-- 价值观 - 结果模式 -->
    <ValuesResult
      v-else-if="tool === 'values_compass' && params?.scores"
      :scores="params.scores as any"
    />
    
    <!-- 价值观 - 完整模式（兼容） -->
    <ValuesCompass
      v-else-if="tool === 'values_compass'"
      @complete="$emit('complete')"
    />
    
    <!-- 边界可视化 - 结果模式 -->
    <BoundaryResult
      v-else-if="tool === 'boundary_mapper' && params?.analysis"
      :analysis="params.analysis as any"
    />
    
    <!-- 边界可视化 - 完整模式（兼容） -->
    <BoundaryMapper
      v-else-if="tool === 'boundary_mapper'"
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
import { ref, watch } from 'vue'
import BreathingGuide from './tools/BreathingGuide.vue'
import EmergencyGuide from './tools/EmergencyGuide.vue'
import EnergyAudit from './tools/EnergyAudit.vue'
import EnergyResult from './tools/EnergyResult.vue'
import ValuesCompass from './tools/ValuesCompass.vue'
import ValuesQuiz from './tools/ValuesQuiz.vue'
import ValuesResult from './tools/ValuesResult.vue'
import BoundaryMapper from './tools/BoundaryMapper.vue'
import BoundaryResult from './tools/BoundaryResult.vue'
import { useValuesStore } from '@/services/values'

const props = defineProps<{
  tool: string
  params?: Record<string, unknown>
}>()

const emit = defineEmits<{
  complete: [data?: object]
}>()

// 创建 values quiz 会话
const { addSession } = useValuesStore()
const quizSessionId = ref('')

// 当进入 quiz 模式时创建会话
watch(() => [props.tool, props.params?.mode], () => {
  if (props.tool === 'values_compass' && props.params?.mode === 'quiz') {
    const context = (props.params.context as string) || ''
    const session = addSession(context)
    quizSessionId.value = session.id
    console.log('[ToolRenderer] 创建 quiz 会话:', session.id)
  }
}, { immediate: true })

function handleEmergencyComplete(feedback: string, sessionData: object) {
  console.log('[EmergencyGuide] Complete:', feedback, sessionData)
  emit('complete', sessionData)
}

function handleQuizComplete(scores: Record<string, number>) {
  console.log('[ValuesQuiz] Complete:', scores)
  emit('complete', { scores })
}
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
