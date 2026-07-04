/**
 * 生成策略 Registry — 4 种策略可插拔。
 *
 * 接口：每个 strategy 都接收 GenerationContext，返回 MotionDraft。
 * 用户在 UI 选策略（或 ensemble 跑多个 + scorer 选最优）。
 */
import type { MotionDraft, ModelMotionSummary } from '@shared/motion'
import type { SemanticsMap } from '@shared/motion-semantics'

export type StrategyId = 'direct_llm' | 'plan_refine' | 'template_based' | 'ensemble'

export interface GenerationContext {
  summary: ModelMotionSummary
  semantics: SemanticsMap
  description: string
  style?: string
  examples?: number
}

export interface IGenerationStrategy {
  readonly id: StrategyId
  readonly display_name_zh: string
  readonly description: string
  /** LLM token 量级估算 */
  readonly cost: 'low' | 'medium' | 'high'
  generate(ctx: GenerationContext): Promise<MotionDraft>
}

const registry = new Map<StrategyId, IGenerationStrategy>()

export function register(s: IGenerationStrategy): void {
  registry.set(s.id, s)
}

export function get(id: StrategyId): IGenerationStrategy | undefined {
  return registry.get(id)
}

export function list(): IGenerationStrategy[] {
  return [...registry.values()]
}

export function listMetadata(): Array<{
  id: StrategyId
  display_name_zh: string
  description: string
  cost: 'low' | 'medium' | 'high'
}> {
  return list().map((s) => ({
    id: s.id,
    display_name_zh: s.display_name_zh,
    description: s.description,
    cost: s.cost,
  }))
}
