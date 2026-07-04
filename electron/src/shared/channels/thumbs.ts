/**
 * Thumbs IPC channels — Live2D 模型缩略图缓存 (Phase 1 G batch 2).
 */
import { defineChannel } from '../ipc-channel'

export interface ThumbInfo {
  exists: boolean
  /** file:// URL，UI 直接 <img :src> */
  url?: string
  size_bytes?: number
  age_ms?: number
  failed?: boolean
}

export const thumbsGet = defineChannel<string, ThumbInfo>('thumbs:get')

export const thumbsGetBatch = defineChannel<string[], Record<string, ThumbInfo>>(
  'thumbs:get-batch',
)

export const thumbsSave = defineChannel<
  { character_id: string; webp_base64: string },
  { ok: boolean; reason?: string }
>('thumbs:save')

export const thumbsMarkFailed = defineChannel<
  { character_id: string; reason: string },
  { ok: boolean }
>('thumbs:mark-failed')

export const thumbsListMissing = defineChannel<string[], string[]>('thumbs:list-missing')

export const thumbsClearAll = defineChannel<void, { deleted: number }>('thumbs:clear-all')
