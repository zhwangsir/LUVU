/**
 * Attention/Planner IPC channels (Phase 1 G batch 1).
 */
import { defineChannel } from '../ipc-channel'
import type { AttentionConfig, AttentionSnapshot, BehaviorPlan } from '../attention'

export const attentionGetConfig = defineChannel<void, AttentionConfig>('attention:get-config')

export const attentionUpdateConfig = defineChannel<Partial<AttentionConfig>, AttentionConfig>(
  'attention:update-config',
)

export const attentionSnapshot = defineChannel<void, AttentionSnapshot>('attention:snapshot')

export const attentionRecentPlans = defineChannel<number | undefined, BehaviorPlan[]>(
  'attention:recent-plans',
)
