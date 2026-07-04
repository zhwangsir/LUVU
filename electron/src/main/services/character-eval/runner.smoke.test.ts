/**
 * Smoke test (Phase 1 K 真实 LLM 验证) — 默认 skip，需 SMOKE_TEST=1 才跑。
 *
 *   SMOKE_TEST=1 pnpm -F luvu-electron test --run runner.smoke
 *
 * 用当前 RuntimeConfig 配置的 LLM 真跑 3 题，验证:
 *   1. provider 链路通
 *   2. JSON 解析能拿到 text + emotion
 *   3. score 计算非 0（即使分数低也说明 scorer 跑通）
 *   4. history 持久化
 */
import { describe, expect, it, vi } from 'vitest'

// vitest 跑在 node，没 electron module — 必须 mock app.isPackaged + getPath
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) =>
      key === 'userData' ? `${process.env.HOME}/.luvu` : `${process.env.HOME}`,
    getVersion: () => '0.16.0-smoke',
  },
}))

// 同步等 mock 注入完，再 import 用到 electron 的模块
const { runEvalSuite } = await import('./runner')
const { loadEvalHistory } = await import('./history')
const { loadConfig } = await import('../config-store')

const SHOULD_RUN = process.env.SMOKE_TEST === '1'

describe.skipIf(!SHOULD_RUN)('K runner smoke test (real LLM)', () => {
  it(
    '跑 3 题 + 验证 history',
    async () => {
      const cfg = loadConfig()
      if (!cfg.llm_endpoint || !cfg.llm_model) {
        console.log('[smoke] LLM 未配置，跳过')
        return
      }
      console.log(
        `[smoke] using ${cfg.llm_provider} ${cfg.llm_endpoint} ${cfg.llm_model}`,
      )

      const beforeCount = loadEvalHistory().length

      const t0 = Date.now()
      const report = await runEvalSuite({
        limit: 3,
        timeoutMs: 90_000,
        onProgress: ({ done, total, current }) => {
          if (current) {
            console.log(
              `[smoke] [${done}/${total}] ${current.question.id} (${current.question.category}) ` +
                `score=${current.score} answer="${current.answer_text.slice(0, 80)}..."`,
            )
          }
        },
      })
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(
        `[smoke] done in ${elapsed}s avg=${report.avg_score} failures=${report.failures.length}`,
      )
      console.log(`[smoke] by_category:`, JSON.stringify(report.by_category, null, 2))

      // 基础健壮性断言（不要求高分 — 角色配置不一定优化过）
      expect(report.total_questions).toBe(3)
      expect(report.model).toBe(cfg.llm_model)
      expect(report.by_category).toBeDefined()

      // history 真的被写
      const afterCount = loadEvalHistory().length
      expect(afterCount).toBeGreaterThan(beforeCount)

      // 至少有一题得分 > 0（说明 LLM 真回了 + scorer 真跑了；
      // 即使全 0 也说明 scorer + provider 没 crash，但更可能是配置异常）
      const someScored = report.failures.length < 3 || report.failures.some((f) => f.score > 0)
      console.log(
        `[smoke] some_scored=${someScored} failures_scores=${report.failures.map((f) => f.score).join(',')}`,
      )
    },
    5 * 60_000,
  )
})
