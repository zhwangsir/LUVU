/**
 * LLM provider 工厂 —— 根据 runtime config 实例化对应 provider。
 */
import type { LlmProvider } from '@shared/types'
import type { LlmProviderImpl } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAiCompatProvider } from './openai-compat'
import { OllamaProvider } from './ollama'

export function buildProvider(
  provider: LlmProvider,
  endpoint: string,
  apiKey: string,
): LlmProviderImpl {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(endpoint, apiKey)
    case 'ollama':
      return new OllamaProvider(endpoint)
    case 'openai_compat':
    default:
      return new OpenAiCompatProvider(endpoint, apiKey)
  }
}

export type { LlmProviderImpl } from './types'
