<template>
  <div class="energy-audit">
    <div class="audit-header">
      <span class="audit-icon">⚡</span>
      <h3>现在能量如何？</h3>
    </div>

    <!-- 能量等级选择 -->
    <div class="energy-levels">
      <button
        v-for="level in ENERGY_LEVELS"
        :key="level.value"
        :class="['level-btn', { selected: selectedLevel === level.value }]"
        @click="selectedLevel = level.value"
      >
        <span class="level-emoji">{{ level.emoji }}</span>
        <span class="level-label">{{ level.label }}</span>
      </button>
    </div>

    <!-- 活动类型 -->
    <div class="activity-section">
      <p class="section-label">在做什么？</p>
      
      <div class="activity-types">
        <button
          v-for="type in ACTIVITY_TYPES"
          :key="type.value"
          :class="['type-btn', { selected: selectedType === type.value }]"
          @click="selectType(type.value)"
        >
          <span>{{ type.emoji }}</span>
          <span>{{ type.label }}</span>
        </button>
      </div>

      <!-- 自定义输入 -->
      <input
        v-model="customActivity"
        type="text"
        placeholder="或输入其他活动..."
        class="custom-input"
      />
    </div>

    <!-- 提交按钮 -->
    <button 
      class="submit-btn" 
      @click="submitRecord"
      :disabled="!canSubmit"
    >
      记录
    </button>

    <!-- 今日统计 -->
    <div class="today-stats" v-if="todayRecords.length > 0">
      <p class="stats-label">今日已记录 {{ todayRecords.length }} 次</p>
      <div class="stats-bar">
        <div 
          class="stats-fill" 
          :style="{ width: (getAverageLevel(todayRecords) / 4 * 100) + '%' }"
        ></div>
      </div>
      <p class="stats-avg">平均能量: {{ getAverageLevel(todayRecords).toFixed(1) }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEnergyStore, ENERGY_LEVELS, ACTIVITY_TYPES } from '@/services/energy'

const emit = defineEmits<{
  complete: []
}>()

const { 
  todayRecords, 
  addRecord, 
  getAverageLevel 
} = useEnergyStore()

// 选择状态
const selectedLevel = ref<number | null>(null)
const selectedType = ref<string | null>(null)
const customActivity = ref('')

const canSubmit = computed(() => {
  return selectedLevel.value !== null
})

function selectType(type: string) {
  if (selectedType.value === type) {
    selectedType.value = null
  } else {
    selectedType.value = type
  }
}

function submitRecord() {
  if (!selectedLevel.value) return
  
  const activity = customActivity.value.trim() || 
    ACTIVITY_TYPES.find(t => t.value === selectedType.value)?.label || 
    ''
  
  addRecord(
    selectedLevel.value as 1 | 2 | 3 | 4,
    activity,
    selectedType.value || undefined
  )
  
  // 重置状态
  selectedLevel.value = null
  selectedType.value = null
  customActivity.value = ''
  
  emit('complete')
}
</script>

<style scoped>
.energy-audit {
  width: 100%;
  padding: 16px;
}

.audit-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.audit-icon {
  font-size: 24px;
}

.audit-header h3 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

/* 能量等级 */
.energy-levels {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.level-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
}

.level-btn:hover {
  border-color: var(--accent);
}

.level-btn.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.level-emoji {
  font-size: 20px;
}

.level-label {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 活动类型 */
.activity-section {
  margin-bottom: 20px;
}

.section-label {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.activity-types {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.type-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.2s ease;
}

.type-btn:hover {
  border-color: var(--accent);
}

.type-btn.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.custom-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
}

.custom-input:focus {
  border-color: var(--accent);
  outline: none;
}

/* 提交按钮 */
.submit-btn {
  width: 100%;
  padding: 14px;
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 20px;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 今日统计 */
.today-stats {
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
}

.stats-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stats-bar {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: 8px;
}

.stats-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.stats-avg {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
