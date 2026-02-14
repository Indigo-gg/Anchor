<template>
  <Transition name="drawer">
    <div v-if="isOpen" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-container">
        <!-- 头部 -->
        <header class="drawer-header">
          <button class="back-btn" @click="$emit('close')">
            <span>←</span>
          </button>
          
          <div class="header-tabs">
            <button 
              :class="['tab-btn', { active: activeTab === 'dashboard' }]"
              @click="activeTab = 'dashboard'"
            >
              概览
            </button>
            <button 
              :class="['tab-btn', { active: activeTab === 'history' }]"
              @click="activeTab = 'history'"
            >
              历史
            </button>
          </div>
        </header>

        <!-- 内容 -->
        <div class="drawer-content">
          
          <!-- Dasboard 面板 -->
          <div v-if="activeTab === 'dashboard'" class="dashboard-panel">
            
            <!-- 能量状态 -->
            <section class="card">
              <h3 class="card-title">⚡ 能量周报</h3>
              <div class="energy-stat">
                <div class="stat-number">{{ avgEnergy.toFixed(1) }}</div>
                <div class="stat-label">本周平均能量 / 4.0</div>
              </div>
              
              <div class="energy-chart">
                <div 
                  v-for="item in energyChartData" 
                  :key="item.hour"
                  class="chart-bar-wrapper"
                >
                  <div 
                    class="chart-bar" 
                    :style="{ height: (item.level / 4 * 100) + '%', opacity: item.hasData ? 1 : 0.1 }"
                  ></div>
                  <span class="chart-label" v-if="item.hour % 3 === 0">{{ item.hour }}</span>
                </div>
              </div>
            </section>

            <!-- 价值观画像 -->
            <section class="card">
              <h3 class="card-title">🧭 核心价值观</h3>
              
              <div v-if="sortedValues.some(v => v.value > 0)" class="radar-content">
                <RadarChart 
                  :data="radarChartData" 
                  :max="5" 
                  :size="200"
                />
                
                <!-- 列表展示 Top 3 -->
                <div class="values-list-mini">
                   <div 
                    v-for="(item, idx) in sortedValues.slice(0, 3)" 
                    :key="item.key"
                    class="value-item-row"
                  >
                    <span class="value-rank">{{ idx + 1 }}</span>
                    <span class="value-name">{{ item.dimension }}</span>
                    <div class="value-bar-bg">
                      <div class="value-bar-fill" :style="{ width: (item.value / 5 * 100) + '%' }"></div>
                    </div>
                    <span class="value-score">{{ item.value.toFixed(1) }}</span>
                  </div>
                </div>
              </div>
              
              <div v-else class="empty-data">
                暂无数据，试着使用"价值观雷达"工具
              </div>
            </section>

            <!-- 边界练习 -->
            <section class="card">
              <h3 class="card-title">🛡️ 边界练习</h3>
              <div class="coming-soon sm">
                 记录功能开发中...
              </div>
            </section>

            <!-- 记忆 -->
            <section class="card">
              <h3 class="card-title">
                🧠 我对你的了解
                <button 
                  v-if="allMemories.length > 0"
                  class="clear-btn" 
                  @click="handleClearMemories"
                  title="清空所有记忆"
                >
                  🗑️
                </button>
              </h3>
              
              <div v-if="allMemories.length === 0" class="empty-data">
                还没有记忆，聊聊天后我会记住重要的事
              </div>
              
              <div v-else class="memory-list">
                <div 
                  v-for="memory in allMemories.slice(0, 5)" 
                  :key="memory.id"
                  class="memory-item"
                >
                  <span class="memory-type" :class="memory.type">
                    {{ memoryTypeLabel(memory.type) }}
                  </span>
                  <span class="memory-content">{{ memory.content }}</span>
                  <button 
                    class="memory-delete" 
                    @click="handleDeleteMemory(memory.id)"
                    title="删除"
                  >×</button>
                </div>
              </div>
            </section>

          </div>

          <!-- 历史会话面板 -->
          <div v-else-if="activeTab === 'history'" class="history-panel">
            <section class="section">
              <div v-if="sessions.length === 0" class="empty-state">
                暂无历史会话
              </div>
              
              <div v-else class="session-list">
                <div
                  v-for="session in sessions"
                  :key="session.id"
                  class="session-item"
                  @click="viewSession(session)"
                >
                  <div class="session-info">
                    <span class="session-time">{{ formatTime(session.startTime) }}</span>
                    <span class="session-count">{{ session.messages.length }} 条消息</span>
                  </div>
                  <div class="session-summary">{{ session.summary || '空会话' }}</div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <!-- 会话详情弹窗 -->
        <Transition name="modal">
          <div v-if="selectedSession" class="modal-overlay" @click.self="selectedSession = null">
            <div class="modal-container">
              <header class="modal-header">
                <h3>{{ formatTime(selectedSession.startTime) }}</h3>
                <button class="close-btn" @click="selectedSession = null">×</button>
              </header>
              <div class="modal-content">
                <div
                  v-for="(msg, index) in selectedSession.messages"
                  :key="index"
                  :class="['history-message', msg.role]"
                >
                  <span class="msg-role">{{ msg.role === 'user' ? '你' : 'Anchor' }}</span>
                  <span class="msg-content">{{ msg.content || `[${msg.tool}]` }}</span>
                </div>
                
                <!-- Agent 思考记录 -->
                <details v-if="selectedSession.thoughts.length > 0" class="thoughts-section">
                  <summary>Agent 思考记录 ({{ selectedSession.thoughts.length }})</summary>
                  <div
                    v-for="(t, index) in selectedSession.thoughts"
                    :key="index"
                    class="thought-item"
                  >
                    <span class="thought-time">{{ formatTime(t.timestamp) }}</span>
                    <p class="thought-text">{{ t.thought }}</p>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSessionStore, formatTime, type Session } from '@/services/session'
import { useEnergyStore } from '@/services/energy'
import { useValuesStore } from '@/services/values'
import RadarChart from '@/components/visualization/RadarChart.vue'

defineProps<{
  isOpen: boolean
}>()

defineEmits<{
  close: []
}>()

const { sessions } = useSessionStore()
const { weekRecords: energyWeekRecords, getHourlyStats, getAverageLevel } = useEnergyStore()
const { radarData } = useValuesStore()

// 选中的 Tab
const activeTab = ref<'history' | 'dashboard'>('dashboard')

const selectedSession = ref<Session | null>(null)

function viewSession(session: Session) {
  selectedSession.value = session
}

// 能量统计
const avgEnergy = computed(() => getAverageLevel(energyWeekRecords.value))
const energyChartData = computed(() => {
  const stats = getHourlyStats(energyWeekRecords.value)
  // 补全 9-23 点的数据
  const hours = []
  for (let i = 9; i <= 23; i++) {
    const found = stats.find(s => s.hour === i)
    hours.push({
      hour: i,
      level: found ? found.avgLevel : 0,
      hasData: !!found
    })
  }
  return hours
})

// 价值观雷达
const radarChartData = computed(() => {
  // 转换数据格式以适配 RadarChart
  return radarData.value.map(d => ({
    label: d.dimension,
    value: d.value,
    max: 5
  }))
})

const sortedValues = computed(() => {
  return [...radarData.value].sort((a, b) => b.value - a.value)
})

// ============ 记忆 ============
import { useMemoryStore, type MemoryType } from '@/services/memory'

const { getAllMemories, deleteMemory, clearAllMemories } = useMemoryStore()

const allMemories = computed(() => getAllMemories())

function memoryTypeLabel(type: MemoryType): string {
  const labels: Record<MemoryType, string> = {
    profile: '画像',
    pattern: '模式',
    episode: '事件'
  }
  return labels[type] || type
}

function handleDeleteMemory(id: string) {
  deleteMemory(id)
}

function handleClearMemories() {
  if (confirm('确定要清空所有记忆吗？这将无法恢复。')) {
    clearAllMemories()
  }
}
</script>

<style scoped>
/* 抽屉动画 */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-active .drawer-container,
.drawer-leave-active .drawer-container {
  transition: transform 0.25s ease;
}

.drawer-enter-from .drawer-container,
.drawer-leave-to .drawer-container {
  transform: translateX(100%);
}

/* 遮罩层 */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: flex-end;
  z-index: 100;
}

/* 抽屉容器 */
.drawer-container {
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 头部 */
.drawer-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 18px;
}

.back-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.drawer-header h2 {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

/* 内容 */
.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.section {
  margin-bottom: 24px;
}

/* 头部 Tabs */
.header-tabs {
  flex: 1;
  display: flex;
  justify-content: center;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.tab-btn {
  padding: 6px 16px;
  background: transparent;
  border-radius: var(--radius-full);
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 500;
}

/* Dashboard 卡片 */
.dashboard-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

/* 能量图表 */
.energy-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 16px;
}

.stat-number {
  font-size: 32px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.energy-chart {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  height: 80px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.chart-bar-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
  width: 12px;
  position: relative;
}

.chart-bar {
  width: 6px;
  background: var(--accent);
  border-radius: 4px;
  min-height: 2px;
}

.chart-label {
  position: absolute;
  bottom: -20px;
  font-size: 10px;
  color: var(--text-muted);
}

/* 价值观列表 */
.radar-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.values-list-mini {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.values-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.value-item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.value-rank {
  width: 16px;
  color: var(--text-muted);
  font-size: 11px;
}

.value-name {
  width: 32px;
  color: var(--text-primary);
}

.value-bar-bg {
  flex: 1;
  height: 6px;
  background: rgba(0,0,0,0.1); /* Dark mode adapt needed later */
  border-radius: var(--radius-full);
  overflow: hidden;
}

.value-bar-fill {
  height: 100%;
  background: var(--accent);
}

.value-score {
  width: 24px;
  text-align: right;
  color: var(--text-secondary);
  font-size: 12px;
}

.empty-data {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px;
}

.coming-soon.sm {
  font-size: 12px;
  padding: 12px;
  background: rgba(0,0,0,0.05);
}

/* 记忆列表 */
.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.clear-btn {
  background: transparent;
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.clear-btn:hover {
  background: rgba(255, 100, 100, 0.2);
  color: #ff6b6b;
}

.memory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
}

.memory-type {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.memory-type.profile {
  background: rgba(147, 112, 219, 0.2);
  color: #b19cd9;
}

.memory-type.pattern {
  background: rgba(92, 196, 168, 0.2);
  color: var(--accent);
}

.memory-type.episode {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.memory-content {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
}

.memory-delete {
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.memory-item:hover .memory-delete {
  opacity: 1;
}

.memory-delete:hover {
  background: rgba(255, 100, 100, 0.2);
  color: #ff6b6b;
}

.empty-state,
.coming-soon {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

/* 会话列表 */
.session-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-item {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease;
}

.session-item:hover {
  background: var(--bg-card);
}

.session-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.session-time {
  font-size: 12px;
  color: var(--accent);
}

.session-count {
  font-size: 11px;
  color: var(--text-muted);
}

.session-summary {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 模态框 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-container {
  width: 90%;
  max-height: 80%;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* 历史消息 */
.history-message {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.history-message:last-child {
  border-bottom: none;
}

.msg-role {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.history-message.user .msg-role {
  color: var(--accent);
}

.msg-content {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}

/* 思考记录 */
.thoughts-section {
  margin-top: 16px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.thoughts-section summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
}

.thought-item {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.thought-time {
  font-size: 10px;
  color: var(--text-muted);
}

.thought-text {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  font-style: italic;
}

/* 模态框动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
