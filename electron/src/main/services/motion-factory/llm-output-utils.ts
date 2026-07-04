/**
 * LLM 输出共享工具：JSON 提取 + MotionDraft 校验。
 * 多个 strategy 复用，避免代码重复。
 */
import type { MotionDraft } from '@shared/motion'
import type { ModelMotionSummary } from '@shared/motion'

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1))
  } catch {
    return null
  }
}

export function validateDraft(raw: unknown, summary: ModelMotionSummary): MotionDraft {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const r = raw as Record<string, unknown>
  const name = String(r.name ?? 'untitled')
  const duration = clamp(Number(r.duration ?? 2), 0.5, 30)
  const loop = !!r.loop
  const fps = Math.round(Number(r.fps ?? 30))
  if (!Array.isArray(r.tracks)) throw new Error('tracks 不是数组')

  const tracks = r.tracks
    .map((t) => {
      const tr = t as Record<string, unknown>
      const param = String(tr.param ?? '')
      if (!param) return null
      const kf = Array.isArray(tr.keyframes) ? tr.keyframes : []
      const keyframes = kf
        .map((k) => {
          if (Array.isArray(k) && k.length >= 2) {
            const t0 = clamp(Number(k[0]), 0, duration)
            const v = Number(k[1])
            if (!Number.isFinite(t0) || !Number.isFinite(v)) return null
            return [t0, v] as [number, number]
          }
          return null
        })
        .filter((x): x is [number, number] => x !== null)
      if (keyframes.length < 2) return null
      const known = summary.params.find((p) => p.id === param)
      if (known) {
        const m = known.min - Math.abs(known.min) * 0.1
        const M = known.max + Math.abs(known.max) * 0.1
        for (const k of keyframes) k[1] = clamp(k[1], m, M)
      }
      return { param, keyframes }
    })
    .filter((x): x is { param: string; keyframes: Array<[number, number]> } => x !== null)

  if (tracks.length === 0) throw new Error('没有任何有效 tracks')

  return {
    name,
    duration,
    loop,
    fps,
    tracks,
    ...(r.description != null ? { description: String(r.description) } : {}),
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}
