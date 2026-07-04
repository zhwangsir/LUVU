/**
 * v0.15 E1: Live2D 模型「行业标准」学习数据库 + 完整度评分增强。
 *
 * 扫描所有 1389+ 模型，从 model3.json 抽取统计:
 * - 参数名分布（ParamAngleX/Y 出现率 / 自定义参数 / 物理参数）
 * - motion group 命名规范（Idle/Tap/Talk/...）
 * - expression 文件命名规范（angry/shy/...）
 * - 复杂度分布（motion 数 / expression 数 / 纹理大小）
 *
 * 这些 learnings 后续给 model-healer 用来「按行业标准补缺」(E2)。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getPaths } from './paths'
import { scanModels } from './model-scanner'

interface ModelDeepProbe {
  model_path: string
  /** model3.json 引用的 motion groups (key = group name) */
  motion_groups: string[]
  /** 所有 expression 文件名（去掉 .exp3.json 后缀） */
  expression_names: string[]
  /** 是否有 physics3.json */
  has_physics: boolean
  /** texture 数量 + 总大小 */
  texture_count: number
  texture_kb: number
  /** moc3 大小 */
  moc_kb: number
  /** Groups (EyeBlink/LipSync) */
  has_eye_blink: boolean
  has_lip_sync: boolean
  /** 完整度评分 0-100 */
  completeness_score: number
}

export interface ModelLearnings {
  /** Channel transit allow（让 main service 类型可直接走 IPC Record<string,unknown> 通道） */
  [k: string]: unknown
  /** 总样本数 */
  total_models: number
  /** 完整模型数（评分 >= 75） */
  complete_models: number
  /** motion group 名 → 出现频率 */
  motion_group_frequency: Record<string, number>
  /** expression 名 → 出现频率 */
  expression_name_frequency: Record<string, number>
  /** 「行业标准」motion group（出现频率 ≥ 30%） */
  standard_motion_groups: string[]
  /** 「行业标准」expression 名 */
  standard_expression_names: string[]
  /** has_physics 占比 */
  physics_coverage: number
  /** has_eye_blink 占比 */
  eye_blink_coverage: number
  /** has_lip_sync 占比 */
  lip_sync_coverage: number
  /** motion_count 分布百分位 */
  motion_count_p25: number
  motion_count_p50: number
  motion_count_p75: number
  /** expression_count 分布 */
  expression_count_p25: number
  expression_count_p50: number
  expression_count_p75: number
  /** 学习时间 */
  computed_at_ms: number
}

function learningsPath(): string {
  return join(getPaths().userDataDir, 'model-learnings.json')
}

/** 深度探测单个 model3.json，比 model-scanner.probeModel3 更详细 */
function deepProbeModel(modelPath: string): ModelDeepProbe | null {
  const base = dirname(modelPath)
  try {
    const json = JSON.parse(readFileSync(modelPath, 'utf-8')) as {
      FileReferences?: {
        Moc?: string
        Textures?: string[]
        Motions?: Record<string, Array<{ File?: string }>>
        Expressions?: Array<{ File?: string; Name?: string }>
        Physics?: string
      }
      Groups?: Array<{ Target?: string; Name?: string; Ids?: string[] }>
    }
    const refs = json.FileReferences ?? {}
    const groups = json.Groups ?? []

    // motion groups
    const motion_groups = Object.keys(refs.Motions ?? {})

    // expression names（从 Name 字段，fallback 文件名去 .exp3.json）
    const expression_names = (refs.Expressions ?? [])
      .map((e) => e.Name ?? (e.File ?? '').replace(/\.exp3?\.json$/i, '').split('/').pop() ?? '')
      .filter(Boolean)

    // physics
    const has_physics = !!refs.Physics && existsSync(join(base, refs.Physics))

    // textures
    const texture_paths = refs.Textures ?? []
    let texture_kb = 0
    let texture_count = 0
    for (const t of texture_paths) {
      try {
        const st = statSync(join(base, t))
        texture_kb += st.size / 1024
        texture_count++
      } catch { /* skip */ }
    }

    // moc
    let moc_kb = 0
    if (refs.Moc) {
      try { moc_kb = statSync(join(base, refs.Moc)).size / 1024 } catch { /* skip */ }
    }

    // Groups 检测 EyeBlink / LipSync
    const has_eye_blink = groups.some((g) => g.Name === 'EyeBlink' && (g.Ids?.length ?? 0) > 0)
    const has_lip_sync = groups.some((g) => g.Name === 'LipSync' && (g.Ids?.length ?? 0) > 0)

    // 完整度评分 0-100
    let score = 0
    if (moc_kb > 50) score += 15
    if (texture_kb > 200) score += 15
    if (motion_groups.length >= 1) score += 15
    if (motion_groups.length >= 3) score += 5
    if (motion_groups.length >= 6) score += 5
    if (expression_names.length >= 1) score += 10
    if (expression_names.length >= 3) score += 5
    if (expression_names.length >= 6) score += 5
    if (has_physics) score += 10
    if (has_eye_blink) score += 8
    if (has_lip_sync) score += 7

    return {
      model_path: modelPath,
      motion_groups,
      expression_names,
      has_physics,
      texture_count,
      texture_kb: Math.round(texture_kb),
      moc_kb: Math.round(moc_kb),
      has_eye_blink,
      has_lip_sync,
      completeness_score: Math.min(100, score),
    }
  } catch {
    return null
  }
}

/**
 * 计算所有模型的 learnings — 慢操作（1389 模型约 30 秒）。
 * 写到 ~/.luvu/model-learnings.json，下次直接读。
 */
export async function computeLearnings(force = false): Promise<ModelLearnings> {
  const fp = learningsPath()
  // 缓存：24 小时内不重新算
  if (!force && existsSync(fp)) {
    try {
      const cached = JSON.parse(readFileSync(fp, 'utf-8')) as ModelLearnings
      if (Date.now() - cached.computed_at_ms < 24 * 60 * 60 * 1000) {
        return cached
      }
    } catch { /* fall through */ }
  }

  const models = scanModels().filter((m) => m.cubism === 'cubism4')
  const probes: ModelDeepProbe[] = []
  for (const m of models) {
    const p = deepProbeModel(m.absolute_path)
    if (p) probes.push(p)
  }

  const total = probes.length
  if (total === 0) {
    const empty: ModelLearnings = {
      total_models: 0,
      complete_models: 0,
      motion_group_frequency: {},
      expression_name_frequency: {},
      standard_motion_groups: [],
      standard_expression_names: [],
      physics_coverage: 0,
      eye_blink_coverage: 0,
      lip_sync_coverage: 0,
      motion_count_p25: 0,
      motion_count_p50: 0,
      motion_count_p75: 0,
      expression_count_p25: 0,
      expression_count_p50: 0,
      expression_count_p75: 0,
      computed_at_ms: Date.now(),
    }
    return empty
  }

  // 频率统计
  const motionFreq: Record<string, number> = {}
  const expFreq: Record<string, number> = {}
  let physicsCount = 0
  let eyeBlinkCount = 0
  let lipSyncCount = 0
  let completeCount = 0
  const motionCounts: number[] = []
  const expCounts: number[] = []

  for (const p of probes) {
    if (p.has_physics) physicsCount++
    if (p.has_eye_blink) eyeBlinkCount++
    if (p.has_lip_sync) lipSyncCount++
    if (p.completeness_score >= 75) completeCount++
    motionCounts.push(p.motion_groups.length)
    expCounts.push(p.expression_names.length)
    for (const g of p.motion_groups) {
      motionFreq[g] = (motionFreq[g] ?? 0) + 1
    }
    for (const e of p.expression_names) {
      expFreq[e] = (expFreq[e] ?? 0) + 1
    }
  }

  // 行业标准：出现频率 ≥ 30% 算「标准」
  const threshold = total * 0.3
  const standardMotions = Object.entries(motionFreq)
    .filter(([, c]) => c >= threshold)
    .sort(([, a], [, b]) => b - a)
    .map(([g]) => g)
  const standardExps = Object.entries(expFreq)
    .filter(([, c]) => c >= threshold)
    .sort(([, a], [, b]) => b - a)
    .map(([e]) => e)

  const percentile = (arr: number[], p: number): number => {
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.floor((sorted.length - 1) * p)
    return sorted[idx] ?? 0
  }

  const learnings: ModelLearnings = {
    total_models: total,
    complete_models: completeCount,
    motion_group_frequency: motionFreq,
    expression_name_frequency: expFreq,
    standard_motion_groups: standardMotions,
    standard_expression_names: standardExps,
    physics_coverage: Math.round((physicsCount / total) * 100) / 100,
    eye_blink_coverage: Math.round((eyeBlinkCount / total) * 100) / 100,
    lip_sync_coverage: Math.round((lipSyncCount / total) * 100) / 100,
    motion_count_p25: percentile(motionCounts, 0.25),
    motion_count_p50: percentile(motionCounts, 0.5),
    motion_count_p75: percentile(motionCounts, 0.75),
    expression_count_p25: percentile(expCounts, 0.25),
    expression_count_p50: percentile(expCounts, 0.5),
    expression_count_p75: percentile(expCounts, 0.75),
    computed_at_ms: Date.now(),
  }

  try {
    writeFileSync(fp, JSON.stringify(learnings, null, 2), 'utf-8')
  } catch {
    /* 写盘失败不影响返回 */
  }

  return learnings
}

export function loadLearnings(): ModelLearnings | null {
  const fp = learningsPath()
  if (!existsSync(fp)) return null
  try {
    return JSON.parse(readFileSync(fp, 'utf-8')) as ModelLearnings
  } catch {
    return null
  }
}

/**
 * 根据 learnings 给单个模型评分 + 列出缺失项。
 * E2 会用这个结果生成「应该补什么」清单给 model-healer。
 */
export interface ModelCompletenessReport {
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  missing_motion_groups: string[]
  missing_expression_names: string[]
  missing_physics: boolean
  missing_eye_blink: boolean
  missing_lip_sync: boolean
  hints: string[]
}

export function evaluateModel(modelPath: string, learnings?: ModelLearnings | null): ModelCompletenessReport | null {
  const probe = deepProbeModel(modelPath)
  if (!probe) return null
  const lrn = learnings ?? loadLearnings()

  let grade: 'A' | 'B' | 'C' | 'D' = 'D'
  if (probe.completeness_score >= 85) grade = 'A'
  else if (probe.completeness_score >= 65) grade = 'B'
  else if (probe.completeness_score >= 40) grade = 'C'

  const missing_motion_groups: string[] = []
  const missing_expression_names: string[] = []
  const hints: string[] = []

  if (lrn) {
    for (const std of lrn.standard_motion_groups) {
      if (!probe.motion_groups.includes(std)) missing_motion_groups.push(std)
    }
    for (const std of lrn.standard_expression_names) {
      if (!probe.expression_names.includes(std)) missing_expression_names.push(std)
    }
    if (missing_motion_groups.length > 0) {
      hints.push(`缺 ${missing_motion_groups.length} 个常用 motion group（${missing_motion_groups.slice(0, 3).join('/')}...）`)
    }
    if (missing_expression_names.length > 0) {
      hints.push(`缺 ${missing_expression_names.length} 个常用 expression（${missing_expression_names.slice(0, 3).join('/')}...）`)
    }
  }
  if (!probe.has_physics) hints.push('缺 physics3.json — 头发/裙摆不会摆动')
  if (!probe.has_eye_blink) hints.push('缺 EyeBlink Groups — 不会自动眨眼')
  if (!probe.has_lip_sync) hints.push('缺 LipSync Groups — 嘴型不会跟随说话')

  return {
    score: probe.completeness_score,
    grade,
    missing_motion_groups,
    missing_expression_names,
    missing_physics: !probe.has_physics,
    missing_eye_blink: !probe.has_eye_blink,
    missing_lip_sync: !probe.has_lip_sync,
    hints,
  }
}
