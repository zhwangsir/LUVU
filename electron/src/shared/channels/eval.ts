/**
 * Character eval IPC channels (Phase 1 K 接通)。
 *
 * eval:run    跑一次完整 50 题套件 — 长任务，进度走 'eval:progress' 推送
 * eval:abort  中断当前运行
 * eval:history 查最近 20 次报告（轻量版）
 * eval:clear-history
 */
import { defineChannel } from '../ipc-channel'

export interface EvalHistoryEntryShape {
  ts: number
  model: string
  total_questions: number
  avg_score: number
  by_category: Record<string, { count: number; avg: number }>
  failure_count: number
  top_failure_ids: string[]
}

export interface EvalReportShape {
  total_questions: number
  total_score: number
  avg_score: number
  by_category: Record<string, { count: number; avg: number }>
  failures: Array<{
    question_id: string
    category: string
    prompt: string
    answer_text: string
    score: number
    breakdown: {
      contains_any_hit: boolean
      contains_all_hit: boolean
      forbidden_violations: string[]
      matches_hit: boolean
      max_chars_violated: boolean
      emotion_matched: boolean
    }
  }>
  ts: number
  model: string
}

export const evalRun = defineChannel<
  { limit?: number },
  { ok: boolean; report?: EvalReportShape; reason?: string }
>('eval:run')

export const evalAbort = defineChannel<void, { ok: boolean }>('eval:abort')

export const evalHistory = defineChannel<void, EvalHistoryEntryShape[]>('eval:history')

export const evalClearHistory = defineChannel<void, { ok: boolean }>('eval:clear-history')
