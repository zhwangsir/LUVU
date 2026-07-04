/**
 * DirectLLM 策略 — 一次性 LLM 调用生成完整 MotionDraft。
 * 速度最快，但质量不稳定。
 */
import type { ChatMessage } from '@shared/types'
import type { MotionDraft } from '@shared/motion'
import { buildProvider } from '../../llm'
import { loadConfig } from '../../config-store'
import type { GenerationContext, IGenerationStrategy } from './index'
import { extractJson, validateDraft } from '../llm-output-utils'

const SYSTEM_PROMPT = `你是 Live2D 动作设计师。给定模型的可用参数和示例，生成一个新动作。
严格输出 JSON（无 markdown 围栏）：
{
  "name": "短英文/拼音 (文件名)",
  "duration": 1.5~5,
  "loop": true/false,
  "fps": 30,
  "tracks": [
    { "param": "参数 id (必须在清单)", "keyframes": [[时间秒, 值], ...] }
  ],
  "description": "中文描述"
}
约束：
- 值在 min/max 内
- 至少 3 条 tracks，至少 1 条覆盖头部
- 1.5-4 秒最自然
- loop=true 时首末值接近
- 优先用 [非?] 的语义参数`

export const directLlmStrategy: IGenerationStrategy = {
  id: 'direct_llm',
  display_name_zh: '直接生成（快速）',
  description: '一次 LLM 调用生成完整动作。速度快，质量中等，适合快速试错',
  cost: 'low',
  async generate(ctx: GenerationContext): Promise<MotionDraft> {
    const cfg = loadConfig()
    validateConfig(cfg)
    const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)

    const semByParamId = new Map<string, string>()
    for (const ps of ctx.semantics.params) {
      if (ps.semantic !== 'unknown' && ps.confidence > 0.5) {
        semByParamId.set(ps.param_id, ps.semantic)
      }
    }
    const topParams = ctx.summary.params.slice(0, 30).map((x) => ({
      id: x.id,
      range: `${round(x.min)}~${round(x.max)}`,
      used: x.usage_count,
      sem: semByParamId.get(x.id) ?? '?',
    }))
    const fewShot = ctx.summary.motions
      .slice(0, ctx.examples ?? 2)
      .map(
        (m) =>
          `- 「${m.name}」时长 ${m.duration.toFixed(1)}s, loop=${m.loop}, 参数 ${m.params.slice(0, 5).join(', ')}`,
      )
      .join('\n')

    const userPrompt = [
      `# 可用参数 (id [语义] : 值域 : 使用次数)`,
      topParams.map((p) => `- ${p.id} [${p.sem}] : ${p.range} : ${p.used}`).join('\n'),
      ``,
      `# 已有动作示例`,
      fewShot || '（无）',
      ``,
      `# 新动作要求`,
      `描述：${ctx.description}`,
      ctx.style ? `风格：${ctx.style}` : '',
      ``,
      `严格只输出 JSON。`,
    ]
      .filter(Boolean)
      .join('\n')

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]

    let buffer = ''
    let streamError: string | null = null
    let done = false
    try {
      await provider.chatStream(
        messages,
        { model: cfg.llm_model, temperature: 0.7, max_tokens: 4000 },
        (evt) => {
          if (evt.delta) buffer += evt.delta
          if (evt.error) streamError = evt.error
          if (evt.done) done = true
        },
      )
    } catch (e) {
      throw new Error(
        `LLM 流调用失败 (${cfg.llm_provider}): ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (streamError) throw new Error(`LLM 返回错误: ${streamError}`)
    if (!done) throw new Error('LLM 流未正常结束')
    if (!buffer) throw new Error(`LLM 无响应。检查 ${cfg.llm_provider} 配置`)

    const json = extractJson(buffer)
    if (!json) throw new Error(`LLM 输出非 JSON:\n${buffer.slice(0, 300)}`)
    return validateDraft(json, ctx.summary)
  },
}

function validateConfig(cfg: { llm_provider: string; llm_api_key: string; llm_model: string; llm_endpoint: string }): void {
  if (!cfg.llm_provider) throw new Error('LLM provider 未配置；请到设置里选')
  if (cfg.llm_provider === 'anthropic' && !cfg.llm_api_key)
    throw new Error('Anthropic 需要 API key')
  if (!cfg.llm_model) throw new Error('LLM model 未配置')
  if (!cfg.llm_endpoint && cfg.llm_provider !== 'anthropic')
    throw new Error(`${cfg.llm_provider} 需要 endpoint URL`)
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
