/**
 * LLM auto-detect IPC channel (UX R20).
 */
import { defineChannel } from '../ipc-channel'

export interface DetectedEndpointShape {
  endpoint: string
  label: string
  models: string[]
  latencyMs: number
}

export interface LlmAutoDetectResult {
  found: DetectedEndpointShape[]
  failed: Array<{ endpoint: string; reason: string }>
  totalMs: number
}

/** 扫常见本机 LLM endpoint + 用户自定义；返检测到的可用 endpoint 列表 */
export const llmAutoDetect = defineChannel<
  { customEndpoint?: string } | undefined,
  LlmAutoDetectResult
>('llm:auto-detect')
