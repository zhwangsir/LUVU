/**
 * 动作模板库共享类型。
 *
 * 模板用「语义参数」编写（如 head_pitch），通过 ParameterIntrospector
 * 映射到任意模型的真实 param id。让模板跨模型复用。
 */
import type { Semantic } from './motion-semantics'

/** 缓动函数（应用于相邻 keyframe 之间的插值） */
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier' | 'stepped'

export interface TemplateKeyframe {
  /** 时间（秒） */
  t: number
  /** 参数值 */
  v: number
}

export interface TemplateTrack {
  /** 语义而非具体 param id */
  semantic: Semantic
  /** 关键帧 */
  keyframes: TemplateKeyframe[]
  /** 缓动 */
  easing?: Easing
  /** 此 track 在该模板里的「重要度」(0~1)；当目标模型缺少此语义时，重要度 < 0.5 可跳过 */
  importance?: number
  /** 数值倍数（适配不同模型 range） */
  scale?: number
  /** 数值偏移 */
  offset?: number
}

export interface MotionTemplate {
  /** 唯一 id（文件名） */
  id: string
  /** 中文显示名 */
  display_name_zh: string
  /** 英文显示名 */
  display_name_en?: string
  /** 时长（秒） */
  duration: number
  /** 是否循环 */
  loop: boolean
  /** 帧率 */
  fps?: number
  /** 分类标签 */
  tags: TemplateTag[]
  /** 文字描述 */
  description: string
  /** 情绪关联（用于 TriggerEngine 选模板） */
  emotions?: string[]
  /** 上下文关联 */
  contexts?: TemplateContext[]
  /** 强度（用作模板变体：同一动作有 light/normal/strong 三档） */
  intensity?: 'light' | 'normal' | 'strong'
  /** 轨道 */
  tracks: TemplateTrack[]
  /** 不可少的语义（缺失时该模板不能应用到目标模型） */
  required_semantics?: Semantic[]
  /** 推荐的语义（缺失时降级，但仍可用） */
  recommended_semantics?: Semantic[]
}

export type TemplateTag =
  | 'idle'
  | 'greeting'
  | 'agreement'
  | 'disagreement'
  | 'thinking'
  | 'listening'
  | 'reaction'
  | 'expression'
  | 'gesture'
  | 'transition'
  | 'calm'
  | 'energetic'

export type TemplateContext =
  | 'conversation_reply'
  | 'user_typing'
  | 'idle_long'
  | 'idle_short'
  | 'greeting'
  | 'farewell'
  | 'task_done'
  | 'task_failed'

/** 模板列表汇总 */
export interface LibrarySummary {
  total: number
  by_tag: Record<string, number>
  by_emotion: Record<string, number>
  templates: Array<{
    id: string
    display_name_zh: string
    duration: number
    loop: boolean
    tags: string[]
    emotions: string[]
    required_semantics: string[]
  }>
}

/** 应用模板到模型的结果 */
export interface ApplyResult {
  ok: boolean
  /** 应用后的 MotionDraft（仍是高层格式，未编码 motion3.json） */
  draft?: import('./motion').MotionDraft
  /** 哪些语义在目标模型上没找到对应 param */
  missing_semantics?: Semantic[]
  /** 降级跳过的 track */
  skipped_tracks?: Semantic[]
  reason?: string
}
