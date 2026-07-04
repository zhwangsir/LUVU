/**
 * 把 MotionTemplate (语义参数) 渲染成 MotionDraft (具体 param id)。
 *
 * 步骤：
 *   1. 查目标模型的 SemanticsMap（ParameterIntrospector 输出）
 *   2. 对模板每条 track：找到 semantic → param_id
 *      - 找到多个候选 → 取 confidence 最高
 *      - 找不到 → 若 importance > 0.5 或在 required_semantics 中：reject
 *               否则降级（skip 该 track）
 *   3. 应用 scale / offset 调整数值
 *   4. 钳值到该参数的 min/max（防越界）
 *   5. 输出 MotionDraft
 */
import type { MotionDraft } from '@shared/motion'
import type { ApplyResult, MotionTemplate, TemplateTrack } from '@shared/motion-library'
import type { Semantic, ParameterSemantics, SemanticsMap } from '@shared/motion-semantics'
import { introspect } from './parameter-introspector'

export interface RenderOptions {
  /** 输出 draft 的 name 后缀（不传则用 template.id） */
  name_suffix?: string
  /** 整体速度倍数（>1 加快 / <1 减慢） */
  speed_scale?: number
  /** 整体强度倍数（数值乘） */
  intensity_scale?: number
}

export function renderTemplateToDraft(
  template: MotionTemplate,
  modelDir: string,
  opts: RenderOptions = {},
): ApplyResult {
  const semantics = introspect(modelDir)
  if (semantics.params.length === 0) {
    return { ok: false, reason: '目标模型无任何 motion 可供推断语义' }
  }
  return renderWithSemantics(template, semantics, opts)
}

export function renderWithSemantics(
  template: MotionTemplate,
  semantics: SemanticsMap,
  opts: RenderOptions = {},
): ApplyResult {
  const speedScale = opts.speed_scale ?? 1
  const intensityScale = opts.intensity_scale ?? 1
  const missing: Semantic[] = []
  const skipped: Semantic[] = []
  const draftTracks: MotionDraft['tracks'] = []

  // 检查 required_semantics
  for (const req of template.required_semantics ?? []) {
    const found = pickBestForSemantic(semantics, req)
    if (!found) {
      missing.push(req)
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing_semantics: missing,
      reason: `目标模型缺少必需语义：${missing.join(', ')}`,
    }
  }

  // 渲染每条 track
  for (const track of template.tracks) {
    const found = pickBestForSemantic(semantics, track.semantic)
    if (!found) {
      // 缺失：required 已经在上面检查过；这里 importance 决定是否 skip
      if ((track.importance ?? 0.5) >= 0.5) {
        missing.push(track.semantic)
      } else {
        skipped.push(track.semantic)
      }
      continue
    }

    const keyframes = remapKeyframes(track, found, intensityScale, speedScale)
    if (keyframes.length < 2) continue

    draftTracks.push({
      param: found.param_id,
      keyframes,
    })
  }

  if (draftTracks.length === 0) {
    return {
      ok: false,
      missing_semantics: missing,
      reason: '所有 track 都无法映射到目标模型',
    }
  }

  const duration = template.duration / speedScale
  const draft: MotionDraft = {
    name: `${template.id}${opts.name_suffix ?? ''}`,
    duration,
    loop: template.loop,
    fps: template.fps ?? 30,
    tracks: draftTracks,
    description: template.display_name_zh + (opts.name_suffix ? ` ${opts.name_suffix}` : ''),
  }

  return {
    ok: true,
    draft,
    missing_semantics: missing,
    skipped_tracks: skipped,
  }
}

/** 对一个语义，选 confidence 最高的 ParameterSemantics（同语义多 param 时） */
function pickBestForSemantic(
  semantics: SemanticsMap,
  sem: Semantic,
): ParameterSemantics | null {
  const list = semantics.by_semantic[sem]
  if (!list || list.length === 0) return null
  return list[0] ?? null // 已按 confidence 排序
}

/** 把模板的语义 keyframes 数值 → 目标参数实际值（应用 scale/offset/clamp） */
function remapKeyframes(
  track: TemplateTrack,
  target: ParameterSemantics,
  intensityScale: number,
  speedScale: number,
): Array<[number, number]> {
  const trackScale = track.scale ?? 1
  const trackOffset = track.offset ?? 0
  const result: Array<[number, number]> = []

  for (const kf of track.keyframes) {
    const t = kf.t / speedScale
    let v = kf.v * trackScale * intensityScale + trackOffset
    // 钳到目标参数 range（外扩 20% 容差，让模板偶尔超出也能用）
    const minBound = target.range.min - Math.abs(target.range.min) * 0.2
    const maxBound = target.range.max + Math.abs(target.range.max) * 0.2
    if (!Number.isFinite(v)) v = 0
    v = clamp(v, minBound, maxBound)
    result.push([t, v])
  }

  return result
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
