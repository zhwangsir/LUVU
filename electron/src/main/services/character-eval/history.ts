/**
 * 评测历史持久化 (Phase 1 K) — ~/.luvu/eval-history.json，LRU 20 条。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../paths'
import type { EvalReport } from './types'

const HISTORY_MAX = 20

function historyPath(): string {
  return join(getPaths().userDataDir, 'eval-history.json')
}

export interface EvalHistoryEntry {
  /** 简化版报告，省 failures 详情避免文件过大 */
  ts: number
  model: string
  total_questions: number
  avg_score: number
  by_category: EvalReport['by_category']
  /** 失败题数（不存全文，只数） */
  failure_count: number
  /** 排前 5 的失败题 id（让用户大概知道 drift 类别） */
  top_failure_ids: string[]
}

export function loadEvalHistory(): EvalHistoryEntry[] {
  const p = historyPath()
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const arr = JSON.parse(raw) as EvalHistoryEntry[]
    if (!Array.isArray(arr)) return []
    return arr
  } catch {
    return []
  }
}

export function appendEvalHistory(report: EvalReport): EvalHistoryEntry {
  const entry: EvalHistoryEntry = {
    ts: report.ts,
    model: report.model,
    total_questions: report.total_questions,
    avg_score: report.avg_score,
    by_category: report.by_category,
    failure_count: report.failures.length,
    top_failure_ids: report.failures.slice(0, 5).map((f) => f.question.id),
  }

  const cur = loadEvalHistory()
  cur.unshift(entry)
  const next = cur.slice(0, HISTORY_MAX)
  writeFileSync(historyPath(), JSON.stringify(next, null, 2), 'utf-8')
  return entry
}

export function clearEvalHistory(): void {
  const p = historyPath()
  if (existsSync(p)) writeFileSync(p, '[]', 'utf-8')
}
