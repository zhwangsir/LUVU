/**
 * TriggerEngine IPC channels (Phase 1 G batch 1).
 */
import { defineChannel } from '../ipc-channel'
import type { TriggerDecision, TriggerEvent, TriggerRule } from '../trigger'

export const triggerDecide = defineChannel<
  { event: TriggerEvent; model_dir?: string; ignore_cooldown?: boolean },
  TriggerDecision | null
>('trigger:decide')

export const triggerListRules = defineChannel<void, TriggerRule[]>('trigger:list-rules')

export const triggerSaveRules = defineChannel<TriggerRule[], TriggerRule[]>('trigger:save-rules')

export const triggerResetDefaults = defineChannel<void, TriggerRule[]>('trigger:reset-defaults')

export const triggerResetCooldowns = defineChannel<void, { ok: boolean }>('trigger:reset-cooldowns')
