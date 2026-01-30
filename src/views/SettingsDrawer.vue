<template>
  <Transition name="drawer">
    <div v-if="isOpen" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-container">
        <!-- 头部 -->
        <header class="drawer-header">
          <button class="back-btn" @click="$emit('close')">
            <span>←</span>
          </button>
          <h2>设置与历史</h2>
        </header>

        <!-- 内容 -->
        <div class="drawer-content">
          <!-- 历史会话 -->
          <section class="section">
            <h3 class="section-title">
              <span>📜</span> 历史会话
            </h3>
            
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

          <!-- 知识库 -->
          <section class="section">
            <h3 class="section-title">
              <span>📚</span> 知识库
            </h3>
            <div class="coming-soon">规划中...</div>
          </section>
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
import { ref } from 'vue'
import { useSessionStore, formatTime, type Session } from '@/services/session'

defineProps<{
  isOpen: boolean
}>()

defineEmits<{
  close: []
}>()

const { sessions } = useSessionStore()

const selectedSession = ref<Session | null>(null)

function viewSession(session: Session) {
  selectedSession.value = session
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

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 12px;
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
