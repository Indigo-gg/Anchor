<template>
  <Transition name="editor">
    <div class="editor-overlay" @click.self="$emit('close')">
      <div class="editor-container">
        <!-- 头部 -->
        <header class="editor-header">
          <h3>{{ isEditing ? '编辑角色' : '创建角色' }}</h3>
          <button class="close-btn" @click="$emit('close')">×</button>
        </header>

        <!-- 表单 -->
        <div class="editor-content">
          <!-- 基本信息 -->
          <section class="form-section">
            <div class="form-row icon-name-row">
              <div class="icon-picker">
                <button class="icon-btn" @click="showIconPicker = !showIconPicker">
                  {{ form.icon }}
                </button>
                <div v-if="showIconPicker" class="icon-grid">
                  <button
                    v-for="emoji in emojiOptions"
                    :key="emoji"
                    class="emoji-option"
                    @click="form.icon = emoji; showIconPicker = false"
                  >
                    {{ emoji }}
                  </button>
                </div>
              </div>
              <input
                v-model="form.name"
                placeholder="角色名称"
                class="name-input"
                maxlength="20"
              />
            </div>

            <input
              v-model="form.description"
              placeholder="简短描述（可选）"
              class="desc-input"
              maxlength="50"
            />

            <!-- 颜色选择 -->
            <div class="form-row color-row">
              <span class="form-label">主题色</span>
              <div class="color-options">
                <button
                  v-for="color in colorOptions"
                  :key="color"
                  :class="['color-dot', { active: form.color === color }]"
                  :style="{ background: color }"
                  @click="form.color = color"
                />
              </div>
            </div>
          </section>

          <!-- 系统提示词 -->
          <section class="form-section">
            <label class="form-label">系统提示词</label>
            <textarea
              v-model="form.systemPrompt"
              placeholder="定义角色的人格与行为方式..."
              class="prompt-textarea"
              rows="6"
            />
          </section>

          <!-- 🛠️ Skill 配置 -->
          <section class="form-section">
            <div class="section-header">
              <label class="form-label">🧩 技能插件</label>
              <button class="refresh-btn" @click="handleRefreshSkills" title="刷新">↻</button>
            </div>
            <div class="tool-list">
              <label
                v-for="skill in allSkills"
                :key="skill.key"
                class="tool-item"
              >
                <div class="tool-info">
                  <span class="tool-icon">{{ skill.icon }}</span>
                  <span class="tool-name">{{ skill.name }}</span>
                  <!-- <span class="tool-desc">{{ skill.description }}</span> -->
                  <span v-if="skill.execMode !== 'prompt-inject'" class="skill-badge">{{ skill.execMode }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="form.toolKeys.includes(skill.key)"
                  @change="toggleTool(skill.key)"
                />
              </label>
            </div>
          </section>

          <!-- 选项 -->
          <section class="form-section options-section">
            <label class="toggle-row">
              <span>启用记忆</span>
              <input type="checkbox" v-model="form.memory" />
            </label>
          </section>
        </div>

        <!-- 底部按钮 -->
        <footer class="editor-footer">
          <button
            v-if="isEditing && !editingRole?.isBuiltin"
            class="delete-btn"
            @click="handleDelete"
          >
            删除
          </button>
          <button
            v-if="isEditing && editingRole?.isBuiltin"
            class="reset-btn"
            @click="handleReset"
          >
            恢复默认
          </button>
          <div class="spacer" />
          <button class="cancel-btn" @click="$emit('close')">取消</button>
          <button class="save-btn" :disabled="!form.name.trim()" @click="handleSave">
            {{ isEditing ? '保存' : '创建' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRoleStore, type RoleDefinition } from '@/services/role'
import { getAllTools, type UnifiedTool } from '@/services/tool-registry'
import { reloadSkills } from '@/services/skill-loader'

const props = defineProps<{
  editingRole: RoleDefinition | null
}>()

const emit = defineEmits<{
  close: []
  save: []
}>()

const { createRole, updateRole, deleteRole, resetBuiltinRole } = useRoleStore()

const isEditing = computed(() => !!props.editingRole)

// V3: 统一 Skill 列表
const allSkills = ref<UnifiedTool[]>(getAllTools())

async function handleRefreshSkills() {
  await reloadSkills()
  allSkills.value = getAllTools()
}

const form = reactive({
  name: props.editingRole?.name || '',
  icon: props.editingRole?.icon || '🤖',
  color: props.editingRole?.color || '#6b9bd2',
  description: props.editingRole?.description || '',
  systemPrompt: props.editingRole?.systemPrompt || '',
  toolKeys: [...(props.editingRole?.toolKeys || [])],
  useCommonTools: props.editingRole?.useCommonTools ?? true,
  memory: props.editingRole?.memory ?? true
})

const showIconPicker = ref(false)

const emojiOptions = [
  '🤖', '📚', '🎨', '💻', '🧪', '📝', '🎯', '🧠',
  '🌟', '🔮', '🎵', '📊', '🌎', '🍳', '🏋️', '✈️',
  '🐱', '🦊', '🐼', '🦉', '🌸', '🔥', '💎', '🎮'
]

const colorOptions = [
  '#88c999', '#6b9bd2', '#e0836e', '#d4a85c',
  '#9b7dd4', '#5bb8a9', '#d47da8', '#7d8fd4'
]

function toggleTool(key: string) {
  const idx = form.toolKeys.indexOf(key)
  if (idx === -1) {
    form.toolKeys.push(key)
  } else {
    form.toolKeys.splice(idx, 1)
  }
  // 自动管理 useCommonTools：如果包含 image_gen 则开启
  form.useCommonTools = form.toolKeys.includes('image_gen')
}

function handleSave() {
  if (!form.name.trim()) return

  if (isEditing.value && props.editingRole) {
    updateRole(props.editingRole.id, {
      name: form.name,
      icon: form.icon,
      color: form.color,
      description: form.description,
      systemPrompt: form.systemPrompt,
      toolKeys: [...form.toolKeys],
      useCommonTools: form.useCommonTools,
      memory: form.memory
    })
  } else {
    createRole({
      name: form.name,
      icon: form.icon,
      color: form.color,
      description: form.description,
      systemPrompt: form.systemPrompt,
      toolKeys: [...form.toolKeys],
      useCommonTools: form.useCommonTools,
      memory: form.memory
    })
  }
  emit('save')
}

function handleDelete() {
  if (!props.editingRole) return
  if (confirm(`确定删除「${props.editingRole.name}」吗？`)) {
    deleteRole(props.editingRole.id)
    emit('close')
  }
}

function handleReset() {
  if (!props.editingRole) return
  if (confirm(`确定恢复「${props.editingRole.name}」到默认设置吗？所有自定义修改将丢失。`)) {
    resetBuiltinRole(props.editingRole.id)
    emit('close')
  }
}
</script>

<style scoped>
/* 动画 */
.editor-enter-active,
.editor-leave-active {
  transition: opacity 0.2s ease;
}
.editor-enter-from,
.editor-leave-to {
  opacity: 0;
}
.editor-enter-active .editor-container,
.editor-leave-active .editor-container {
  transition: transform 0.2s ease;
}
.editor-enter-from .editor-container,
.editor-leave-to .editor-container {
  transform: translateY(20px);
}

/* 遮罩 */
.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  -webkit-app-region: no-drag;
}

/* 容器 */
.editor-container {
  width: 90%;
  max-width: 420px;
  max-height: 85vh;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}

/* 头部 */
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.editor-header h3 {
  font-size: 15px;
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
  font-size: 18px;
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

/* 内容 */
.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.form-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

/* 图标 + 名称 */
.icon-name-row {
  gap: 10px;
}

.icon-picker {
  position: relative;
}

.icon-btn {
  width: 44px;
  height: 44px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--accent);
}

.icon-grid {
  position: absolute;
  top: 50px;
  left: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  z-index: 10;
  box-shadow: var(--shadow-soft);
}

.emoji-option {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 18px;
  cursor: pointer;
}

.emoji-option:hover {
  background: rgba(255, 255, 255, 0.1);
}

.name-input {
  flex: 1;
  height: 44px;
  font-size: 15px;
  font-weight: 500;
}

.desc-input {
  height: 38px;
  font-size: 13px;
}

/* 颜色 */
.color-row {
  gap: 12px;
}

.color-options {
  display: flex;
  gap: 8px;
}

.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.color-dot:hover {
  transform: scale(1.2);
}

.color-dot.active {
  border-color: white;
  box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px currentColor;
}

/* 提示词 */
.prompt-textarea {
  resize: vertical;
  min-height: 100px;
  max-height: 200px;
  font-size: 13px;
  line-height: 1.5;
}

/* 工具列表 */
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tool-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tool-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.tool-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.tool-desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  flex-shrink: 0;
}

/* 开关 */
.options-section {
  gap: 8px;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.toggle-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

/* 底部 */
.editor-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.spacer {
  flex: 1;
}

.cancel-btn,
.save-btn,
.delete-btn,
.reset-btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
}

.cancel-btn {
  background: transparent;
  color: var(--text-secondary);
}

.cancel-btn:hover {
  background: var(--bg-secondary);
}

.save-btn {
  background: var(--accent);
  color: var(--bg-primary);
}

.save-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.delete-btn {
  background: transparent;
  color: #ff6b6b;
}

.delete-btn:hover {
  background: rgba(255, 100, 100, 0.15);
}

.reset-btn {
  background: transparent;
  color: var(--text-muted);
}

.reset-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

/* V2: 外部 Skills */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.refresh-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover {
  background: var(--bg-secondary);
  color: var(--accent);
  transform: rotate(90deg);
}

.skill-badge {
  font-size: 10px !important;
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8 !important;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}
</style>
