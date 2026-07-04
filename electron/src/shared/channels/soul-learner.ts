/**
 * Soul auto-learner IPC channels (P5)。
 *
 * 让用户在 Settings 手动触发一次"立即同步 learned_traits"，
 * 不用等 24h ticker。
 */
import { defineChannel } from '../ipc-channel'

export interface SoulLearnerSyncResult {
  ok: boolean
  applied?: number
  reason?: string
}

/** 立即同步当前 active character 的 topic_imprints → learned_traits.yaml */
export const soulLearnerSync = defineChannel<
  { character_id?: string } | undefined,
  SoulLearnerSyncResult
>('soul-learner:sync')
