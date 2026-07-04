/**
 * Emotional state IPC channels (Phase 1 J 接通)。
 *
 * - emotional:on-reply  每轮对话结束后 fire-and-forget；带 user_text + emotion + intensity
 *                       让 main 端调 applyChatSentiment + applyTopicMention + applyTick
 * - emotional:get-state 查询当前 character 的情感切片（UI 状态栏 / debug）
 * - emotional:tick      手动触发 tick（attention loop / 测试用）
 */
import { defineChannel } from '../ipc-channel'
import type { EmotionalState, Mood } from '../emotional'

export interface EmotionalOnReplyPayload {
  user_text: string
  assistant_text: string
  emotion?: string
  intensity?: number
}

export const emotionalOnReply = defineChannel<EmotionalOnReplyPayload, { ok: boolean }>(
  'emotional:on-reply',
)

export const emotionalGetState = defineChannel<void, EmotionalState | null>(
  'emotional:get-state',
)

export const emotionalTick = defineChannel<void, EmotionalState | null>('emotional:tick')

/** 手动 setMood — UI 调试 / 测试用 */
export const emotionalSetMood = defineChannel<
  { mood: Mood; intensity: number; trigger?: string },
  EmotionalState | null
>('emotional:set-mood')
