/**
 * 对话 store —— 历史 + 流式控制 + 工具调用 loop。
 *
 * 工具调用流程：
 *   1. 第一轮：用户 message + tools 定义 → LLM 返回 text + 0~n 个 tool_use
 *   2. 若收到 needs_tools：依次执行 tool_use（IPC tools:run，含审批）→ 收集 results
 *   3. 后续轮：把上一轮 tool_results 作为 extra 再调 LLM；直到没有 needs_tools
 *   4. 最终把累计的 text 当作 assistant.text，emotion/intensity 用 parseReply
 */
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import type { ChatMessage, EmotionId, IpcStreamChunk } from '@shared/types'
import type { ToolDefinition } from '@shared/tools'
import { useConfigStore } from '../../infra/stores/config'
import { bus } from '../../infra/eventbus'
import { toFriendlyError } from '../../infra/friendly-error'
import { parsePartialText, parseReply } from '../parser'
import type { DialogTurn } from '../types'

const MAX_HISTORY = 40
const MAX_TOOL_ROUNDS = 6 // 防止 LLM 自循环

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Vue reactive → 纯 JS（IPC 结构化克隆不接受 Proxy） */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(toRaw(v as object))) as T
}

interface ToolUseRecord {
  id: string
  name: string
  input: Record<string, unknown>
}

/** v0.21：单个工具调用在灵动岛里的状态 */
export interface ToolActivityItem {
  id: string
  name: string
  status: 'running' | 'ok' | 'error'
}

export const useDialogStore = defineStore('dialog', () => {
  const turns = ref<DialogTurn[]>([])
  const replying = ref(false)
  const currentStreamId = ref<string | null>(null)
  const partialBuffer = ref<string>('')
  const availableTools = ref<ToolDefinition[]>([])
  /** v0.21：本轮按需检索出的相关工具子集；null = 用 availableTools 全量 */
  const activeTurnTools = ref<ToolDefinition[] | null>(null)
  /** v0.21：工具链调用状态 —— 灵动岛展示（与文字答复分离） */
  const toolActivity = ref<ToolActivityItem[]>([])

  /** 本轮 LLM 产生的所有 tool_use（按顺序） */
  let pendingToolUses: ToolUseRecord[] = []
  /** 本轮是否被 stop_reason='tool_use' 标记，决定流结束后是否继续 loop */
  let pendingNeedsTools = false
  /** 跨轮累积的纯文本（用于 parseReply 最终落地） */
  let accumulatedText = ''
  /** 当前 active assistant turn id（多轮 tool loop 共用同一个 turn） */
  let activeAssistantId: string | null = null
  /** tool round 计数 */
  let toolRound = 0

  let unsubChunk: (() => void) | null = null
  let unsubInjectUtterance: (() => void) | null = null
  let pendingResolve: (() => void) | null = null

  async function bootstrap(): Promise<void> {
    if (!unsubChunk) {
      unsubChunk = window.api.llm.onChunk((chunk) => handleChunk(chunk))
    }
    // v0.13 (audit architecture): 监听 avatar/plan-executor 发的 inject-utterance
    // 把跨域硬依赖（avatar import dialog store）改成事件驱动
    if (!unsubInjectUtterance) {
      const handler = (payload: { text: string; emotion: EmotionId; intensity: number }): void => {
        injectAssistantUtterance(payload.text, payload.emotion, payload.intensity)
      }
      bus.on('brain:inject-utterance', handler)
      unsubInjectUtterance = () => bus.off('brain:inject-utterance', handler)
    }
    try {
      const rows = await window.api.history.listRecent(50)
      if (rows.length > 0) {
        turns.value = rows.map((r) => ({
          id: r.id,
          role: r.role,
          text: r.text,
          ...(r.emotion != null ? { emotion: r.emotion as EmotionId } : {}),
          ...(r.intensity != null ? { intensity: r.intensity } : {}),
          ts: r.ts,
          ...(r.error != null ? { error: r.error } : {}),
        }))
      }
    } catch (e) {
      console.warn('[dialog] history restore failed:', e)
    }
    // 拉取 tools，供 LLM 用
    await refreshTools()
    // v0.17: 订阅 main 的 tools:changed (MCP register/unregister 时推送) — push-driven 替代 send 热路径 IPC pre-flight
    if (!toolsChangedUnsub) {
      toolsChangedUnsub = window.api.tools.onChanged(() => {
        void refreshTools()
      })
    }
  }

  async function refreshTools(): Promise<void> {
    try {
      availableTools.value = await window.api.tools.list()
    } catch (e) {
      console.warn('[dialog] tools.list failed:', e)
    }
  }

  let toolsChangedUnsub: (() => void) | null = null

  async function persist(t: DialogTurn): Promise<void> {
    try {
      await window.api.history.append({
        id: t.id,
        role: t.role,
        text: t.text,
        emotion: t.emotion ?? null,
        intensity: t.intensity ?? null,
        ts: t.ts,
        error: t.error ?? null,
      })
    } catch (e) {
      console.warn('[dialog] persist failed:', e)
    }
  }

  function teardown(): void {
    unsubChunk?.()
    unsubChunk = null
    unsubInjectUtterance?.()
    unsubInjectUtterance = null
  }

  function buildMessages(userText: string, ragContext?: string): ChatMessage[] {
    const cfg = useConfigStore()
    let system = cfg.systemPrompt
    // v0.17 M2：把 RAG 检索到的长期记忆 prepend 到 system prompt
    if (ragContext && ragContext.trim()) {
      system = `${system}\n\n## 你记得的关于 master 的事（仅供你回忆参考，不要直接复述）\n${ragContext}`
    }
    const history: ChatMessage[] = turns.value
      .filter((t) => !t.error && t.role !== 'system' && t.id !== activeAssistantId)
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.role, content: t.text }))
    return [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: userText },
    ]
  }

  /** v0.17 M2：发请求前调 memory.ragContext 拿长期记忆 — 800ms timeout，失败/超时静默 */
  async function fetchRagContext(userText: string): Promise<string> {
    try {
      const r = await Promise.race([
        window.api.memory.ragContext({ query_text: userText, k: 5 }),
        new Promise<{ ok: false; reason: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 800),
        ),
      ])
      if (r.ok && 'context' in r && r.context) return r.context
      return ''
    } catch {
      return ''
    }
  }

  /** v0.21：发请求前按需检索相关工具子集 — 800ms timeout，失败/超时/关闭 → null（用全部工具） */
  async function fetchRelevantTools(userText: string): Promise<ToolDefinition[] | null> {
    const cfg = useConfigStore()
    if (cfg.config?.tool_retrieval_enabled === false) return null
    try {
      const r = await Promise.race([
        window.api.tools.relevant({ query: userText, k: 12 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
      ])
      return Array.isArray(r) && r.length > 0 ? r : null
    } catch {
      return null
    }
  }

  async function send(text: string): Promise<void> {
    if (!text.trim() || replying.value) return
    const cfg = useConfigStore()
    if (!cfg.config) {
      bus.emit('ui:toast', { kind: 'error', message: '配置未加载，无法发送' })
      return
    }
    // UX:LLM 未配置时,别让用户发出去再吃一个 cryptic "对话失败" —— 友好引导去连大脑。
    // (审计 P1:新用户跳过 onboarding 后卡在"她不理我")
    if (!cfg.config.llm_endpoint || !cfg.config.llm_model) {
      bus.emit('ui:toast', {
        kind: 'warn',
        message: '我还没连上大脑呢～ 配一下 LLM 才能跟你聊天哦',
        ttl_ms: 8000,
        action: { label: '去连大脑', do: () => bus.emit('ui:open-onboarding') },
      })
      return
    }

    const userTurn: DialogTurn = {
      id: uid(),
      role: 'user',
      text: text.trim(),
      ts: Date.now(),
    }
    const assistantTurn: DialogTurn = {
      id: uid(),
      role: 'assistant',
      text: '',
      ts: Date.now(),
      streaming: true,
    }
    turns.value.push(userTurn, assistantTurn)
    activeAssistantId = assistantTurn.id
    void persist(userTurn)
    bus.emit('brain:chat-input', { text: userTurn.text })

    replying.value = true
    toolRound = 0
    accumulatedText = ''
    pendingToolUses = []
    pendingNeedsTools = false
    toolActivity.value = [] // v0.21：新一轮清空灵动岛工具链状态

    // v0.17 M2 + v0.21 工具检索：并行拉 RAG 记忆 + 相关工具子集（各 800ms timeout，失败静默兜底）
    const [ragContext, relTools] = await Promise.all([
      fetchRagContext(userTurn.text),
      fetchRelevantTools(userTurn.text),
    ])
    activeTurnTools.value = relTools
    const messages = buildMessages(userTurn.text, ragContext)
    await runOneRound(messages, undefined)
    // v0.21 M7:tool loop 对所有支持 tools 的 provider 启用,与 supportsTools 一致
    const toolsCapable =
      cfg.config.llm_provider === 'anthropic' || cfg.config.llm_provider === 'openai_compat'
    await loopUntilDone(messages, assistantTurn, toolsCapable)

    finalizeAssistant(assistantTurn)
  }

  /** 工具 loop：在主流结束后若 needs_tools，执行 → 续 LLM 直到结束或超限 */
  async function loopUntilDone(
    baseMessages: ChatMessage[],
    assistant: DialogTurn,
    toolsCapable: boolean,
  ): Promise<void> {
    while (toolsCapable && pendingNeedsTools && pendingToolUses.length > 0) {
      if (++toolRound > MAX_TOOL_ROUNDS) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `工具调用轮数超过 ${MAX_TOOL_ROUNDS}，已强制停止`,
          ttl_ms: 6000,
        })
        break
      }
      const calls = pendingToolUses
      pendingToolUses = []
      pendingNeedsTools = false

      const results = await runTools(calls)
      // v0.21：工具链状态归灵动岛显示（toolActivity），文字气泡只留真正的答复
      assistant.text = accumulatedText
      await runOneRound(baseMessages, results)
    }
  }

  /** v0.21：更新某个工具在灵动岛里的状态（不可变更新） */
  function setToolStatus(id: string, status: ToolActivityItem['status']): void {
    toolActivity.value = toolActivity.value.map((it) => (it.id === id ? { ...it, status } : it))
  }

  async function runTools(calls: ToolUseRecord[]): Promise<
    Array<{ tool_use_id: string; content: string; is_error?: boolean }>
  > {
    // 本批工具先标 running 追加到灵动岛（跨轮累积成完整工具链）
    toolActivity.value = [
      ...toolActivity.value,
      ...calls.map((c) => ({ id: c.id, name: c.name, status: 'running' as const })),
    ]
    const results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = []
    for (const call of calls) {
      try {
        const r = await window.api.tools.run({
          invocation_id: call.id,
          tool_name: call.name,
          input: call.input,
        })
        setToolStatus(call.id, r.ok ? 'ok' : 'error')
        if (r.ok) {
          results.push({ tool_use_id: call.id, content: r.output ?? '(empty output)' })
        } else {
          results.push({
            tool_use_id: call.id,
            content: r.error ?? '(unknown error)',
            is_error: true,
          })
        }
      } catch (e) {
        setToolStatus(call.id, 'error')
        results.push({
          tool_use_id: call.id,
          content: e instanceof Error ? e.message : String(e),
          is_error: true,
        })
      }
    }
    return results
  }

  async function runOneRound(
    messages: ChatMessage[],
    toolResults?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>,
  ): Promise<void> {
    const cfg = useConfigStore()
    if (!cfg.config) return
    const streamId = uid()
    currentStreamId.value = streamId
    partialBuffer.value = ''

    const done = new Promise<void>((resolve) => {
      pendingResolve = resolve
    })

    // v0.21 M7:tools 对所有支持 tool 的 provider 暴露(anthropic + openai_compat 都已实现 tool_calls)
    // ollama 走 OAI 兼容接口大多也支持 tool_calls;若个别模型/endpoint 不支持 LLM 会忽略 tools field
    const supportsTools =
      cfg.config.llm_provider === 'anthropic' || cfg.config.llm_provider === 'openai_compat'
    // v0.21：优先用本轮检索出的相关工具子集；无则回退全部工具
    const toolsVal = supportsTools ? plain(activeTurnTools.value ?? availableTools.value) : undefined
    const result = await window.api.llm.chatStream({
      streamId,
      messages: plain(messages),
      options: {
        model: cfg.config.llm_model,
        temperature: 0.8,
        ...(cfg.config.llm_max_tokens ? { max_tokens: cfg.config.llm_max_tokens } : {}),
      },
      ...(toolsVal !== undefined ? { tools: toolsVal } : {}),
      ...(toolResults ? { tool_results: plain(toolResults) } : {}),
    })

    if (!result.ok) {
      const reason = result.reason ?? 'failed'
      const t = turns.value.find((x) => x.id === activeAssistantId)
      if (t) {
        t.streaming = false
        t.error = reason
        t.text = `（出错：${reason}）`
      }
      replying.value = false
      currentStreamId.value = null
      pendingResolve?.()
      pendingResolve = null
      bus.emit('ui:toast', { kind: 'error', message: `对话失败：${reason}`, ttl_ms: 8000 })
      return
    }

    await done
  }

  function finalizeAssistant(assistant: DialogTurn): void {
    const parsed = parseReply(accumulatedText || assistant.text)
    assistant.text = parsed.text || assistant.text
    assistant.emotion = parsed.emotion
    assistant.intensity = parsed.intensity
    assistant.streaming = false
    void persist(assistant)
    bus.emit('brain:reply-end', {
      stream_id: currentStreamId.value ?? '',
      full_text: assistant.text,
      emotion: parsed.emotion,
      intensity: parsed.intensity,
    })
    // UX R21: 显式 service:status — 成功回完即 LLM ok
    bus.emit('service:status', { service: 'llm', status: 'ok' })
    bus.emit('brain:emotion-changed', { emotion: parsed.emotion, intensity: parsed.intensity })
    // v0.17 D-3：fire-and-forget 抽取长期记忆（不阻塞对话流）
    void (async (): Promise<void> => {
      try {
        const userTurn = [...turns.value].reverse().find((t) => t.role === 'user')
        if (!userTurn?.text) return
        await window.api.memory.extractFromTurn({
          user_text: userTurn.text,
          assistant_text: assistant.text,
          turn_id: assistant.id,
        })
      } catch (e) {
        console.warn('[dialog] memory extract failed (non-fatal):', e)
      }
    })()
    // v0.8.2: LLM 可以在 reply 里附带 actions（瞥屏/换表情/idle），让 plan-executor 跑
    if (parsed.actions && parsed.actions.length > 0) {
      bus.emit('brain:reply-actions', { actions: parsed.actions })
    }
    // v0.14 T5: 对话完成 → 更新当前 character 亲密度 + last_chat_at
    void window.api.characters.recordChat().catch((e) => {
      console.warn('[dialog] recordChat failed:', e)
    })
    // Phase 1 J: 接通情感演化 — emotion → sentiment / user_text → topic / 顺带 tick
    void (async () => {
      try {
        const userTurn = [...turns.value].reverse().find((t) => t.role === 'user')
        if (!userTurn?.text) return
        await window.api.emotional.onReply({
          user_text: userTurn.text,
          assistant_text: assistant.text,
          emotion: parsed.emotion,
          intensity: parsed.intensity,
        })
        // 通知 UI（CharacterStatusBar）重新拉 mood
        bus.emit('emotional:state-changed')
      } catch (e) {
        console.warn('[dialog] emotional.onReply failed (non-fatal):', e)
      }
    })()
    replying.value = false
    currentStreamId.value = null
    activeAssistantId = null
  }

  function abort(): void {
    if (!currentStreamId.value) return
    window.api.llm.abort(currentStreamId.value)
  }

  function handleChunk(chunk: IpcStreamChunk): void {
    if (chunk.streamId !== currentStreamId.value) return
    const assistant = turns.value.find((t) => t.id === activeAssistantId)
    if (!assistant || assistant.role !== 'assistant') return

    if (chunk.delta) {
      partialBuffer.value += chunk.delta
      accumulatedText += chunk.delta
      const partial = parsePartialText(partialBuffer.value)
      if (partial) assistant.text = partial
      else assistant.text = accumulatedText
      bus.emit('brain:reply-token', { stream_id: chunk.streamId, delta: chunk.delta })
    }
    if (chunk.tool_use) {
      pendingToolUses.push(chunk.tool_use)
    }
    if (chunk.needs_tools) {
      pendingNeedsTools = true
    }
    if (chunk.error) {
      assistant.error = chunk.error
      assistant.streaming = false
      bus.emit('brain:reply-error', { stream_id: chunk.streamId, error: chunk.error })
      // UX R21: 显式 emit service:status，让 ServiceStatusPill 摆脱 toast 文本推断
      bus.emit('service:status', {
        service: 'llm',
        status: 'down',
        reason: chunk.error.slice(0, 100),
      })
      // UX R22: 友好化 LLM 错误 — domain='llm' 让规则按域过滤
      // R99: toast 挂 "🔄 重试" action, 让用户从 toast 一键修复
      const fe = toFriendlyError(chunk.error, 'llm')
      bus.emit('ui:toast', {
        kind: 'error',
        message: `${fe.title}：${fe.detail}`,
        ttl_ms: 9000,
        action: {
          label: '🔄 重试',
          do: () => {
            void retryLast()
          },
        },
      })
    }
    if (chunk.done) {
      pendingResolve?.()
      pendingResolve = null
    }
  }

  async function clear(): Promise<void> {
    turns.value = []
    try {
      await window.api.history.clear()
    } catch (e) {
      console.warn('[dialog] clear failed:', e)
    }
  }

  /**
   * R41: 重试最后一次失败的对话 — 找最后 user turn，删后续 error/空 assistant，再 send。
   * 无失败 turn / 正在 replying → no-op
   */
  async function retryLast(): Promise<void> {
    if (replying.value) return
    // 从末尾找 — 必须是 assistant 且 error 或文本空
    let assistantIdx = -1
    for (let i = turns.value.length - 1; i >= 0; i--) {
      const t = turns.value[i]
      if (!t) continue
      if (t.role === 'assistant') {
        if (t.error || !t.text.trim()) {
          assistantIdx = i
          break
        }
        // 找到最新 assistant 但是成功的 → 无可重试
        return
      }
    }
    if (assistantIdx < 0) return
    // 前一个 user turn
    const userIdx = assistantIdx - 1
    const userTurn = turns.value[userIdx]
    if (!userTurn || userTurn.role !== 'user') return
    const text = userTurn.text
    // 不可变更新: 移除 user + failed assistant
    turns.value = turns.value.slice(0, userIdx)
    await send(text)
  }

  /** v0.8: BehaviorPlanner 主动发起的 utterance（不经 LLM 生成，直接注入） */
  function injectAssistantUtterance(text: string, emotion: EmotionId, intensity: number): void {
    const turn: DialogTurn = {
      id: uid(),
      role: 'assistant',
      text,
      emotion,
      intensity,
      ts: Date.now(),
    }
    turns.value.push(turn)
    void persist(turn)
  }

  /** 只在没有任何历史时注入开场白，避免重复 */
  function injectGreeting(): void {
    if (turns.value.length > 0) return
    const greet: DialogTurn = {
      id: uid(),
      role: 'assistant',
      text: '主人——我在这儿，今天先陪我说说话好不好？',
      emotion: 'shy' as EmotionId,
      intensity: 0.6,
      ts: Date.now(),
    }
    turns.value.push(greet)
    void persist(greet)
  }

  return {
    turns,
    replying,
    availableTools,
    toolActivity,
    bootstrap,
    teardown,
    send,
    retryLast,
    abort,
    clear,
    injectGreeting,
    injectAssistantUtterance,
  }
})
