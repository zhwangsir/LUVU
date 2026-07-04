/**
 * MotionScorer — 自动给 MotionDraft 打分。
 *
 * 6 维度加权（总分 0~1）：
 *   smoothness        0.25  — 平滑度（二阶差分越小越平滑）
 *   param_diversity   0.15  — 多少不同参数（越多越生动）
 *   description_match 0.30  — 占位（v0.7.5 接入 LLM judge）
 *   range_usage       0.10  — 参数用了多少 range
 *   loop_compatibility 0.10 — loop=true 时首末差
 *   density           0.10  — keyframe 密度合理度
 *
 * Ensemble 策略用 scorer 选最优。
 */
import type { MotionDraft, ModelMotionSummary, KeyframeTrack } from '@shared/motion'

export interface ScoreBreakdown {
  smoothness: number
  param_diversity: number
  description_match: number
  range_usage: number
  loop_compatibility: number
  density: number
  total: number
  weights: Record<string, number>
}

const WEIGHTS = {
  smoothness: 0.25,
  param_diversity: 0.15,
  description_match: 0.3,
  range_usage: 0.1,
  loop_compatibility: 0.1,
  density: 0.1,
}

export function scoreMotion(draft: MotionDraft, summary?: ModelMotionSummary): ScoreBreakdown {
  const smoothness = scoreSmoothness(draft)
  const diversity = scoreParamDiversity(draft)
  const description = 0.7 // 占位（v0.7.5 接 LLM）
  const range = summary ? scoreRangeUsage(draft, summary) : 0.5
  const loopOk = summary ? scoreLoopCompatibility(draft, summary) : draft.loop ? 0.5 : 1
  const density = scoreDensity(draft)

  const total =
    smoothness * WEIGHTS.smoothness +
    diversity * WEIGHTS.param_diversity +
    description * WEIGHTS.description_match +
    range * WEIGHTS.range_usage +
    loopOk * WEIGHTS.loop_compatibility +
    density * WEIGHTS.density

  return {
    smoothness,
    param_diversity: diversity,
    description_match: description,
    range_usage: range,
    loop_compatibility: loopOk,
    density,
    total: clamp01(total),
    weights: WEIGHTS,
  }
}

// === 各维度实现 ===

function scoreSmoothness(draft: MotionDraft): number {
  // 对每条 track 算二阶差分平均，归一化
  if (draft.tracks.length === 0) return 0
  let sum = 0
  let count = 0
  for (const t of draft.tracks) {
    const s = trackSmoothness(t)
    if (s != null) {
      sum += s
      count++
    }
  }
  return count > 0 ? sum / count : 0.5
}

function trackSmoothness(t: KeyframeTrack): number | null {
  const kf = t.keyframes
  if (kf.length < 3) return null
  // 二阶差分：speed 变化（加速度）
  const accs: number[] = []
  for (let i = 2; i < kf.length; i++) {
    const a = kf[i - 2]
    const b = kf[i - 1]
    const c = kf[i]
    if (!a || !b || !c) continue
    const dt1 = b[0] - a[0]
    const dt2 = c[0] - b[0]
    if (dt1 <= 0 || dt2 <= 0) continue
    const v1 = (b[1] - a[1]) / dt1
    const v2 = (c[1] - b[1]) / dt2
    accs.push(Math.abs(v2 - v1))
  }
  if (accs.length === 0) return 0.5
  const avgAcc = accs.reduce((s, a) => s + a, 0) / accs.length
  // 归一化：< 5 给 1.0，> 50 给 0
  if (avgAcc < 5) return 1.0
  if (avgAcc > 50) return 0
  return 1 - (avgAcc - 5) / 45
}

function scoreParamDiversity(draft: MotionDraft): number {
  // 参数数量映射到分数：1 个 = 0.2，3 个 = 0.7，6+ 个 = 1.0
  const n = new Set(draft.tracks.map((t) => t.param)).size
  if (n === 0) return 0
  if (n >= 6) return 1
  return Math.min(1, 0.2 + (n - 1) * 0.16)
}

function scoreRangeUsage(draft: MotionDraft, summary: ModelMotionSummary): number {
  // 平均：每条 track 用了 param 的多少 range
  let sum = 0
  let count = 0
  for (const t of draft.tracks) {
    const p = summary.params.find((x) => x.id === t.param)
    if (!p) continue
    const range = Math.abs(p.max - p.min)
    if (range < 0.001) continue
    let minV = Infinity
    let maxV = -Infinity
    for (const [, v] of t.keyframes) {
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const usage = Math.abs(maxV - minV) / range
    // 0.1~0.7 比例最好；过小=没动，过大=戏剧化
    let score = 0
    if (usage < 0.05) score = usage / 0.05
    else if (usage > 0.9) score = 0.5
    else if (usage > 0.7) score = 0.7 + 0.3 * ((0.9 - usage) / 0.2)
    else if (usage > 0.1) score = 1
    else score = 0.5 + 0.5 * ((usage - 0.05) / 0.05)
    sum += score
    count++
  }
  return count > 0 ? sum / count : 0.5
}

function scoreLoopCompatibility(draft: MotionDraft, summary: ModelMotionSummary): number {
  if (!draft.loop) return 1 // 非 loop 不计
  let minJump = 1
  for (const t of draft.tracks) {
    if (t.keyframes.length < 2) continue
    const firstKf = t.keyframes[0]
    const lastKf = t.keyframes[t.keyframes.length - 1]
    if (!firstKf || !lastKf) continue
    const first = firstKf[1]
    const last = lastKf[1]
    const p = summary.params.find((x) => x.id === t.param)
    const range = p ? Math.max(0.01, Math.abs(p.max - p.min)) : 1
    const ratio = Math.abs(last - first) / range
    // ratio 0 = 完美；ratio 0.2 = 0.5；ratio 0.5+ = 0
    const score = Math.max(0, 1 - ratio * 2.5)
    if (score < minJump) minJump = score
  }
  return minJump
}

function scoreDensity(draft: MotionDraft): number {
  // 每秒 1.5-5 个 keyframe 最理想
  if (draft.tracks.length === 0) return 0
  let sum = 0
  for (const t of draft.tracks) {
    const perSec = t.keyframes.length / Math.max(0.1, draft.duration)
    let s = 0
    if (perSec < 0.5) s = 0.3
    else if (perSec < 1.5) s = 0.6 + 0.4 * ((perSec - 0.5) / 1)
    else if (perSec < 5) s = 1
    else if (perSec < 10) s = 1 - 0.5 * ((perSec - 5) / 5)
    else s = 0.3
    sum += s
  }
  return sum / draft.tracks.length
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
