/**
 * Character eval IPC handlers (Phase 1 K 接通)。
 * eval:run 长任务期间通过 webContents.send('eval:progress', ...) 推 UI 进度。
 */
import type { BrowserWindow } from 'electron'
import {
  evalAbort,
  evalClearHistory,
  evalHistory,
  evalRun,
  type EvalReportShape,
} from '@shared/channels/eval'
import { runEvalSuite } from '../services/character-eval/runner'
import { clearEvalHistory, loadEvalHistory } from '../services/character-eval/history'
import { handleInvoke } from './channel-helpers'

export function registerEvalIpc(getWindow: () => BrowserWindow | null): void {
  let currentAbort: AbortController | null = null

  handleInvoke(evalRun, async (payload) => {
    if (currentAbort) {
      return { ok: false, reason: '已有评测正在运行，请先 abort' }
    }
    currentAbort = new AbortController()
    try {
      const report = await runEvalSuite({
        abortSignal: currentAbort.signal,
        ...(typeof payload?.limit === 'number' ? { limit: payload.limit } : {}),
        onProgress: (p) => {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('eval:progress', {
              done: p.done,
              total: p.total,
              ...(p.current
                ? {
                    current: {
                      question_id: p.current.question.id,
                      category: p.current.question.category,
                      score: p.current.score,
                    },
                  }
                : {}),
            })
          }
        },
      })
      // 投出 UI 友好的精简报告（去除 LLM 完整原 prompt 等冗余字段）
      const shape: EvalReportShape = {
        total_questions: report.total_questions,
        total_score: report.total_score,
        avg_score: report.avg_score,
        by_category: report.by_category,
        failures: report.failures.map((f) => ({
          question_id: f.question.id,
          category: f.question.category,
          prompt: f.question.prompt,
          answer_text: f.answer_text,
          score: f.score,
          breakdown: f.breakdown,
        })),
        ts: report.ts,
        model: report.model,
      }
      return { ok: true, report: shape }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    } finally {
      currentAbort = null
    }
  })

  handleInvoke(evalAbort, () => {
    if (currentAbort) {
      currentAbort.abort()
      currentAbort = null
      return { ok: true }
    }
    return { ok: false }
  })

  handleInvoke(evalHistory, () => loadEvalHistory())

  handleInvoke(evalClearHistory, () => {
    clearEvalHistory()
    return { ok: true }
  })
}
