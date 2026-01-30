<template>
  <div class="chat-container">
    <!-- 消息列表 -->
    <div class="message-list no-drag" ref="messageListRef">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message fade-in">
        <div class="welcome-icon">🌿</div>
        <h2>你好</h2>
        <p>有什么想聊的，或者只是想静静地待一会儿？</p>
      </div>

      <!-- 消息气泡 -->
      <div
        v-for="(msg, index) in messages"
        :key="index"
        :class="['message', msg.role, { 'full-width': msg.tool }]"
        class="fade-in"
      >
        <div :class="['message-content', { 'tool-content': msg.tool }]">
          <!-- 工具渲染器 -->
          <ToolRenderer v-if="msg.tool" :tool="msg.tool" :params="msg.toolParams" />
          <!-- Markdown 渲染的文本 -->
          <div v-else class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
        </div>
      </div>

      <!-- 流式响应中 -->
      <div v-if="streamingContent" class="message assistant fade-in">
        <div class="message-content markdown-body" v-html="renderMarkdown(streamingContent)"></div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="isLoading && !streamingContent" class="message assistant fade-in">
        <div class="message-content loading">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area no-drag">
      <textarea
        v-model="inputText"
        @keydown.enter.exact.prevent="sendMessage"
        placeholder="说点什么..."
        rows="1"
        :disabled="isLoading"
      ></textarea>
      <button class="send-btn" @click="sendMessage" :disabled="!inputText.trim() || isLoading">
        <span>→</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { marked } from 'marked'
import ToolRenderer from '@/components/ToolRenderer.vue'
import { useAgentLoop } from '@/agents/react-agent'
import { useSessionStore } from '@/services/session'

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
})

interface Message {
  role: 'user' | 'assistant'
  content: string
  tool?: string
  toolParams?: Record<string, unknown>
}

const messages = ref<Message[]>([])
const inputText = ref('')
const isLoading = ref(false)
const streamingContent = ref('')
const messageListRef = ref<HTMLElement | null>(null)

const { sendToAgent } = useAgentLoop()
const { addMessage, addThought } = useSessionStore()

// Markdown 渲染
function renderMarkdown(content: string): string {
  if (!content) return ''
  return marked.parse(content) as string
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isLoading.value) return

  // 添加用户消息
  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  isLoading.value = true
  streamingContent.value = ''
  scrollToBottom()

  try {
    // 调用 Agent（支持流式回调）
    const responses = await sendToAgent(
      text, 
      messages.value,
      // 流式回调
      (chunk: string) => {
        streamingContent.value += chunk
        scrollToBottom()
      }
    )
    
    // 流式内容结束，添加到消息列表
    if (streamingContent.value) {
      messages.value.push({ role: 'assistant', content: streamingContent.value })
      streamingContent.value = ''
    }

    // 处理 Agent 响应（工具调用等）
    for (const response of responses) {
      if (response.type === 'message' && response.content) {
        // 如果已经通过流式添加了，跳过
        if (!streamingContent.value) {
          messages.value.push({ role: 'assistant', content: response.content || '' })
        }
      } else if (response.type === 'tool') {
        messages.value.push({
          role: 'assistant',
          content: '',
          tool: response.tool,
          toolParams: response.params
        })
      }
      scrollToBottom()
    }
  } catch (error) {
    console.error('Agent error:', error)
    messages.value.push({
      role: 'assistant',
      content: '抱歉，出了点问题。深呼吸，我们再试一次？'
    })
  } finally {
    isLoading.value = false
    streamingContent.value = ''
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
  })
}

// 清空消息（新建会话时调用）
function clearMessages() {
  messages.value = []
  streamingContent.value = ''
}

// 暴露给父组件
defineExpose({ clearMessages })

// 监听消息变化，自动滚动
watch(messages, scrollToBottom, { deep: true })
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  gap: 16px;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 8px;
}

/* 欢迎消息 */
.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.welcome-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.welcome-message h2 {
  font-size: 20px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.welcome-message p {
  font-size: 14px;
  color: var(--text-muted);
}

/* 消息气泡 */
.message {
  display: flex;
  max-width: 85%;
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

/* 工具消息全宽 */
.message.full-width {
  max-width: 100%;
  width: 100%;
}

.message-content {
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  line-height: 1.5;
  word-break: break-word;
}

/* 工具内容全宽 */
.message-content.tool-content {
  width: 100%;
  padding: 0;
  background: transparent;
}

.message.user .message-content {
  background: var(--accent);
  color: var(--bg-primary);
}

.message.assistant .message-content:not(.tool-content) {
  background: var(--bg-card);
  color: var(--text-primary);
}

/* Markdown 样式 */
.markdown-body {
  font-size: 14px;
  line-height: 1.6;
}

.markdown-body :deep(p) {
  margin: 0 0 8px 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: var(--accent);
}

.markdown-body :deep(em) {
  font-style: italic;
  color: var(--text-secondary);
}

.markdown-body :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.markdown-body :deep(ul), .markdown-body :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* 加载动画 */
.message-content.loading {
  display: flex;
  gap: 4px;
  padding: 16px 20px;
}

.dot {
  width: 8px;
  height: 8px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-6px);
  }
}

/* 输入区域 */
.input-area {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.input-area textarea {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  resize: none;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
}

.input-area textarea:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.input-area textarea::placeholder {
  color: var(--text-muted);
}

.send-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: var(--radius-md);
  font-size: 18px;
  font-weight: bold;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
