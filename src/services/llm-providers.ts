/**
 * LLM 提供商配置管理
 * 
 * V2: 支持多模型提供商，兼容 OpenAI API 格式。
 * 所有提供商配置持久化到 localStorage。
 */

import { ref, computed } from 'vue'

// ============ 类型定义 ============

export type ModelIntent = 'fast' | 'simple' | 'complex' | 'image' | 'embedding' | 'reranker'

/** 模型提供商定义 */
export interface ModelProvider {
    id: string
    name: string
    baseURL: string
    apiKey: string
    models: Partial<Record<ModelIntent, string>>
    enabled: boolean
    isBuiltin: boolean          // 预置提供商不可删除
}

// ============ 预置提供商 ============

const BUILTIN_PROVIDERS: ModelProvider[] = [
    {
        id: 'cstcloud',
        name: 'CSTCloud',
        baseURL: 'https://uni-api.cstcloud.cn/v1',
        apiKey: import.meta.env.VITE_DASHSCOPE_API_KEY_SCTCLOUD || '',
        models: {
            fast: 'gpt-oss-120b',
            simple: 'deepseek-v3:671b',
            complex: 'qwen3.5',
            image: 'qwen2.5-vl:72b',
            reranker: 'bge-reranker-v2-m3',
            embedding: 'bge-large-zh:latest'
        },
        enabled: true,
        isBuiltin: true,
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: '',
        models: {
            fast: 'deepseek/deepseek-chat',
            simple: 'deepseek/deepseek-chat',
            complex: 'anthropic/claude-sonnet-4-5',
            // embedding: 'openai/text-embedding-3-small',
        },
        enabled: false,
        isBuiltin: true,
    },
    {
        id: 'dashscope',
        name: 'DashScope (阿里云)',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: import.meta.env.VITE_DASHSCOPE_API_KEY_QWEN || '',
        models: {
            fast: 'glm-4.7',//tongyi-xiaomi-analysis-pro;tongyi-xiaomi-analysis-flash;qwen3-vl-flash-2026-01-22
            simple: 'kimi-k2.5',
            complex: 'qwen3-max-2026-01-23',
            // embedding: 'qwen3-vl-embedding',
            reranker: 'qwen3-vl-rerank'
        },
        enabled: true,
        isBuiltin: true,

    },
    // qwen3-vl-plus-2025-12-19
    // 剩971,836/共1,000,000
    // 2026/03/19
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // glm-4.7
    // 剩862,082/共1,000,000
    // 2026/03/25
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // tongyi-xiaomi-analysis-pro
    // 剩1,000,000/共1,000,000
    // 2026/04/09
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // tongyi-xiaomi-analysis-flash
    // 剩1,000,000/共1,000,000
    // 2026/04/09
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // qwen3-vl-flash-2026-01-22
    // 剩972,598/共1,000,000
    // 2026/04/22
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // qwen3-max-2026-01-23
    // 剩971,829/共1,000,000
    // 2026/04/23
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // qwen-flash-character
    // 剩1,000,000/共1,000,000
    // 2026/04/23
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // MiniMax-M2.1
    // 剩940,181/共1,000,000
    // 2026/04/23
    // 已开启	
    // 免费额度用完即停
    // 购买节省计划
    // kimi-k2.5
    // 剩908,723/共1,000,000
    // 2026/04/30
    // 已开启
    {
        id: 'gemini',
        name: 'Google Gemini',
        baseURL: 'http://127.0.0.1:8045/v1',
        apiKey: import.meta.env.VITE_ANTI_GEMINI_API_KEY,
        models: {
            fast: 'gemini-3-flash',
            simple: 'gemini-3-pro-low',
            complex: 'gemini-3.1-pro-high',
            reranker: 'gpt-oss-120b-medium',
        },
        enabled: true,
        isBuiltin: true,
    },
]

// ============ 存储 ============

const STORAGE_KEY = 'anchor_llm_providers'
const ACTIVE_KEY = 'anchor_active_provider'

const providers = ref<ModelProvider[]>([])
const activeProviderId = ref<string>('cstcloud')
let initialized = false

// ============ 初始化 ============

function init() {
    if (initialized) return
    initialized = true

    // 加载用户保存的配置
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
        try {
            const savedProviders: ModelProvider[] = JSON.parse(stored)
            const merged = BUILTIN_PROVIDERS.map(builtin => {
                const saved = savedProviders.find(s => s.id === builtin.id)
                if (saved) {
                    return {
                        ...builtin,
                        // 如果缓存里的 API Key 是空的，但 .env 里配了，强行使用 .env 里的
                        apiKey: saved.apiKey || builtin.apiKey,
                        models: { ...builtin.models, ...saved.models },
                        enabled: saved.enabled,
                    }
                }
                return { ...builtin }
            })
            // 加入用户自定义的非预置提供商
            const customProviders = savedProviders.filter(
                s => !BUILTIN_PROVIDERS.some(b => b.id === s.id)
            )
            providers.value = [...merged, ...customProviders]
        } catch (e) {
            console.error('[Providers] 加载配置失败:', e)
            providers.value = BUILTIN_PROVIDERS.map(p => ({ ...p }))
        }
    } else {
        providers.value = BUILTIN_PROVIDERS.map(p => ({ ...p }))
    }

    // 加载活跃提供商
    const savedActive = localStorage.getItem(ACTIVE_KEY)
    if (savedActive && providers.value.some(p => p.id === savedActive)) {
        activeProviderId.value = savedActive
    }

    // 回填硬编码的 CSTCloud API Key（向下兼容）
    const cstcloud = providers.value.find(p => p.id === 'cstcloud')
    if (cstcloud && !cstcloud.apiKey) {
        cstcloud.apiKey = '3b16ea8e11d783dc29306bc4dcd8da83d2abcf65ce2399d0fe43ef93ef3aed72'

    }

    console.log('[Providers] 已初始化，活跃提供商:', activeProviderId.value)
}

// ============ 持久化 ============

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(providers.value))
    localStorage.setItem(ACTIVE_KEY, activeProviderId.value)
}

// ============ 查询方法 ============

/** 当前活跃提供商 */
const activeProvider = computed<ModelProvider>(() => {
    init()
    return providers.value.find(p => p.id === activeProviderId.value)
        || providers.value.find(p => p.enabled)
        || providers.value[0]
})

/** 获取指定意图对应的模型名 */
function getModelForIntent(intent: ModelIntent): string {
    const provider = activeProvider.value
    return provider.models[intent] || provider.models.simple || 'unknown'
}

/** 获取活跃提供商的 LLM 配置 */
function getConfigForIntent(intent: ModelIntent): { baseURL: string; model: string; apiKey: string } {
    const provider = activeProvider.value
    return {
        baseURL: provider.baseURL,
        model: getModelForIntent(intent),
        apiKey: provider.apiKey,
    }
}

// ============ 管理方法 ============

/** 切换活跃提供商 */
function setActiveProvider(id: string) {
    if (providers.value.some(p => p.id === id)) {
        activeProviderId.value = id
        save()
        console.log('[Providers] 切换活跃提供商:', id)
    }
}

/** 更新提供商配置 */
function updateProvider(id: string, updates: Partial<ModelProvider>) {
    const provider = providers.value.find(p => p.id === id)
    if (provider) {
        Object.assign(provider, updates)
        save()
    }
}

/** 添加自定义提供商 */
function addProvider(provider: Omit<ModelProvider, 'isBuiltin'>): ModelProvider {
    const newProvider: ModelProvider = {
        ...provider,
        isBuiltin: false,
    }
    providers.value.push(newProvider)
    save()
    return newProvider
}

/** 删除自定义提供商（预置不可删除） */
function deleteProvider(id: string): boolean {
    const provider = providers.value.find(p => p.id === id)
    if (!provider || provider.isBuiltin) return false

    providers.value = providers.value.filter(p => p.id !== id)
    if (activeProviderId.value === id) {
        activeProviderId.value = providers.value[0]?.id || 'cstcloud'
    }
    save()
    return true
}

// ============ 导出 ============

export function useProviderStore() {
    init()
    return {
        providers,
        activeProviderId,
        activeProvider,
        getModelForIntent,
        getConfigForIntent,
        setActiveProvider,
        updateProvider,
        addProvider,
        deleteProvider,
    }
}
