/**
 * Perception IPC handlers — type-safe channels (Phase 1 G).
 * renderer 用来：
 *  1. 订阅感知事件（用于调试面板 / Live2D 视线响应）
 *  2. 读/改感知配置
 *  3. 取最近事件历史
 */
import {
  perceptionGetConfig,
  perceptionRecent,
  perceptionUpdateConfig,
} from '@shared/channels/perception'
import type { PerceptionEvent } from '@shared/perception'
import { getPerceptionConfig, perception, updatePerceptionConfig } from '../services/perception'
import { handleInvoke } from './channel-helpers'

export function registerPerceptionIpc(): void {
  handleInvoke(perceptionGetConfig, () => getPerceptionConfig())
  handleInvoke(perceptionUpdateConfig, (patch) => updatePerceptionConfig(patch))
  handleInvoke(perceptionRecent, (payload) => {
    const types = payload.types
    return perception
      .recent(
        payload.limit ?? 50,
        types && types.length > 0 ? (e) => types.includes(e.type) : undefined,
      )
      .map((e) => sanitizeForIpc(e))
  })
}

function sanitizeForIpc(event: PerceptionEvent): PerceptionEvent {
  if (event.type === 'screen_snapshot' && event.image_b64) {
    const { image_b64, ...rest } = event
    return { ...rest, image_b64_size: image_b64.length } as PerceptionEvent
  }
  return event
}
