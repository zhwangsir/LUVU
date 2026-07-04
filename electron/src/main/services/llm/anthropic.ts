/**
 * Anthropic Claude Messages API streaming（含 tool_use）。
 *
 * 协议细节：
 *   - content_block_start: type=tool_use → 开始一个 tool_use 块，含 id/name
 *   - content_block_delta: type=input_json_delta → 逐步累积 input JSON 字符串
 *   - content_block_stop → 一个 tool_use 块结束，此时整段 JSON 完整
 *   - message_delta: stop_reason='tool_use' → 整条消息因 tool 暂停
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ToolDefinition } from '@shared/tools'
import type { ChatExtraOptions, ChatStreamCallback, LlmProviderImpl } from './types'
import { enhanceMessagesForChineseModel } from './chinese-models'
import { loadConfig } from '../config-store'

interface PendingToolUse {
  id: string
  name: string
  json_buf: string
}

export class AnthropicProvider implements LlmProviderImpl {
  readonly name = 'anthropic' as const

  constructor(
    private endpoint: string,
    private apiKey: string,
    private anthropicVersion = '2023-06-01',
  ) {
    if (!this.endpoint || this.endpoint.length === 0) {
      this.endpoint = 'https://api.anthropic.com'
    }
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
    extra?: ChatExtraOptions,
  ): Promise<void> {
    if (!this.apiKey) {
      onEvent({ error: 'Anthropic API key 未配置' })
      onEvent({ done: true })
      return
    }

    // Phase 1 I (P3): 国产模型检测增强 — 用户通过 OpenRouter / anthropic-compat
    // 代理 GLM / Qwen 等国产模型时仍能命中（不止 openai_compat 路径）
    // 用户可在 settings.chinese_llm_enhance=false 关闭
    const cfg = loadConfig()
    const enhanced =
      cfg.chinese_llm_enhance === false
        ? messages
        : enhanceMessagesForChineseModel(messages, options.model)

    let system = ''
    const msgs: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
    for (const m of enhanced) {
      if (m.role === 'system') {
        system += (system ? '\n\n' : '') + m.content
      } else if (m.role === 'user' || m.role === 'assistant') {
        msgs.push({ role: m.role, content: m.content })
      }
    }

    // 附加上一轮 tool_results（作为 user 消息的 content blocks）
    if (extra?.tool_results && extra.tool_results.length > 0) {
      msgs.push({
        role: 'user',
        content: extra.tool_results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
          ...(r.is_error ? { is_error: true } : {}),
        })),
      })
    }

    const url = `${this.endpoint.replace(/\/+$/, '')}/v1/messages`
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.max_tokens ?? 4096,
      temperature: options.temperature,
      stream: true,
      messages: msgs,
    }
    if (system) body.system = system
    if (extra?.tools && extra.tools.length > 0) {
      body.tools = extra.tools.map((t) => toAnthropicTool(t))
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
        body: JSON.stringify(body),
        signal: abortSignal ?? null,
      })
    } catch (e) {
      onEvent({ error: String(e) })
      onEvent({ done: true })
      return
    }

    if (!resp.ok || !resp.body) {
      const text = resp.body ? await resp.text().catch(() => '') : ''
      onEvent({ error: `Anthropic ${resp.status}: ${text || resp.statusText}` })
      onEvent({ done: true })
      return
    }

    let stopReason: string | null = null
    const pendingByIndex = new Map<number, PendingToolUse>()

    await consumeSse(resp.body, (data) => {
      try {
        const ev = JSON.parse(data) as {
          type?: string
          index?: number
          content_block?: { type?: string; id?: string; name?: string; text?: string }
          delta?: {
            type?: string
            text?: string
            partial_json?: string
            stop_reason?: string
          }
          error?: { type?: string; message?: string }
        }
        switch (ev.type) {
          case 'content_block_start': {
            if (ev.content_block?.type === 'tool_use' && typeof ev.index === 'number') {
              pendingByIndex.set(ev.index, {
                id: ev.content_block.id ?? `tool_${ev.index}`,
                name: ev.content_block.name ?? '',
                json_buf: '',
              })
            }
            break
          }
          case 'content_block_delta': {
            if (ev.delta?.type === 'text_delta' && ev.delta.text) {
              onEvent({ delta: ev.delta.text })
            } else if (ev.delta?.type === 'input_json_delta' && typeof ev.index === 'number') {
              const p = pendingByIndex.get(ev.index)
              if (p) p.json_buf += ev.delta.partial_json ?? ''
            }
            break
          }
          case 'content_block_stop': {
            if (typeof ev.index === 'number' && pendingByIndex.has(ev.index)) {
              const p = pendingByIndex.get(ev.index)!
              pendingByIndex.delete(ev.index)
              let parsed: Record<string, unknown> = {}
              if (p.json_buf) {
                try {
                  parsed = JSON.parse(p.json_buf) as Record<string, unknown>
                } catch (e) {
                  console.warn('[anthropic] tool input json parse failed', e, p.json_buf)
                }
              }
              onEvent({ tool_use: { id: p.id, name: p.name, input: parsed } })
            }
            break
          }
          case 'message_delta': {
            if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
            break
          }
          case 'error': {
            const msg = ev.error?.message ?? ev.error?.type ?? 'Anthropic 未明确错误'
            onEvent({ error: `Anthropic: ${msg}` })
            break
          }
          default:
            break
        }
      } catch {
        /* skip malformed */
      }
    })

    if (stopReason === 'tool_use') onEvent({ needs_tools: true })
    onEvent({ done: true })
  }
}

function toAnthropicTool(t: ToolDefinition): {
  name: string
  description: string
  input_schema: ToolDefinition['input_schema']
} {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }
}

/** 解析 SSE：按空行分块，把每个 data: 行的载荷交给 onData */
export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data && data !== '[DONE]') onData(data)
        }
      }
      idx = buf.indexOf('\n\n')
    }
  }
}
