/**
 * 模型管理 IPC channels (Phase 1 G batch 4).
 *
 * 涵盖：heal / dedup / describe / preferences / favorites / enrich / learnings /
 *      auto-fill / expression-pack / physics-presets / param-analysis
 *
 * 注：models:scan 留在 system.ts (bootstrap 必经路径)，仍走旧 invoke()
 *     models:enrich-progress 是 main→renderer 推送，不在 channel 范围内
 */
import { defineChannel } from '../ipc-channel'
import type { ModelInfoExt } from '../api'

// === v0.15 E1: Learnings ===
/** 跟 main service ModelLearnings 兼容 — 带 index signature 透传未列字段 */
export interface ModelLearningsLite {
  [k: string]: unknown
  total_models: number
  complete_models: number
  standard_motion_groups: string[]
  standard_expression_names: string[]
  physics_coverage: number
}

export const modelsComputeLearnings = defineChannel<boolean | undefined, ModelLearningsLite>(
  'models:compute-learnings',
)

export const modelsGetLearnings = defineChannel<void, ModelLearningsLite | null>(
  'models:get-learnings',
)

export const modelsEvaluate = defineChannel<
  { model_json_path: string },
  {
    score: number
    grade: 'A' | 'B' | 'C' | 'D'
    missing_motion_groups: string[]
    missing_expression_names: string[]
    missing_physics: boolean
    missing_eye_blink: boolean
    missing_lip_sync: boolean
    hints: string[]
  } | null
>('models:evaluate')

// === v0.15 E2 / v0.16: Auto fill ===
export const modelsAutoFill = defineChannel<
  { model_json_path: string; skip_expressions?: boolean },
  {
    ok: boolean
    added_motions: string[]
    added_expressions: string[]
    failed: string[]
    reason?: string
  }
>('models:auto-fill')

export const modelsApplyExpressionPack = defineChannel<
  { model_json_path: string },
  { ok: boolean; added: string[]; skipped: string[]; reason?: string }
>('models:apply-expression-pack')

export const modelsAnalyzeParams = defineChannel<
  { model_json_path: string },
  {
    total_params: number
    non_standard_count: number
    usages: Array<{
      param_id: string
      motion_refs: number
      expression_refs: number
      observed_min: number
      observed_max: number
      non_standard: boolean
      reason?: string
      suggested_id?: string
    }>
  }
>('models:analyze-params')

// === v0.16 T3: Physics presets ===
export const modelsListPhysicsPresets = defineChannel<
  void,
  Array<{ id: string; label: string; description: string }>
>('models:list-physics-presets')

export const modelsApplyPhysicsPreset = defineChannel<
  { model_json_path: string; preset_id: string },
  { ok: boolean; applied_outputs: string[]; reason?: string }
>('models:apply-physics-preset')

// === v0.8.2 heal + dedup ===
export const modelsHeal = defineChannel<
  { model_json_path: string },
  {
    ok: boolean
    reason?: string
    added: {
      motions: string[]
      expressions: string[]
      bound_orphans: { motions: string[]; expressions: string[] }
    }
  }
>('models:heal')

export const modelsFindDuplicates = defineChannel<
  void,
  {
    total_models: number
    groups: Array<{
      group_key: string
      confidence: 'exact' | 'same_moc' | 'similar_dir'
      keep: ModelInfoExt
      others: ModelInfoExt[]
    }>
    exact_duplicates: number
    exact_disk_kb: number
  }
>('models:find-duplicates')

export const modelsApplyDedup = defineChannel<
  { group_keys?: string[]; dry_run?: boolean } | undefined,
  {
    ok: boolean
    deleted: string[]
    failed: Array<{ path: string; reason: string }>
    freed_kb: number
  }
>('models:apply-dedup')

export const modelsMergeGroups = defineChannel<
  { group_keys?: string[] } | undefined,
  {
    ok: boolean
    merged_groups: number
    added_motions: number
    added_expressions: number
    archived_model_jsons: string[]
    skipped: Array<{ group_key: string; reason: string }>
  }
>('models:merge-groups')

// === v0.8.2 describe ===
export const modelsDescribe = defineChannel<
  {
    model_dir: string
    model_json_path: string
    display: string
    ip: string
    motion_count: number
    expression_count: number
  },
  { ok: boolean; text?: string; reason?: string; from_cache?: boolean }
>('models:describe')

export const modelsCachedDescriptions = defineChannel<void, Record<string, string>>(
  'models:cached-descriptions',
)

// === v0.9 preferences ===
export const modelsGetPreference = defineChannel<
  string,
  { scale: number; offset_x?: number; offset_y: number; last_used_at: number } | null
>('models:get-preference')

export const modelsSetPreference = defineChannel<
  { character_id: string; scale: number; offset_x?: number; offset_y: number },
  { ok: boolean }
>('models:set-preference')

// === v0.12 favorites + enrichment ===
export const modelsFavorites = defineChannel<
  void,
  { favorites: string[]; recent: Array<{ dir: string; used_at: number }> }
>('models:favorites')

export const modelsToggleFavorite = defineChannel<string, { is_favorite: boolean }>(
  'models:toggle-favorite',
)

export const modelsMarkRecent = defineChannel<string, { ok: boolean }>('models:mark-recent')

export const modelsClearRecent = defineChannel<void, { ok: boolean }>('models:clear-recent')

export const modelsEnrichCached = defineChannel<
  void,
  Record<
    string,
    {
      character_id: string
      chinese_name: string
      intro_one_line: string
      tags: string[]
      source_dir: string
      enriched_at: number
    }
  >
>('models:enrich-cached')

export const modelsEnrichStart = defineChannel<void, { ok: boolean }>('models:enrich-start')
export const modelsEnrichAbort = defineChannel<void, { ok: boolean }>('models:enrich-abort')
export const modelsEnrichClear = defineChannel<void, { ok: boolean }>('models:enrich-clear')
