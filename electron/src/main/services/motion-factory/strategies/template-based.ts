/**
 * TemplateBased 策略 — 从 MotionLibrary 选最匹配的模板 + LLM 微调时长/数值。
 *
 * 1. LLM 看描述 + 模板清单（含 tags/emotions/description）→ 选模板 id
 * 2. 渲染模板到 MotionDraft
 * 3. 可选：再调一次 LLM 给 keyframes 微调（speed/intensity 倍率）
 *
 * 优点：基础设定稳（用人工设计的模板），LLM 只做"风格匹配"，不容易崩
 */
import type { ChatMessage } from '@shared/types'
import type { MotionDraft } from '@shared/motion'
import { buildProvider } from '../../llm'
import { loadConfig } from '../../config-store'
import * as library from '../library-loader'
import { renderWithSemantics } from '../template-renderer'
import type { GenerationContext, IGenerationStrategy } from './index'

const PICK_PROMPT = `从模板清单中选一个最匹配用户描述的模板，输出 JSON：
{ "template_id": "...", "speed_scale": 1.0, "intensity_scale": 1.0, "reason": "..." }
speed_scale 0.5~2.0；intensity_scale 0.5~1.5；可微调动作快慢与幅度`

export const templateBasedStrategy: IGenerationStrategy = {
  id: 'template_based',
  display_name_zh: '模板匹配（稳定）',
  description: '从 17+ 内置模板中 LLM 挑最匹配的 + 微调参数。稳定，依赖模板库丰富度',
  cost: 'low',
  async generate(ctx: GenerationContext): Promise<MotionDraft> {
    const cfg = loadConfig()
    if (!cfg.llm_model) throw new Error('LLM model 未配置')

    const templates = library.list()
    if (templates.length === 0) throw new Error('模板库为空')

    const templateSummary = templates
      .map(
        (t) =>
          `- ${t.id}: "${t.display_name_zh}" (${t.description.slice(0, 50)}) tags=[${t.tags.join(',')}] emotions=[${(t.emotions ?? []).join(',')}]`,
      )
      .join('\n')

    const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)
    const msgs: ChatMessage[] = [
      { role: 'system', content: PICK_PROMPT },
      {
        role: 'user',
        content: `# 模板清单\n${templateSummary}\n\n# 用户描述\n${ctx.description}${ctx.style ? `\n风格: ${ctx.style}` : ''}`,
      },
    ]

    let buffer = ''
    let streamError: string | null = null
    await provider.chatStream(
      msgs,
      { model: cfg.llm_model, temperature: 0.5, max_tokens: 600 },
      (evt) => {
        if (evt.delta) buffer += evt.delta
        if (evt.error) streamError = evt.error
      },
    )
    if (streamError) throw new Error(`LLM: ${streamError}`)
    if (!buffer) throw new Error('LLM 无响应')

    // 提取 template_id
    const m = buffer.match(/"template_id"\s*:\s*"([^"]+)"/)
    if (!m) throw new Error(`未能从 LLM 输出解析 template_id:\n${buffer.slice(0, 200)}`)
    const tmplId = m[1]!

    const speedMatch = buffer.match(/"speed_scale"\s*:\s*([\d.]+)/)
    const intensityMatch = buffer.match(/"intensity_scale"\s*:\s*([\d.]+)/)
    const speed = clamp(speedMatch ? parseFloat(speedMatch[1]!) : 1, 0.5, 2)
    const intensity = clamp(intensityMatch ? parseFloat(intensityMatch[1]!) : 1, 0.3, 1.5)

    const template = library.get(tmplId)
    if (!template) {
      throw new Error(`LLM 选了不存在的模板：${tmplId}（清单中 ${templates.length} 个）`)
    }

    const result = renderWithSemantics(template, ctx.semantics, {
      speed_scale: speed,
      intensity_scale: intensity,
      name_suffix: `_${Date.now().toString(36).slice(-4)}`,
    })

    if (!result.ok || !result.draft) {
      throw new Error(result.reason ?? '模板渲染失败')
    }
    return result.draft
  },
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}
