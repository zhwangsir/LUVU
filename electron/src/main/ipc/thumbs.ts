/**
 * Thumbs IPC handlers — Live2D 模型缩略图缓存。Type-safe channels (Phase 1 G).
 *
 * Renderer 后台 worker pool off-screen 渲染每个模型 → webp →
 * 通过 IPC 写盘到 ~/.luvu/thumbs/<character_id>.webp。
 * UI 卡片直接 file:// 读。
 */
import {
  thumbsClearAll,
  thumbsGet,
  thumbsGetBatch,
  thumbsListMissing,
  thumbsMarkFailed,
  thumbsSave,
} from '@shared/channels/thumbs'
import { handleInvoke } from './channel-helpers'

export function registerThumbsIpc(): void {
  handleInvoke(thumbsGet, async (characterId) => {
    const { getThumb } = await import('../services/thumb-store')
    return getThumb(characterId)
  })

  // v0.13 (audit performance ROI 2): 批量查询，消除 N+1 IPC 风暴
  handleInvoke(thumbsGetBatch, async (characterIds) => {
    const { getThumbBatch } = await import('../services/thumb-store')
    return getThumbBatch(characterIds)
  })

  handleInvoke(thumbsSave, async (payload) => {
    const { saveThumb } = await import('../services/thumb-store')
    return saveThumb(payload.character_id, payload.webp_base64)
  })

  handleInvoke(thumbsMarkFailed, async (payload) => {
    const { markFailed } = await import('../services/thumb-store')
    markFailed(payload.character_id, payload.reason)
    return { ok: true }
  })

  handleInvoke(thumbsListMissing, async (characterIds) => {
    const { listMissing } = await import('../services/thumb-store')
    return listMissing(characterIds)
  })

  handleInvoke(thumbsClearAll, async () => {
    const { clearAll } = await import('../services/thumb-store')
    return clearAll()
  })
}
