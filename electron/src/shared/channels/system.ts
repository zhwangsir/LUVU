/**
 * 系统级 IPC channels (Phase 1 G batch 4).
 *
 * 涵盖：system / config / soul / history / models:scan
 * 注：config:changed / soul:changed / tray:action 推送是 main→renderer，不在 channel 范围。
 */
import { defineChannel } from '../ipc-channel'
import type { ModelInfoExt, SystemPaths } from '../api'
import type { RuntimeConfig, SoulConfig } from '../types'

// === system ===
export const systemVersion = defineChannel<void, string>('system:version')
export const systemPaths = defineChannel<void, SystemPaths>('system:paths')
export const systemRevealDataDir = defineChannel<void, string>('system:reveal-data-dir')
export const systemRevealModelsDir = defineChannel<void, string | undefined>(
  'system:reveal-models-dir',
)
export const systemOpenExternal = defineChannel<string, { ok: boolean; reason?: string }>(
  'system:open-external',
)

export interface DiskEntry {
  label: string
  path: string
  bytes: number
  exists: boolean
  hint: string
  cleanable: boolean
}
export interface DiskUsageReport {
  entries: DiskEntry[]
  total_bytes: number
  computed_at_ms: number
}

export const systemDiskUsage = defineChannel<boolean | undefined, DiskUsageReport>(
  'system:disk-usage',
)

export const systemCleanPath = defineChannel<
  string,
  { ok: boolean; freed_bytes: number; reason?: string }
>('system:clean-path')

// === config ===
export const configLoad = defineChannel<void, RuntimeConfig>('config:load')
export const configSave = defineChannel<RuntimeConfig, RuntimeConfig>('config:save')

// === models scan ===
export const modelsScan = defineChannel<void, ModelInfoExt[]>('models:scan')

// === soul ===
export const soulLoad = defineChannel<void, { config: SoulConfig; sources: string[] }>(
  'soul:load',
)
export const soulSystemPrompt = defineChannel<void, string>('soul:system-prompt')
export const soulSaveAvatar = defineChannel<
  Partial<SoulConfig['avatar']>,
  { ok: boolean; path: string; reason?: string }
>('soul:save-avatar')
export const soulPickDirectory = defineChannel<void, string | null>('soul:pick-directory')

// === history ===
export interface StoredTurnShape {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  emotion: string | null
  intensity: number | null
  ts: number
  error: string | null
  session_id: string
}

export const historyListRecent = defineChannel<number | undefined, StoredTurnShape[]>(
  'history:list-recent',
)
export const historyAppend = defineChannel<
  Omit<StoredTurnShape, 'session_id'>,
  { ok: boolean }
>('history:append')
export const historyClear = defineChannel<void, { deleted: number }>('history:clear')
