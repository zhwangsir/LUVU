/**
 * 注册所有内置策略 — 主进程启动时调一次。
 */
import { register } from './index'
import { directLlmStrategy } from './direct-llm'
import { planRefineStrategy } from './plan-refine'
import { templateBasedStrategy } from './template-based'
import { ensembleStrategy } from './ensemble'

export function bootstrapStrategies(): void {
  register(directLlmStrategy)
  register(planRefineStrategy)
  register(templateBasedStrategy)
  register(ensembleStrategy)
}
