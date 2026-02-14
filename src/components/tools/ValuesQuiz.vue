<template>
  <div class="values-quiz">
    <!-- 完成后显示结果 -->
    <template v-if="isComplete">
      <ValuesResult :scores="finalScores" />
    </template>
    
    <!-- 未完成显示题目 -->
    <template v-else>
      <!-- 进度条 -->
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        <span class="progress-text">{{ currentRound }}/{{ totalRounds }}</span>
      </div>

      <!-- 情境描述 -->
      <div class="scenario-card">
        <p class="scenario-text">{{ currentScenario }}</p>
      </div>

      <!-- 选项卡片 -->
      <div class="options-grid">
        <div
          v-for="(option, idx) in currentOptions"
          :key="idx"
          class="option-card"
          :class="{ selected: selectedIndex === idx }"
          @click="selectOption(idx)"
        >
          <div class="option-emoji">{{ getDimensionEmoji(option.dimension) }}</div>
          <p class="option-text">{{ option.text }}</p>
        </div>
      </div>

      <!-- 确认按钮 -->
      <button 
        class="confirm-btn" 
        :disabled="selectedIndex === null || isLoading"
        @click="confirmChoice"
      >
        {{ isLoading ? '思考中...' : (currentRound >= totalRounds ? '查看结果' : '下一题') }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { structuredChat } from '@/services/llm'
import { useValuesStore, SCHWARTZ_DIMENSIONS, getDimension } from '@/services/values'
import ValuesResult from './ValuesResult.vue'

const props = defineProps<{
  context: string      // 用户描述的情境背景
  sessionId: string    // 评估会话ID
}>()

const emit = defineEmits<{
  complete: [scores: Record<string, number>]
}>()

const { addChoice, completeSession } = useValuesStore()

const totalRounds = 6
const currentRound = ref(0)
const isLoading = ref(false)
const selectedIndex = ref<number | null>(null)
const isComplete = ref(false)
const finalScores = ref<Record<string, number>>({})

const currentScenario = ref('')
const currentOptions = ref<Array<{ text: string; dimension: string }>>([])
const choiceHistory = ref<Array<{ scenario: string; choice: string; dimension: string }>>([])

const progressPercent = computed(() => (currentRound.value / totalRounds) * 100)

function getDimensionEmoji(key: string): string {
  return getDimension(key)?.emoji || '🎯'
}

// 生成下一道题目
async function generateNextQuestion() {
  isLoading.value = true
  selectedIndex.value = null

  try {
    // 随机选择3-4个维度用于本题选项
    const shuffled = [...SCHWARTZ_DIMENSIONS].sort(() => Math.random() - 0.5)
    const selectedDims = shuffled.slice(0, 4).map(d => d.key)

    // 使用完整历史，保持故事连贯性
    const historyText = choiceHistory.value.length > 0
      ? choiceHistory.value.map((h, i) => `第${i + 1}题: ${h.scenario}\n你的选择: ${h.choice}`).join('\n\n')
      : '（这是第一题）'

    const prompt = `生成一道价值观情境选择题。

背景：${props.context}
已完成的故事：
${historyText}

要求：
1. 延续故事情节，创造生动情境
2. 提供4个选项，对应维度：${selectedDims.join(', ')}
3. 选项自然，不提价值观名称

只返回JSON，不要markdown代码块：
{"scenario": "情境...", "options": [{"text": "选项A", "dimension": "${selectedDims[0]}"}, {"text": "选项B", "dimension": "${selectedDims[1]}"}, {"text": "选项C", "dimension": "${selectedDims[2]}"}, {"text": "选项D", "dimension": "${selectedDims[3]}"}]}`

    const response = await structuredChat<{
      scenario: string
      options: Array<{ text: string; dimension: string }>
    }>([{ role: 'user', content: prompt }], { intent: 'simple' })

    // 解析响应（可能是对象或字符串）
    let parsed = response
    if (typeof response === 'string') {
      // 尝试从 markdown 代码块中提取 JSON
      const jsonMatch = (response as string).match(/```(?:json)?\s*([\s\S]*?)```/) 
        || (response as string).match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0]
        parsed = JSON.parse(jsonStr)
      }
    }

    if (parsed.scenario && parsed.options && parsed.options.length >= 2) {
      currentScenario.value = parsed.scenario
      currentOptions.value = parsed.options.slice(0, 4)
      currentRound.value++
    } else {
      throw new Error('Invalid response format')
    }
  } catch (e) {
    console.error('[ValuesQuiz] 生成题目失败:', e)
    // 使用备用题目
    useFallbackQuestion()
  } finally {
    isLoading.value = false
  }
}

// 备用题目池
const fallbackQuestions = [
  {
    scenario: '周末你有一整天空闲时间，你会怎么安排？',
    options: [
      { text: '尝试一项从没做过的新活动', dimension: 'stimulation' },
      { text: '陪家人朋友聊天聚会', dimension: 'benevolence' },
      { text: '安安静静看书或学习新技能', dimension: 'self-direction' },
      { text: '处理一些待办事项，让下周更轻松', dimension: 'security' }
    ]
  },
  {
    scenario: '工作中遇到一个新项目，你会怎么处理？',
    options: [
      { text: '主动争取主导权，展示自己的能力', dimension: 'achievement' },
      { text: '优先考虑团队合作，确保大家都能参与', dimension: 'benevolence' },
      { text: '按照公司流程稳步推进', dimension: 'conformity' },
      { text: '用创新的方式尝试突破', dimension: 'self-direction' }
    ]
  },
  {
    scenario: '朋友邀请你参加一个你不太熟悉的聚会，你会...',
    options: [
      { text: '欣然前往，认识新朋友是件有趣的事', dimension: 'stimulation' },
      { text: '考虑一下，看看能否帮朋友什么忙', dimension: 'benevolence' },
      { text: '委婉拒绝，更想待在舒适圈里', dimension: 'security' },
      { text: '去看看能不能拓展人脉资源', dimension: 'power' }
    ]
  },
  {
    scenario: '你发现一个同事在工作中犯了错误，你会...',
    options: [
      { text: '私下提醒他，帮助他改正', dimension: 'benevolence' },
      { text: '按规定向上级汇报', dimension: 'conformity' },
      { text: '不管太多，专注自己的事', dimension: 'self-direction' },
      { text: '看看能否从中学到什么', dimension: 'achievement' }
    ]
  },
  {
    scenario: '面对一个重要的人生选择，你更看重什么？',
    options: [
      { text: '能让我有更多自由和选择权', dimension: 'self-direction' },
      { text: '能给家人带来更好的生活', dimension: 'benevolence' },
      { text: '有稳定的收入和保障', dimension: 'security' },
      { text: '能获得更高的社会认可', dimension: 'achievement' }
    ]
  },
  {
    scenario: '假期结束前最后一天，你会做什么？',
    options: [
      { text: '和家人朋友一起度过', dimension: 'benevolence' },
      { text: '做件让自己开心的事', dimension: 'hedonism' },
      { text: '提前准备明天的工作', dimension: 'security' },
      { text: '完成一个小目标，有成就感地结束假期', dimension: 'achievement' }
    ]
  }
]

function useFallbackQuestion() {
  const idx = currentRound.value % fallbackQuestions.length
  const q = fallbackQuestions[idx]
  currentScenario.value = q.scenario
  currentOptions.value = q.options
  currentRound.value++
}

function selectOption(idx: number) {
  if (!isLoading.value) {
    selectedIndex.value = idx
  }
}

async function confirmChoice() {
  if (selectedIndex.value === null) return

  const option = currentOptions.value[selectedIndex.value]
  
  // 保存选择
  addChoice(props.sessionId, currentScenario.value, option.text, option.dimension)
  choiceHistory.value.push({
    scenario: currentScenario.value,
    choice: option.text,
    dimension: option.dimension
  })

  if (currentRound.value >= totalRounds) {
    // 完成评估 - 显示结果
    const scores = completeSession(props.sessionId)
    finalScores.value = scores
    isComplete.value = true
    emit('complete', scores)
  } else {
    // 生成下一题
    await generateNextQuestion()
  }
}

onMounted(() => {
  generateNextQuestion()
})
</script>

<style scoped>
.values-quiz {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  max-width: 500px;
  margin: 0 auto;
}

.progress-bar {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #a78bfa);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  right: 0;
  top: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.scenario-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  border-left: 4px solid var(--accent);
}

.scenario-text {
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary);
  margin: 0;
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option-card {
  background: var(--bg-card);
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-card:hover {
  border-color: var(--border);
  transform: translateY(-2px);
}

.option-card.selected {
  border-color: var(--accent);
  background: rgba(139, 92, 246, 0.1);
}

.option-emoji {
  font-size: 24px;
}

.option-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
}

.confirm-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 14px 24px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirm-btn:not(:disabled):hover {
  filter: brightness(1.1);
}
</style>
