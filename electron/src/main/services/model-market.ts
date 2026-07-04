/**
 * Live2D 模型「市场」—— 从 ZIP / URL / 文件夹安装到 ~/.luvu/models/
 *
 * 设计：
 * - 不维护中央仓库（版权 + 带宽），由用户自己提供 zip / url
 * - 安装后扫描器自动识别（路径已在 modelSearchPaths）
 * - 自动找出 zip 内的 *.model3.json，提取它所在的目录结构，写到 ~/.luvu/models/<dir>/
 * - 同名目录已存在时加 -2 -3 后缀，不覆盖
 */
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, statSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, normalize, posix, sep } from 'node:path'
import { getPaths } from './paths'

export interface InstallResult {
  ok: boolean
  /** 实际写入的目录绝对路径（成功时） */
  installed_to?: string
  /** 检测到的模型 dir name */
  detected_name?: string
  /** 检测到的 model3.json 文件名 */
  model_file?: string
  /** 失败原因 */
  reason?: string
}

function modelsRoot(): string {
  const root = join(getPaths().userDataDir, 'models')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/** 同名时加 -2 -3 后缀 */
function dedupName(parent: string, name: string): string {
  let candidate = name
  let i = 2
  while (existsSync(join(parent, candidate))) {
    candidate = `${name}-${i}`
    i++
    if (i > 100) throw new Error('too many dups')
  }
  return candidate
}

/**
 * 解析 zip 找到 *.model3.json，提取它所在子树到 ~/.luvu/models/<auto-name>/
 * 例：zip 内
 *   foo/bar/HuTao/Hu Tao.model3.json
 *   foo/bar/HuTao/textures/...
 *   foo/bar/HuTao/motions/...
 * → 提取 foo/bar/HuTao/ 整个目录到 ~/.luvu/models/HuTao/
 */
export async function installFromZip(zipPath: string): Promise<InstallResult> {
  if (!existsSync(zipPath)) return { ok: false, reason: `zip 不存在：${zipPath}` }

  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch (e) {
    return { ok: false, reason: `zip 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }

  const entries = zip.getEntries()
  // 找第一个 *.model3.json（顶层优先）
  const modelEntry = entries
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.model3.json'))
    .sort((a, b) => a.entryName.length - b.entryName.length)[0]
  if (!modelEntry) {
    return { ok: false, reason: 'zip 内没找到 *.model3.json（必须是 Cubism 4 模型）' }
  }

  // 模型目录 = model3.json 的父目录（zip 内 posix 风格）
  const modelDirInZip = posix.dirname(modelEntry.entryName)
  const detectedName = posix.basename(modelDirInZip) || 'untitled-model'
  const modelFile = posix.basename(modelEntry.entryName)

  const root = modelsRoot()
  const finalName = dedupName(root, detectedName)
  const finalDir = join(root, finalName)
  mkdirSync(finalDir, { recursive: true })

  // 提取该子树下所有 entries
  const prefix = modelDirInZip === '.' ? '' : modelDirInZip + '/'
  let extracted = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    if (prefix && !entry.entryName.startsWith(prefix)) continue
    const relInsideModel = prefix ? entry.entryName.slice(prefix.length) : entry.entryName
    if (!relInsideModel) continue
    // 防 zip slip
    const target = normalize(join(finalDir, relInsideModel))
    if (!target.startsWith(finalDir + sep) && target !== finalDir) {
      console.warn('[market] skip zip-slip:', entry.entryName)
      continue
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, entry.getData())
      extracted++
    } catch (e) {
      console.warn(`[market] extract ${entry.entryName} failed:`, e)
    }
  }

  if (extracted === 0) {
    return {
      ok: false,
      reason: '解压后无文件落地（可能 zip 结构异常）',
      installed_to: finalDir,
    }
  }

  return {
    ok: true,
    installed_to: finalDir,
    detected_name: finalName,
    model_file: modelFile,
  }
}

/** 从 URL 下载 zip 到临时目录再 install */
export async function installFromUrl(url: string): Promise<InstallResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: '只接受 http/https URL' }
  }
  const tmpZip = join(getPaths().userDataDir, '.tmp', `download-${Date.now()}.zip`)
  mkdirSync(dirname(tmpZip), { recursive: true })

  try {
    const resp = await fetch(url, { redirect: 'follow' })
    if (!resp.ok) return { ok: false, reason: `HTTP ${resp.status} ${resp.statusText}` }
    const ct = resp.headers.get('content-type') ?? ''
    const isZip = ct.includes('zip') || url.toLowerCase().endsWith('.zip')
    if (!isZip) {
      // 仍然继续，靠 magic 字节判断
      console.warn('[market] URL content-type not zip:', ct)
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return { ok: false, reason: '响应不是 zip 文件（缺少 PK 文件头）' }
    }
    writeFileSync(tmpZip, buf)
  } catch (e) {
    return { ok: false, reason: `下载失败：${e instanceof Error ? e.message : String(e)}` }
  }

  const result = await installFromZip(tmpZip)
  try {
    if (existsSync(tmpZip)) unlinkSync(tmpZip)
  } catch {
    /* ignore */
  }
  return result
}

/** 用户拖拽的 path：可能是 zip 或目录。目录则当作已经组织好的 Live2D 模型，复制过去 */
export async function installFromPath(path: string): Promise<InstallResult> {
  if (!existsSync(path)) return { ok: false, reason: `路径不存在：${path}` }
  const st = statSync(path)
  if (st.isFile() && path.toLowerCase().endsWith('.zip')) {
    return installFromZip(path)
  }
  if (st.isDirectory()) {
    return installFromDirectory(path)
  }
  return { ok: false, reason: '只接受 .zip 文件或目录' }
}

/** 复制本地模型目录到 ~/.luvu/models/ */
async function installFromDirectory(srcDir: string): Promise<InstallResult> {
  const fs = await import('node:fs/promises')
  const { readdirSync } = await import('node:fs')
  // 找到 source 内的第一个 *.model3.json
  const candidates = findModel3(srcDir, 3)
  if (candidates.length === 0) {
    return { ok: false, reason: '目录内未找到 *.model3.json' }
  }
  const modelFile = candidates[0]!
  const modelDirInSrc = dirname(modelFile)
  const detectedName = modelDirInSrc.split(sep).pop() ?? 'untitled-model'

  const root = modelsRoot()
  const finalName = dedupName(root, detectedName)
  const finalDir = join(root, finalName)
  mkdirSync(finalDir, { recursive: true })

  async function copyRec(s: string, d: string): Promise<void> {
    const ents = readdirSync(s, { withFileTypes: true })
    for (const ent of ents) {
      const sp = join(s, ent.name)
      const dp = join(d, ent.name)
      if (ent.isDirectory()) {
        mkdirSync(dp, { recursive: true })
        await copyRec(sp, dp)
      } else if (ent.isFile()) {
        await fs.copyFile(sp, dp)
      }
    }
  }
  await copyRec(modelDirInSrc, finalDir)

  const modelFileName = modelFile.split(sep).pop()
  return {
    ok: true,
    installed_to: finalDir,
    detected_name: finalName,
    ...(modelFileName !== undefined && { model_file: modelFileName }),
  }
}

function findModel3(dir: string, maxDepth: number, acc: string[] = []): string[] {
  if (maxDepth < 0) return acc
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue
    const full = join(dir, e)
    try {
      const s = statSync(full)
      if (s.isFile() && e.endsWith('.model3.json')) acc.push(full)
      else if (s.isDirectory()) findModel3(full, maxDepth - 1, acc)
    } catch {
      /* ignore */
    }
  }
  return acc
}
