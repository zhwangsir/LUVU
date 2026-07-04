/**
 * 在线资源商店（v0.12）
 *
 * 从 HuggingFace 浏览 / 下载 / 部署社区上传的 RVC voice + Live2D 模型。
 *
 * 推荐 repo 硬编码在 RECOMMENDED_REPOS，每个 repo 有 kind + adapter（解析 repo 文件树
 * 抽取可装资源 + 下载 + 部署的逻辑）。新加 repo 只需写一个 adapter。
 *
 * 部署：
 *   - RVC voice → mac 下载 zip → 解压找 .pth + .index → scp 到 workstation
 *   - Live2D → mac 下载 zip → 解压到 electron/models-library/<repo>/<asset_name>/
 *
 * 网络：走 hf-mirror.com（GFW 友好），huggingface.co 作 fallback
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { app } from 'electron'

const HF_MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co']
// v0.13: 全部 RVC 部署相关配置走 env 化，去掉硬编码 master 私网
// 任何 fork 用户都可以通过 env 改成自己的 workstation
const WORKSTATION = process.env.LUVU_WORKSTATION || ''
const RVC_REMOTE_WEIGHTS = process.env.LUVU_RVC_REMOTE_WEIGHTS || 'C:/LUVU-rvc/assets/weights'
const RVC_REMOTE_LOGS = process.env.LUVU_RVC_REMOTE_LOGS || 'C:/LUVU-rvc/logs'
const RVC_PROBE_URL = process.env.LUVU_RVC_PROBE_URL || 'http://127.0.0.1:8765/v1/rvc/voices'

export type AssetKind = 'rvc' | 'live2d'
export type RepoSource = 'huggingface' | 'github' | 'browse_only'

export interface RecommendedRepo {
  /** repo_id 形如 'ArkanDash/rvc-genshin-impact' 或 'Eikanya/Live2d-model' */
  id: string
  /** 显示名 */
  name: string
  /** 简介 */
  description: string
  kind: AssetKind
  /** 数据源 — huggingface API / github API / 只提供浏览链接（不可一键装） */
  source: RepoSource
  /** 资源子路径，如 HF 'prezipped/v2' 或 github 子目录 */
  asset_path?: string
  /** 资源命名形式提示 */
  hint?: string
  /** browse_only 时的浏览 URL */
  browse_url?: string
}

/**
 * 全部经 curl/HF API 验证存在的 repo。
 * Live2D 在 HF 上极少大型集合，主要在 GitHub。大型 GitHub repo (>1GB) 不支持一键装
 * （只列出供浏览，让用户 git clone 整 repo），小的可装。
 */
export const RECOMMENDED_REPOS: RecommendedRepo[] = [
  // === HF RVC（已 curl 验证 200）===
  {
    id: 'ArkanDash/rvc-genshin-impact',
    name: '原神 RVC v2（ArkanDash）',
    description: '47 个原神角色 RVC v2，100-700 epoch，每个 zip 含 .pth + .index',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: 'prezipped/v2',
    hint: '⭐ 质量最稳，已默认推荐',
  },
  {
    id: 'ArkanDash/rvc-genshin-impact',
    name: '原神 RVC v1（ArkanDash · 旧版）',
    description: '19 个原神角色 RVC v1 模型（256d feature）',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: 'prezipped/v1',
    hint: '兼容性不如 v2，仅历史保留',
  },
  {
    id: 'mrmocciai/genshin-impact',
    name: '原神 RVC（mrmocciai）',
    description: '另一组原神角色 RVC 模型集合',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: '',
    hint: '直接列根目录文件',
  },
  {
    id: 'ttttdiva/rvc_okiba',
    name: '日系萌少女音色（rvc_okiba）',
    description: '63 个日系萌少女音色 + 6 男声，RVC v2，匿名化 A/B/C 命名',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: 'models',
    hint: '⚠ 文件夹名是 A/B/C 匿名，看 vc-samples.md 对照角色',
  },
  {
    id: 'AIHeaven/rvc-models',
    name: '动漫女声（AIHeaven）',
    description: '动漫角色 RVC 模型，含 Haruka 等萌系',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: '',
  },
  {
    id: 'Chynya/RVC_Models',
    name: 'Chynya 综合 RVC 集',
    description: 'Chynya 整理的 RVC 模型集合（zip 含 .pth + .index）',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: '',
  },
  {
    id: '1358Adrian/so-vits-svc-rvc-models',
    name: 'so-vits-svc + RVC（1358Adrian）',
    description: '混合了 so-vits-svc 和 RVC 的模型集',
    kind: 'rvc',
    source: 'huggingface',
    asset_path: '',
    hint: '⚠ 含 so-vits-svc 模型不能直接给 RVC 用，要看文件名',
  },

  // === GitHub Live2D（已 GitHub API 验证）===
  {
    id: 'Eikanya/Live2d-model',
    name: '⭐ Eikanya/Live2d-model（17GB · 已内置）',
    description: '3157 star · 你当前用的 1389 个 Live2D 模型来源，按 IP 分组',
    kind: 'live2d',
    source: 'browse_only',
    browse_url: 'https://github.com/Eikanya/Live2d-model',
    hint: '17GB · 已经全部复制进 electron/models-library/，不需要重复装',
  },
  {
    id: 'xiaoski/live2d_models_collection',
    name: 'xiaoski/live2d_models_collection',
    description: '182 star · 另一个开源 Live2D 模型集合（含拼接 zip 分卷）',
    kind: 'live2d',
    source: 'browse_only',
    browse_url: 'https://github.com/xiaoski/live2d_models_collection',
    hint: '建议 git clone 整仓库，逐个文件下载效率低',
  },
  {
    id: 'L01den/live2d-models',
    name: 'L01den/live2d-models',
    description: '从手游中提取的 Live2D 模型集合',
    kind: 'live2d',
    source: 'browse_only',
    browse_url: 'https://github.com/L01den/live2d-models',
    hint: '比 Eikanya 小，可以选感兴趣的角色目录单独 clone',
  },
  {
    id: 'Live2D/CubismWebSamples',
    name: 'Live2D 官方 demo（Live2D/CubismWebSamples）',
    description: 'Live2D 官方 SDK 样例模型：Haru / Hiyori / Mark / Mao / Wanko / Natori',
    kind: 'live2d',
    source: 'browse_only',
    browse_url: 'https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources',
    hint: '✅ 干净小巧（每个 < 5MB），用做测试或备胎',
  },
]

interface HfFileEntry {
  type: 'file' | 'directory'
  path: string
  size: number
}

/** 列 HF repo 某子路径下的文件树（递归 1 层） */
export async function listRepoAssets(
  repoId: string,
  subPath: string = '',
): Promise<HfFileEntry[]> {
  for (const base of HF_MIRRORS) {
    const url = subPath
      ? `${base}/api/models/${repoId}/tree/main/${encodeURI(subPath)}`
      : `${base}/api/models/${repoId}/tree/main`
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) continue
      const data = (await r.json()) as HfFileEntry[]
      return data.map((x) => ({
        type: x.type,
        path: x.path,
        size: x.size ?? 0,
      }))
    } catch {
      /* try next mirror */
    }
  }
  return []
}

/** 已部署检查：voice_id → 是否已在 workstation assets/weights/ */
export async function checkRvcInstalled(voiceId: string): Promise<boolean> {
  // 简化：通过 sidecar /v1/rvc/voices 查（v0.13: probe URL env 化）
  try {
    const r = await fetch(RVC_PROBE_URL, {
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return false
    const data = (await r.json()) as { voices?: string[] }
    return (data.voices ?? []).includes(voiceId)
  } catch {
    return false
  }
}

/** Live2D 已装检查：电脑本地 electron/models-library/<repo>/<assetName> 目录存在 */
export function checkLive2dInstalled(repoSlug: string, assetName: string): boolean {
  const targetDir = getLive2dInstallTarget(repoSlug, assetName)
  return existsSync(targetDir) && readdirSync(targetDir).length > 0
}

function getLive2dInstallTarget(repoSlug: string, assetName: string): string {
  // mac 上 electron/models-library 是 project root 的子目录
  // dev 期间：__dirname 在 out/main/，项目根 = 上 3 层
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : resolvePath(__dirname, '..', '..', '..')
  return join(projectRoot, 'models-library', `online_${repoSlug}`, assetName.replace(/\.zip$/i, ''))
}

export interface InstallProgress {
  asset_path: string
  stage: 'download' | 'extract' | 'deploy' | 'done' | 'fail'
  percent: number // 0~100
  message?: string
  bytes_done?: number
  bytes_total?: number
}

export type ProgressCb = (p: InstallProgress) => void

/** 下载 + 解压 + 部署 — 通用入口，按 kind dispatch */
export async function installAsset(
  repoId: string,
  assetPath: string,
  kind: AssetKind,
  onProgress: ProgressCb,
  signal?: AbortSignal,
): Promise<{ ok: boolean; voice_id?: string; reason?: string }> {
  const tmpDir = join(tmpdir(), 'luvu-online-install')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const fileName = assetPath.split('/').pop() ?? 'asset.zip'
  const tmpFile = join(tmpDir, `${Date.now()}_${fileName}`)

  // 1. 下载
  try {
    await downloadFile(repoId, assetPath, tmpFile, (done, total) => {
      onProgress({
        asset_path: assetPath,
        stage: 'download',
        percent: total > 0 ? Math.round((done / total) * 60) : 0, // download 占 0-60%
        bytes_done: done,
        bytes_total: total,
      })
    }, signal)
  } catch (e) {
    if (existsSync(tmpFile)) try { unlinkSync(tmpFile) } catch { /* skip */ }
    return { ok: false, reason: `下载失败：${e}` }
  }

  // 2. 解压 + 部署（按 kind 分发）
  try {
    if (kind === 'rvc') {
      const voiceId = await deployRvcZip(tmpFile, assetPath, onProgress)
      onProgress({ asset_path: assetPath, stage: 'done', percent: 100, message: `已部署 ${voiceId}` })
      return { ok: true, voice_id: voiceId }
    } else {
      const repoSlug = repoId.replace('/', '__')
      const assetName = fileName
      await deployLive2dZip(tmpFile, repoSlug, assetName, onProgress)
      onProgress({ asset_path: assetPath, stage: 'done', percent: 100 })
      return { ok: true }
    }
  } catch (e) {
    onProgress({ asset_path: assetPath, stage: 'fail', percent: 0, message: String(e) })
    return { ok: false, reason: String(e) }
  } finally {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile)
    } catch { /* skip */ }
  }
}

/**
 * 直接装一个任意 URL 的 zip — 用户从 booth.pm / patreon / 别的源拷链接进来
 * 自动识别 .pth = RVC voice，.model3.json = Live2D
 */
export async function installCustomZip(
  url: string,
  kind: AssetKind,
  onProgress: ProgressCb,
  signal?: AbortSignal,
): Promise<{ ok: boolean; voice_id?: string; reason?: string }> {
  const tmpDir = join(tmpdir(), 'luvu-online-install')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const fileName = decodeURIComponent(url.split('/').pop() ?? 'asset.zip').replace(/\?.*$/, '')
  const tmpFile = join(tmpDir, `${Date.now()}_${fileName}`)

  // v0.13 security: SSRF 防护 — 只接受 https?://，拒绝本地/内网/链路本地 IP
  // 防止用户被诱导粘贴 http://127.0.0.1:8765 之类的内网 URL 探测局域网
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: `仅支持 http:// 或 https:// URL: ${url}` }
  }
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const isPrivate =
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    if (isPrivate) {
      return { ok: false, reason: `拒绝下载内网/本地 URL（SSRF 防护）: ${host}` }
    }
  } catch {
    return { ok: false, reason: `URL 解析失败: ${url}` }
  }

  // 下载（用户给的原始 URL）
  try {
    onProgress({ asset_path: url, stage: 'download', percent: 0 })
    const r = await fetch(url, { signal: signal ?? null })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const total = Number(r.headers.get('content-length') ?? '0')
    if (!r.body) throw new Error('empty body')
    const writer = createWriteStream(tmpFile)
    let done = 0
    const reader = r.body.getReader()
    while (true) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      if (signal?.aborted) {
        writer.close()
        throw new Error('aborted')
      }
      writer.write(value)
      done += value.length
      onProgress({
        asset_path: url, stage: 'download',
        percent: total > 0 ? Math.round((done / total) * 60) : 0,
        bytes_done: done, bytes_total: total,
      })
    }
    writer.end()
    await new Promise<void>((res, rej) => {
      writer.on('finish', () => res())
      writer.on('error', rej)
    })
  } catch (e) {
    if (existsSync(tmpFile)) try { unlinkSync(tmpFile) } catch { /* skip */ }
    return { ok: false, reason: `下载失败：${e}` }
  }

  // 解压 + 部署（同 installAsset 的 deploy 路径）
  try {
    if (kind === 'rvc') {
      const voiceId = await deployRvcZip(tmpFile, fileName, onProgress)
      onProgress({ asset_path: url, stage: 'done', percent: 100 })
      return { ok: true, voice_id: voiceId }
    } else {
      await deployLive2dZip(tmpFile, 'custom', fileName, onProgress)
      onProgress({ asset_path: url, stage: 'done', percent: 100 })
      return { ok: true }
    }
  } catch (e) {
    onProgress({ asset_path: url, stage: 'fail', percent: 0, message: String(e) })
    return { ok: false, reason: String(e) }
  } finally {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile)
    } catch { /* skip */ }
  }
}

async function downloadFile(
  repoId: string,
  assetPath: string,
  destPath: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let lastErr: Error | null = null
  for (const base of HF_MIRRORS) {
    const url = `${base}/${repoId}/resolve/main/${encodeURI(assetPath)}`
    try {
      const r = await fetch(url, { signal: signal ?? null })
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status}`)
        continue
      }
      const total = Number(r.headers.get('content-length') ?? '0')
      if (!r.body) {
        lastErr = new Error('empty body')
        continue
      }
      const writer = createWriteStream(destPath)
      let done = 0
      const reader = r.body.getReader()
      while (true) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        if (signal?.aborted) {
          writer.close()
          throw new Error('aborted')
        }
        writer.write(value)
        done += value.length
        onProgress(done, total)
      }
      writer.end()
      await new Promise<void>((res, rej) => {
        writer.on('finish', () => res())
        writer.on('error', rej)
      })
      return
    } catch (e) {
      lastErr = e as Error
      try {
        if (existsSync(destPath)) unlinkSync(destPath)
      } catch { /* skip */ }
      continue
    }
  }
  throw lastErr ?? new Error('all mirrors failed')
}

/** 部署 RVC zip：解压找 .pth + .index → scp 到 workstation */
async function deployRvcZip(
  zipPath: string,
  assetPath: string,
  onProgress: ProgressCb,
): Promise<string> {
  onProgress({ asset_path: assetPath, stage: 'extract', percent: 65 })
  // 解压到临时目录
  const extractDir = `${zipPath}.extract`
  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  await spawnAsync('unzip', ['-o', '-q', zipPath, '-d', extractDir])

  // 找 .pth (> 10MB) 和 .index
  const pthPath = findFile(extractDir, (n) => n.endsWith('.pth'), 10 * 1024 * 1024)
  const indexPath = findFile(extractDir, (n) => n.endsWith('.index'))
  if (!pthPath) {
    rmSync(extractDir, { recursive: true, force: true })
    throw new Error('zip 里没找到 .pth')
  }

  // voice_id：取 zip 文件名第一段（"furina-jp 275 epochs 48k v2.zip" → "furina-jp"）
  const baseName = assetPath.split('/').pop() ?? ''
  const rawVoiceId = baseName.replace(/\.zip$/i, '').split(/\s+/)[0] ?? baseName
  // v0.13 security: voiceId 会拼到 PowerShell + scp 远程命令，必须严格 sanitize 防注入
  // 只保留字母 / 数字 / 横线 / 下划线，且 baseName 不可为空、不可含 .. / /
  const voiceId = rawVoiceId.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!voiceId || voiceId === '_' || rawVoiceId.includes('..') || rawVoiceId.includes('/')) {
    rmSync(extractDir, { recursive: true, force: true })
    throw new Error(`不安全的 voice_id（含特殊字符或路径分隔符）: ${rawVoiceId}`)
  }

  onProgress({ asset_path: assetPath, stage: 'deploy', percent: 75, message: `scp ${voiceId}` })

  // scp .pth
  await runScp(pthPath, `${WORKSTATION}:${RVC_REMOTE_WEIGHTS}/${voiceId}.pth`)
  onProgress({ asset_path: assetPath, stage: 'deploy', percent: 90 })
  // 建 logs/<voice_id>/ + scp .index
  if (indexPath) {
    await runSsh([
      'powershell', '-NoProfile', '-Command',
      `New-Item -ItemType Directory -Force -Path C:\\LUVU-rvc\\logs\\${voiceId} | Out-Null`,
    ])
    await runScp(indexPath, `${WORKSTATION}:${RVC_REMOTE_LOGS}/${voiceId}/added_${voiceId}.index`)
  }
  rmSync(extractDir, { recursive: true, force: true })
  return voiceId
}

/** 部署 Live2D zip：解压到 electron/models-library/online_<repo>/<name>/ */
async function deployLive2dZip(
  zipPath: string,
  repoSlug: string,
  assetName: string,
  onProgress: ProgressCb,
): Promise<void> {
  onProgress({ asset_path: assetName, stage: 'extract', percent: 70 })
  const target = getLive2dInstallTarget(repoSlug, assetName)
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  await spawnAsync('unzip', ['-o', '-q', zipPath, '-d', target])
  onProgress({ asset_path: assetName, stage: 'deploy', percent: 90 })
  // 检查解压结果含 .model3.json
  const has = walkFind(target, (n) => n.endsWith('.model3.json') || n.endsWith('.model.json'))
  if (!has) {
    rmSync(target, { recursive: true, force: true })
    throw new Error('zip 里没找到 .model3.json — 可能不是 Live2D 模型')
  }
}

function findFile(dir: string, pred: (name: string) => boolean, minSize = 0): string | null {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        stack.push(full)
      } else if (pred(name) && st.size >= minSize) {
        return full
      }
    }
  }
  return null
}

function walkFind(dir: string, pred: (name: string) => boolean): boolean {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) stack.push(full)
      else if (pred(name)) return true
    }
  }
  return false
}

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore' })
    p.on('exit', (code) => {
      if (code === 0) res()
      else rej(new Error(`${cmd} exit ${code}`))
    })
    p.on('error', rej)
  })
}

function requireWorkstation(): string {
  if (!WORKSTATION) {
    throw new Error(
      'RVC 远程部署未配置：请设置环境变量 LUVU_WORKSTATION="user@host"（详见 README）',
    )
  }
  return WORKSTATION
}

function runScp(src: string, dst: string): Promise<void> {
  requireWorkstation()
  return spawnAsync('scp', ['-q', src, dst])
}

function runSsh(remoteArgs: string[]): Promise<void> {
  // remoteArgs 是要在远端跑的命令；用 powershell -Command 包
  return spawnAsync('ssh', [requireWorkstation(), ...remoteArgs])
}

// 防止 dirname unused warning
void dirname
