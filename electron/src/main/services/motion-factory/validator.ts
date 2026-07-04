/**
 * MotionValidator — 校验 MotionDraft 是否合理，给出 warnings + errors。
 *
 * 检查项：
 *   1. 曲线平滑度（相邻 keyframe 速度变化过激 = "颤抖"）
 *   2. 参数冲突（互斥参数同时朝相反方向变化）
 *   3. Loop 跳变（loop=true 时首末值差 > 阈值）
 *   4. 时长合理（0.5s ~ 10s）
 *   5. Keyframe 密度（< 2 或 > 100）
 *   6. 值越界（超 param min/max 1.2 倍）
 */
import type { MotionDraft, KeyframeTrack, ModelMotionSummary } from '@shared/motion'

export interface ValidationIssue {
  level: 'error' | 'warning'
  category: 'smoothness' | 'conflict' | 'loop' | 'duration' | 'density' | 'out_of_range'
  message: string
  track?: string
}

export interface ValidationResult {
  valid: boolean // 无 error 即 valid（warnings 不影响）
  warnings: ValidationIssue[]
  errors: ValidationIssue[]
}

const SMOOTHNESS_MAX_VELOCITY_RATIO = 8 // 速度突变 > 8x 视为颤抖
const LOOP_JUMP_THRESHOLD_RATIO = 0.15 // 首末值差 / 值域 > 15% 视为跳变
const DURATION_MIN = 0.5
const DURATION_MAX = 10
const DENSITY_MIN = 2
const DENSITY_MAX = 100
const OUT_OF_RANGE_TOLERANCE = 1.2

export function validate(draft: MotionDraft, summary?: ModelMotionSummary): ValidationResult {
  const warnings: ValidationIssue[] = []
  const errors: ValidationIssue[] = []

  // === 时长 ===
  if (draft.duration < DURATION_MIN) {
    errors.push({
      level: 'error',
      category: 'duration',
      message: `时长过短 ${draft.duration}s（最少 ${DURATION_MIN}s）`,
    })
  } else if (draft.duration > DURATION_MAX) {
    warnings.push({
      level: 'warning',
      category: 'duration',
      message: `时长过长 ${draft.duration}s（建议 < ${DURATION_MAX}s，避免显得呆滞）`,
    })
  }

  // === 逐 track 检查 ===
  for (const track of draft.tracks) {
    const tIssues = validateTrack(track, draft, summary)
    for (const i of tIssues) {
      if (i.level === 'error') errors.push(i)
      else warnings.push(i)
    }
  }

  // === 参数冲突（多 track 同时变化方向相反） ===
  detectConflicts(draft).forEach((i) => {
    if (i.level === 'error') errors.push(i)
    else warnings.push(i)
  })

  return { valid: errors.length === 0, warnings, errors }
}

function validateTrack(
  track: KeyframeTrack,
  draft: MotionDraft,
  summary?: ModelMotionSummary,
): ValidationIssue[] {
  const out: ValidationIssue[] = []
  const kf = track.keyframes

  // 密度
  if (kf.length < DENSITY_MIN) {
    out.push({
      level: 'warning',
      category: 'density',
      track: track.param,
      message: `仅 ${kf.length} 个 keyframe，无法表达变化`,
    })
  } else if (kf.length > DENSITY_MAX) {
    out.push({
      level: 'warning',
      category: 'density',
      track: track.param,
      message: `${kf.length} 个 keyframe 太多，可能性能影响`,
    })
  }

  if (kf.length < 2) return out

  // 值越界
  const known = summary?.params.find((p) => p.id === track.param)
  if (known) {
    const tol = OUT_OF_RANGE_TOLERANCE
    const lo = known.min * (known.min >= 0 ? 1 / tol : tol)
    const hi = known.max * (known.max >= 0 ? tol : 1 / tol)
    for (const [t, v] of kf) {
      if (v < lo || v > hi) {
        out.push({
          level: 'warning',
          category: 'out_of_range',
          track: track.param,
          message: `t=${t.toFixed(2)}s 值 ${v.toFixed(2)} 超出 ${known.min}~${known.max} (容差 1.2x)`,
        })
      }
    }
  }

  // 平滑度（相邻段速度变化）
  const velocities: number[] = []
  for (let i = 1; i < kf.length; i++) {
    const cur = kf[i]
    const prev = kf[i - 1]
    if (!cur || !prev) continue
    const dt = cur[0] - prev[0]
    if (dt > 0) velocities.push(Math.abs((cur[1] - prev[1]) / dt))
  }
  if (velocities.length >= 2) {
    const avg = velocities.reduce((s, v) => s + v, 0) / velocities.length
    for (let i = 0; i < velocities.length; i++) {
      const v = velocities[i]
      if (v !== undefined && v > avg * SMOOTHNESS_MAX_VELOCITY_RATIO && avg > 0.1) {
        out.push({
          level: 'warning',
          category: 'smoothness',
          track: track.param,
          message: `段 ${i + 1} 速度突变 ${v.toFixed(1)}/s (平均 ${avg.toFixed(1)})，可能颤抖`,
        })
        break
      }
    }
  }

  // Loop 跳变
  if (draft.loop && known) {
    const firstKf = kf[0]
    const lastKf = kf[kf.length - 1]
    if (!firstKf || !lastKf) return out
    const first = firstKf[1]
    const last = lastKf[1]
    const range = Math.max(0.01, Math.abs(known.max - known.min))
    const jumpRatio = Math.abs(last - first) / range
    if (jumpRatio > LOOP_JUMP_THRESHOLD_RATIO) {
      out.push({
        level: 'warning',
        category: 'loop',
        track: track.param,
        message: `loop=true 但首末值差 ${(jumpRatio * 100).toFixed(0)}% 值域，会跳变`,
      })
    }
  }

  return out
}

function detectConflicts(draft: MotionDraft): ValidationIssue[] {
  const out: ValidationIssue[] = []
  // 简化版：检查同名前缀但 L/R 后缀的成对参数 (eye_left_open vs eye_right_open)
  // 应当大致同向变化，否则可能出错
  const byBase = new Map<string, { left?: KeyframeTrack; right?: KeyframeTrack }>()
  for (const t of draft.tracks) {
    const m = t.param.match(/^(.+?)_?[LRlr]$|^(.+?)[_-]?[Ll]eft$|^(.+?)[_-]?[Rr]ight$/)
    if (!m) continue
    const base = (m[1] || m[2] || m[3] || '').toLowerCase()
    const side = /[lL]eft|_l$|_L$/.test(t.param) ? 'left' : 'right'
    const cur = byBase.get(base) ?? {}
    cur[side as 'left' | 'right'] = t
    byBase.set(base, cur)
  }
  for (const [base, pair] of byBase) {
    if (!pair.left || !pair.right) continue
    // 比较两边平均值的方向
    const avgLeft = avgValue(pair.left)
    const avgRight = avgValue(pair.right)
    if (Math.sign(avgLeft) !== 0 && Math.sign(avgLeft) === -Math.sign(avgRight) && Math.abs(avgLeft - avgRight) > 0.3) {
      out.push({
        level: 'warning',
        category: 'conflict',
        track: `${pair.left.param} / ${pair.right.param}`,
        message: `${base} 左右参数方向相反（左 ${avgLeft.toFixed(2)} / 右 ${avgRight.toFixed(2)}），可能不对称`,
      })
    }
  }
  return out
}

function avgValue(t: KeyframeTrack): number {
  if (t.keyframes.length === 0) return 0
  return t.keyframes.reduce((s, [, v]) => s + v, 0) / t.keyframes.length
}
