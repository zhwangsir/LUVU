/**
 * OpenAI-compatible chat completions streaming
 * 覆盖：OpenAI / LM Studio / SiliconFlow / DeepSeek / Ollama (OAI 接口) / 任意自建 OAI 兼容服务
 *
 * v0.7.5 jinja-template 兼容修复：
 *   很多本地模型（特别是社区量化的 Qwen MoE）的 prompt template 对
 *   `system` role 处理不一致，导致 "No user query found in messages" 错误。
 *   修复策略：
 *     1. 默认 `mergeSystemIntoUser=true`（最大兼容性）
 *        把所有 system 内容拼到第一个 user message 前
 *     2. 检测 jinja template 类错误时自动 retry 合并模式
 *     3. 确保至少有 1 个 user message（如果只有 system，转成 user）
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ToolDefinition } from '@shared/tools'
import type { ChatExtraOptions, ChatStreamCallback, LlmProviderImpl } from './types'
import { consumeSse } from './anthropic'
import { loadConfig } from '../config-store'
import { enhanceMessagesForChineseModel } from './chinese-models'

/**
 * v0.21 M7:OpenAI function-calling 转换 — 给 LM Studio / Ollama / vLLM 用户也开 tool。
 * 格式来自 OpenAI Chat Completions API tools 规范:
 *   { type: 'function', function: { name, description, parameters } }
 * 其中 parameters 是 JSON Schema(我们的 input_schema 已经是子集)。
 */
export function toOpenAITool(t: ToolDefinition): {
  type: 'function'
  function: { name: string; description: string; parameters: ToolDefinition['input_schema'] }
} {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }
}

interface PendingOpenAIToolCall {
  id: string
  name: string
  arguments_buf: string
}

/** 哪些错误内容意味着 prompt template 不支持当前 messages 结构 */
const TEMPLATE_ERROR_PATTERNS = [
  /no user query found/i,
  /jinja template/i,
  /prompt template/i,
  /first message must/i,
  /messages must start with/i,
]

export class OpenAiCompatProvider implements LlmProviderImpl {
  readonly name = 'openai_compat' as const

  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {
    if (!this.endpoint) this.endpoint = 'https://api.openai.com'
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
    extra?: ChatExtraOptions,
  ): Promise<void> {
    const cfg = loadConfig()
    // 用户可在 settings 关闭（OpenAI 真版本对 system message 支持完美）
    const mergeFromConfig = cfg.openai_compat_merge_system !== false

    // v0.8.2: 用 sentinel 保证每次调用恰好发一次 done，不论成功/失败/throw
    let doneEmitted = false
    const safeEvent: ChatStreamCallback = (evt) => {
      if (evt.done) {
        if (doneEmitted) return
        doneEmitted = true
      }
      onEvent(evt)
    }
    const emitDone = (): void => {
      if (!doneEmitted) {
        doneEmitted = true
        onEvent({ done: true })
      }
    }

    try {
      // 第一次尝试：根据 config 决定是否合并
      const success = await this.tryStream(
        messages,
        options,
        safeEvent,
        abortSignal,
        mergeFromConfig,
        false,
        extra,
      )
      if (success) return

      // 第二次尝试：第一次出现 jinja 错误且当时未合并 → 强制合并 retry
      if (!mergeFromConfig) {
        const retried = await this.tryStream(
          messages,
          options,
          safeEvent,
          abortSignal,
          true,
          true,
          extra,
        )
        if (retried) return
      }
    } finally {
      emitDone()
    }
  }

  /**
   * 单次流式调用尝试。
   * @returns true 表示流正常完成（有任何 delta 或 done 事件）；false 表示遇到 template 错误且未发任何 delta
   */
  private async tryStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal: AbortSignal | undefined,
    mergeSystem: boolean,
    isRetry = false,
    extra?: ChatExtraOptions,
  ): Promise<boolean> {
    // v0.17：用户可能填的 endpoint 已含 /v1（如 http://x:8000/v1），也可能没含（http://x:1234）
    // 智能判断：若末尾已是 /v1 就不重复拼
    const base = this.endpoint.replace(/\/+$/, '')
    const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
    // Phase 1 I: 检测国产模型 → 给 system 注入中文人格强化指令（airi 不会做）
    // 用户可在 settings.chinese_llm_enhance=false 关闭
    const innerCfg = loadConfig()
    const enhanced =
      innerCfg.chinese_llm_enhance === false
        ? messages
        : enhanceMessagesForChineseModel(messages, options.model)
    const normalized = normalizeMessages(enhanced, mergeSystem)
    console.log(
      `[openai-compat] tryStream merge=${mergeSystem} retry=${isRetry} in=${messages.length} out=${normalized.length} roles=[${normalized.map((m) => `${m.role}:${m.content.trim().length}`).join(',')}]`,
    )

    const body: Record<string, unknown> = {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens ?? 16000, // v0.8.1: thinking 模型需要大空间（v0.21 默认提到 16000）
      stream: true,
      messages: normalized,
    }

    // v0.21 M7:tools 字段(OpenAI function-calling 格式)
    if (extra?.tools && extra.tools.length > 0) {
      body.tools = extra.tools.map((t) => toOpenAITool(t))
      // tool_choice='auto' 让模型自决,'required' 强制调工具(default 是 'auto')
      body.tool_choice = 'auto'
    }

    // v0.21 M7:上一轮 tool 结果回流
    // OpenAI 协议要求严格序列:`assistant {tool_calls} → tool {result}`
    // 因为 ChatMessage 当前类型没保留 tool_calls 字段,这里反推一个占位 assistant 消息
    // 让大多数 OAI-compat 服务器(LM Studio / vLLM / Ollama)能接受。
    // 局限:真 OpenAI API 严格校验 function.name + arguments,占位 'unknown'+'{}' 会拒;
    // 但目标用户群是本地 LLM,实际不阻断。后续 v0.22 改 ChatMessage 类型保留 tool_calls
    // 让 dialog 串完整序列。
    if (extra?.tool_results && extra.tool_results.length > 0) {
      const messagesArr = body.messages as Array<Record<string, unknown>>
      // 1. 插入对应的 assistant 消息(占位)
      messagesArr.push({
        role: 'assistant',
        content: null,
        tool_calls: extra.tool_results.map((r) => ({
          id: r.tool_use_id,
          type: 'function',
          function: { name: 'unknown', arguments: '{}' },
        })),
      })
      // 2. 然后 push 所有 tool result 消息
      for (const r of extra.tool_results) {
        messagesArr.push({
          role: 'tool',
          content: r.content,
          tool_call_id: r.tool_use_id,
        })
      }
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: abortSignal ?? null,
      })
    } catch (e) {
      onEvent({ error: String(e) })
      return true
    }

    if (!resp.ok || !resp.body) {
      const text = resp.body ? await resp.text().catch(() => '') : ''
      const errorMsg = `${resp.status} ${text || resp.statusText}`
      // 检测是否是 template 错误且未 retry → 触发 retry
      if (!isRetry && isTemplateError(text)) {
        return false
      }
      console.error(`[openai-compat] HTTP ${resp.status} body=${text.slice(0, 300)}`)
      onEvent({
        error: `OpenAI-compat ${errorMsg}${
          isRetry ? '（已自动合并 system 重试，仍失败）' : ''
        }`,
      })
      return true
    }

    let sawDelta = false
    let sawTemplateError = false
    let sawReasoningOnly = false
    let lastFinishReason: string | null = null
    // v0.21 M7:tool_calls 累积。OpenAI streaming 把同一 tool_call 分多个 chunk 推
    // (第一个含 id+function.name,后续 chunk function.arguments 累积 partial json)
    const pendingToolCalls = new Map<number, PendingOpenAIToolCall>()
    await consumeSse(resp.body, (data) => {
      try {
        const ev = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string
              reasoning_content?: string
              tool_calls?: Array<{
                index?: number
                id?: string
                type?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string
          }>
          error?: { message?: string; code?: string }
        }
        // LM Studio 把错误以 SSE event 形式发送
        if (ev.error?.message) {
          if (!isRetry && isTemplateError(ev.error.message)) {
            sawTemplateError = true
          } else {
            onEvent({
              error: `${ev.error.code ? `[${ev.error.code}] ` : ''}${ev.error.message}${
                isRetry ? '（已自动合并 system 重试，仍失败）' : ''
              }`,
            })
          }
          return
        }
        const choice = ev.choices?.[0]
        if (choice?.finish_reason) lastFinishReason = choice.finish_reason
        // v0.8.1: Qwen3 / DeepSeek-R1 等 thinking 模型把 CoT 推理放 delta.reasoning_content
        // content 才是最终答案。这里把 reasoning_content drop（debug 模式可选 forward）
        const reasoning = choice?.delta?.reasoning_content
        if (reasoning) sawReasoningOnly = true
        const delta = choice?.delta?.content
        if (delta) {
          sawDelta = true
          sawReasoningOnly = false
          onEvent({ delta })
        }
        // v0.21 M7:累积 tool_calls
        const toolCalls = choice?.delta?.tool_calls
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0
            const existing = pendingToolCalls.get(idx)
            if (existing) {
              // 累积 arguments(可能跨多个 chunk)
              if (tc.function?.arguments) existing.arguments_buf += tc.function.arguments
              // 后来的 chunk 也可能补 name(有些 provider 把 name 拆开发)
              if (tc.function?.name && !existing.name) existing.name = tc.function.name
              if (tc.id && !existing.id) existing.id = tc.id
            } else {
              pendingToolCalls.set(idx, {
                id: tc.id ?? `call_${idx}`,
                name: tc.function?.name ?? '',
                arguments_buf: tc.function?.arguments ?? '',
              })
            }
          }
        }
      } catch {
        /* skip */
      }
    })

    // v0.21 M7:stream 结束 — emit 累积好的 tool_calls
    if (pendingToolCalls.size > 0) {
      for (const tc of pendingToolCalls.values()) {
        if (!tc.name) {
          console.warn('[openai-compat] tool_call 无 name,跳过', tc)
          continue
        }
        let parsed: Record<string, unknown> = {}
        if (tc.arguments_buf) {
          try {
            parsed = JSON.parse(tc.arguments_buf) as Record<string, unknown>
          } catch (e) {
            console.warn('[openai-compat] tool arguments JSON parse 失败', e, tc.arguments_buf)
          }
        }
        onEvent({ tool_use: { id: tc.id, name: tc.name, input: parsed } })
      }
      // OpenAI 协议下 finish_reason='tool_calls' 表示对话因 tool 暂停,需要回轮
      if (lastFinishReason === 'tool_calls') {
        onEvent({ needs_tools: true })
      }
    }

    if (sawTemplateError && !sawDelta) return false
    // v0.8.1: thinking 模型 max_tokens 被思考吃光 → 用户必须知道
    if (!sawDelta && (sawReasoningOnly || lastFinishReason === 'length')) {
      onEvent({
        error:
          `LLM 思考过程占满 max_tokens，没有产生最终答案。\n` +
          `这是 thinking 模型（如 Qwen3 / DeepSeek-R1）的典型问题。\n` +
          `修复：在「设置 → 大脑」把 max_tokens 调到 8000+（或在 LM Studio 内 reload model 时设大上下文）。`,
      })
      return true
    }
    return true
  }
}

function isTemplateError(text: string): boolean {
  if (!text) return false
  return TEMPLATE_ERROR_PATTERNS.some((p) => p.test(text))
}

/**
 * 把 messages 数组规范化为模型友好格式：
 * 0. v0.8.2 sanitize：丢空 content 的 assistant/user 消息，丢 leading assistant 消息
 *    （Qwen jinja template 见到空 assistant / 首条不是 user 就报 "No user query found"）
 * 1. 若 mergeSystem=true：所有 system 内容拼到第一个 user message 前
 * 2. 确保至少有 1 个 user message（只有 system 时转成 user）
 * 3. 合并相邻 same-role messages（某些模板 chokes on this）
 */
function normalizeMessages(
  messages: ChatMessage[],
  mergeSystem: boolean,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (messages.length === 0) {
    return [{ role: 'user', content: '' }]
  }

  let work: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = messages.map(
    (m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }),
  )

  // 0a. 丢掉 content 为空白的非 system 消息（之前失败留下的空 assistant、误发的空 user）
  work = work.filter((m) => m.role === 'system' || m.content.trim() !== '')

  if (mergeSystem) {
    const systemParts: string[] = []
    const rest: typeof work = []
    for (const m of work) {
      if (m.role === 'system') systemParts.push(m.content)
      else rest.push(m)
    }
    if (systemParts.length > 0) {
      const systemBlob = systemParts.join('\n\n')
      const firstUserIdx = rest.findIndex((m) => m.role === 'user')
      if (firstUserIdx >= 0) {
        const firstUser = rest[firstUserIdx]!
        rest[firstUserIdx] = {
          role: 'user',
          content: `${systemBlob}\n\n---\n\n${firstUser.content}`,
        }
      } else {
        // 全是 assistant 或空 — 加一条 user 承载 system
        rest.unshift({ role: 'user', content: systemBlob })
      }
    }
    work = rest
  }

  // 0b. mergeSystem 之后再 drop leading assistant（system 被合走后开头可能仍是 assistant）
  //     Qwen / Llama jinja 要求 messages 以 user (或 system) 开头，
  //     启动时 BehaviorPlanner 主动注入的开场白 "主人——我在这儿" 会触发 "No user query found"
  while (work.length > 0 && work[0]!.role === 'assistant') work.shift()

  // 确保至少一个 user
  if (!work.some((m) => m.role === 'user')) {
    work.push({ role: 'user', content: '请按上述要求生成。' })
  }

  // 合并相邻同 role 消息
  const merged: typeof work = []
  for (const m of work) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      merged.push({ ...m })
    }
  }

  return merged
}
