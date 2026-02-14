<template>
  <div class="values-compass-placeholder">
    <div class="placeholder-icon">🧭</div>
    <p class="placeholder-text">价值观探索工具已升级为卡片式交互</p>
    <p class="placeholder-hint">请通过对话启动"价值观雷达"</p>
  </div>
</template>

<script setup lang="ts">
// 旧版 ValuesCompass 组件（保留兼容）
// 新架构使用 ValuesQuiz 组件（卡片式交互）
defineEmits<{
  complete: []
}>()
</script>

<style scoped>
.values-compass-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.placeholder-text {
  font-size: 15px;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.placeholder-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}
</style>
