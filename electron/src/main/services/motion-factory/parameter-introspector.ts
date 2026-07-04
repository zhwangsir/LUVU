/**
 * Parameter Introspector — 给定模型，识别每个参数的「语义」。
 *
 * 三层算法 (从高到低置信)：
 *   1. cdi3.json 元数据 (Cubism 自带描述文件)
 *   2. 命名规则匹配 (英文/中文/拼音 + 正则覆盖常见命名)
 *   3. 协同分析 (motion 中协同变化 + 范围模式)
 *
 * 输出标准化语义图，让 MotionLibrary 的模板能跨模型复用。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Semantic, ParameterSemantics, SemanticsMap } from '@shared/motion-semantics'
import { parseMotion3 } from './parser'

// ============================================================================
// 命名规则库（按优先级排列；先匹配的胜出）
// ============================================================================

interface NamePattern {
  semantic: Semantic
  patterns: RegExp[]
}

const NAME_PATTERNS: NamePattern[] = [
  // ===== 头部 =====
  {
    semantic: 'head_yaw',
    patterns: [
      /^Param_?Angle_?X$/i,
      /^PARAM_ANGLE_X$/i,
      /^head[_-]?yaw$/i,
      /头部.*[xX]/,
      /头.*角度.*[xX水平]/,
      /tou[_-]?jiao[_-]?du[_-]?x/i,
    ],
  },
  {
    semantic: 'head_pitch',
    patterns: [
      /^Param_?Angle_?Y$/i,
      /^PARAM_ANGLE_Y$/i,
      /^head[_-]?pitch$/i,
      /头部.*[yY]/,
      /头.*角度.*[yY垂直]/,
      /tou[_-]?jiao[_-]?du[_-]?y/i,
    ],
  },
  {
    semantic: 'head_roll',
    patterns: [
      /^Param_?Angle_?Z$/i,
      /^PARAM_ANGLE_Z$/i,
      /^head[_-]?roll$/i,
      /头部.*[zZ]/,
      /tou[_-]?jiao[_-]?du[_-]?z/i,
    ],
  },

  // ===== 身体 =====
  {
    semantic: 'body_yaw',
    patterns: [/^Param_?Body_?Angle_?X$/i, /^body[_-]?yaw$/i, /身体.*[xX]/, /shen[_-]?ti.*x/i],
  },
  {
    semantic: 'body_pitch',
    patterns: [/^Param_?Body_?Angle_?Y$/i, /^body[_-]?pitch$/i, /身体.*[yY]/],
  },
  {
    semantic: 'body_roll',
    patterns: [/^Param_?Body_?Angle_?Z$/i, /^body[_-]?roll$/i, /身体.*[zZ]/],
  },

  // ===== 眼睛位置 =====
  {
    semantic: 'eye_left_x',
    patterns: [/^Param_?Eye[_-]?L[_-]?X$/i, /^eye[_-]?ball[_-]?x$/i, /左眼.*[xX]/, /eye.*l.*x/i],
  },
  {
    semantic: 'eye_left_y',
    patterns: [/^Param_?Eye[_-]?L[_-]?Y$/i, /^eye[_-]?ball[_-]?y$/i, /左眼.*[yY]/, /eye.*l.*y/i],
  },
  {
    semantic: 'eye_ball_x',
    patterns: [/^Param_?Eye[_-]?Ball[_-]?X$/i, /^PARAM_EYE_BALL_X$/i, /眼球.*[xX]/, /眼睛.*[xX]/],
  },
  {
    semantic: 'eye_ball_y',
    patterns: [/^Param_?Eye[_-]?Ball[_-]?Y$/i, /^PARAM_EYE_BALL_Y$/i, /眼球.*[yY]/, /眼睛.*[yY]/],
  },

  // ===== 眼睛开闭 =====
  {
    semantic: 'eye_left_open',
    patterns: [
      /^Param_?Eye[_-]?L[_-]?Open$/i,
      /^PARAM_EYE_L_OPEN$/i,
      /左眼.*[开睁]/,
      /eye.*l.*open/i,
      /zuo[_-]?yan[_-]?kai/i,
    ],
  },
  {
    semantic: 'eye_right_open',
    patterns: [
      /^Param_?Eye[_-]?R[_-]?Open$/i,
      /^PARAM_EYE_R_OPEN$/i,
      /右眼.*[开睁]/,
      /eye.*r.*open/i,
      /you[_-]?yan[_-]?kai/i,
    ],
  },
  {
    semantic: 'eye_smile',
    patterns: [
      /^Param_?Eye[_-]?L?_?Smile$/i,
      /^PARAM_EYE_L?_SMILE$/i,
      /眼.*笑/,
      /yan[_-]?xiao/i,
    ],
  },

  // ===== 眉毛 =====
  {
    semantic: 'brow_left_y',
    patterns: [/^Param_?Brow_?L[_-]?Y$/i, /^PARAM_BROW_L_Y$/i, /左眉/, /左.*眉/, /eyebrow.*l/i],
  },
  {
    semantic: 'brow_right_y',
    patterns: [/^Param_?Brow_?R[_-]?Y$/i, /^PARAM_BROW_R_Y$/i, /右眉/, /右.*眉/, /eyebrow.*r/i],
  },
  {
    semantic: 'brow_form',
    patterns: [/^Param_?Brow_?L?_?Form$/i, /眉.*[形状型]/, /mei[_-]?xing/i],
  },

  // ===== 嘴部 =====
  {
    semantic: 'mouth_open',
    patterns: [
      /^Param_?Mouth_?Open_?Y$/i,
      /^PARAM_MOUTH_OPEN_Y$/i,
      /嘴.*[开张]/,
      /zui[_-]?kai/i,
      /kou[_-]?kai/i,
      /mouth.*open/i,
    ],
  },
  {
    semantic: 'mouth_form',
    patterns: [
      /^Param_?Mouth_?Form$/i,
      /^PARAM_MOUTH_FORM$/i,
      /嘴.*[形状型]/,
      /嘴角/,
      /mouth.*form/i,
      /mouth.*shape/i,
    ],
  },
  {
    semantic: 'mouth_smile',
    patterns: [/^Param_?Mouth_?Smile$/i, /嘴.*笑/, /微笑/],
  },

  // ===== 呼吸 / 脸颊 =====
  {
    semantic: 'breath',
    patterns: [/^Param_?Breath$/i, /^PARAM_BREATH$/i, /呼吸/, /huxi/i],
  },
  {
    semantic: 'cheek',
    patterns: [/^Param_?Cheek$/i, /脸颊/, /害羞/, /lian[_-]?jia/i],
  },

  // ===== 头发物理 (常见, 但语义弱) =====
  {
    semantic: 'hair_front',
    patterns: [/^Param_?Hair_?Front$/i, /前发/, /qian[_-]?fa/i],
  },
  {
    semantic: 'hair_side',
    patterns: [/^Param_?Hair_?Side$/i, /侧发/, /ce[_-]?fa/i],
  },
  {
    semantic: 'hair_back',
    patterns: [/^Param_?Hair_?Back$/i, /后发/, /hou[_-]?fa/i],
  },

  // ===== 手臂 =====
  {
    semantic: 'arm_left',
    patterns: [/^Param_?Arm_?L/i, /左[手臂]/, /zuo[_-]?bi/i],
  },
  {
    semantic: 'arm_right',
    patterns: [/^Param_?Arm_?R/i, /右[手臂]/, /you[_-]?bi/i],
  },
]

// ============================================================================
// 主入口
// ============================================================================

export function introspect(modelDir: string): SemanticsMap {
  const model3 = findModel3(modelDir)
  if (!model3) return { model_dir: modelDir, params: [], by_semantic: {}, confidence: 0 }

  // 1. 收集所有 motion 里出现的 param + value 范围
  const paramMap = collectParamsFromMotions(modelDir, model3)
  if (paramMap.size === 0) {
    return { model_dir: modelDir, params: [], by_semantic: {}, confidence: 0 }
  }

  // 2. 协同分析（构建 co-occurrence 图）
  const coocs = buildCooccurrence(modelDir, model3)

  // 3. 读 cdi3.json (如果存在)
  const cdi = readCdi3(model3)

  // 4. 逐参数推断
  const params: ParameterSemantics[] = []
  for (const [id, range] of paramMap) {
    params.push(inferSemantics(id, range, cdi, coocs.get(id) ?? []))
  }

  // 5. 构造 by_semantic 反查
  const bySemantic: SemanticsMap['by_semantic'] = {}
  for (const p of params) {
    if (p.semantic !== 'unknown' && p.confidence > 0.3) {
      ;(bySemantic[p.semantic] ??= []).push(p)
    }
  }

  const overall =
    params.length > 0
      ? params.reduce((s, p) => s + p.confidence, 0) / params.length
      : 0

  return {
    model_dir: modelDir,
    params: params.sort((a, b) => b.confidence - a.confidence),
    by_semantic: bySemantic,
    confidence: overall,
  }
}

// ============================================================================
// 单参数语义推断
// ============================================================================

function inferSemantics(
  id: string,
  range: { min: number; max: number; count: number },
  cdi: Map<string, { name?: string; group?: string }>,
  cooccurs: string[],
): ParameterSemantics {
  // 1. cdi3 优先（最高置信）
  const cdiEntry = cdi.get(id)
  if (cdiEntry?.name) {
    const sem = matchByPatterns(cdiEntry.name)
    if (sem !== 'unknown') {
      return {
        param_id: id,
        semantic: sem,
        confidence: 0.95,
        evidence: 'cdi3_metadata',
        range: { min: range.min, max: range.max },
        cooccurs_with: cooccurs,
      }
    }
  }

  // 2. 命名规则
  const byName = matchByPatterns(id)
  if (byName !== 'unknown') {
    return {
      param_id: id,
      semantic: byName,
      confidence: 0.85,
      evidence: 'name_match',
      range: { min: range.min, max: range.max },
      cooccurs_with: cooccurs,
    }
  }

  // 3. range pattern（很弱的启发）
  const byRange = matchByRange(range)
  if (byRange) {
    return {
      param_id: id,
      semantic: byRange,
      confidence: 0.4,
      evidence: 'range_pattern',
      range: { min: range.min, max: range.max },
      cooccurs_with: cooccurs,
    }
  }

  // 4. 协同分析（最低置信；判断属于哪个语义组）
  // 看 cooccurs 中已识别的参数最多属于哪个组，归到同组
  // （需要先有其它已识别参数）—— 这层在调用方做完一轮后再做第二遍
  return {
    param_id: id,
    semantic: 'unknown',
    confidence: 0.15,
    evidence: 'cooccurrence_analysis',
    range: { min: range.min, max: range.max },
    cooccurs_with: cooccurs,
  }
}

function matchByPatterns(name: string): Semantic {
  for (const { semantic, patterns } of NAME_PATTERNS) {
    for (const p of patterns) {
      if (p.test(name)) return semantic
    }
  }
  return 'unknown'
}

function matchByRange(r: { min: number; max: number }): Semantic | null {
  // 一般经验：
  // [-30, 30] → 头部角度
  // [-1, 1] → 眼球 / 嘴形
  // [0, 1] → 开闭 / 透明度
  if (r.min <= -25 && r.max >= 25) return 'unknown' // 多种可能，不强归
  return null
}

// ============================================================================
// 协同分析：在已有 motion3.json 中，哪些参数同时变化
// ============================================================================

function buildCooccurrence(modelDir: string, model3Path: string): Map<string, string[]> {
  const map = new Map<string, Set<string>>()
  const motions = listMotionFiles(modelDir, model3Path)
  for (const mf of motions) {
    const parsed = parseMotion3(mf)
    if (!parsed) continue
    const ids = [...parsed.params.keys()]
    for (const id of ids) {
      if (!map.has(id)) map.set(id, new Set())
      const set = map.get(id)!
      for (const other of ids) {
        if (other !== id) set.add(other)
      }
    }
  }
  const result = new Map<string, string[]>()
  for (const [k, v] of map) result.set(k, [...v])
  return result
}

function collectParamsFromMotions(
  modelDir: string,
  model3Path: string,
): Map<string, { min: number; max: number; count: number }> {
  const motions = listMotionFiles(modelDir, model3Path)
  const map = new Map<string, { min: number; max: number; count: number }>()
  for (const mf of motions) {
    const parsed = parseMotion3(mf)
    if (!parsed) continue
    for (const [id, range] of parsed.params) {
      const cur = map.get(id)
      if (!cur) map.set(id, { ...range })
      else {
        cur.min = Math.min(cur.min, range.min)
        cur.max = Math.max(cur.max, range.max)
        cur.count += range.count
      }
    }
  }
  return map
}

// ============================================================================
// cdi3.json 读取（Cubism Display Info file）
// ============================================================================

interface RawCdi3 {
  Version: number
  Parameters?: Array<{ Id: string; Name?: string; GroupId?: string }>
  ParameterGroups?: Array<{ Id: string; Name?: string }>
}

function readCdi3(model3Path: string): Map<string, { name?: string; group?: string }> {
  const base = dirname(model3Path)
  // 标准命名 *.cdi3.json
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return new Map()
  }
  const cdiFile = entries.find((e) => /\.cdi3\.json$/i.test(e))
  if (!cdiFile) return new Map()
  try {
    const json = JSON.parse(readFileSync(join(base, cdiFile), 'utf-8')) as RawCdi3
    const map = new Map<string, { name?: string; group?: string }>()
    for (const p of json.Parameters ?? []) {
      map.set(p.Id, {
        ...(p.Name !== undefined && { name: p.Name }),
        ...(p.GroupId !== undefined && { group: p.GroupId }),
      })
    }
    return map
  } catch {
    return new Map()
  }
}

// ============================================================================
// helpers
// ============================================================================

function findModel3(dir: string): string | null {
  try {
    for (const e of readdirSync(dir)) {
      if (/\.model3\.json$/i.test(e)) return join(dir, e)
    }
  } catch {
    /* ignore */
  }
  return null
}

function listMotionFiles(modelDir: string, model3Path: string): string[] {
  // 从 model3.json FileReferences.Motions 拿
  try {
    const json = JSON.parse(readFileSync(model3Path, 'utf-8')) as {
      FileReferences?: {
        Motions?: Record<string, Array<{ File?: string }>>
      }
    }
    const base = dirname(model3Path)
    const out: string[] = []
    if (json.FileReferences?.Motions) {
      for (const arr of Object.values(json.FileReferences.Motions)) {
        for (const m of arr) {
          if (m.File) {
            const abs = join(base, m.File)
            if (existsSync(abs)) out.push(abs)
          }
        }
      }
    }
    if (out.length > 0) return out
    // fallback: 扫 motions/ 目录
    const motionsDir = join(modelDir, 'motions')
    if (existsSync(motionsDir) && statSync(motionsDir).isDirectory()) {
      for (const e of readdirSync(motionsDir)) {
        if (e.endsWith('.motion3.json')) out.push(join(motionsDir, e))
      }
    }
    return out
  } catch {
    return []
  }
}
