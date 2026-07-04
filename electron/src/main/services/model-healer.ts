/**
 * Model Auto-Heal — 给不完整的 Live2D 模型补基础 motion / expression / 自动 bind。
 *
 * 能补：
 *   1. 基础 idle motion（呼吸/眨眼/轻微摇头）
 *   2. 基础 expression（happy/sad/shy/neutral）
 *   3. 扫描模型目录里 orphan 的 motion3.json / .exp3.json 自动 bind 进 model3.json
 *
 * 不能补：moc3、缺失的 texture（必须用 Cubism Editor 或换模型）。
 *
 * 注意：generated motion/expression 用 Cubism 标准参数名 (ParamAngleX/EyeLOpen/MouthForm 等)。
 * 模型如果用非标命名，heal 出来的 motion 不会有视觉效果（但也不会崩）。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, basename, relative as relPath } from 'node:path'
import type { MotionDraft } from '@shared/motion'
import type { SemanticsMap, Semantic } from '@shared/motion-semantics'
import { writeMotion } from './motion-factory/writer'
import { introspect } from './motion-factory/parameter-introspector'

export interface HealResult {
  ok: boolean
  reason?: string
  added: {
    motions: string[]
    expressions: string[]
    bound_orphans: { motions: string[]; expressions: string[] }
  }
}

interface RawModel3 {
  Version: number
  FileReferences: {
    Moc: string
    Motions?: Record<string, Array<{ File: string; Name?: string }>>
    Expressions?: Array<{ File: string; Name?: string }>
    Physics?: string
    [k: string]: unknown
  }
  [k: string]: unknown
}

export function healModel(modelJsonPath: string): HealResult {
  if (!existsSync(modelJsonPath)) {
    return emptyResult(false, `model3.json 不存在: ${modelJsonPath}`)
  }
  let model: RawModel3
  try {
    model = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as RawModel3
  } catch (e) {
    return emptyResult(false, `model3.json 解析失败: ${String(e)}`)
  }

  const base = dirname(modelJsonPath)
  const result: HealResult = {
    ok: true,
    added: { motions: [], expressions: [], bound_orphans: { motions: [], expressions: [] } },
  }

  // Step 1: 扫描 motion 数量 + orphan 检测
  const existingMotionFiles = new Set<string>()
  if (model.FileReferences.Motions) {
    for (const arr of Object.values(model.FileReferences.Motions)) {
      for (const m of arr) existingMotionFiles.add(m.File.replace(/\\/g, '/'))
    }
  }
  const existingExpFiles = new Set<string>()
  if (Array.isArray(model.FileReferences.Expressions)) {
    for (const e of model.FileReferences.Expressions) {
      existingExpFiles.add(e.File.replace(/\\/g, '/'))
    }
  }

  // Step 2: 扫 orphan motion3.json / exp3.json 自动 bind
  const allFiles = walkFiles(base)
  const orphanMotions = allFiles.filter(
    (f) => f.endsWith('.motion3.json') && !existingMotionFiles.has(toRel(base, f)),
  )
  const orphanExps = allFiles.filter(
    (f) => /\.(exp3\.json|exp\.json)$/.test(f) && !existingExpFiles.has(toRel(base, f)),
  )

  if (orphanMotions.length > 0) {
    if (!model.FileReferences.Motions) model.FileReferences.Motions = {}
    if (!model.FileReferences.Motions.Recovered) model.FileReferences.Motions.Recovered = []
    for (const f of orphanMotions) {
      const rel = toRel(base, f)
      const name = basename(f).replace(/\.motion3\.json$/, '')
      model.FileReferences.Motions.Recovered.push({ File: rel, Name: name })
      result.added.bound_orphans.motions.push(rel)
    }
  }
  if (orphanExps.length > 0) {
    if (!Array.isArray(model.FileReferences.Expressions)) model.FileReferences.Expressions = []
    for (const f of orphanExps) {
      const rel = toRel(base, f)
      const name = basename(f).replace(/\.(exp3\.json|exp\.json)$/, '')
      model.FileReferences.Expressions.push({ File: rel, Name: name })
      result.added.bound_orphans.expressions.push(rel)
    }
  }

  // 写回 model3.json（绑定 orphan 后）
  writeFileSync(modelJsonPath, JSON.stringify(model, null, 2), 'utf-8')

  // Step 3: 如果总 motion < 3，生成基础 motion
  // 关键：先 introspect 模型实际拥有的参数，用模型本身的 param id 生成
  // 否则用 Cubism 标准名（ParamAngleX 等）— 但很多游戏 rip 模型用非标命名，会无视觉效果
  const totalMotions = existingMotionFiles.size + orphanMotions.length
  if (totalMotions < 3) {
    const semantics = introspect(base)
    const drafts = generateAdaptiveMotions(semantics)
    for (const draft of drafts.slice(0, 3 - totalMotions)) {
      const r = writeMotion(modelJsonPath, draft, 'Idle')
      if (r.ok && r.motion_relative) result.added.motions.push(r.motion_relative)
    }
  }

  // Step 4: 如果总 expression < 4，生成基础 expression
  // 重新读 model3.json（writeMotion 改过）
  model = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as RawModel3
  const totalExps = (Array.isArray(model.FileReferences.Expressions) ? model.FileReferences.Expressions.length : 0)
  if (totalExps < 4) {
    const expDir = join(base, 'expressions')
    mkdirSync(expDir, { recursive: true })
    if (!Array.isArray(model.FileReferences.Expressions)) model.FileReferences.Expressions = []
    const existingNames = new Set(
      model.FileReferences.Expressions.map((e) => (e.Name ?? '').toLowerCase()),
    )
    for (const exp of basicExpressions()) {
      if (existingNames.has(exp.name)) continue
      const file = join(expDir, `${exp.name}.exp3.json`)
      if (existsSync(file)) continue
      writeFileSync(
        file,
        JSON.stringify({ Type: 'Live2D Expression', Parameters: exp.params }, null, 2),
        'utf-8',
      )
      const rel = `expressions/${exp.name}.exp3.json`
      model.FileReferences.Expressions.push({ File: rel, Name: exp.name })
      result.added.expressions.push(rel)
    }
    writeFileSync(modelJsonPath, JSON.stringify(model, null, 2), 'utf-8')
  }

  return result
}

function emptyResult(ok: boolean, reason?: string): HealResult {
  return {
    ok,
    ...(reason !== undefined && { reason }),
    added: { motions: [], expressions: [], bound_orphans: { motions: [], expressions: [] } },
  }
}

function toRel(base: string, abs: string): string {
  return relPath(base, abs).replace(/\\/g, '/')
}

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 3) return []
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue
    const p = join(dir, e)
    try {
      const st = statSync(p)
      if (st.isDirectory()) out.push(...walkFiles(p, depth + 1))
      else out.push(p)
    } catch {
      /* skip */
    }
  }
  return out
}

/**
 * 基于 introspect 出的 semantic map 生成 motion — 用模型**实际拥有**的参数 id。
 * 即便模型用 P00 / Eye_L 这种非标命名也能 work。
 * introspect 失败时（模型 0 motion 无法采样）fallback 到 Cubism 标准名 best-effort。
 */
function generateAdaptiveMotions(sem: SemanticsMap): MotionDraft[] {
  const pick = (semantic: Semantic): string | null => {
    const cands = sem.by_semantic[semantic]
    return cands && cands.length > 0 ? cands[0]!.param_id : null
  }
  const isUseful = sem.params.length > 0

  if (!isUseful) {
    // fallback：模型还没 motion → 不能 introspect。用 Cubism 标准名碰运气
    return basicMotionDrafts()
  }

  const drafts: MotionDraft[] = []

  // 呼吸 / 身体小幅摆动
  const breath = pick('breath')
  const bodyX = pick('body_yaw')
  if (breath || bodyX) {
    const tracks = []
    if (breath) tracks.push({ param: breath, keyframes: [[0, 0], [2, 1], [4, 0]] as Array<[number, number]> })
    if (bodyX) {
      const range = sem.by_semantic['body_yaw']?.[0]?.range
      const amp = range ? Math.min(2, (range.max - range.min) * 0.1) : 0.8
      tracks.push({ param: bodyX, keyframes: [[0, 0], [2, amp], [4, 0]] as Array<[number, number]> })
    }
    drafts.push({
      name: 'auto_breathe',
      duration: 4,
      loop: true,
      description: 'Auto-healed (semantics-aware): breathing',
      tracks,
    })
  }

  // 眨眼
  const eyeL = pick('eye_left_open')
  const eyeR = pick('eye_right_open')
  if (eyeL || eyeR) {
    const tracks = []
    const blink: Array<[number, number]> = [[0, 1], [1.4, 1], [1.45, 0], [1.55, 0], [1.6, 1], [3, 1]]
    if (eyeL) tracks.push({ param: eyeL, keyframes: blink })
    if (eyeR && eyeR !== eyeL) tracks.push({ param: eyeR, keyframes: blink })
    drafts.push({
      name: 'auto_blink',
      duration: 3,
      loop: true,
      description: 'Auto-healed (semantics-aware): blink',
      tracks,
    })
  }

  // 头部摇动
  const headX = pick('head_yaw')
  const headY = pick('head_pitch')
  if (headX || headY) {
    const tracks = []
    if (headX) {
      const range = sem.by_semantic['head_yaw']?.[0]?.range
      const amp = range ? Math.min(5, (range.max - range.min) * 0.1) : 3
      tracks.push({
        param: headX,
        keyframes: [[0, 0], [1.5, amp], [3, 0], [4.5, -amp], [5, 0]] as Array<[number, number]>,
      })
    }
    if (headY) {
      const range = sem.by_semantic['head_pitch']?.[0]?.range
      const amp = range ? Math.min(3, (range.max - range.min) * 0.07) : 2
      tracks.push({
        param: headY,
        keyframes: [[0, 0], [2.5, amp], [5, 0]] as Array<[number, number]>,
      })
    }
    drafts.push({
      name: 'auto_sway',
      duration: 5,
      loop: true,
      description: 'Auto-healed (semantics-aware): head sway',
      tracks,
    })
  }

  // 兜底：introspect 出了参数但全是 unknown semantic — 至少给一个 noop motion 让模型有 group
  if (drafts.length === 0 && sem.params.length > 0) {
    const firstParam = sem.params[0]!.param_id
    drafts.push({
      name: 'auto_idle',
      duration: 3,
      loop: true,
      description: 'Auto-healed: minimal idle (no recognized params)',
      tracks: [{ param: firstParam, keyframes: [[0, 0], [3, 0]] }],
    })
  }

  return drafts
}

/** 3 个基础 idle motion，用 Cubism 标准参数名 — 仅 introspect 失败时 fallback */
function basicMotionDrafts(): MotionDraft[] {
  return [
    {
      name: 'auto_breathe',
      duration: 4,
      loop: true,
      description: 'Auto-healed: gentle breathing loop',
      tracks: [
        { param: 'ParamBreath', keyframes: [[0, 0], [2, 1], [4, 0]] },
        { param: 'ParamBodyAngleX', keyframes: [[0, 0], [2, 0.8], [4, 0]] },
      ],
    },
    {
      name: 'auto_blink',
      duration: 3,
      loop: true,
      description: 'Auto-healed: blink loop',
      tracks: [
        { param: 'ParamEyeLOpen', keyframes: [[0, 1], [1.4, 1], [1.45, 0], [1.55, 0], [1.6, 1], [3, 1]] },
        { param: 'ParamEyeROpen', keyframes: [[0, 1], [1.4, 1], [1.45, 0], [1.55, 0], [1.6, 1], [3, 1]] },
      ],
    },
    {
      name: 'auto_sway',
      duration: 5,
      loop: true,
      description: 'Auto-healed: tiny head sway',
      tracks: [
        { param: 'ParamAngleX', keyframes: [[0, 0], [1.5, 3], [3, 0], [4.5, -3], [5, 0]] },
        { param: 'ParamAngleY', keyframes: [[0, 0], [2.5, 2], [5, 0]] },
      ],
    },
  ]
}

/** 4 个基础 expression，用 Cubism 标准参数名 */
function basicExpressions(): Array<{
  name: string
  params: Array<{ Id: string; Value: number; Blend: string }>
}> {
  return [
    {
      name: 'auto_happy',
      params: [
        { Id: 'ParamMouthForm', Value: 1.0, Blend: 'Add' },
        { Id: 'ParamMouthOpenY', Value: 0.3, Blend: 'Add' },
        { Id: 'ParamCheek', Value: 1.0, Blend: 'Add' },
      ],
    },
    {
      name: 'auto_sad',
      params: [
        { Id: 'ParamMouthForm', Value: -1.0, Blend: 'Add' },
        { Id: 'ParamBrowLY', Value: -1.0, Blend: 'Add' },
        { Id: 'ParamBrowRY', Value: -1.0, Blend: 'Add' },
      ],
    },
    {
      name: 'auto_shy',
      params: [
        { Id: 'ParamCheek', Value: 1.0, Blend: 'Add' },
        { Id: 'ParamMouthForm', Value: 0.5, Blend: 'Add' },
        { Id: 'ParamEyeLOpen', Value: -0.2, Blend: 'Add' },
        { Id: 'ParamEyeROpen', Value: -0.2, Blend: 'Add' },
      ],
    },
    {
      name: 'auto_neutral',
      params: [],
    },
  ]
}
