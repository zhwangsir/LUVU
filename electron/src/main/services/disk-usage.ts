/**
 * 磁盘占用统计 — 列 LUVU 各数据目录与模型库大小，供 Settings UI 展示。
 *
 * 用 Node fs 跨平台递归 stat，对 1389 模型库约 1-2s（已缓存 60s）。
 */
import { promises as fsp, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getPaths } from './paths'

export interface DiskEntry {
  /** 显示标签 */
  label: string
  /** 绝对路径 */
  path: string
  /** 字节数；不存在时为 0 */
  bytes: number
  /** 是否存在 */
  exists: boolean
  /** 简短说明 */
  hint: string
  /** 是否可被「清理」按钮删除（如缩略图缓存可删，模型库不可） */
  cleanable: boolean
}

export interface DiskUsageReport {
  entries: DiskEntry[]
  total_bytes: number
  computed_at_ms: number
}

let cached: { report: DiskUsageReport; ts: number } | null = null
const CACHE_TTL_MS = 60_000

/** 递归计算目录总大小。失败/无权限的子项跳过不抛错。 */
async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      try {
        if (e.isDirectory()) {
          total += await dirSize(full)
        } else if (e.isFile()) {
          const s = await fsp.stat(full)
          total += s.size
        }
      } catch {
        /* skip 单项错误 */
      }
    }
  } catch {
    /* dir 不存在 / 无权限 */
  }
  return total
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function pathExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

export async function computeDiskUsage(force = false): Promise<DiskUsageReport> {
  if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.report
  }
  const paths = getPaths()
  const candidates: Array<Omit<DiskEntry, 'bytes' | 'exists'>> = [
    ...paths.modelSearchPaths.map((p, i) => ({
      label: i === 0 ? 'Live2D 模型库（主）' : `Live2D 模型库 #${i + 1}`,
      path: p,
      hint: '你放进去的 Live2D 模型；删除会丢失模型，不会自动清理',
      cleanable: false,
    })),
    {
      label: 'TTS 模型',
      path: join(paths.userDataDir, 'models-tts'),
      hint: 'CosyVoice / F5-TTS / RVC 模型，删后 TTS sidecar 启动会重下',
      cleanable: false,
    },
    {
      label: 'RVC 虚拟环境',
      path: join(paths.userDataDir, 'rvc-venv'),
      hint: 'Python venv；删后 sidecar 失效，需重跑 install.sh',
      cleanable: false,
    },
    {
      label: 'CosyVoice 源码',
      path: join(paths.userDataDir, 'cosyvoice-repo'),
      hint: 'CosyVoice 仓库副本',
      cleanable: false,
    },
    {
      label: '缩略图缓存',
      path: join(paths.userDataDir, 'thumbs'),
      hint: '可清理 — 重启会按需重新生成',
      cleanable: true,
    },
    {
      label: '音色克隆样本',
      path: join(paths.userDataDir, 'voice_clones'),
      hint: '你训练 RVC 时上传的语音样本',
      cleanable: false,
    },
    {
      label: '对话历史 (SQLite)',
      path: paths.historyDbPath,
      hint: '可清理 — 但会失去所有历史对话',
      cleanable: true,
    },
  ]

  const entries: DiskEntry[] = []
  let total = 0
  for (const c of candidates) {
    const exists = pathExists(c.path)
    let bytes = 0
    if (exists) {
      // SQLite 是单文件，其他是目录
      bytes = c.path.endsWith('.sqlite') || c.path.endsWith('.db')
        ? fileSize(c.path)
        : await dirSize(c.path)
    }
    entries.push({ ...c, exists, bytes })
    total += bytes
  }

  const report: DiskUsageReport = {
    entries,
    total_bytes: total,
    computed_at_ms: Date.now(),
  }
  cached = { report, ts: Date.now() }
  return report
}

/** 删除指定 cleanable 路径下的内容（递归）。返回释放的字节数。 */
export async function cleanPath(rawPath: string): Promise<{ ok: boolean; freed_bytes: number; reason?: string }> {
  // v0.13 security: 先归一化路径，防止 ../ 绕过白名单
  // 例：rawPath = '~/.luvu/thumbs/../../etc/passwd' → normalized = '/etc/passwd'
  // path.resolve 同时展开 .. 和把相对路径变绝对
  const normalized = resolve(rawPath)
  if (!pathExists(normalized)) return { ok: true, freed_bytes: 0 }

  // 双重保护：只允许删 thumbs / *.sqlite 这类已知 cleanable 路径
  const userData = getPaths().userDataDir
  const allowedPrefixes = [
    join(userData, 'thumbs'),
    join(userData, 'history.sqlite'),
  ]
  const allowed = allowedPrefixes.some((p) => normalized === p || normalized.startsWith(p + '/'))
  if (!allowed) {
    return { ok: false, freed_bytes: 0, reason: `路径未在白名单：${normalized}` }
  }
  try {
    let freed = 0
    try {
      freed = normalized.endsWith('.sqlite') || normalized.endsWith('.db')
        ? fileSize(normalized)
        : await dirSize(normalized)
    } catch {
      /* ignore */
    }
    await fsp.rm(normalized, { recursive: true, force: true })
    cached = null
    return { ok: true, freed_bytes: freed }
  } catch (e) {
    return { ok: false, freed_bytes: 0, reason: String(e).slice(0, 200) }
  }
}
