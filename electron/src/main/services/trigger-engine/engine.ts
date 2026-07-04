/**
 * TriggerEngine — 接收 TriggerEvent，匹配规则，返回 TriggerDecision。
 *
 * 规则匹配优先级：
 *   1. 过滤所有 enabled 规则
 *   2. 评分匹配（emotion 强匹配 +2，context 强匹配 +2，弱匹配 +1）
 *   3. 排序：得分 → priority → cooldown 未触发
 *   4. 第一个胜出
 *
 * cooldown 用 in-memory map 记录每条规则上次触发时间。
 */
import type { TriggerDecision, TriggerEvent, TriggerRule } from '@shared/trigger'
import type { EmotionId } from '@shared/types'
import * as rulesStore from './rules-store'
import * as engineStorage from '../motion-engine/storage'

const lastTriggered = new Map<string, number>()

export interface DecideOptions {
  /** 当前选中的模型 dir，用于从 MotionEngine 查 motion */
  model_dir?: string
  /** 跳过 cooldown 检查（用于 preview） */
  ignore_cooldown?: boolean
}

export function decide(event: TriggerEvent, opts: DecideOptions = {}): TriggerDecision | null {
  const rules = rulesStore.load().filter((r) => r.enabled !== false)
  const now = Date.now()
  const scored: Array<{ rule: TriggerRule; score: number }> = []

  for (const rule of rules) {
    if (!opts.ignore_cooldown && rule.cooldown_seconds) {
      const last = lastTriggered.get(rule.id) ?? 0
      if (now - last < rule.cooldown_seconds * 1000) continue
    }

    let score = 0
    const w = rule.when

    // emotion match
    if (w.emotion != null) {
      const emos = Array.isArray(w.emotion) ? w.emotion : [w.emotion]
      if (event.emotion && (emos as string[]).includes(event.emotion)) {
        score += 2
        if (w.min_intensity != null && (event.intensity ?? 0) >= w.min_intensity) score += 1
      } else {
        continue // emotion 指定了但不匹配 → 不参与
      }
    }

    // context match
    if (w.context != null) {
      const ctxs = Array.isArray(w.context) ? w.context : [w.context]
      if ((ctxs as string[]).includes(event.context)) {
        score += 2
      } else {
        continue
      }
    }

    // priority bonus
    score += (rule.priority ?? 0) * 0.1

    scored.push({ rule, score })
  }

  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)

  for (const { rule } of scored) {
    const decision = pickFromRule(rule, opts)
    if (decision) {
      lastTriggered.set(rule.id, now)
      return decision
    }
  }
  return null
}

function pickFromRule(rule: TriggerRule, opts: DecideOptions): TriggerDecision | null {
  if (rule.pick.source === 'engine') {
    if (!opts.model_dir) return null
    const emo = firstOf(rule.when.emotion)
    let candidates = emo
      ? engineStorage.findByEmotion(opts.model_dir, emo, rule.pick.limit ?? 5)
      : engineStorage.list({
          model_dir: opts.model_dir,
          order_by: rule.pick.order_by ?? 'scorer_score',
          order_dir: 'desc',
          limit: rule.pick.limit ?? 5,
        })
    if (candidates.length === 0) return null
    const picked = rule.pick.randomize
      ? candidates[Math.floor(Math.random() * candidates.length)]!
      : candidates[0]!
    return {
      rule_id: rule.id,
      motion_entry_id: picked.id,
      reason: `engine pick from emotion=${emo}, ${candidates.length} candidates`,
    }
  } else if (rule.pick.source === 'library') {
    const ids = rule.pick.template_ids ?? []
    if (ids.length === 0) return null
    const picked = rule.pick.randomize ? ids[Math.floor(Math.random() * ids.length)]! : ids[0]!
    return {
      rule_id: rule.id,
      template_id: picked,
      reason: `library pick ${picked} from ${ids.length} options`,
    }
  }
  return null
}

function firstOf<T>(v: T | T[] | undefined): T | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

export function resetCooldowns(): void {
  lastTriggered.clear()
}

// Re-export rules-store ops for IPC
export { load as loadRules, save as saveRules, resetToDefaults } from './rules-store'

// 兼容旧 EmotionId 引用
void ({} as EmotionId)
