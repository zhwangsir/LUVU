/**
 * TriggerEngine IPC handlers — type-safe channels (Phase 1 G).
 */
import {
  triggerDecide,
  triggerListRules,
  triggerResetCooldowns,
  triggerResetDefaults,
  triggerSaveRules,
} from '@shared/channels/trigger'
import * as engine from '../services/trigger-engine/engine'
import { handleInvoke } from './channel-helpers'

export function registerTriggerIpc(): void {
  handleInvoke(triggerDecide, (payload) =>
    engine.decide(payload.event, {
      ...(payload.model_dir !== undefined && { model_dir: payload.model_dir }),
      ...(payload.ignore_cooldown !== undefined && { ignore_cooldown: payload.ignore_cooldown }),
    }),
  )
  handleInvoke(triggerListRules, () => engine.loadRules())
  handleInvoke(triggerSaveRules, (rules) => {
    engine.saveRules(rules)
    return engine.loadRules()
  })
  handleInvoke(triggerResetDefaults, () => engine.resetToDefaults())
  handleInvoke(triggerResetCooldowns, () => {
    engine.resetCooldowns()
    return { ok: true }
  })
}
