import type { EmotionId } from '@shared/types'

export interface DialogTurn {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  emotion?: EmotionId
  intensity?: number
  ts: number
  /** 流式中？ */
  streaming?: boolean
  error?: string
}

export interface ParsedReply {
  text: string
  emotion: EmotionId
  intensity: number
  /** v0.8.2: LLM 可在 reply 里附带 actions（瞥屏/换表情/idle 等），由 plan-executor 执行 */
  actions?: import('@shared/attention').BehaviorAction[]
}
