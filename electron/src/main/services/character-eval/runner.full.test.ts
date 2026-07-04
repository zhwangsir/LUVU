/**
 * 完整 50 题评测 — Phase 1 K 真实产品价值证明。
 *
 *   FULL_EVAL=1 pnpm -F luvu-electron test --run runner.full
 *
 * 预计 10-18 分钟 (Qwen3.6 thinking ~19s/题)。
 * 输出真实 drift 报告 + 失败题清单，供 soul 优化参考。
 */
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) =>
      key === 'userData' ? `${process.env.HOME}/.luvu` : `${process.env.HOME}`,
    getVersion: () => '0.16.0-eval',
  },
}))

const SHOULD_RUN = process.env.FULL_EVAL === '1'

describe.skipIf(!SHOULD_RUN)('Full 50-question character eval', () => {
  it(
    '跑全 50 题输出 drift 报告',
    async () => {
      const { runEvalSuite } = await import('./runner')
      const { loadConfig } = await import('../config-store')

      const cfg = loadConfig()
      console.log(`[full] LLM: ${cfg.llm_provider} ${cfg.llm_endpoint} ${cfg.llm_model}`)
      console.log(`[full] 50 题预计 10-18 分钟...`)

      const t0 = Date.now()
      const report = await runEvalSuite({
        timeoutMs: 90_000,
        onProgress: ({ done, total, current }) => {
          if (current) {
            const tag = current.score >= 80 ? '✓' : current.score >= 50 ? '?' : '✗'
            console.log(
              `[full] [${done}/${total}] ${tag} ${current.question.id} (${current.question.category}) ` +
                `score=${current.score}`,
            )
          }
        },
      })
      const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1)
      console.log(`\n[full] === Report (${elapsed} min) ===`)
      console.log(`[full] avg_score: ${report.avg_score} / 100`)
      console.log(`[full] failures: ${report.failures.length} / ${report.total_questions}`)
      console.log(`\n[full] by_category (avg / count):`)
      for (const [cat, info] of Object.entries(report.by_category)) {
        console.log(`  ${cat.padEnd(25)} ${info.avg.toString().padStart(3)} / ${info.count}`)
      }

      if (report.failures.length > 0) {
        console.log(`\n[full] failures (score < 60):`)
        for (const f of report.failures.slice(0, 20)) {
          console.log(`  ${f.question.id} (${f.question.category}) score=${f.score}`)
          console.log(`    Q: ${f.question.prompt}`)
          console.log(`    A: ${f.answer_text.slice(0, 120)}`)
          if (f.breakdown.forbidden_violations.length > 0) {
            console.log(`    forbidden hits: ${f.breakdown.forbidden_violations.join(', ')}`)
          }
        }
      }

      // 落盘完整报告供后查
      const reportPath = join(process.env.HOME!, '.luvu', `eval-full-${Date.now()}.json`)
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
      console.log(`\n[full] full report saved: ${reportPath}`)

      // 基础断言
      expect(report.total_questions).toBe(50)
      expect(report.avg_score).toBeGreaterThan(0)
    },
    25 * 60_000,
  )
})
