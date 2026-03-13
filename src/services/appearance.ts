import { ref, watch } from 'vue'

const APPEARANCE_SETTINGS_KEY = 'anchor_appearance_settings'

export interface AppearanceSettings {
  fontSize: number    // 全局基础字号 (px)
  fontWeight: number  // 全局基础字重 (300-600)
}

const defaultSettings: AppearanceSettings = {
  fontSize: 14.5,
  fontWeight: 400
}

const settings = ref<AppearanceSettings>({ ...defaultSettings })

// 初始化标识
let isInitializing = false

function init() {
  if (isInitializing) return
  isInitializing = true

  const stored = localStorage.getItem(APPEARANCE_SETTINGS_KEY)
  if (stored) {
    try {
      settings.value = { ...defaultSettings, ...JSON.parse(stored) }
      // 进行一些合理的范围限制保护
      settings.value.fontSize = Math.max(12, Math.min(24, settings.value.fontSize))
      settings.value.fontWeight = Math.max(300, Math.min(600, settings.value.fontWeight))
    } catch (e) {
      console.error('[Appearance] 解析外观设置失败:', e)
    }
  }

  // 初始应用
  applyToRoot()

  // 监听变化并自动持久化、应用
  watch(settings, () => {
    localStorage.setItem(APPEARANCE_SETTINGS_KEY, JSON.stringify(settings.value))
    applyToRoot()
  }, { deep: true })
}

function applyToRoot() {
  const root = document.documentElement
  root.style.setProperty('--base-font-size', `${settings.value.fontSize}px`)
  root.style.setProperty('--base-font-weight', `${settings.value.fontWeight}`)
}

export function useAppearanceStore() {
  if (!isInitializing) {
    init()
  }

  return {
    settings,
    reset: () => {
      settings.value = { ...defaultSettings }
    }
  }
}
