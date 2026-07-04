/**
 * PlanRefine 策略 — 两阶段生成。
 * 1. 先让 LLM 规划 outline（动作分几个 phase，每 phase 主导参数 + 时长）
 * 2. 再让 LLM 给每个 phase 写具体 keyframes
 * 质量比 direct 高，但 token 量翻倍。
 */
import type { ChatMessage } from '@shared/types'
import type { MotionDraft, KeyframeTrack } from '@shared/motion'
import { buildProvider } from '../../llm'
import { loadConfig } from '../../config-store'
import type { GenerationContext, IGenerationStrategy } from './index'
import { extractJson, validateDraft } from '../llm-output-utils'

const PLAN_PROMPT = `规划一个 Live2D 动作的高层结构，分 2-4 个 phase。
严格输出 JSON：
{
  "name": "短名",
  "duration": 总秒数,
  "loop": true/false,
  "phases": [
    { "name": "phase1", "start": 0, "end": 1.2, "intent": "略微抬头", "main_params": ["ParamAngleY"] }
  ]
}`

const REFINE_PROMPT = `根据 phase outline 生成具体 keyframes。
严格输出 JSON（同 MotionDraft 格式）。
每个 phase 起止时间内补充 2-3 个 keyframe，让动作过渡自然。`

interface PlanOutput {
  name: string
  duration: number
  loop: boolean
  phases: Array<{ name: string; start: number; end: number; intent: string; main_params?: string[] }>
}

export const planRefineStrategy: IGenerationStrategy = {
  id: 'plan_refine',
  display_name_zh: '规划→细化（推荐）',
  description: '两阶段生成：先规划动作分镜，再细化关键帧。质量高但 token 量 2x',
  cost: 'medium',
  async generate(ctx: GenerationContext): Promise<MotionDraft> {
    const cfg = loadConfig()
    if (!cfg.llm_model) throw new Error('LLM model 未配置')
    const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)

    const semByParamId = new Map<string, string>()
    for (const ps of ctx.semantics.params) {
      if (ps.semantic !== 'unknown' && ps.confidence > 0.5) {
        semByParamId.set(ps.param_id, ps.semantic)
      }
    }
    const topParams = ctx.summary.params
      .slice(0, 20)
      .map((x) => `${x.id} [${semByParamId.get(x.id) ?? '?'}] ${x.min}~${x.max}`)
      .join('; ')

    // === Phase 1: PLAN ===
    const planMsgs: ChatMessage[] = [
      { role: 'system', content: PLAN_PROMPT },
      {
        role: 'user',
        content: `参数: ${topParams}\n描述: ${ctx.description}${ctx.style ? `\n风格: ${ctx.style}` : ''}`,
      },
    ]
    const planRaw = await callLlm(provider, cfg.llm_model, planMsgs, 1500)
    const plan = extractJson(planRaw) as PlanOutput | null
    if (!plan || !Array.isArray(plan.phases)) {
      throw new Error(`Plan 阶段返回无效:\n${planRaw.slice(0, 300)}`)
    }

    // === Phase 2: REFINE ===
    const refineMsgs: ChatMessage[] = [
      { role: 'system', content: REFINE_PROMPT },
      {
        role: 'user',
        content: [
          `参数: ${topParams}`,
          `Plan: ${JSON.stringify(plan)}`,
          `现在输出 MotionDraft JSON，含 tracks 和 keyframes`,
        ].join('\n'),
      },
    ]
    const refineRaw = await callLlm(provider, cfg.llm_model, refineMsgs, 3500)
    const refined = extractJson(refineRaw)
    if (!refined) throw new Error(`Refine 阶段返回无效:\n${refineRaw.slice(0, 300)}`)
    return validateDraft(refined, ctx.summary)
  },
}

async function callLlm(
  provider: ReturnType<typeof buildProvider>,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  let buffer = ''
  let streamError: string | null = null
  let done = false
  await provider.chatStream(
    messages,
    { model, temperature: 0.7, max_tokens: maxTokens },
    (evt) => {
      if (evt.delta) buffer += evt.delta
      if (evt.error) streamError = evt.error
      if (evt.done) done = true
    },
  )
  if (streamError) throw new Error(`LLM: ${streamError}`)
  if (!done) throw new Error('LLM stream 未结束')
  if (!buffer) throw new Error('LLM 空响应')
  return buffer
}

// 防止未使用警告
void ({} as KeyframeTrack)
