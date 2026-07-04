/**
 * 角色一致性评测 runner (Phase 1 K 接通)。
 *
 * 加载当前 soul + 50 题，逐题调 LLM 用非流式包装跑，组装 EvalReport。
 *
 * 串行而非并行 — 避免 LLM endpoint rate limit；每题 5-30s，整套 5-25 分钟。
 * UI 通过 onProgress 显示当前进度。
 */
import type { ChatMessage, LlmProvider } from '@shared/types'
import { loadConfig } from '../config-store'
import { loadSoul } from '../soul-loader'
import { buildProvider } from '../llm'
import { CHARACTER_EVAL_QUESTIONS } from './questions'
import { buildReport, scoreAnswer, type ScoreSubjects } from './scorer'
import type { EvalReport, EvalQuestion, QuestionAnswerPair, ScoredAnswer } from './types'
import { appendEvalHistory } from './history'

export interface RunEvalOptions {
  /** 收到每一题完成的进度（done/total + 当前 score） */
  onProgress?: (p: { done: number; total: number; current?: ScoredAnswer }) => void
  /** 中断 */
  abortSignal?: AbortSignal
  /** 每题 LLM 调用 timeout (默认 60s) */
  timeoutMs?: number
  /** 调试用：限制只跑前 N 题 */
  limit?: number
  /**
   * 跨模型对比模式：覆盖当前 RuntimeConfig 的 LLM 配置（不写盘）。
   * 用法：runEvalSuite({ llmOverride: { provider: 'openai_compat',
   *        endpoint: 'http://other:1234', model: 'glm-4.6' } })
   */
  llmOverride?: {
    provider?: LlmProvider
    endpoint?: string
    api_key?: string
    model?: string
  }
}

/** 串行跑一道题 → 返回解析后的 answer_text + answer_emotion */
async function askOne(
  question: EvalQuestion,
  systemPrompt: string,
  opts: {
    timeoutMs: number
    abortSignal?: AbortSignal
    llmOverride?: RunEvalOptions['llmOverride']
  },
): Promise<QuestionAnswerPair> {
  const cfg = loadConfig()
  const o = opts.llmOverride ?? {}
  const llmProvider = o.provider ?? cfg.llm_provider
  const llmEndpoint = o.endpoint ?? cfg.llm_endpoint
  const llmApiKey = o.api_key ?? cfg.llm_api_key ?? ''
  const llmModel = o.model ?? cfg.llm_model
  if (!llmProvider || !llmEndpoint || !llmModel) {
    throw new Error('LLM 未配置 (provider/endpoint/model 缺失)')
  }
  const provider = buildProvider(llmProvider, llmEndpoint, llmApiKey)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question.prompt },
  ]

  let raw = ''
  let errored = ''
  const t0 = Date.now()

  const timeout = new AbortController()
  const timeoutHandle = setTimeout(() => timeout.abort(), opts.timeoutMs)
  // 合并外部 abort + timeout 信号
  const signals = [opts.abortSignal, timeout.signal].filter(
    (s): s is AbortSignal => s !== undefined,
  )
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

  try {
    await provider.chatStream(
      messages,
      {
        model: llmModel,
        temperature: 0.7,
        // v0.8.1 lesson: Qwen3 / DeepSeek-R1 等 thinking 模型 max_tokens 必须够大
        // 否则思考链占满，没有最终答案 — eval 题虽短，思考可能 4000+ tokens
        max_tokens: 8000,
      },
      (evt) => {
        if (evt.delta) raw += evt.delta
        if (evt.error) errored = evt.error
      },
      combined,
    )
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (errored && !raw) {
    return {
      question,
      answer_text: `[LLM 错误] ${errored}`,
      duration_ms: Date.now() - t0,
    }
  }

  // 解析 JSON: {text, emotion, intensity, actions?}；fallback 拿整段当 text
  let parsedText = raw
  let parsedEmotion: string | undefined
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]) as {
        text?: string
        emotion?: string
      }
      if (typeof obj.text === 'string') parsedText = obj.text
      if (typeof obj.emotion === 'string') parsedEmotion = obj.emotion
    }
  } catch {
    /* not JSON — 直接用 raw */
  }

  return {
    question,
    answer_text: parsedText,
    ...(parsedEmotion !== undefined && { answer_emotion: parsedEmotion }),
    duration_ms: Date.now() - t0,
  }
}

export async function runEvalSuite(opts: RunEvalOptions = {}): Promise<EvalReport> {
  const { onProgress, abortSignal, timeoutMs = 60_000, limit, llmOverride } = opts
  const cfg = loadConfig()
  const effectiveModel = llmOverride?.model ?? cfg.llm_model
  if (!effectiveModel) {
    throw new Error('LLM model 未配置；无法跑评测')
  }

  const loaded = loadSoul()
  const systemPrompt = loaded.systemPrompt
  const subjects: ScoreSubjects = {
    name: loaded.config.name,
    master: loaded.config.master,
    master_call: loaded.config.call_master_as,
  }

  const questions = limit ? CHARACTER_EVAL_QUESTIONS.slice(0, limit) : CHARACTER_EVAL_QUESTIONS
  const scored: ScoredAnswer[] = []

  for (let i = 0; i < questions.length; i++) {
    if (abortSignal?.aborted) break
    const q = questions[i]!
    try {
      const pair = await askOne(q, systemPrompt, {
        timeoutMs,
        ...(abortSignal ? { abortSignal } : {}),
        ...(llmOverride ? { llmOverride } : {}),
      })
      const s = scoreAnswer(pair, subjects)
      scored.push(s)
      onProgress?.({ done: i + 1, total: questions.length, current: s })
    } catch (e) {
      const failedPair: QuestionAnswerPair = {
        question: q,
        answer_text: `[执行错误] ${e instanceof Error ? e.message : String(e)}`,
      }
      const s = scoreAnswer(failedPair, subjects)
      scored.push(s)
      onProgress?.({ done: i + 1, total: questions.length, current: s })
    }
  }

  const report = buildReport(scored, effectiveModel)
  appendEvalHistory(report)
  return report
}
