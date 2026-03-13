<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getExternalTools, type UnifiedTool } from '@/services/tool-registry'
import { reloadSkills, installSkill, uninstallSkill } from '@/services/skill-loader'

const skills = ref<UnifiedTool[]>([])
const loading = ref(false)
const showInstallModal = ref(false)
const searchQuery = ref('')
const activeFilter = ref<'all' | 'builtin' | 'user'>('all')
const expandedSkillKey = ref<string | null>(null)

const newSkillName = ref('')
const newSkillContent = ref('')
const installError = ref('')

/** 加载列表 */
const loadList = () => {
  skills.value = getExternalTools()
}

/** 过滤后的列表 */
const filteredSkills = computed(() => {
  let list = skills.value

  // 按来源过滤
  if (activeFilter.value === 'builtin') {
    list = list.filter(s => s.key.startsWith('skill_builtin'))
  } else if (activeFilter.value === 'user') {
    list = list.filter(s => !s.key.startsWith('skill_builtin'))
  }

  // 按搜索词过滤
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q)
    )
  }

  return list
})

/** 统计数 */
const builtinCount = computed(() => skills.value.filter(s => s.key.startsWith('skill_builtin')).length)
const userCount = computed(() => skills.value.filter(s => !s.key.startsWith('skill_builtin')).length)

/** 刷新 */
const handleRefresh = async () => {
  loading.value = true
  await reloadSkills()
  loadList()
  loading.value = false
}

/** 切换展开 */
const toggleExpand = (key: string) => {
  expandedSkillKey.value = expandedSkillKey.value === key ? null : key
}

/** 安装 */
const handleInstall = async () => {
  installError.value = ''

  if (!newSkillName.value.trim()) {
    installError.value = '请输入技能标识名'
    return
  }
  if (!newSkillContent.value.trim()) {
    installError.value = '请粘贴 SKILL.md 内容'
    return
  }
  // 简单格式校验
  if (!newSkillContent.value.includes('---')) {
    installError.value = '内容格式不正确，需包含 YAML frontmatter (--- 分隔)'
    return
  }

  const ok = await installSkill(newSkillName.value.trim(), newSkillContent.value)
  if (ok) {
    showInstallModal.value = false
    newSkillName.value = ''
    newSkillContent.value = ''
    installError.value = ''
    loadList()
  } else {
    installError.value = '安装失败，请检查名称和内容格式'
  }
}

/** 卸载 */
const handleUninstall = async (key: string, event: Event) => {
  event.stopPropagation()
  if (confirm('确定要删除这个技能吗？')) {
    const ok = await uninstallSkill(key)
    if (ok) {
      if (expandedSkillKey.value === key) expandedSkillKey.value = null
      loadList()
    }
  }
}

/** 关闭安装弹窗 */
const closeInstallModal = () => {
  showInstallModal.value = false
  installError.value = ''
}

onMounted(() => {
  loadList()
})
</script>

<template>
  <div class="skill-manager">
    <!-- 标题栏 -->
    <div class="sm-header">
      <div class="sm-title">
        <span class="sm-title-icon">🧩</span>
        <span>技能插件</span>
        <span class="sm-count">{{ skills.length }}</span>
      </div>
      <div class="sm-actions">
        <button @click="handleRefresh" :disabled="loading" class="sm-btn-icon" title="刷新列表">
          <span :class="{ 'sm-spinning': loading }">↻</span>
        </button>
        <button @click="showInstallModal = true" class="sm-btn-primary">
          <span>+</span> 安装
        </button>
      </div>
    </div>

    <!-- 搜索 + 过滤 -->
    <div class="sm-toolbar">
      <div class="sm-search">
        <span class="sm-search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索技能..."
          class="sm-search-input"
        />
      </div>
      <div class="sm-filters">
        <button
          :class="['sm-filter-tag', { active: activeFilter === 'all' }]"
          @click="activeFilter = 'all'"
        >
          全部 {{ skills.length }}
        </button>
        <button
          :class="['sm-filter-tag', { active: activeFilter === 'builtin' }]"
          @click="activeFilter = 'builtin'"
        >
          内置 {{ builtinCount }}
        </button>
        <button
          :class="['sm-filter-tag', { active: activeFilter === 'user' }]"
          @click="activeFilter = 'user'"
        >
          安装 {{ userCount }}
        </button>
      </div>
    </div>

    <!-- 技能列表 -->
    <div class="sm-list">
      <div
        v-for="skill in filteredSkills"
        :key="skill.key"
        :class="['sm-card', { expanded: expandedSkillKey === skill.key }]"
        @click="toggleExpand(skill.key)"
      >
        <!-- 卡片主体 -->
        <div class="sm-card-main">
          <div class="sm-card-icon">{{ skill.icon }}</div>
          <div class="sm-card-body">
            <div class="sm-card-title-row">
              <span class="sm-card-name">{{ skill.name }}</span>
              <span
                v-if="skill.key.startsWith('skill_builtin')"
                class="sm-badge sm-badge-builtin"
              >内置</span>
              <span v-else class="sm-badge sm-badge-user">用户</span>
            </div>
            <div class="sm-card-desc">{{ skill.description }}</div>
          </div>
          <div class="sm-card-actions">
            <button
              v-if="!skill.key.startsWith('skill_builtin')"
              @click="handleUninstall(skill.key, $event)"
              class="sm-btn-danger"
              title="删除技能"
            >✕</button>
            <span class="sm-expand-arrow">{{ expandedSkillKey === skill.key ? '▲' : '▼' }}</span>
          </div>
        </div>

        <!-- 展开的详情区域 -->
        <Transition name="sm-detail">
          <div v-if="expandedSkillKey === skill.key" class="sm-card-detail" @click.stop>
            <div class="sm-detail-grid">
              <div class="sm-detail-item">
                <span class="sm-detail-label">标识</span>
                <span class="sm-detail-value sm-mono">{{ skill.key }}</span>
              </div>
              <div class="sm-detail-item">
                <span class="sm-detail-label">来源</span>
                <span class="sm-detail-value">{{ skill.source === 'openclaw-skill' ? 'OpenClaw Skill' : '内置模块' }}</span>
              </div>
              <div class="sm-detail-item">
                <span class="sm-detail-label">执行模式</span>
                <span class="sm-detail-value">{{ skill.execMode === 'prompt-inject' ? 'Prompt 注入' : skill.execMode }}</span>
              </div>
              <div v-if="skill.skillMeta?.platform?.length" class="sm-detail-item">
                <span class="sm-detail-label">平台</span>
                <span class="sm-detail-value">{{ skill.skillMeta.platform.join(', ') }}</span>
              </div>
              <div v-if="skill.skillMeta?.requires?.bins?.length" class="sm-detail-item">
                <span class="sm-detail-label">依赖</span>
                <span class="sm-detail-value sm-mono">{{ skill.skillMeta.requires.bins.join(', ') }}</span>
              </div>
            </div>
            <div v-if="skill.skillMeta?.markdownBody" class="sm-detail-preview">
              <span class="sm-detail-label">Skill 内容预览</span>
              <pre class="sm-detail-code">{{ skill.skillMeta.markdownBody.slice(0, 300) }}{{ skill.skillMeta.markdownBody.length > 300 ? '...' : '' }}</pre>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredSkills.length === 0" class="sm-empty">
        <div class="sm-empty-icon">📦</div>
        <div class="sm-empty-text" v-if="searchQuery">
          未找到匹配「{{ searchQuery }}」的技能
        </div>
        <div class="sm-empty-text" v-else-if="activeFilter !== 'all'">
          该分类下暂无技能
        </div>
        <div class="sm-empty-text" v-else>
          暂无外部技能，点击上方「安装」添加
        </div>
      </div>
    </div>

    <!-- 安装弹窗 -->
    <Transition name="sm-modal">
      <div v-if="showInstallModal" class="sm-overlay" @click.self="closeInstallModal">
        <div class="sm-modal">
          <div class="sm-modal-header">
            <h3>安装新技能</h3>
            <button class="sm-modal-close" @click="closeInstallModal">✕</button>
          </div>

          <p class="sm-modal-hint">
            粘贴 <a href="https://github.com/anthropics/courses" target="_blank" class="sm-link">OpenClaw SKILL.md</a> 的完整内容来安装技能
          </p>

          <div class="sm-form-group">
            <label class="sm-label">技能标识</label>
            <input
              v-model="newSkillName"
              placeholder="例如: my-search-tool"
              class="sm-input"
            />
          </div>

          <div class="sm-form-group">
            <label class="sm-label">SKILL.md 内容</label>
            <textarea
              v-model="newSkillContent"
              placeholder="---
name: my-tool
description: '工具描述'
metadata:
  openclaw:
    emoji: '🔧'
---

## 何时使用
..."
              class="sm-textarea"
            ></textarea>
          </div>

          <div v-if="installError" class="sm-error">{{ installError }}</div>

          <div class="sm-modal-footer">
            <button @click="closeInstallModal" class="sm-btn-ghost">取消</button>
            <button
              @click="handleInstall"
              class="sm-btn-primary"
              :disabled="!newSkillName || !newSkillContent"
            >确认安装</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ============ 容器 ============ */
.skill-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ============ 标题栏 ============ */
.sm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sm-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.sm-title-icon {
  font-size: 16px;
}

.sm-count {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 500;
}

.sm-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ============ 按钮 ============ */
.sm-btn-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-btn-icon:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.sm-btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sm-btn-primary {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent);
  color: #0f1419;
  border: none;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 12px rgba(92, 196, 168, 0.3);
}

.sm-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.sm-btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-btn-ghost:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.sm-btn-danger {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}

.sm-card:hover .sm-btn-danger {
  opacity: 1;
}

.sm-btn-danger:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* ============ 搜索 + 过滤 ============ */
.sm-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-search {
  position: relative;
  display: flex;
  align-items: center;
}

.sm-search-icon {
  position: absolute;
  left: 10px;
  font-size: 12px;
  pointer-events: none;
  opacity: 0.5;
}

.sm-search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: all var(--transition-fast);
}

.sm-search-input::placeholder {
  color: var(--text-muted);
}

.sm-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(92, 196, 168, 0.1);
}

.sm-filters {
  display: flex;
  gap: 6px;
}

.sm-filter-tag {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-filter-tag:hover {
  color: var(--text-secondary);
  border-color: var(--text-muted);
}

.sm-filter-tag.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

/* ============ 技能列表 ============ */
.sm-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}

/* ============ 技能卡片 ============ */
.sm-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  overflow: hidden;
}

.sm-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transform: translateY(-1px);
}

.sm-card.expanded {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(92, 196, 168, 0.1);
}

.sm-card-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.sm-card-icon {
  font-size: 22px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.sm-card-body {
  flex: 1;
  min-width: 0;
}

.sm-card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sm-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.sm-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.sm-badge-builtin {
  background: rgba(92, 196, 168, 0.15);
  color: var(--accent);
}

.sm-badge-user {
  background: rgba(147, 112, 219, 0.15);
  color: #b19cd9;
}

.sm-card-desc {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.sm-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.sm-expand-arrow {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.5;
  transition: opacity var(--transition-fast);
}

.sm-card:hover .sm-expand-arrow {
  opacity: 1;
}

/* ============ 展开详情 ============ */
.sm-card-detail {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border);
  margin-top: 0;
}

.sm-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding-top: 10px;
}

.sm-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sm-detail-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sm-detail-value {
  font-size: 12px;
  color: var(--text-secondary);
}

.sm-mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.sm-detail-preview {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sm-detail-code {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
  line-height: 1.5;
}

/* 展开动画 */
.sm-detail-enter-active {
  animation: sm-slide-down 0.2s ease;
}

.sm-detail-leave-active {
  animation: sm-slide-down 0.15s ease reverse;
}

@keyframes sm-slide-down {
  from {
    opacity: 0;
    max-height: 0;
    padding-top: 0;
  }
  to {
    opacity: 1;
    max-height: 400px;
    padding-top: 12px;
  }
}

/* ============ 空状态 ============ */
.sm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}

.sm-empty-icon {
  font-size: 28px;
  opacity: 0.6;
}

.sm-empty-text {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

/* ============ 旋转动画 ============ */
.sm-spinning {
  display: inline-block;
  animation: sm-spin 1s linear infinite;
}

@keyframes sm-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ============ 弹窗 ============ */
.sm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.sm-modal {
  background: var(--bg-secondary);
  width: 90%;
  max-width: 420px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  padding: 20px;
}

.sm-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.sm-modal-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.sm-modal-close {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-modal-close:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.sm-modal-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 16px;
  line-height: 1.5;
}

.sm-link {
  color: var(--accent);
  text-decoration: none;
}

.sm-link:hover {
  text-decoration: underline;
}

.sm-form-group {
  margin-bottom: 12px;
}

.sm-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sm-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}

.sm-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(92, 196, 168, 0.1);
}

.sm-input::placeholder {
  color: var(--text-muted);
}

.sm-textarea {
  width: 100%;
  height: 180px;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}

.sm-textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(92, 196, 168, 0.1);
}

.sm-textarea::placeholder {
  color: var(--text-muted);
}

.sm-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 12px;
  color: #ef4444;
  margin-bottom: 12px;
}

.sm-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

/* ============ 弹窗动画 ============ */
.sm-modal-enter-active {
  animation: sm-modal-in 0.2s ease;
}

.sm-modal-leave-active {
  animation: sm-modal-in 0.15s ease reverse;
}

@keyframes sm-modal-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
