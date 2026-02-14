import { ref, computed } from 'vue'

export function useMessageSelection() {
  const isMultiSelectMode = ref(false)
  const selectedIds = ref<Set<string>>(new Set())
  const contextMenuPosition = ref<{ x: number; y: number } | null>(null)
  const contextMenuTargetId = ref<string | null>(null)

  const selectedCount = computed(() => selectedIds.value.size)

  function toggleMultiSelectMode() {
    isMultiSelectMode.value = !isMultiSelectMode.value
    if (!isMultiSelectMode.value) {
      clearSelection()
    }
  }

  function toggleSelection(id: string) {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }
  }

  function clearSelection() {
    selectedIds.value.clear()
  }

  function selectAll(messageIds: string[]) {
    messageIds.forEach(id => selectedIds.value.add(id))
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  function showContextMenu(event: MouseEvent, messageId: string) {
    contextMenuPosition.value = { x: event.clientX, y: event.clientY }
    contextMenuTargetId.value = messageId
  }

  function hideContextMenu() {
    contextMenuPosition.value = null
    contextMenuTargetId.value = null
  }

  return {
    isMultiSelectMode,
    selectedIds,
    selectedCount,
    contextMenuPosition,
    contextMenuTargetId,
    toggleMultiSelectMode,
    toggleSelection,
    clearSelection,
    selectAll,
    isSelected,
    showContextMenu,
    hideContextMenu
  }
}
