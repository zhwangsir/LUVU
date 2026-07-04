/**
 * MotionEngine IPC channels (Phase 1 G batch 2).
 */
import { defineChannel } from '../ipc-channel'
import type {
  MotionEntry,
  MotionFilter,
  MotionSource,
  MotionVersion,
  SyncReport,
} from '../motion-engine'

/** 与 storage.CreateMotionInput 对齐 */
export interface CreateMotionInput {
  model_dir: string
  name: string
  file_path: string
  group_name?: string
  source: MotionSource
  strategy?: string | null
  prompt?: string | null
  llm_provider?: string | null
  llm_model?: string | null
  duration_ms?: number
  loop_flag?: boolean
  param_count?: number
  validator_score?: number | null
  scorer_score?: number | null
  parent_entry_id?: number | null
  emotion_tags?: string[]
  context_tags?: string[]
}

export const engineList = defineChannel<MotionFilter | undefined, MotionEntry[]>('engine:list')
export const engineGet = defineChannel<number, MotionEntry | null>('engine:get')
export const engineCreate = defineChannel<CreateMotionInput, MotionEntry>('engine:create')
export const engineUpdate = defineChannel<
  { id: number; patch: Partial<MotionEntry> },
  MotionEntry
>('engine:update')
export const engineDelete = defineChannel<number, { ok: boolean }>('engine:delete')

export const engineSaveVersion = defineChannel<
  { entry_id: number; snapshot_json: string; edited_by: string },
  MotionVersion
>('engine:save-version')
export const engineListVersions = defineChannel<number, MotionVersion[]>('engine:list-versions')
export const engineGetVersion = defineChannel<
  { entry_id: number; version_no: number },
  MotionVersion | null
>('engine:get-version')

export const engineRecordPlay = defineChannel<number, void>('engine:record-play')
export const engineSetRating = defineChannel<{ id: number; rating: -1 | 0 | 1 }, void>(
  'engine:set-rating',
)

export const engineByEmotion = defineChannel<
  { model_dir: string; emotion: string; limit?: number },
  MotionEntry[]
>('engine:by-emotion')
export const engineByContext = defineChannel<
  { model_dir: string; context: string; limit?: number },
  MotionEntry[]
>('engine:by-context')
export const engineTopRated = defineChannel<
  { model_dir: string; n?: number },
  MotionEntry[]
>('engine:top-rated')

export const engineSync = defineChannel<string, SyncReport>('engine:sync')
