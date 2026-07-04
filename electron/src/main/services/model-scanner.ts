/**
 * 扫描 Live2D 模型 —— 在 modelSearchPaths 下找所有 *.model3.json (Cubism 4) / *.model.json (Cubism 2)。
 *
 * v0.6.9: 解析每个 .model3.json 验证完整度（moc + textures + motions），
 * 只把"完整可用"的暴露给 UI 默认选项。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { ModelInfo } from '@shared/types'
import { getPaths } from './paths'

/**
 * v0.13 (audit performance ROI 1): 增量缓存
 * key: model3.json 绝对路径
 * value: model3.json 的 mtimeMs（变了 → cache miss → 重新 probe）+ 缓存的 ModelInfo
 *
 * 1389 模型冷启动从 ~3s 降到 ~200ms（热启动）。
 * 持久化到 ~/.luvu/model-scan-cache.json，跨重启有效。
 */
interface ScanCacheEntry {
  mtime: number
  info: ModelInfo
}
const scanCache = new Map<string, ScanCacheEntry>()
let cacheLoaded = false

function cacheFilePath(): string {
  return join(getPaths().userDataDir, 'model-scan-cache.json')
}

function loadScanCache(): void {
  if (cacheLoaded) return
  cacheLoaded = true
  const f = cacheFilePath()
  if (!existsSync(f)) return
  try {
    const raw = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, ScanCacheEntry>
    for (const [k, v] of Object.entries(raw)) scanCache.set(k, v)
  } catch {
    /* 损坏的 cache 重新生成 */
  }
}

function persistScanCache(): void {
  try {
    const obj: Record<string, ScanCacheEntry> = {}
    for (const [k, v] of scanCache.entries()) obj[k] = v
    writeFileSync(cacheFilePath(), JSON.stringify(obj), 'utf-8')
  } catch {
    /* 写盘失败不影响本次扫描结果 */
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'out',
  'src',
  'src-tauri',
  'electron',
  'sidecar',
  'public',
  'docs',
  'scripts',
  'example_voice',
  'icons',
])

const MAX_DEPTH = 3

export function scanModels(): ModelInfo[] {
  loadScanCache()
  const paths = getPaths()
  const results: ModelInfo[] = []
  const seen = new Set<string>()
  const liveKeys = new Set<string>()
  let cacheMisses = 0
  let cacheHits = 0

  for (const root of paths.modelSearchPaths) {
    if (!existsSync(root)) continue
    walk(root, 0, (modelFile, modelDir, depth) => {
      const abs = join(modelDir, modelFile)
      if (seen.has(abs)) return
      seen.add(abs)
      liveKeys.add(abs)

      // v0.13: 拿 mtime 试着走缓存
      let mtime = 0
      try { mtime = statSync(abs).mtimeMs } catch { /* file 不见了 */ return }

      const cached = scanCache.get(abs)
      if (cached && cached.mtime === mtime) {
        results.push(cached.info)
        cacheHits++
        return
      }

      // cache miss → 全量 probe
      cacheMisses++
      const cubism = modelFile.endsWith('.model3.json') ? 'cubism4' : 'cubism2'
      const dirName = basename(modelDir)
      // v0.22: 项目内置策展库(models-library) 与 projectRoot 都算 builtin →
      //   complete 模型自动 recommended。之前只认 projectRoot，导致软链进来的
      //   全量库全标 user、recommended 永远为空（判断 bug）。
      const source =
        root === paths.projectRoot || root === paths.modelsLibraryDir ? 'builtin' : 'user'

      const meta = cubism === 'cubism4' ? probeModel3(abs) : probeModel2(abs)
      if (meta) meta.recommended = source === 'builtin' && meta.complete

      const info: ModelInfo = {
        dir: dirName,
        model_file: modelFile,
        absolute_path: abs,
        source,
        cubism,
        display: dirName,
        root_id: `${source}:${depth}:${dirName}`,
        meta,
      }
      scanCache.set(abs, { mtime, info })
      results.push(info)
    })
  }

  // v0.13: 清理已删除模型的缓存条目
  for (const k of [...scanCache.keys()]) {
    if (!liveKeys.has(k)) scanCache.delete(k)
  }

  // 只在有 miss 时写盘（hit-only 扫描无需 IO）
  if (cacheMisses > 0) {
    persistScanCache()
    console.log(`[model-scanner] cache miss=${cacheMisses} hit=${cacheHits} (persisted)`)
  } else {
    console.log(`[model-scanner] cache all hit (${cacheHits} models)`)
  }

  return results.sort((a, b) => {
    // 推荐 > 完整 > 不完整，组内按显示名 alphabetical
    const score = (m: ModelInfo): number => {
      if (m.meta?.recommended) return 0
      if (m.meta?.complete) return 1
      return 2
    }
    const sa = score(a)
    const sb = score(b)
    if (sa !== sb) return sa - sb
    return a.display.localeCompare(b.display)
  })
}

interface ModelMeta {
  has_core: boolean
  has_motions: boolean
  has_expressions: boolean
  has_physics: boolean
  motion_count: number
  expression_count: number
  moc_kb: number
  texture_kb: number
  complete: boolean
  recommended: boolean
  reason?: string
  health_score?: number
  grade?: 'A' | 'B' | 'C' | 'D'
  healable?: boolean
  heal_hints?: string[]
  dedup_key?: string
  character_id?: string
  view_label?: string
}

/** 过滤阈值：低于这些值通常是占位/不完整模型 */
const MIN_MOC_KB = 50
const MIN_TEXTURE_KB = 200
const MIN_MOTIONS = 1

/**
 * pixi-live2d-display 内部用 new URL(relPath, baseUrl) 解析资源，
 * `#` 会被 URL 标准当成 fragment 分隔符 → 路径被截断 → 加载失败。
 * 同理 `?` 是 search 分隔符。这种文件名我们无法用 file:// 加载。
 *
 * 检测引用字符串本身是否含这些字符（路径里有空格、中文 OK；只防 # 和 ?）。
 */
/**
 * 从 model3.json 路径推 character_id + view_label。
 * Live2D 业界惯例：同角色多 view 各自独立 model3.json，view 通过 dir 名后缀区分。
 * 例：BanG Dream!/Hina/Hina_normal/Hina_normal.model3.json
 *     BanG Dream!/Hina/Hina_skin1/Hina_skin1.model3.json
 * 都是 Hina 角色，view 是 normal / skin1。
 *
 * character_id = parent_ip_dir + character_base_name + moc3_size_kb (帮助消歧不同角色重名)
 */
/**
 * 同角色聚类（修订版）：
 *   主键 = mocBytes（同 Live2D 编译产物必然同角色，避开 dir 名 regex 不全的坑）
 *   次键 = parent dir 名（用来在 mocBytes 相同的不同角色之间消歧，虽然概率极低）
 *
 * view_label：尽量从 dir 名抽出（去掉跟 parent dir 名重叠的前缀，剩下的就是 view 标记）。
 * 不再依赖枚举所有可能后缀（之前漏 _00 / _base / _live / _alt 等）。
 */
function extractCharacterIdAndView(
  modelPath: string,
  mocBytes: number,
  skeletonFingerprint: string,
): { characterId: string; viewLabel: string } {
  const dir = dirname(modelPath)
  const dirName = basename(dir)
  const parentDir = dirname(dir)
  const parentName = basename(parentDir)

  // viewLabel：dirName 去掉跟 parentName 重叠前缀
  let viewLabel = ''
  if (parentName && dirName.toLowerCase().startsWith(parentName.toLowerCase())) {
    viewLabel = dirName.slice(parentName.length).replace(/^[_\-\s]+/, '').trim()
  }

  // character_id v2 = sha1(mocBytes + skeletonFingerprint + grandParent)
  //   mocBytes：基础信号
  //   skeletonFingerprint：Groups+HitAreas 列表 — 同角色多 view 必然一致
  //   grandParent：通常是 IP 名 — 防止不同 IP 同字节巧合
  // 三个全一致才同 character → cluster 精度大幅提升
  const grandParent = basename(dirname(parentDir))
  let characterId: string
  if (mocBytes > 0) {
    const seed = `${mocBytes}|${skeletonFingerprint}|${grandParent || 'root'}`
    characterId = `char:${sha1Short(seed)}`
  } else {
    characterId = `dir:${dir}`
  }
  return { characterId, viewLabel }
}

/** 8-char sha1 — 用作 character_id 短哈希，避免 model3.json 内容长无意义 */
function sha1Short(input: string): string {
  // v0.13: 改顶层 import createHash，去掉每模型一次 require() 开销
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

function isUrlSafe(ref: string): boolean {
  return !ref.includes('#') && !ref.includes('?')
}

/**
 * 解析 Cubism 4 settings (.model3.json) — 验证 moc + textures + motions 都到位。
 * 完整 = has_core (moc3 存在 + texture 引用全部 URL-safe) && has_motions
 */
function probeModel3(modelPath: string): ModelMeta {
  const reasons: string[] = []
  const base = dirname(modelPath)
  try {
    const raw = readFileSync(modelPath, 'utf-8')
    const json = JSON.parse(raw) as {
      FileReferences?: {
        Moc?: string
        Textures?: string[]
        Motions?: Record<string, Array<{ File?: string }>>
        Expressions?: Array<{ File?: string }>
        Physics?: string
      }
      Groups?: Array<{ Target?: string; Name?: string; Ids?: string[] }>
      HitAreas?: Array<{ Id?: string; Name?: string }>
    }
    const refs = json.FileReferences ?? {}
    // 骨骼指纹：Groups 的 Ids（EyeBlink/LipSync 用到的参数）+ HitAreas Name 列表
    // 同角色多 view 必然共享同一骨骼 → 这俩字段完全一致；不同角色巧合一致概率 ≈ 0
    const groupIds: string[] = []
    if (Array.isArray(json.Groups)) {
      for (const g of json.Groups) {
        if (Array.isArray(g.Ids)) groupIds.push(...g.Ids)
      }
    }
    const hitAreaNames: string[] = []
    if (Array.isArray(json.HitAreas)) {
      for (const h of json.HitAreas) {
        if (h.Name) hitAreaNames.push(h.Name)
      }
    }
    const skeletonFingerprint = [
      ...groupIds.sort(),
      '|',
      ...hitAreaNames.sort(),
    ].join(',')
    const mocPath = refs.Moc ? resolve(base, refs.Moc) : null
    const mocOk = !!mocPath && existsSync(mocPath) && (refs.Moc ? isUrlSafe(refs.Moc) : false)
    if (!mocOk) {
      if (refs.Moc && !isUrlSafe(refs.Moc)) reasons.push('moc 文件名含 # 或 ?')
      else reasons.push('moc3 缺失')
    }

    const mocBytes = mocPath && existsSync(mocPath) ? statSync(mocPath).size : 0
    const mocKb = Math.round(mocBytes / 1024)

    const textures = Array.isArray(refs.Textures) ? refs.Textures : []
    const hasAnyTexture = textures.length > 0 && textures.some((t) => existsSync(resolve(base, t)))
    const allTexturesUrlSafe = textures.every(isUrlSafe)
    const texturesOk = hasAnyTexture && allTexturesUrlSafe
    if (!hasAnyTexture) reasons.push('texture 缺失')
    else if (!allTexturesUrlSafe) reasons.push('texture 文件名含 # 或 ?')

    let textureKb = 0
    let textureBytesSum = 0
    for (const t of textures) {
      const tp = resolve(base, t)
      if (existsSync(tp)) {
        const sz = statSync(tp).size
        textureBytesSum += sz
        textureKb += Math.round(sz / 1024)
      }
    }
    // v0.8.2: 内容指纹 — 精确字节级 size，两个模型相同 = 同一文件
    const dedupKey = mocBytes > 0 ? `${mocBytes}:${textureBytesSum}:${textures.length}` : ''
    // v0.8.2: character_id —— 同角色多 view 聚类
    // 信号 1: moc3 字节相同（同一 Live2D 编译产物，必然同角色）
    // 信号 2: 角色基础名（dir 名去掉 view 后缀）
    const { characterId, viewLabel } = extractCharacterIdAndView(
      modelPath,
      mocBytes,
      skeletonFingerprint,
    )

    let motionCount = 0
    let motionsAllUrlSafe = true
    if (refs.Motions && typeof refs.Motions === 'object') {
      for (const arr of Object.values(refs.Motions)) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m.File && existsSync(resolve(base, m.File))) {
              if (!isUrlSafe(m.File)) motionsAllUrlSafe = false
              else motionCount++
            }
          }
        }
      }
    }
    if (motionCount === 0) reasons.push('无动作')
    if (!motionsAllUrlSafe) reasons.push('motion 文件名含 # 或 ?')

    const expressionCount =
      Array.isArray(refs.Expressions)
        ? refs.Expressions.filter(
            (e) => e.File && existsSync(resolve(base, e.File)) && isUrlSafe(e.File),
          ).length
        : 0

    const hasPhysics =
      !!refs.Physics && existsSync(resolve(base, refs.Physics)) && isUrlSafe(refs.Physics)

    if (mocKb > 0 && mocKb < MIN_MOC_KB) reasons.push(`moc3 仅 ${mocKb}KB（疑似占位）`)
    if (textureKb > 0 && textureKb < MIN_TEXTURE_KB) reasons.push(`texture 仅 ${textureKb}KB（疑似纯色块）`)

    const hasCore = mocOk && texturesOk
    const hasMotions = motionCount >= MIN_MOTIONS && motionsAllUrlSafe
    const sizesOk = mocKb >= MIN_MOC_KB && textureKb >= MIN_TEXTURE_KB
    const complete = hasCore && hasMotions && sizesOk

    // v0.8.2 (rewrite v2): 评级直接按动作数量 — 主人原则「动作多 = 质量高」
    //   A: motion >= 15  (顶级丰富，专业模型)
    //   B: motion >= 8   (动作很多，质量高)
    //   C: motion >= 3   (基础动作齐全)
    //   D: motion < 3 or 缺核心 (几乎静态)
    let grade: 'A' | 'B' | 'C' | 'D'
    if (!hasCore) {
      grade = 'D'
    } else if (motionCount >= 15) {
      grade = 'A'
    } else if (motionCount >= 8) {
      grade = 'B'
    } else if (motionCount >= 3) {
      grade = 'C'
    } else {
      grade = 'D'
    }
    // score = motion_count 直接做主排序键（动作多绝对在前），其他属性当尾注微调
    const score =
      Math.min(100, motionCount * 4) + // 动作核心权重
      Math.min(10, expressionCount) + // 表情微加
      (hasPhysics ? 5 : 0) + // 物理微加
      (sizesOk ? 3 : 0) +
      (hasCore ? 2 : 0)

    // healable: 必须有 moc + 至少 1 texture（heal 只能补 motion/expression，补不了核心）
    const healable = mocOk && hasAnyTexture
    const healHints: string[] = []
    if (healable) {
      if (motionCount === 0) healHints.push('完全静态 — Heal 可生成 3 个 idle motion 让它动起来')
      else if (motionCount < 4) healHints.push(`仅 ${motionCount} 个动作 — Heal 可补到 4 个`)
      if (expressionCount < 3) healHints.push(`仅 ${expressionCount} 个表情 — Heal 可补 4 个`)
      if (!hasPhysics) healHints.push('无物理 — 头发/裙摆不会飘')
    } else if (!mocOk) {
      healHints.push('moc3 缺失/损坏 — 无法修复，建议删除或换模型')
    } else if (!hasAnyTexture) {
      healHints.push('texture 全部缺失 — 无法修复，建议删除或换模型')
    }

    return {
      has_core: hasCore,
      has_motions: hasMotions,
      has_expressions: expressionCount > 0,
      has_physics: hasPhysics,
      motion_count: motionCount,
      expression_count: expressionCount,
      moc_kb: mocKb,
      texture_kb: textureKb,
      complete,
      recommended: false, // 由 scanModels() 根据 source 标
      ...(reasons.length > 0 && { reason: reasons.join('；') }),
      health_score: score,
      grade,
      healable,
      heal_hints: healHints,
      dedup_key: dedupKey,
      character_id: characterId,
      view_label: viewLabel,
    }
  } catch (e) {
    return {
      has_core: false,
      has_motions: false,
      has_expressions: false,
      has_physics: false,
      motion_count: 0,
      expression_count: 0,
      moc_kb: 0,
      texture_kb: 0,
      complete: false,
      recommended: false,
      reason: `model3.json 解析失败: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * 解析 Cubism 2 settings (.model.json) — 简化：我们当前不支持 cubism2，
 * 但仍提供基本完整度判断，便于 UI 显示信息。
 */
function probeModel2(modelPath: string): ModelMeta {
  const base = dirname(modelPath)
  try {
    const raw = readFileSync(modelPath, 'utf-8')
    const json = JSON.parse(raw) as {
      model?: string
      textures?: string[]
      motions?: Record<string, Array<{ file?: string }>>
      expressions?: Array<{ file?: string }>
      physics?: string
    }
    const mocOk = !!json.model && existsSync(resolve(base, json.model))
    const texturesOk =
      Array.isArray(json.textures) &&
      json.textures.length > 0 &&
      json.textures.some((t) => existsSync(resolve(base, t)))
    let motionCount = 0
    if (json.motions) {
      for (const arr of Object.values(json.motions)) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m.file && existsSync(resolve(base, m.file))) motionCount++
          }
        }
      }
    }
    const expressionCount =
      Array.isArray(json.expressions)
        ? json.expressions.filter((e) => e.file && existsSync(resolve(base, e.file))).length
        : 0
    return {
      has_core: mocOk && texturesOk,
      has_motions: motionCount > 0,
      has_expressions: expressionCount > 0,
      has_physics: !!json.physics && existsSync(resolve(base, json.physics)),
      motion_count: motionCount,
      expression_count: expressionCount,
      moc_kb: 0,
      texture_kb: 0,
      complete: mocOk && texturesOk && motionCount > 0,
      recommended: false,
    }
  } catch {
    return {
      has_core: false,
      has_motions: false,
      has_expressions: false,
      has_physics: false,
      motion_count: 0,
      expression_count: 0,
      moc_kb: 0,
      texture_kb: 0,
      complete: false,
      recommended: false,
    }
  }
}

function walk(
  dir: string,
  depth: number,
  onFound: (modelFile: string, modelDir: string, depth: number) => void,
): void {
  if (depth > MAX_DEPTH) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  let foundHere = false
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isFile() && (entry.endsWith('.model3.json') || entry.endsWith('.model.json'))) {
      onFound(entry, dir, depth)
      foundHere = true
    }
  }

  if (foundHere) return

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        walk(full, depth + 1, onFound)
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * H1 (audit): 生成 luvu-asset:// URL（不再是 file://）— renderer 通过自定义协议加载，
 * webSecurity: true 仍能跨目录访问 + CSP 严格生效。
 * 保留函数名 toFileUrl 不改 callers，但 scheme 变了。
 */
export function toFileUrl(absolute: string): string {
  const normalized = absolute.split(sep).map(encodeURIComponent).join('/')
  // 用 `localhost` 占位 host:standard:true scheme 下 Chromium 会把三斜杠 URL 的
  // 第一个 path segment 当成 host(`luvu-asset:///Users/...` → host=Users 被
  // canonicalize 丢失)。固定一个假 host 让 pathname 保留全 absolute 路径 + 大小写。
  return `luvu-asset://localhost/${normalized.replace(/^\//, '')}`
}
