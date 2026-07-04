import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ToolDefinition } from '@shared/tools'

export interface ChatStreamEvent {
  delta?: string
  /** LLM 发起的 tool_use（Anthropic 格式：tool 已完整解析） */
  tool_use?: {
    id: string
    name: string
    input: Record<string, unknown>
  }
  /** stop_reason 'tool_use' 时设 true，让上层进入 tool result loop */
  needs_tools?: boolean
  done?: boolean
  error?: string
}

export type ChatStreamCallback = (evt: ChatStreamEvent) => void

export interface ChatExtraOptions {
  /** 工具定义（Anthropic 用 tool_use；OpenAI 用 functions） */
  tools?: ToolDefinition[]
  /** 上一轮的工具结果，将作为 user 消息附加 */
  tool_results?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
}

export interface LlmProviderImpl {
  readonly name: 'anthropic' | 'openai_compat' | 'ollama'
  chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
    extra?: ChatExtraOptions,
  ): Promise<void>
}
