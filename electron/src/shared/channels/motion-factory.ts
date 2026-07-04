/**
 * 动作工坊 IPC channels (Phase 1 G batch 3).
 * 注：motion:introspect-debug 只在 LUVU_DEBUG=1 时注册，
 * 故不预先声明 channel — 调试用 invoke('motion:introspect-debug', ...) 直传字符串即可。
 */
import { defineChannel } from '../ipc-channel'
import type { ModelMotionSummary, MotionDraft } from '../motion'
import type { SemanticsMap } from '../motion-semantics'
import type { ApplyResult, LibrarySummary, MotionTemplate } from '../motion-library'

export const motionSummarize = defineChannel<string, ModelMotionSummary>('motion:summarize')

export const motionIntrospect = defineChannel<string, SemanticsMap>('motion:introspect')

export const motionGenerate = defineChannel<
  {
    model_dir: string
    description: string
    style?: string
    examples?: number
    /** 'direct_llm' | 'plan_refine' | 'template_based' | 'ensemble' */
    strategy?: string
  },
  { ok: boolean; draft?: MotionDraft; reason?: string; strategy_used?: string }
>('motion:generate')

export const motionWrite = defineChannel<
  { model_json_path: string; draft: MotionDraft; group?: string },
  {
    ok: boolean
    motion_path?: string
    motion_relative?: string
    group?: string
    reason?: string
  }
>('motion:write')

// MotionLibrary
export const libraryGet = defineChannel<string, MotionTemplate | undefined>('library:get')
export const libraryList = defineChannel<void, MotionTemplate[]>('library:list')
export const librarySummary = defineChannel<void, LibrarySummary>('library:summary')
export const libraryReload = defineChannel<void, LibrarySummary>('library:reload')
export const libraryApply = defineChannel<
  {
    template_id: string
    model_dir: string
    speed_scale?: number
    intensity_scale?: number
    name_suffix?: string
  },
  ApplyResult
>('library:apply')
