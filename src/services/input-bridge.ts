import { ref } from 'vue'

// 输入处理函数类型
type InputHandler = (text: string) => void | Promise<void>

// 状态
const currentHandler = ref<InputHandler | null>(null)
const placeholder = ref<string>('说点什么...')

export function useInputBridge() {
    /**
     * 注册输入处理器（由工具调用）
     * @param handler 处理函数
     * @param inputPlaceholder 输入框提示词
     */
    function registerHandler(handler: InputHandler, inputPlaceholder: string = '请输入...') {
        currentHandler.value = handler
        placeholder.value = inputPlaceholder
    }

    /**
     * 移除输入处理器（由工具调用）
     */
    function unregisterHandler() {
        currentHandler.value = null
        placeholder.value = '说点什么...'
    }

    /**
     * 处理输入（由 Chat 组件调用）
     * @param text 用户输入的文本
     * @returns 是否被处理器消费
     */
    async function handleInput(text: string): Promise<boolean> {
        if (currentHandler.value) {
            await currentHandler.value(text)
            return true
        }
        return false
    }

    return {
        isBridgeActive: currentHandler,
        placeholder,
        registerHandler,
        unregisterHandler,
        handleInput
    }
}
