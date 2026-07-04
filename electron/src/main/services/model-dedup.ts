/**
 * Model Grouping — 识别"同组"模型（同一角色的不同形态/换装/变体）。
 *
 * 检测维度（多档信号，不再单纯按字节）：
 *   - exact: 字节级完全相同（mocBytes + textureBytesSum + textureCount 都一致）→ 真重复
 *   - same_moc: moc3 字节一致 + texture 不同 → 同一模型不同换装/表情
 *   - similar_dir: 目录名相似 (如 "Hibiki" / "Hibiki_smile" / "Hibiki@2") → 可能同组
 *
 * UI 默认只**标注**同组关系，**不**建议删除。
 * 只有 confidence='exact' 的可考虑删除冗余。
 */
import { rmSync, existsSync, statSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve, relative, sep, join } from 'node:path'
import type { ModelInfo } from '@shared/types'
import { scanModels } from './model-scanner'

export type GroupConfidence = 'exact' | 'same_moc' | 'similar_dir'

export interface DuplicateGroup {
  group_key: string
  confidence: GroupConfidence
  /** confidence='exact' 时推荐保留的（grade/motion 最优）；其他 confidence 都建议保留 */
  keep: ModelInfo
  /** group 内其他模型；只有 confidence='exact' 时才视为可删除 */
  others: ModelInfo[]
}

export interface DedupReport {
  total_models: number
  /** 所有同组 group（含 exact / same_moc / similar_dir） */
  groups: DuplicateGroup[]
  /** 真正的 byte-exact 重复数量（可安全删除） */
  exact_duplicates: number
  /** exact 重复占用空间 */
  exact_disk_kb: number
}

export function findDuplicates(): DedupReport {
  const all = scanModels()

  // Step 1: 按完整 dedup_key (mocBytes+texSum+texCount) group → 字节级完全一致
  const exactGroups = new Map<string, ModelInfo[]>()
  // Step 2: 按 mocBytes group → 同 moc 不同 texture（换装/表情）
  const sameMocGroups = new Map<number, ModelInfo[]>()
  // Step 3: 按目录名 normalize group → 名字相似（去掉 _v2 _smile 等后缀）
  const similarDirGroups = new Map<string, ModelInfo[]>()

  for (const m of all) {
    const key = m.meta?.dedup_key
    if (key) {
      const list = exactGroups.get(key) ?? []
      list.push(m)
      exactGroups.set(key, list)
    }
    if (m.meta && m.meta.moc_kb > 0) {
      // mocBytes 估算（meta 没存 byte 级，用 kb * 1024 + dedup_key 解析）
      const parts = (key ?? '').split(':')
      const mocBytes = Number(parts[0]) || 0
      if (mocBytes > 0) {
        const list = sameMocGroups.get(mocBytes) ?? []
        list.push(m)
        sameMocGroups.set(mocBytes, list)
      }
    }
    const normName = normalizeDirName(m.display)
    if (normName) {
      const list = similarDirGroups.get(normName) ?? []
      list.push(m)
      similarDirGroups.set(normName, list)
    }
  }

  const seen = new Set<string>()
  const groups: DuplicateGroup[] = []
  let exactDup = 0
  let exactDiskKb = 0

  // Step 1: exact 优先
  for (const [key, list] of exactGroups) {
    if (list.length < 2) continue
    const sorted = sortByQuality(list)
    const [keep, ...others] = sorted as [ModelInfo, ...ModelInfo[]]
    groups.push({ group_key: `exact:${key}`, confidence: 'exact', keep, others })
    for (const m of list) seen.add(m.dir)
    exactDup += others.length
    for (const o of others) exactDiskKb += dirSizeKb(dirname(o.absolute_path))
  }

  // Step 2: same_moc（排除 exact 已 group 的）
  for (const [moc, list] of sameMocGroups) {
    const filtered = list.filter((m) => !seen.has(m.dir))
    if (filtered.length < 2) continue
    const sorted = sortByQuality(filtered)
    const [keep, ...others] = sorted as [ModelInfo, ...ModelInfo[]]
    groups.push({ group_key: `same_moc:${moc}`, confidence: 'same_moc', keep, others })
    for (const m of filtered) seen.add(m.dir)
  }

  // Step 3: similar_dir（排除前 2 步已 group 的）
  for (const [norm, list] of similarDirGroups) {
    const filtered = list.filter((m) => !seen.has(m.dir))
    if (filtered.length < 2) continue
    const sorted = sortByQuality(filtered)
    const [keep, ...others] = sorted as [ModelInfo, ...ModelInfo[]]
    groups.push({ group_key: `similar_dir:${norm}`, confidence: 'similar_dir', keep, others })
    for (const m of filtered) seen.add(m.dir)
  }

  return {
    total_models: all.length,
    groups,
    exact_duplicates: exactDup,
    exact_disk_kb: exactDiskKb,
  }
}

function sortByQuality(list: ModelInfo[]): ModelInfo[] {
  return [...list].sort(
    (a, b) =>
      gradeRank(a) - gradeRank(b) || motion(b) - motion(a) || a.display.localeCompare(b.display),
  )
}

/** normalize 目录名 — 去掉常见 outfit/version 后缀，保留 base 名字 */
function normalizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-]?(v\d+|2$|copy|new|old|smile|sad|happy|shy|angry|normal|default|@\d+|\(\d+\))$/g, '')
    .replace(/[_\-\s]+$/, '')
    .trim()
}

export interface DedupExecResult {
  ok: boolean
  deleted: string[]
  failed: Array<{ path: string; reason: string }>
  freed_kb: number
}

/**
 * 安全 archive 模式（v0.8.2 修复）：永远不 rm 整个目录。
 *   - 只 rename 次要 model3.json 为 .dedup.bak（同 mergeGroups archive 一致）
 *   - 不动 moc / texture / motion / expression 文件
 *   - 如果同目录还有其他活的 model3.json（说明该目录被多个 model3.json 共享），更要避免误伤
 *
 * 上一版用 rmSync(modelDir, recursive) 删整个父目录的灾难性 bug 已废弃。
 */
export function applyDedup(opts: { group_keys?: string[]; dry_run?: boolean }): DedupExecResult {
  const report = findDuplicates()
  const exactGroups = report.groups.filter((g) => g.confidence === 'exact')
  const targets =
    opts.group_keys && opts.group_keys.length > 0
      ? exactGroups.filter((g) => opts.group_keys!.includes(g.group_key))
      : exactGroups

  const result: DedupExecResult = { ok: true, deleted: [], failed: [], freed_kb: 0 }
  for (const g of targets) {
    for (const dup of g.others) {
      if (!existsSync(dup.absolute_path)) continue
      if (opts.dry_run) {
        result.deleted.push(dup.absolute_path)
        result.freed_kb += Math.round(statSync(dup.absolute_path).size / 1024)
        continue
      }
      try {
        // 只 archive model3.json 文件本身（不动整个目录），避免误删共享 moc/texture
        const archived = dup.absolute_path + '.dedup.bak'
        renameSync(dup.absolute_path, archived)
        result.deleted.push(dup.absolute_path)
        result.freed_kb += Math.round(statSync(archived).size / 1024)
      } catch (e) {
        result.failed.push({ path: dup.absolute_path, reason: String(e) })
        result.ok = false
      }
    }
  }
  return result
}

/**
 * 真正合并同组模型：把次要 model3.json 里独有的 motion/expression 引用并入主 model3.json。
 * 只对 confidence='exact'（mocBytes + textureBytesSum + textureCount 一致）执行 — 这是 Live2D 规范允许的安全合并。
 * 其他场景（不同 moc / 不同 texture）技术上不能合并，会跳过 + 报告。
 */
export interface MergeResult {
  ok: boolean
  merged_groups: number
  added_motions: number
  added_expressions: number
  archived_model_jsons: string[] // 次要 model3.json 改名为 .merged.bak
  skipped: Array<{ group_key: string; reason: string }>
}

interface ModelRefs {
  Moc: string
  Textures?: string[]
  Motions?: Record<string, Array<{ File: string; Name?: string }>>
  Expressions?: Array<{ File: string; Name?: string }>
  Physics?: string
  [k: string]: unknown
}

interface Model3Json {
  Version: number
  FileReferences: ModelRefs
  [k: string]: unknown
}

export function mergeGroups(opts: { group_keys?: string[] }): MergeResult {
  const report = findDuplicates()
  const result: MergeResult = {
    ok: true,
    merged_groups: 0,
    added_motions: 0,
    added_expressions: 0,
    archived_model_jsons: [],
    skipped: [],
  }
  for (const g of report.groups) {
    if (opts.group_keys && opts.group_keys.length > 0 && !opts.group_keys.includes(g.group_key)) {
      continue
    }
    if (g.confidence !== 'exact') {
      result.skipped.push({
        group_key: g.group_key,
        reason:
          g.confidence === 'same_moc'
            ? 'moc3 相同但 texture 不同（同模型不同换装） — Live2D 不支持运行时切 texture'
            : '目录名相似但 moc3 不同（不同模型） — 技术上无法合并',
      })
      continue
    }
    // exact group：把 g.others 的 motion/expression 引用合并到 g.keep
    try {
      const merged = mergeExactGroup(g.keep, g.others)
      result.merged_groups++
      result.added_motions += merged.addedMotions
      result.added_expressions += merged.addedExpressions
      result.archived_model_jsons.push(...merged.archived)
    } catch (e) {
      result.skipped.push({ group_key: g.group_key, reason: `合并失败: ${String(e)}` })
      result.ok = false
    }
  }
  return result
}

function mergeExactGroup(
  keep: ModelInfo,
  others: ModelInfo[],
): { addedMotions: number; addedExpressions: number; archived: string[] } {
  const keepPath = keep.absolute_path
  const keepBase = dirname(keepPath)
  // v0.8.2 safety: 跨目录相对路径用 ../../ 越多越脆，
  // pixi-live2d-display new URL(rel, base) 解析多层 .. 在某些 builder 下静默 fail。
  // 只合并跟 keep 在同一 root（顶级 modelSearchPath）下的 other，否则跳过。
  const keepRoot = topLevelOf(keepBase)
  const safeOthers = others.filter((o) => topLevelOf(dirname(o.absolute_path)) === keepRoot)
  const keepJson = JSON.parse(readFileSync(keepPath, 'utf-8')) as Model3Json
  const keepRefs = keepJson.FileReferences
  keepRefs.Motions = keepRefs.Motions ?? {}
  keepRefs.Expressions = Array.isArray(keepRefs.Expressions) ? keepRefs.Expressions : []

  // 把 keep 已 reference 的 motion/expression 文件绝对路径加进 seen set，避免重复添加
  const seenMotionAbs = new Set<string>()
  for (const arr of Object.values(keepRefs.Motions)) {
    for (const m of arr) seenMotionAbs.add(resolve(keepBase, m.File))
  }
  const seenExpAbs = new Set<string>()
  for (const e of keepRefs.Expressions) seenExpAbs.add(resolve(keepBase, e.File))

  let addedMotions = 0
  let addedExpressions = 0
  const archived: string[] = []

  for (const other of safeOthers) {
    if (!existsSync(other.absolute_path)) continue
    const otherBase = dirname(other.absolute_path)
    let otherJson: Model3Json
    try {
      otherJson = JSON.parse(readFileSync(other.absolute_path, 'utf-8')) as Model3Json
    } catch {
      continue
    }
    const oRefs = otherJson.FileReferences
    // 合并 motions
    if (oRefs.Motions) {
      for (const [group, arr] of Object.entries(oRefs.Motions)) {
        for (const m of arr) {
          const abs = resolve(otherBase, m.File)
          if (seenMotionAbs.has(abs)) continue
          if (!existsSync(abs)) continue
          // motion 文件实际在 otherBase，不在 keepBase
          // 我们 reference 它的相对路径必须从 keepBase 起算
          const rel = relativePathPortable(keepBase, abs)
          if (!keepRefs.Motions![group]) keepRefs.Motions![group] = []
          keepRefs.Motions![group].push({ File: rel, Name: m.Name ?? '' })
          seenMotionAbs.add(abs)
          addedMotions++
        }
      }
    }
    // 合并 expressions
    if (Array.isArray(oRefs.Expressions)) {
      for (const e of oRefs.Expressions) {
        const abs = resolve(otherBase, e.File)
        if (seenExpAbs.has(abs)) continue
        if (!existsSync(abs)) continue
        const rel = relativePathPortable(keepBase, abs)
        keepRefs.Expressions.push({ File: rel, Name: e.Name ?? '' })
        seenExpAbs.add(abs)
        addedExpressions++
      }
    }
    // 归档 other 的 model3.json — 改后缀 .merged.bak，不删 motion/exp 文件
    const archivedPath = other.absolute_path + '.merged.bak'
    renameSync(other.absolute_path, archivedPath)
    archived.push(archivedPath)
  }

  writeFileSync(keepPath, JSON.stringify(keepJson, null, 2), 'utf-8')
  return { addedMotions, addedExpressions, archived }
}

function relativePathPortable(fromDir: string, toFile: string): string {
  return relative(fromDir, toFile).replace(/\\/g, '/')
}

/** 取目录的顶级 segment（用于 mergeGroups 安全检查：只合并同 root 下的） */
function topLevelOf(dir: string): string {
  // 取 path 的前两层（如 /Users/<user>/Documents/Live2d-model-master/BanG... → /Users/<user>/Documents/Live2d-model-master）
  const parts = dir.split(sep).filter(Boolean)
  return parts.slice(0, 5).join(sep) // 5 层够 fingerprint 主人模型库根
}

function gradeRank(m: ModelInfo): number {
  const g = m.meta?.grade
  return g === 'A' ? 0 : g === 'B' ? 1 : g === 'C' ? 2 : 3
}

function motion(m: ModelInfo): number {
  return m.meta?.motion_count ?? 0
}

function dirSizeKb(dir: string): number {
  // 简单 stat 不递归 — 估算够用
  try {
    if (!existsSync(dir)) return 0
    const st = statSync(dir)
    if (!st.isDirectory()) return Math.round(st.size / 1024)
    // 递归累加
    let total = 0
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      try {
        const s = statSync(p)
        if (s.isDirectory()) total += dirSizeKb(p)
        else total += s.size
      } catch {
        /* skip */
      }
    }
    return Math.round(total / 1024)
  } catch {
    return 0
  }
}
