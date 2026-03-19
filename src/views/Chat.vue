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
        v-for="msg in messages"
        :key="msg.id"
        :data-message-id="msg.id"
        :class="['message', msg.role, {
          'full-width': msg.tool && !msg.isToolStart,
          'selected': isSelected(msg.id),
          'multi-select-mode': isMultiSelectMode
        }]"
        class="fade-in"
        @contextmenu.prevent="handleContextMenu($event, msg.id)"
        @click="handleMessageClick(msg.id)"
      >
        <!-- 多选复选框 -->
        <div v-if="isMultiSelectMode" class="message-checkbox">
          <input type="checkbox"
                 :checked="isSelected(msg.id)"
                 @click.stop="toggleSelection(msg.id)">
        </div>

        <div :class="['message-content', { 'tool-content': msg.tool && !msg.isToolStart }]">
          <!-- 工具结果渲染器（边界图、能量条等） -->
          <div v-if="msg.isToolResult && msg.tool" class="tool-result-container">
            <ToolRenderer 
              :tool="msg.tool" 
              :params="msg.toolResultData || {}" 
            />
          </div>
          <!-- 旧的工具渲染器（兼容） -->
          <ToolRenderer v-else-if="msg.tool && !msg.isToolStart && !msg.isToolResult" :tool="msg.tool" :params="msg.toolParams" />
          <!-- 图片消息 -->
          <div v-else-if="msg.imageUrl" class="image-message">
            <img :src="msg.imageUrl" alt="生成的图片" @click="openImage(msg.imageUrl)" />
            <button class="save-image-btn" @click="saveImage(msg.imageUrl)" title="保存图片">
              💾
            </button>
          </div>
          <!-- 工具启动消息（带图标） -->
          <div v-else-if="msg.isToolStart" class="tool-start-message">
            <span class="tool-badge">{{ getToolIcon(msg.tool) }}</span>
            <div class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
          </div>
          <!-- Gemini 异步任务卡片 -->
          <div v-else-if="msg.geminiTaskId" class="gemini-task-card">
            <div class="task-card-header">
              <span class="task-icon">🤖</span>
              <span class="task-status" :class="msg.geminiTaskStatus || 'running'">{{ getTaskStatusLabel(msg.geminiTaskStatus) }}</span>
            </div>
            <div class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
            <div class="task-card-footer" v-if="msg.geminiTaskStatus === 'running' || !msg.geminiTaskStatus">
              <button class="cancel-task-btn" @click="cancelGeminiTask(msg.geminiTaskId)">⭕ 取消任务</button>
            </div>
          </div>
          <!-- Markdown 渲染的文本 -->
          <div v-else class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
        </div>
      </div>

      <!-- 流式响应中（不解析 Markdown，避免未闭合标记导致格式混乱） -->
      <div v-if="streamingContent" class="message assistant fade-in">
        <div class="message-content streaming-text">{{ streamingContent }}</div>
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
      <button class="upload-btn" @click="handleUploadFile" title="上传外部文件到当前工作区">
        📎
      </button>
      <textarea
        ref="inputRef"
        v-model="inputText"
        @keydown.enter.exact.prevent="sendMessage"
        :placeholder="placeholder"
        rows="1"
        :disabled="isLoading"
      ></textarea>
      <!-- 发送/中止按钮 -->
      <button
        v-if="isLoading"
        class="send-btn abort-btn"
        @click="abortResponse"
        title="中止回答"
      >
        <span>■</span>
      </button>
      <button
        v-else
        class="send-btn"
        @click="sendMessage"
        :disabled="!inputText.trim()"
      >
        <span>→</span>
      </button>
    </div>
  </div>

  <!-- 图片预览模态框 -->
  <div v-if="previewImageUrl" class="image-preview-modal" @click="closeImagePreview">
    <img :src="previewImageUrl" alt="预览图片" @click.stop />
    <button class="close-preview-btn" @click="closeImagePreview">✕</button>
  </div>

  <!-- 右键菜单 -->
  <MessageContextMenu
    :visible="!!contextMenuPosition"
    :x="contextMenuPosition?.x || 0"
    :y="contextMenuPosition?.y || 0"
    @close="hideContextMenu"
    @multi-select="handleMultiSelectFromMenu"
    @copy="handleCopyFromMenu"
  />

  <!-- 多选工具栏 -->
  <Transition name="toolbar">
    <div v-if="isMultiSelectMode" class="multi-select-toolbar">
      <div class="toolbar-info">
        已选中 {{ selectedCount }} 条消息
      </div>
      <div class="toolbar-actions">
        <button @click="selectAll(messages.map(m => m.id))">全选</button>
        <button @click="exportSelectedAsJSON">导出 JSON</button>
        <button @click="exportSelectedAsImage">导出图片</button>
        <button @click="toggleMultiSelectMode">取消</button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import { marked, Renderer } from 'marked'
import ToolRenderer from '@/components/ToolRenderer.vue'
import MessageContextMenu from '@/components/MessageContextMenu.vue'
import { useAgentLoop, confirmTool, cancelToolConfirm, setupGeminiTaskListener } from '@/agents/react-agent'
import { useSessionStore } from '@/services/session'
import { useInputBridge } from '@/services/input-bridge'
import { compressHistory } from '@/services/llm'
import { useMessageSelection } from '@/composables/useMessageSelection'
import html2canvas from 'html2canvas'

// 配置 marked
const renderer = new Renderer();
renderer.link = ({ href, title, tokens }) => {
  const text = renderer.parser.parseInline(tokens);
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer: renderer
})

interface Message {
  id: string                    // 唯一标识符
  role: 'user' | 'assistant'
  content: string
  tool?: string
  toolParams?: Record<string, unknown>
  imageUrl?: string
  // 工具消息类型
  isToolStart?: boolean      // 工具启动消息
  isToolResult?: boolean     // 工具结果消息
  toolResultData?: Record<string, unknown>    // 工具结果数据
  // Gemini 异步任务
  geminiTaskId?: string         // Gemini 任务 ID
  geminiTaskStatus?: string     // 任务状态 (running/completed/failed/cancelled)
  timestamp?: number            // 时间戳
}

const messages = ref<Message[]>([])
const inputText = ref('')
const isLoading = ref(false)
const streamingContent = ref('')
let abortFlag = false  // 中止标志
const messageListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const awaitingConfirm = ref(false)  // 是否在等待用户确认

const { sendToAgent } = useAgentLoop()
const { addMessage, shouldCompress, addCompressedSummary, getContextMessages } = useSessionStore()
const { handleInput, placeholder } = useInputBridge()

// 消息选择管理
const {
  isMultiSelectMode,
  selectedIds,
  selectedCount,
  contextMenuPosition,
  contextMenuTargetId,
  toggleMultiSelectMode,
  toggleSelection,
  selectAll,
  isSelected,
  showContextMenu,
  hideContextMenu
} = useMessageSelection()

// 生成唯一消息 ID
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Markdown 渲染
function renderMarkdown(content: string): string {
  if (!content) return ''
  // trim 内容避免多余空白导致气泡过大
  return marked.parse(content.trim()) as string
}

// 工具图标
function getToolIcon(tool: string | undefined): string {
  const icons: Record<string, string> = {
    breathing_guide: '🌬️',
    boundary_mapper: '🛡️',
    emergency_guide: '🧭',
    energy_audit: '⚡',
    values_compass: '🧭'
  }
  return tool ? (icons[tool] || '🔧') : '🔧'
}

// 右键菜单处理
function handleContextMenu(event: MouseEvent, messageId: string) {
  event.preventDefault()
  showContextMenu(event, messageId)
}

function handleMultiSelectFromMenu() {
  toggleMultiSelectMode()
  if (contextMenuTargetId.value) {
    toggleSelection(contextMenuTargetId.value)
  }
}

function handleCopyFromMenu() {
  if (contextMenuTargetId.value) {
    const msg = messages.value.find(m => m.id === contextMenuTargetId.value)
    if (msg) {
      navigator.clipboard.writeText(msg.content)
    }
  }
}

// 消息点击处理
function handleMessageClick(messageId: string) {
  if (isMultiSelectMode.value) {
    toggleSelection(messageId)
  }
}

// JSON 导出
async function exportSelectedAsJSON() {
  const selected = messages.value.filter(m => selectedIds.value.has(m.id))

  if (selected.length === 0) {
    alert('请先选择要导出的消息')
    return
  }

  const exportData = {
    version: '1.0',
    exportTime: Date.now(),
    messageCount: selected.length,
    messages: selected.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp || Date.now(),
      ...(msg.tool && { tool: msg.tool }),
      ...(msg.toolParams && { toolParams: msg.toolParams }),
      ...(msg.isToolResult && { isToolResult: true }),
      ...(msg.toolResultData && { toolResultData: msg.toolResultData })
    }))
  }

  const jsonStr = JSON.stringify(exportData, null, 2)
  const fileName = `anchor_messages_${Date.now()}.json`

  try {
    const result = await window.electronAPI.saveJsonFile(fileName, jsonStr)
    if (result.success) {
      alert(`导出成功：${result.path}`)
      toggleMultiSelectMode()
    }
  } catch (e) {
    console.error('导出 JSON 失败:', e)
    alert('导出失败，请重试')
  }
}

// 图片导出 - 合并所有选中消息为一张图片
async function exportSelectedAsImage() {
  const selectedArray = Array.from(selectedIds.value)

  if (selectedArray.length === 0) {
    alert('请先选择要导出的消息')
    return
  }

  try {
    // 创建一个临时容器来组合所有选中的消息
    const container = document.createElement('div')
    container.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      background: #0f1419;
      padding: 20px;
      width: 440px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `
    document.body.appendChild(container)

    // 按照消息在列表中的原始顺序克隆（而不是选中顺序）
    const sortedSelectedIds = messages.value
      .filter(msg => selectedIds.value.has(msg.id))
      .map(msg => msg.id)

    // 克隆所有选中的消息元素
    for (const id of sortedSelectedIds) {
      const element = document.querySelector(`[data-message-id="${id}"]`) as HTMLElement
      if (element) {
        const clone = element.cloneNode(true) as HTMLElement
        // 移除复选框
        const checkbox = clone.querySelector('.message-checkbox')
        if (checkbox) checkbox.remove()
        // 移除选中样式
        clone.classList.remove('selected', 'multi-select-mode')
        clone.style.marginLeft = '0'
        container.appendChild(clone)
      }
    }

    // 等待渲染完成
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 500))

    // 截图
    const canvas = await html2canvas(container, {
      backgroundColor: '#0f1419',
      scale: 2,
      logging: false,
      useCORS: true
    })

    // 清理临时容器
    document.body.removeChild(container)

    const base64Image = canvas.toDataURL('image/png')
    const fileName = `anchor_messages_${Date.now()}.png`

    const result = await window.electronAPI.saveImage(fileName, base64Image)
    if (result.success) {
      alert(`导出成功：${result.path}`)
      toggleMultiSelectMode()
    }
  } catch (err) {
    console.error('导出图片失败:', err)
    alert('导出失败，请重试')
  }
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isLoading.value) return

  // 1. 尝试通过 Bridge 处理输入（工具拦截）
  const processed = await handleInput(text)
  if (processed) {
    inputText.value = ''
    scrollToBottom()
    return
  }

  // 2. 检查是否在等待工具确认
  if (awaitingConfirm.value) {
    const lowerText = text.toLowerCase()
    const isConfirm = /^(好|行|可以|试试|开始|嗯|ok|yes|是的|来吧|要)/.test(lowerText)
    const isReject = /^(不|算了|不用|不要|拒绝|no|取消|等等)/.test(lowerText)

    // 添加用户消息
    const userMsg = {
      id: generateMessageId(),
      role: 'user' as const,
      content: text,
      timestamp: Date.now()
    }
    messages.value.push(userMsg)
    addMessage(userMsg)
    inputText.value = ''

    if (isConfirm) {
      // 用户确认，执行工具
      const pending = confirmTool()
      if (pending) {
        if (pending.tool === 'gemini_cli') {
          // Gemini CLI 特殊处理：重新发给 agent 执行
          awaitingConfirm.value = false
          await processNormalMessage(text)
          scrollToBottom()
          return
        }
        const toolMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: '',
          tool: pending.tool,
          toolParams: pending.params,
          timestamp: Date.now()
        }
        messages.value.push(toolMsg)
        addMessage(toolMsg)
      }
      awaitingConfirm.value = false
    } else if (isReject) {
      // 用户拒绝
      cancelToolConfirm()
      awaitingConfirm.value = false
      const rejectMsg = {
        id: generateMessageId(),
        role: 'assistant' as const,
        content: '好的，那我们继续聊聊？',
        timestamp: Date.now()
      }
      messages.value.push(rejectMsg)
      addMessage(rejectMsg)
    } else {
      // 用户可能想换一个工具或说别的，继续正常对话
      cancelToolConfirm()
      awaitingConfirm.value = false
      // 继续走正常流程
      await processNormalMessage(text)
    }
    scrollToBottom()
    return
  }

  // 3. 正常对话流程
  const userMsg = {
    id: generateMessageId(),
    role: 'user' as const,
    content: text,
    timestamp: Date.now()
  }
  messages.value.push(userMsg)
  addMessage(userMsg)
  inputText.value = ''

  await processNormalMessage(text)
}

async function handleUploadFile() {
  try {
    const result = await window.electronAPI?.selectAndCopyFile()
    if (result && result.success && result.path) {
      const addedText = `[已上传文件: ${result.path}] `
      inputText.value = (inputText.value ? inputText.value + '\n' : '') + addedText
      nextTick(() => inputRef.value?.focus())
    }
  } catch (error) {
    console.error('上传文件失败:', error)
  }
}

/** 中止当前回答 */
function abortResponse() {
  if (!isLoading.value) return
  console.log('[Chat] 用户中止回答')
  abortFlag = true

  // 保留已收到的流式内容
  if (streamingContent.value.trim()) {
    const partialMsg = {
      id: generateMessageId(),
      role: 'assistant' as const,
      content: streamingContent.value + '\n\n*(已中止)*',
      timestamp: Date.now()
    }
    messages.value.push(partialMsg)
    addMessage(partialMsg)
  }

  streamingContent.value = ''
  isLoading.value = false
  scrollToBottom()
}

async function processNormalMessage(text: string) {
  isLoading.value = true
  streamingContent.value = ''
  abortFlag = false
  scrollToBottom()

  try {
    const responses = await sendToAgent(
      text, 
      messages.value,
      (chunk: string) => {
        if (abortFlag) return  // 中止后忽略后续 chunk
        streamingContent.value += chunk
        scrollToBottom()
      }
    )

    // 如果已中止，跳过后续处理
    if (abortFlag) return
    
    let streamingMessageAdded = false

    // 检查是否有 tool_result 响应，如果有则不添加流式内容作为消息
    const hasToolResult = responses.some(r => r.type === 'tool_result')

    if (streamingContent.value && !hasToolResult) {
      const assistantMsg = {
        id: generateMessageId(),
        role: 'assistant' as const,
        content: streamingContent.value,
        timestamp: Date.now()
      }
      messages.value.push(assistantMsg)
      addMessage(assistantMsg)
      streamingContent.value = ''
      streamingMessageAdded = true
    } else if (hasToolResult) {
      // 有工具结果时，清空流式内容（JSON 不需要显示）
      streamingContent.value = ''
    }

    for (const response of responses) {
      if (response.type === 'message' && response.content) {
        if (streamingMessageAdded) continue

        const msg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.content || '',
          timestamp: Date.now()
        }
        messages.value.push(msg)
        addMessage(msg)
      } else if (response.type === 'tool_confirm') {
        // 工具确认：显示确认消息，等待用户回复
        const confirmMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.confirmMessage || '',
          timestamp: Date.now()
        }
        messages.value.push(confirmMsg)
        addMessage(confirmMsg)
        awaitingConfirm.value = true
      } else if (response.type === 'tool') {
        const toolMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: '',
          tool: response.tool,
          toolParams: response.params,
          timestamp: Date.now()
        }
        messages.value.push(toolMsg)
        addMessage(toolMsg)
      } else if (response.type === 'tool_start') {
        // 工具启动消息
        const startMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.content || '',
          tool: response.tool,
          isToolStart: true,
          timestamp: Date.now()
        }
        messages.value.push(startMsg)
        addMessage(startMsg)
      } else if (response.type === 'tool_result') {
        // 工具结果消息
        const resultMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.content || '',
          tool: response.tool,
          isToolResult: true,
          toolResultData: response.resultData as Record<string, unknown> | undefined,
          timestamp: Date.now()
        }
        messages.value.push(resultMsg)
        addMessage(resultMsg)
      } else if ((response as any).type === 'gemini_task') {
        // Gemini 异步任务卡片
        const taskMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.content || '',
          geminiTaskId: response.params?.taskId as string,
          geminiTaskStatus: 'running',
          timestamp: Date.now()
        }
        messages.value.push(taskMsg)
        addMessage(taskMsg)
      } else if (response.type === 'image' && response.imageUrl) {
        // 图片消息
        const imageMsg = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: response.content || '',
          imageUrl: response.imageUrl,
          timestamp: Date.now()
        }
        messages.value.push(imageMsg)
        addMessage(imageMsg)
      }
      scrollToBottom()
    }
  } catch (error) {
    console.error('Agent error:', error)
    const errorMsg = {
      id: generateMessageId(),
      role: 'assistant' as const,
      content: '抱歉，出了点问题。深呼吸，我们再试一次？',
      timestamp: Date.now()
    }
    messages.value.push(errorMsg)
    addMessage(errorMsg)
  } finally {
    isLoading.value = false
    streamingContent.value = ''
    scrollToBottom()
    
    // 检查是否需要压缩历史
    if (shouldCompress()) {
      try {
        const { recent } = getContextMessages()
        const summary = await compressHistory(recent.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        })))
        await addCompressedSummary(summary)
        console.log('[Chat] History compressed:', summary)
      } catch (e) {
        console.warn('[Chat] Failed to compress history:', e)
      }
    }
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
    // 保持输入框聚焦
    if (inputRef.value && !isLoading.value) {
      inputRef.value.focus()
    }
  })
}

// 图片操作
const previewImageUrl = ref<string | null>(null)

function openImage(imageUrl: string | undefined) {
  if (!imageUrl) return
  // data URL 不能用 window.open，使用模态框预览
  if (imageUrl.startsWith('data:')) {
    previewImageUrl.value = imageUrl
  } else {
    window.open(imageUrl, '_blank')
  }
}

function closeImagePreview() {
  previewImageUrl.value = null
}

async function saveImage(imageUrl: string | undefined) {
  if (!imageUrl) return
  try {
    // 尝试通过 Electron API 保存
    if (window.electronAPI?.saveImage) {
      const fileName = `anchor_image_${Date.now()}.png`
      await window.electronAPI.saveImage(fileName, imageUrl)
    } else {
      // 降级到浏览器下载
      const link = document.createElement('a')
      link.href = imageUrl
      link.download = `anchor_image_${Date.now()}.png`
      link.click()
    }
  } catch (e) {
    console.error('Failed to save image:', e)
  }
}

// 清空消息（新建会话时调用）
function clearMessages() {
  messages.value = []
  streamingContent.value = ''
}

// 从当前 session 加载消息（角色切换恢复会话时调用）
function loadFromSession() {
  const { currentSession } = useSessionStore()
  if (currentSession.value && currentSession.value.messages.length > 0) {
    messages.value = currentSession.value.messages.map(m => ({
      id: `msg_${m.timestamp}_${Math.random().toString(36).slice(2, 9)}`,
      role: m.role,
      content: m.content,
      tool: m.tool,
      toolParams: m.toolParams,
      isToolStart: m.toolContext?.isToolStart,
      isToolResult: m.toolContext?.isToolResult,
      toolResultData: m.toolContext?.resultData as Record<string, unknown> | undefined,
      timestamp: m.timestamp
    }))
  } else {
    messages.value = []
  }
  streamingContent.value = ''
}

// Gemini 任务状态标签
function getTaskStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    running: '执行中...',
    completed: '✅ 已完成',
    failed: '❌ 失败',
    cancelled: '⭕ 已取消',
    timeout: '⏰ 超时',
  }
  return labels[status || 'running'] || '执行中...'
}

// 取消 Gemini 任务
async function cancelGeminiTask(taskId?: string) {
  if (!taskId) return
  try {
    await window.electronAPI.gemini.cancelTask(taskId)
    // 更新消息卡片状态
    const msg = messages.value.find(m => m.geminiTaskId === taskId)
    if (msg) {
      msg.geminiTaskStatus = 'cancelled'
      msg.content = msg.content.replace('正在后台执行...', '已取消')
    }
  } catch (e) {
    console.error('取消任务失败:', e)
  }
}

// 为现有消息补充 ID（向后兼容）
onMounted(() => {
  messages.value.forEach(msg => {
    if (!msg.id) {
      msg.id = generateMessageId()
      msg.timestamp = msg.timestamp || Date.now()
    }
  })

  // 初始化 Gemini 异步任务事件监听
  setupGeminiTaskListener()

  // 监听 Gemini 任务状态更新
  window.electronAPI?.gemini?.onTaskEvent?.((event: string, data: any) => {
    const taskId = data?.taskId
    if (!taskId) return

    // 更新对应任务卡片的状态
    const taskMsg = messages.value.find(m => m.geminiTaskId === taskId)
    if (taskMsg) {
      if (event === 'completed') {
        taskMsg.geminiTaskStatus = 'completed'
        taskMsg.content = taskMsg.content.replace('正在后台执行...', '已完成 ✅')
      } else if (event === 'failed') {
        taskMsg.geminiTaskStatus = 'failed'
        taskMsg.content = taskMsg.content.replace('正在后台执行...', '失败 ❌')
      } else if (event === 'cancelled') {
        taskMsg.geminiTaskStatus = 'cancelled'
        taskMsg.content = taskMsg.content.replace('正在后台执行...', '已取消')
      }
    }
  })

  // 监听 Gemini 异步结果推入对话流
  window.addEventListener('gemini-result-ready', ((e: CustomEvent) => {
    const { message, sessionId } = e.detail
    if (message) {
      const resultMsg = {
        id: generateMessageId(),
        role: 'assistant' as const,
        content: message.content || '',
        timestamp: Date.now()
      }
      
      const { currentSession, addMessageToSession } = useSessionStore()
      if (sessionId && currentSession.value?.id !== sessionId) {
          // 非当前会话，静默写入对应的数据库记录
          addMessageToSession(sessionId, resultMsg).then(() => {
              console.log(`[Chat] 后台任务完成，结果已写入历史会话: ${sessionId}`)
              // 如果有全局通知组件（比如 ElMessage），可以在这里调用
          })
      } else {
          // 是当前会话，正常上屏展示
          messages.value.push(resultMsg)
          addMessage(resultMsg)
          scrollToBottom()
      }
    }
  }) as EventListener)

  // 拦截消息区域中的链接点击，在系统浏览器打开
  messageListRef.value?.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href) return

    e.preventDefault()
    e.stopPropagation()

    // 通过 Electron shell 或降级 window.open 打开
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(href)
    } else {
      window.open(href, '_blank')
    }
  })
})

// 暴露给父组件
defineExpose({ clearMessages, loadFromSession })

// 启动时自动加载会话：session.init() 是异步的，currentSession 可能在组件挂载后才就绪
// 用 watch 监听，一旦 currentSession 有值且本地消息为空，自动加载一次
const { currentSession } = useSessionStore()
watch(currentSession, (session) => {
  if (session && session.messages.length > 0 && messages.value.length === 0) {
    loadFromSession()
  }
}, { immediate: true })

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
  position: relative;
  cursor: default;
  transition: all 0.2s ease;
}

.message.multi-select-mode {
  cursor: pointer;
  margin-left: 36px;
}

/* 选中状态 - 极简设计 */
.message.selected .message-content {
  opacity: 0.65;
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

/* 多选复选框 - 完美圆形 */
.message-checkbox {
  position: absolute;
  left: -30px;
  top: 16px;
  width: 20px;
  height: 20px;
  z-index: 10;
}

.message-checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
  margin: 0;
  padding: 0;
  display: block;
}

.message-checkbox input[type="checkbox"]:hover {
  border-color: rgba(74, 222, 128, 0.6);
  background: rgba(74, 222, 128, 0.1);
}

.message-checkbox input[type="checkbox"]:checked {
  background: #4ade80;
  border-color: #4ade80;
}

.message-checkbox input[type="checkbox"]:checked::after {
  content: '✓';
  position: absolute;
  color: #0f1419;
  font-size: 14px;
  font-weight: bold;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  line-height: 1;
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
  font-weight: inherit; /* 跟随全局字体粗细设置 */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.message.assistant .message-content:not(.tool-content) {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); /* 为 AI 气泡也加一点阴影 */
}

/* 工具启动消息 */
.tool-start-message {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.tool-badge {
  font-size: 24px;
  flex-shrink: 0;
}

.tool-start-message .markdown-body {
  flex: 1;
}

/* 工具结果容器 - 居中显示 */
.tool-result-container {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

/* Gemini 异步任务卡片 */
.gemini-task-card {
  padding: 4px 0;
}

.task-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.task-icon {
  font-size: 18px;
}

.task-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.task-status.running {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  animation: pulse-status 2s ease-in-out infinite;
}

.task-status.completed {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
}

.task-status.failed,
.task-status.timeout {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.task-status.cancelled {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

@keyframes pulse-status {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.task-card-footer {
  margin-top: 8px;
}

.cancel-task-btn {
  background: transparent;
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-task-btn:hover {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.5);
}

/* Markdown 样式 */
.markdown-body {
  font-size: var(--base-font-size, 14.5px);
  line-height: 1.65;
}

.streaming-text {
  font-size: var(--base-font-size, 14.5px);
  line-height: 1.65;
  white-space: pre-wrap;
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
  word-break: break-all;
  white-space: pre-wrap;
}

.markdown-body :deep(pre) {
  overflow-x: hidden;
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  border-radius: 8px;
  margin: 8px 0;
  max-width: 100%;
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  word-break: break-all;
  white-space: pre-wrap;
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

.markdown-body :deep(a) {
  color: #6ee7a0;
  text-decoration: none;
  border-bottom: 1px solid rgba(110, 231, 160, 0.3);
  transition: color 0.15s ease, border-color 0.15s ease;
}

.markdown-body :deep(a:hover) {
  color: #86efac;
  border-bottom-color: rgba(134, 239, 172, 0.6);
}

/* 图片消息 */
.image-message {
  position: relative;
  max-width: 100%;
}

.image-message img {
  max-width: 100%;
  max-height: 300px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform 0.2s ease;
}

.image-message img:hover {
  transform: scale(1.02);
}

.save-image-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: var(--radius-sm);
  color: white;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-message:hover .save-image-btn {
  opacity: 1;
}

.save-image-btn:hover {
  background: rgba(0, 0, 0, 0.8);
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
  font-size: var(--base-font-size, 14.5px);
  line-height: 1.4;
}

.input-area textarea:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.upload-btn {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.upload-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
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

.send-btn.abort-btn {
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
  cursor: pointer;
  opacity: 1;
  animation: abort-pulse 1.5s ease-in-out infinite;
}

.send-btn.abort-btn:hover {
  background: rgba(239, 68, 68, 1);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
}

.send-btn.abort-btn span {
  font-size: 14px;
}

@keyframes abort-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}

/* 图片预览模态框 */
.image-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: pointer;
}

.image-preview-modal img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  cursor: default;
}

.close-preview-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  font-size: 24px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.2s;
}

.close-preview-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* 多选工具栏 */
.multi-select-toolbar {
  position: fixed;
  bottom: 72px;
  left: 16px;
  right: 16px;
  padding: 12px 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
}

.toolbar-info {
  font-size: 14px;
  color: var(--text-secondary);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.toolbar-actions button {
  padding: 6px 12px;
  font-size: 13px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}

.toolbar-actions button:hover {
  background: var(--accent);
}

.toolbar-enter-active,
.toolbar-leave-active {
  transition: all 0.25s ease;
}

.toolbar-enter-from,
.toolbar-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
