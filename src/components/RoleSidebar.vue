<template>
  <div :class="['role-sidebar', { collapsed: isCollapsed }]">
    <!-- 角色图标列表 -->
    <div class="role-list">
      <button
        v-for="role in sortedRoles"
        :key="role.id"
        :class="['role-item', { active: activeRoleId === role.id }]"
        :title="role.name"
        :style="{ '--role-color': role.color }"
        @click="handleRoleClick(role.id)"
      >
        <span class="role-icon">{{ role.icon }}</span>
        <span v-if="!isCollapsed" class="role-name">{{ role.name }}</span>
      </button>
    </div>

    <!-- 底部操作 -->
    <div class="sidebar-actions">
      <button class="action-btn" title="添加角色" @click="showEditor = true">
        <span>＋</span>
      </button>
      <button class="action-btn toggle-btn" :title="isCollapsed ? '展开' : '收起'" @click="isCollapsed = !isCollapsed">
        <span>{{ isCollapsed ? '›' : '‹' }}</span>
      </button>
    </div>

    <!-- 角色编辑器 -->
    <RoleEditor
      v-if="showEditor"
      :editingRole="editingRole"
      @close="closeEditor"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoleStore, type RoleDefinition } from '@/services/role'
import { useSessionStore } from '@/services/session'
import RoleEditor from './RoleEditor.vue'

const { roles, activeRoleId, switchRole, roleLastChatTime } = useRoleStore()

const sortedRoles = computed(() => {
  return [...roles.value].sort((a, b) => {
    const timeA = roleLastChatTime.value[a.id] || 0
    const timeB = roleLastChatTime.value[b.id] || 0
    return timeB - timeA
  })
})
const { restoreLatestSession } = useSessionStore()

const emit = defineEmits<{
  roleChanged: [roleId: string]
}>()

const isCollapsed = ref(true)
const showEditor = ref(false)
const editingRole = ref<RoleDefinition | null>(null)

function handleRoleClick(roleId: string) {
  if (activeRoleId.value === roleId) {
    // 点击已选中角色 -> 打开编辑器
    editingRole.value = roles.value.find(r => r.id === roleId) || null
    showEditor.value = true
    return
  }

  // 切换角色 + 恢复会话
  switchRole(roleId)
  restoreLatestSession(roleId)
  emit('roleChanged', roleId)
}

function closeEditor() {
  showEditor.value = false
  editingRole.value = null
}

function handleSave() {
  closeEditor()
}
</script>

<style scoped>
.role-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 120px;
  min-width: 120px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  transition: width 0.25s ease, min-width 0.25s ease;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.role-sidebar.collapsed {
  width: 48px;
  min-width: 48px;
}

.role-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  overflow-y: auto;
  overflow-x: hidden;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
}

.role-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.role-item.active {
  background: var(--accent-soft);
  color: var(--text-primary);
  box-shadow: inset 3px 0 0 var(--role-color, var(--accent));
}

.role-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  line-height: 1;
}

.role-name {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  border-top: 1px solid var(--border);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 32px;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  font-size: 16px;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.toggle-btn {
  font-size: 14px;
  font-weight: bold;
}
</style>
