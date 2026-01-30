<template>
  <div class="app-container">
    <!-- 顶部拖拽区域 + 控制按钮 -->
    <header class="app-header">
      <div class="app-title">
        <span class="anchor-icon">⚓</span>
        <span>Anchor</span>
      </div>
      <div class="window-controls no-drag">
        <button class="control-btn new-chat" @click="handleNewSession" title="新建会话">
          <span>+</span>
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Chat from './views/Chat.vue'
import SettingsDrawer from './views/SettingsDrawer.vue'
import { useSessionStore } from './services/session'

const showDrawer = ref(false)
const chatRef = ref<InstanceType<typeof Chat> | null>(null)
const { startNewSession } = useSessionStore()

function hideWindow() {
  window.electronAPI?.hideWindow()
}

function handleNewSession() {
  startNewSession()
  // 通知 Chat 组件清空消息
  chatRef.value?.clearMessages()
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
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
