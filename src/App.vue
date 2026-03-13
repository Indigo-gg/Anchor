<template>
  <div class="app-container">
    <!-- 左侧角色侧边栏 -->
    <RoleSidebar @role-changed="handleRoleChanged" />

    <!-- 右侧主内容 -->
    <div class="app-body">
      <!-- 顶部拖拽区域 + 控制按钮 -->
      <header class="app-header">
        <div class="app-title">
          <span class="anchor-icon">{{ activeRole.icon }}</span>
          <span>{{ activeRole.name }}</span>
        </div>
        <div class="window-controls no-drag">
          <button class="control-btn new-chat" @click="handleNewSession" title="新建会话">
            <span>✎</span>
          </button>
          <button class="control-btn settings" @click="showDrawer = true" title="历史与设置">
            <span>🚪</span>
          </button>
          <button class="control-btn minimize" @click="hideWindow" title="最小化到托盘 (Ctrl+Alt+A)">
            <span>─</span>
          </button>
        </div>
      </header>

      <!-- 主内容区 -->
      <main class="app-main">
        <Chat ref="chatRef" />
      </main>

      <!-- 二级页面抽屉 -->
      <SettingsDrawer :isOpen="showDrawer" @close="showDrawer = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Chat from './views/Chat.vue'
import SettingsDrawer from './views/SettingsDrawer.vue'
import RoleSidebar from './components/RoleSidebar.vue'
import { useSessionStore } from './services/session'
import { useRoleStore } from './services/role'
import { useAppearanceStore } from './services/appearance'

// 确保在应用启动时初始化会话存储和外观设置
useSessionStore()
useAppearanceStore()

const showDrawer = ref(false)
const chatRef = ref<InstanceType<typeof Chat> | null>(null)
const { startNewSession } = useSessionStore()
const { activeRole, activeRoleId } = useRoleStore()

function hideWindow() {
  window.electronAPI?.hideWindow()
}

function handleNewSession() {
  startNewSession(activeRoleId.value)
  // 通知 Chat 组件清空消息
  chatRef.value?.clearMessages()
}

function handleRoleChanged(_roleId: string) {
  // 角色切换后从恢复的会话加载消息
  chatRef.value?.loadFromSession()
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;  /* 水平布局：侧边栏 + 主体 */
  background: var(--bg-primary);
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.app-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--text-secondary);
  font-size: 13px;
}

.anchor-icon {
  font-size: 16px;
}

.window-controls {
  display: flex;
  gap: 6px;
}

.control-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.control-btn.new-chat:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.control-btn.settings:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.control-btn.minimize:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.app-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
