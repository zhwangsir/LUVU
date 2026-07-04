/**
 * MotionDraft → Cubism 4 motion3.json 纯函数编码器。
 *
 * 输入: 高层 KeyframeTrack[] (LLM 友好)
 * 输出: motion3.json 字符串 (Cubism 4 SDK 直接可加载)
 *
 * 不依赖 fs / electron — 任何 JS runtime (Node / browser / deno) 都可用。
 */
import type { KeyframeTrack, MotionDraft } from './types'

interface RawMotion3 {
  Version: number
  Meta: {
    Duration: number
    Fps: number
    Loop: boolean
    CurveCount: number
    AreBeziersRestricted?: boolean
    TotalSegmentCount?: number
    TotalPointCount?: number
    UserDataCount?: number
    TotalUserDataSize?: number
  }
  Curves: Array<{
    Target: 'Parameter'
    Id: string
    Segments: number[]
  }>
  UserData?: Array<{ Time: number; Value: string }>
}

/** 把 LLM 输出的 MotionDraft 编码成 motion3.json 字符串 */
export function draftToMotion3Json(draft: MotionDraft): string {
  const fps = draft.fps ?? 30
  let totalSegmentCount = 0
  let totalPointCount = 0

  const curves = draft.tracks.map((t) => {
    const seg = trackToSegments(t)
    totalSegmentCount += seg.segmentCount
    totalPointCount += seg.pointCount
    return {
      Target: 'Parameter' as const,
      Id: t.param,
      Segments: seg.segments,
    }
  })

  const data: RawMotion3 = {
    Version: 3,
    Meta: {
      Duration: draft.duration,
      Fps: fps,
      Loop: draft.loop,
      CurveCount: curves.length,
    },
    Curves: curves,
    ...(draft.description
      ? { UserData: [{ Time: 0, Value: draft.description }] }
      : {}),
  }
  data.Meta.AreBeziersRestricted = true
  data.Meta.TotalSegmentCount = totalSegmentCount
  data.Meta.TotalPointCount = totalPointCount
  data.Meta.UserDataCount = draft.description ? 1 : 0
  data.Meta.TotalUserDataSize = draft.description?.length ?? 0

  return JSON.stringify(data, null, 2)
}

/** 一条轨道 → segments 数组（全 Linear，type=0） */
export function trackToSegments(t: KeyframeTrack): {
  segments: number[]
  segmentCount: number
  pointCount: number
} {
  if (t.keyframes.length === 0) {
    return { segments: [0, 0], segmentCount: 0, pointCount: 1 }
  }
  const sorted = [...t.keyframes].sort((a, b) => a[0] - b[0])
  const first = sorted[0]
  if (!first) return { segments: [0, 0], segmentCount: 0, pointCount: 1 }
  const out: number[] = [first[0], first[1]]
  let segCount = 0
  for (let i = 1; i < sorted.length; i++) {
    const kf = sorted[i]
    if (!kf) continue
    out.push(0, kf[0], kf[1]) // type=0 Linear
    segCount++
  }
  return { segments: out, segmentCount: segCount, pointCount: sorted.length }
}
