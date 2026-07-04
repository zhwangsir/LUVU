/**
 * Perception IPC channels (Phase 1 G batch 1).
 */
import { defineChannel } from '../ipc-channel'
import type { PerceptionConfig, PerceptionEvent, PerceptionEventType } from '../perception'

export const perceptionGetConfig = defineChannel<void, PerceptionConfig>('perception:get-config')

export const perceptionUpdateConfig = defineChannel<
  Partial<PerceptionConfig>,
  PerceptionConfig
>('perception:update-config')

export const perceptionRecent = defineChannel<
  { limit?: number; types?: PerceptionEventType[] },
  PerceptionEvent[]
>('perception:recent')
