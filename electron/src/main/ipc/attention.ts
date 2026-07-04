/**
 * Attention/Planner IPC handlers — type-safe channels (Phase 1 G).
 */
import {
  attentionGetConfig,
  attentionRecentPlans,
  attentionSnapshot,
  attentionUpdateConfig,
} from '@shared/channels/attention'
import {
  attentionSnapshot as svcAttentionSnapshot,
  getAttentionConfig,
  recentPlans,
  updateAttentionConfig,
} from '../services/attention'
import { handleInvoke } from './channel-helpers'

export function registerAttentionIpc(): void {
  handleInvoke(attentionGetConfig, () => getAttentionConfig())
  handleInvoke(attentionUpdateConfig, (patch) => updateAttentionConfig(patch))
  handleInvoke(attentionSnapshot, () => svcAttentionSnapshot())
  handleInvoke(attentionRecentPlans, (limit) => recentPlans(limit))
}
