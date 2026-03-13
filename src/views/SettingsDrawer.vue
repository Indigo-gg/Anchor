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
            <button 
              :class="['tab-btn', { active: activeTab === 'settings' }]"
              @click="activeTab = 'settings'"
            >
              设置
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

            <!-- 技能管理 -->
            <section class="card">
              <SkillManager />
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
                    <span class="session-role">{{ getRoleName(session.roleId) }}</span>
                    <span class="session-time">{{ formatTime(session.startTime) }}</span>
                    <span class="session-count">{{ session.messages.length }} 条消息</span>
                  </div>
                  <div class="session-summary-row">
                    <div class="session-summary markdown-preview" v-html="renderMarkdown(session.summary)"></div>
                    <button class="delete-session-btn" @click.stop="handleDeleteSession(session.id)" title="删除会话">
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- 设置面板 -->
          <div v-else-if="activeTab === 'settings'" class="settings-panel">

            <!-- 模型提供商 -->
            <section class="card">
              <h3 class="card-title">🤖 模型提供商</h3>

              <!-- 提供商选择 -->
              <div class="provider-list">
                <div
                  v-for="provider in allProviders"
                  :key="provider.id"
                  :class="['provider-card', { active: provider.id === currentProviderId }]"
                  @click="switchProvider(provider.id)"
                >
                  <div class="provider-info">
                    <span class="provider-name">{{ provider.name }}</span>
                    <span class="provider-status" :class="{ configured: !!provider.apiKey }">
                      {{ provider.apiKey ? '已配置' : '未配置' }}
                    </span>
                  </div>
                  <div class="provider-check" v-if="provider.id === currentProviderId">✓</div>
                  <button
                    v-if="!provider.isBuiltin"
                    class="provider-delete"
                    @click.stop="handleDeleteProvider(provider.id)"
                    title="删除"
                  >×</button>
                </div>
              </div>

              <!-- 添加自定义提供商 -->
              <button class="add-provider-btn" @click="showAddProvider = !showAddProvider">
                {{ showAddProvider ? '取消' : '+ 添加自定义提供商' }}
              </button>

              <div v-if="showAddProvider" class="add-provider-form">
                <input
                  v-model="newProvider.name"
                  class="settings-input"
                  placeholder="名称（如 My Server）"
                />
                <input
                  v-model="newProvider.baseURL"
                  class="settings-input"
                  placeholder="API 地址（如 https://api.example.com/v1）"
                />
                <button class="save-provider-btn" @click="handleAddProvider" :disabled="!newProvider.name || !newProvider.baseURL">
                  添加
                </button>
              </div>
            </section>

            <!-- API Key 配置 -->
            <section class="card">
              <h3 class="card-title">🔑 {{ currentProvider?.name }} 配置</h3>

              <div class="setting-row">
                <label class="setting-label">API Key</label>
                <div class="input-group">
                  <input
                    :type="showApiKey ? 'text' : 'password'"
                    :value="currentProvider?.apiKey"
                    @input="handleApiKeyChange"
                    class="settings-input"
                    placeholder="输入 API Key"
                  />
                  <button class="toggle-eye" @click="showApiKey = !showApiKey">
                    {{ showApiKey ? '🙈' : '👁' }}
                  </button>
                </div>
              </div>

              <div class="setting-row">
                <label class="setting-label">API 地址</label>
                <input
                  :value="currentProvider?.baseURL"
                  @input="handleBaseURLChange"
                  class="settings-input"
                  placeholder="https://api.example.com/v1"
                />
              </div>
            </section>

            <!-- 模型映射 -->
            <section class="card">
              <h3 class="card-title">🎯 意图 → 模型映射</h3>
              <p class="card-hint">不同复杂度的请求使用不同模型</p>

              <div class="setting-row" v-for="intent in intentList" :key="intent.key">
                <label class="setting-label">
                  <span class="intent-icon">{{ intent.icon }}</span>
                  {{ intent.label }}
                </label>
                <input
                  :value="currentProvider?.models[intent.key]"
                  @input="handleModelChange(intent.key, $event)"
                  class="settings-input model-input"
                  :placeholder="intent.placeholder"
                />
              </div>
            </section>

            <!-- 测试连接 -->
            <section class="card">
              <button
                class="test-btn"
                @click="testConnection"
                :disabled="testingConnection"
              >
                {{ testingConnection ? '测试中...' : '🧪 测试连接' }}
              </button>
              <div v-if="testResult" :class="['test-result', testResult.ok ? 'success' : 'error']">
                {{ testResult.message }}
              </div>
            </section>

            <!-- 会话设置 -->
            <section class="card">
              <h3 class="card-title">💬 会话设置</h3>

              <div class="setting-row">
                <label class="setting-label">上下文窗口（轮）</label>
                <div class="range-group">
                  <input
                    type="range"
                    :value="sessionSettings.contextWindowSize"
                    @input="handleWindowSizeChange"
                    min="3"
                    max="20"
                    step="1"
                    class="settings-range"
                  />
                  <span class="range-value">{{ sessionSettings.contextWindowSize }}</span>
                </div>
                <p class="setting-hint">每 {{ sessionSettings.contextWindowSize }} 轮对话后自动压缩历史</p>
              </div>
            </section>
            
            <!-- 外观设置 -->
            <section class="card">
              <h3 class="card-title">✨ 外观设置</h3>
              <div class="setting-row">
                <label class="setting-label">全局字体大小</label>
                <div class="range-group">
                  <input
                    type="range"
                    v-model.number="appearanceSettings.fontSize"
                    min="12"
                    max="24"
                    step="2"
                    class="settings-range"
                  />
                  <span class="range-value">{{ appearanceSettings.fontSize }}px</span>
                </div>
              </div>
              <div class="setting-row">
                <label class="setting-label">全局字体粗细</label>
                <div class="range-group">
                  <input
                    type="range"
                    v-model.number="appearanceSettings.fontWeight"
                    min="300"
                    max="600"
                    step="50"
                    class="settings-range"
                  />
                  <span class="range-value">{{ appearanceSettings.fontWeight }}</span>
                </div>
              </div>
              <div class="setting-row" style="margin-top: 12px; justify-content: flex-end;">
                 <button class="test-btn" @click="resetAppearance" style="padding: 4px 12px; font-size: 12px; width: auto;">恢复默认</button>
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
                  <span class="msg-role">{{ msg.role === 'user' ? '你' : (getRoleName(selectedSession.roleId)) }}</span>
                  <span class="msg-content markdown-body" v-html="renderMarkdown(msg.content || `[${msg.tool}]`)"></span>
                </div>
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
import SkillManager from '@/components/SkillManager.vue'
import { useRoleStore } from '@/services/role'
import { marked } from 'marked'

defineProps<{
  isOpen: boolean
}>()

defineEmits<{
  close: []
}>()

const { sessions, sessionSettings, saveSessionSettings, deleteSession } = useSessionStore()
const { weekRecords: energyWeekRecords, getHourlyStats, getAverageLevel } = useEnergyStore()
const { radarData } = useValuesStore()
const { roles } = useRoleStore()

function getRoleName(roleId: string) {
  const role = roles.value.find(r => r.id === roleId)
  return role ? role.name : 'Unknown'
}

async function handleDeleteSession(id: string) {
  if (confirm('确定要删除这条聊天记录吗？无法恢复哦。')) {
    await deleteSession(id)
    if (selectedSession.value?.id === id) {
      selectedSession.value = null
    }
  }
}

function renderMarkdown(content: string | undefined): string {
  if (!content) return '空会话'
  return marked.parse(content.trim()) as string
}

// 选中的 Tab
const activeTab = ref<'history' | 'dashboard' | 'settings'>('dashboard')

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
  const labels: Record<string, string> = {
    profile: '画像',
    pattern: '模式',
    episode: '事件',
    summary: '摘要',
    tool: '工具',
    fact: '事实'
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

// ============ 模型设置 ============
import { useProviderStore, type ModelIntent } from '@/services/llm-providers'
import { chat, type Message } from '@/services/llm'

const {
    providers: allProviders,
    activeProviderId: currentProviderId,
    activeProvider: currentProvider,
    setActiveProvider,
    updateProvider,
    addProvider,
    deleteProvider,
} = useProviderStore()

const showApiKey = ref(false)
const showAddProvider = ref(false)
const testingConnection = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const newProvider = ref({
    name: '',
    baseURL: '',
})

const intentList = [
    { key: 'fast' as ModelIntent, icon: '⚡', label: '快速', placeholder: '轻量意图路由' },
    { key: 'simple' as ModelIntent, icon: '💬', label: '对话', placeholder: '日常对话' },
    { key: 'complex' as ModelIntent, icon: '🧠', label: '深度', placeholder: '复杂推理' },
    { key: 'image' as ModelIntent, icon: '🖼️', label: '图像', placeholder: '图像生成/理解' },
    { key: 'embedding' as ModelIntent, icon: '📐', label: '向量', placeholder: '文本嵌入' },
    { key: 'reranker' as ModelIntent, icon: '🔍', label: '精排', placeholder: '混合检索重排序' },
]

function switchProvider(id: string) {
    setActiveProvider(id)
    testResult.value = null
}

function handleApiKeyChange(event: Event) {
    const value = (event.target as HTMLInputElement).value
    updateProvider(currentProviderId.value, { apiKey: value })
}

function handleBaseURLChange(event: Event) {
    const value = (event.target as HTMLInputElement).value
    updateProvider(currentProviderId.value, { baseURL: value })
}

function handleModelChange(intent: ModelIntent, event: Event) {
    const value = (event.target as HTMLInputElement).value
    const models = { ...currentProvider.value.models, [intent]: value }
    updateProvider(currentProviderId.value, { models })
}

function handleAddProvider() {
    if (!newProvider.value.name || !newProvider.value.baseURL) return
    const id = 'custom_' + Date.now().toString(36)
    addProvider({
        id,
        name: newProvider.value.name,
        baseURL: newProvider.value.baseURL,
        apiKey: '',
        models: {},
        enabled: true,
    })
    newProvider.value = { name: '', baseURL: '' }
    showAddProvider.value = false
}

function handleDeleteProvider(id: string) {
    if (confirm('确定要删除此提供商吗？')) {
        deleteProvider(id)
    }
}

async function testConnection() {
    testingConnection.value = true
    testResult.value = null
    try {
        const messages: Message[] = [{ role: 'user', content: '你好，请回复"连接成功"。' }]
        const response = await chat(messages, { intent: 'fast' })
        testResult.value = { ok: true, message: `✅ 连接成功！模型响应：${response.slice(0, 50)}` }
    } catch (e: any) {
        testResult.value = { ok: false, message: `❌ 连接失败：${e.message}` }
    } finally {
        testingConnection.value = false
    }
}

function handleWindowSizeChange(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value)
    sessionSettings.value.contextWindowSize = value
    saveSessionSettings()
}

// ============ 外观设置 ============
import { useAppearanceStore } from '@/services/appearance'
const { settings: appearanceSettings, reset: resetAppearance } = useAppearanceStore()

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

.session-summary-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.session-summary {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.delete-session-btn {
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0; 
  transition: all 0.2s ease;
  font-size: 14px;
}

.session-item:hover .delete-session-btn {
  opacity: 1; 
}

.delete-session-btn:hover {
  background: rgba(255, 60, 60, 0.15);
  color: #ff5555;
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

/* ============ 设置面板 ============ */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.provider-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: all 0.15s ease;
}

.provider-card:hover {
  border-color: var(--border);
}

.provider-card.active {
  border-color: var(--accent);
  background: rgba(92, 196, 168, 0.08);
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-name {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.provider-status {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

.provider-status.configured {
  background: rgba(92, 196, 168, 0.15);
  color: var(--accent);
}

.provider-check {
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
}

.provider-delete {
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.provider-delete:hover {
  background: rgba(255, 100, 100, 0.2);
  color: #ff6b6b;
}

.add-provider-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.add-provider-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.add-provider-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 12px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
}

.save-provider-btn {
  padding: 6px 12px;
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  align-self: flex-end;
}

.save-provider-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.setting-row {
  margin-bottom: 12px;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.intent-icon {
  font-size: 14px;
}

.settings-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.settings-input:focus {
  outline: none;
  border-color: var(--accent);
}

.settings-input::placeholder {
  color: var(--text-muted);
  font-family: inherit;
}

.model-input {
  font-size: 12px;
}

.input-group {
  display: flex;
  gap: 6px;
}

.input-group .settings-input {
  flex: 1;
}

.toggle-eye {
  width: 36px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
}

.card-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.test-btn {
  width: 100%;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.test-btn:hover {
  border-color: var(--accent);
  background: rgba(92, 196, 168, 0.08);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.test-result {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
}

.test-result.success {
  background: rgba(92, 196, 168, 0.12);
  color: var(--accent);
}

.test-result.error {
  background: rgba(255, 100, 100, 0.12);
  color: #ff6b6b;
}

/* 滑块设置 */
.range-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-range {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  outline: none;
}

.settings-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  transition: transform 0.1s ease;
}

.settings-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.range-value {
  min-width: 24px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
}

.setting-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
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

.session-role {
  font-weight: 500;
  color: var(--text-primary);
}

.markdown-preview {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
.markdown-preview :deep(p) {
  margin: 0;
  display: inline;
}

/* History Message Details Markdown */
.history-message {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-message .msg-role {
  font-size: 12px;
  color: var(--text-muted);
}
.history-message .msg-content.markdown-body {
  font-size: 14px;
  background: var(--bg-secondary);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

</style>
