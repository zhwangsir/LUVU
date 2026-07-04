/**
 * 周期性 onTick (Phase 1 J P3 接通) — 不靠对话也让情感自然演化。
 *
 * 默认每 5 分钟跑一次:
 *   - mood_intensity 自然衰减
 *   - missing_intensity 按 sinceChat 增长
 *   - 衰减到阈值 → 自动切回 baseline / 升到 missing
 *
 * 跟 attention loop 解耦 — attention 关停时本 ticker 仍跑（情感是 always-on）。
 */
import { getActiveCharacter } from '../character-store'
import { onTick } from './store'
import { SYNC_INTERVAL_MS, syncLearnedTraits } from '../soul-learner'

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
/** P5 soul-learner: 上次同步时刻 — 每 24h 触发一次 */
let lastLearnerSyncAt = 0

export function startEmotionalTicker(intervalMs: number = DEFAULT_TICK_INTERVAL_MS): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      const active = getActiveCharacter()
      if (!active) return
      const next = onTick(active.id)
      const lastChange = next.mood_history.at(-1)
      if (lastChange && lastChange.ts > Date.now() - intervalMs - 1000) {
        console.log(
          `[emotional] ${active.id}: mood→${next.current_mood} ` +
            `intensity=${next.mood_intensity.toFixed(2)} ` +
            `missing=${next.missing_intensity.toFixed(2)} (trigger: ${lastChange.trigger})`,
        )
      }
      // P5: soul-learner 每 24h 触发一次 - 把 topic_imprints 写回 learned_traits.yaml
      const now = Date.now()
      if (now - lastLearnerSyncAt >= SYNC_INTERVAL_MS) {
        lastLearnerSyncAt = now
        try {
          const r = syncLearnedTraits(active.id)
          if (r.applied && r.applied > 0) {
            console.log(`[soul-learner] sync: ${r.applied} traits 写入 learned_traits.yaml`)
          }
        } catch (e) {
          console.warn('[soul-learner] sync failed (non-fatal):', e)
        }
      }
    } catch (e) {
      console.warn('[emotional] tick failed:', e)
    }
  }, intervalMs)
  console.log(`[emotional] ticker started (every ${intervalMs / 1000}s)`)
}

export function stopEmotionalTicker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // ts-reviewer L1: 重置 sync 时间戳，避免热重载场景测试残留
  lastLearnerSyncAt = 0
}

export function isEmotionalTickerRunning(): boolean {
  return timer !== null
}
