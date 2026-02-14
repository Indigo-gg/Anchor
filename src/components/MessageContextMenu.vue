<template>
  <Teleport to="body">
    <div v-if="visible"
         class="context-menu-overlay"
         @click="close"
         @contextmenu.prevent>
      <div class="context-menu"
           :style="menuStyle"
           @click.stop>
        <div class="menu-item" @click="onMultiSelect">
          <span class="menu-icon">☑️</span>
          <span>多选消息</span>
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" @click="onCopy">
          <span class="menu-icon">📋</span>
          <span>复制消息</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

interface Props {
  visible: boolean
  x: number
  y: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  multiSelect: []
  copy: []
}>()

const menuStyle = computed(() => {
  const style: Record<string, string> = {
    left: `${props.x}px`,
    top: `${props.y}px`
  }

  // 边界检测：防止菜单溢出屏幕
  const menuWidth = 180
  const menuHeight = 100

  if (props.x + menuWidth > window.innerWidth) {
    style.left = `${props.x - menuWidth}px`
  }
  if (props.y + menuHeight > window.innerHeight) {
    style.top = `${props.y - menuHeight}px`
  }

  return style
})

function close() {
  emit('close')
}

function onMultiSelect() {
  emit('multiSelect')
  close()
}

function onCopy() {
  emit('copy')
  close()
}

// ESC 键关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.context-menu {
  position: fixed;
  min-width: 180px;
  background: var(--bg-card);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
  padding: 4px;
  animation: menuFadeIn 0.15s ease-out;
}

@keyframes menuFadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
  font-size: 14px;
  transition: background 0.15s ease;
}

.menu-item:hover {
  background: var(--bg-secondary);
}

.menu-icon {
  font-size: 16px;
}

.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
