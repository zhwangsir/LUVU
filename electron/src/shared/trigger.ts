/**
 * TriggerEngine 共享类型。
 * 情绪 + 上下文 → 选 motion 自动播放。
 */
import type { EmotionId } from './types'

export type TriggerContext =
  | 'conversation_reply'
  | 'user_typing'
  | 'idle_short'
  | 'idle_long'
  | 'greeting'
  | 'farewell'
  | 'task_done'
  | 'task_failed'
  | 'tool_call'
  | 'tool_done'

export interface TriggerRule {
  id: string
  /** 描述用 */
  display_name_zh: string
  /** 触发条件 */
  when: {
    emotion?: EmotionId | EmotionId[]
    /** 情绪强度阈值（≥） */
    min_intensity?: number
    context?: TriggerContext | TriggerContext[]
  }
  /** 候选选择策略 */
  pick: {
    /** 'engine' = 查 MotionEngine（emotion/context tag） / 'library' = 用模板渲染 */
    source: 'engine' | 'library'
    /** 若 source=engine，按什么排序 */
    order_by?: 'scorer_score' | 'play_count' | 'user_rating'
    /** 取前 N 个候选 */
    limit?: number
    /** 在候选中随机 (true) 还是用第一个 (false) */
    randomize?: boolean
    /** 若 source=library，指定模板 id (可数组 → 多选随机) */
    template_ids?: string[]
  }
  /** 触发后冷却时间（秒，防止重复触发） */
  cooldown_seconds?: number
  /** 规则优先级（高的优先匹配） */
  priority?: number
  /** 启用 */
  enabled?: boolean
}

export interface TriggerEvent {
  emotion?: EmotionId
  intensity?: number
  context: TriggerContext
}

export interface TriggerDecision {
  rule_id: string
  /** 实际要播放的 motion entry id (来自 MotionEngine) */
  motion_entry_id?: number
  /** 若 source=library，提供 template_id 让 renderer 在该模型上 apply + 播放 */
  template_id?: string
  /** 推断理由（调试用） */
  reason: string
}
