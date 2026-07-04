/**
 * motion3.json 与高层 KeyframeTrack 互转。
 *
 * Cubism 4 motion3.json Curves[i].Segments 编码：
 *   起始点: [time0, value0]
 *   然后每段第 1 个数是 segment_type:
 *     0 = Linear:        [t, v]
 *     1 = Bezier:        [cp1_t, cp1_v, cp2_t, cp2_v, end_t, end_v]
 *     2 = Stepped:       [t, v]
 *     3 = InverseStepped:[t, v]
 *
 * 我们生成的 motion3.json 全部用 type=0 (Linear)，
 * 这样 LLM 只需输出 keyframes 即可。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MotionDraft, KeyframeTrack, ParamInfo, ModelMotionSummary } from '@shared/motion'
// Phase 1 W5 C: 纯函数 draftToMotion3Json + trackToSegments 现在来自 @luvu/motion-factory
// 本文件保留 IO 函数 (parseMotion3 / summarizeModelMotions) — 依赖 fs
import { draftToMotion3Json as _draftToMotion3Json } from '@luvu/motion-factory'
export { draftToMotion3Json } from '@luvu/motion-factory'

interface RawMotion3 {
  Version: number
  Meta: {
    Duration: number
    Fps: number
    Loop: boolean
    CurveCount?: number
    AreBeziersRestricted?: boolean
    TotalSegmentCount?: number
    TotalPointCount?: number
    UserDataCount?: number
    TotalUserDataSize?: number
  }
  Curves: Array<{
    Target: 'Parameter' | 'PartOpacity' | 'Model'
    Id: string
    Segments: number[]
  }>
  UserData?: Array<{ Time: number; Value: string }>
}

interface RawModel3 {
  Version: number
  FileReferences: {
    Moc: string
    Motions?: Record<string, Array<{ File: string; Name?: string }>>
  }
}

// draftToMotion3Json + trackToSegments 已搬到 @luvu/motion-factory 包，本文件 re-export
void _draftToMotion3Json  // 防 unused import warn (export 已在顶部)

/** 解析 motion3.json → 提取参数 id + 估算值范围 */
export function parseMotion3(filePath: string): {
  duration: number
  loop: boolean
  params: Map<string, { min: number; max: number; count: number }>
} | null {
  if (!existsSync(filePath)) return null
  let raw: RawMotion3
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawMotion3
  } catch {
    return null
  }
  const params = new Map<string, { min: number; max: number; count: number }>()
  for (const curve of raw.Curves) {
    if (curve.Target !== 'Parameter') continue
    const seg = curve.Segments
    // 遍历所有 (time, value) 对取 value 极值
    // 起始点
    if (seg.length >= 2 && seg[1] !== undefined) updateParam(params, curve.Id, seg[1])
    // 之后每段
    let i = 2
    while (i < seg.length) {
      const type = seg[i]
      if (type === 0 || type === 2 || type === 3) {
        // 2 数 [t, v]
        const v = seg[i + 2]
        if (v !== undefined) updateParam(params, curve.Id, v)
        i += 3
      } else if (type === 1) {
        // 6 数 [c1t, c1v, c2t, c2v, et, ev]
        const v = seg[i + 6]
        if (v !== undefined) updateParam(params, curve.Id, v)
        i += 7
      } else {
        i++
      }
    }
  }
  return { duration: raw.Meta.Duration, loop: raw.Meta.Loop, params }
}

function updateParam(
  map: Map<string, { min: number; max: number; count: number }>,
  id: string,
  value: number,
): void {
  if (!Number.isFinite(value)) return
  const cur = map.get(id)
  if (!cur) map.set(id, { min: value, max: value, count: 1 })
  else {
    cur.min = Math.min(cur.min, value)
    cur.max = Math.max(cur.max, value)
    cur.count++
  }
}

/**
 * 给定模型目录，扫描所有 motion3.json，汇总：
 * - 每个 motion 的 duration / loop / 用到的 param
 * - 整个模型用过的所有 param + min/max
 */
export function summarizeModelMotions(modelDir: string): ModelMotionSummary {
  const model3 = findFirst(modelDir, /\.model3\.json$/i)
  if (!model3) {
    return { model_dir: modelDir, motions: [], params: [] }
  }
  let json: RawModel3
  try {
    json = JSON.parse(readFileSync(model3, 'utf-8')) as RawModel3
  } catch {
    return { model_dir: modelDir, motions: [], params: [] }
  }
  const base = dirname(model3)
  const motionEntries: Array<{ name: string; file: string }> = []
  if (json.FileReferences.Motions) {
    for (const [group, arr] of Object.entries(json.FileReferences.Motions)) {
      for (const m of arr) {
        motionEntries.push({
          name: m.Name ?? `${group}/${motionEntries.length}`,
          file: m.File,
        })
      }
    }
  }

  const motions: ModelMotionSummary['motions'] = []
  const allParams = new Map<string, { min: number; max: number; count: number }>()
  for (const e of motionEntries) {
    const abs = join(base, e.file)
    const parsed = parseMotion3(abs)
    if (!parsed) continue
    motions.push({
      name: e.name,
      file: e.file,
      duration: parsed.duration,
      loop: parsed.loop,
      params: [...parsed.params.keys()],
    })
    for (const [id, range] of parsed.params) {
      const cur = allParams.get(id)
      if (!cur) allParams.set(id, { ...range })
      else {
        cur.min = Math.min(cur.min, range.min)
        cur.max = Math.max(cur.max, range.max)
        cur.count += range.count
      }
    }
  }

  const params: ParamInfo[] = [...allParams.entries()]
    .map(([id, r]) => ({ id, usage_count: r.count, min: r.min, max: r.max }))
    .sort((a, b) => b.usage_count - a.usage_count)

  return { model_dir: modelDir, motions, params }
}

function findFirst(dir: string, pattern: RegExp): string | null {
  try {
    for (const e of readdirSync(dir)) {
      if (pattern.test(e)) return join(dir, e)
    }
  } catch {
    /* ignore */
  }
  return null
}
