/**
 * Model Describer — 用本地 IP 知识库 + dir 名解析给每个 model 生成介绍。
 *
 * v0.9 修订：放弃调用远端 LLM（之前会发请求到 workstation）。
 * 用户反馈：「分析介绍是需要你做的内容你却交给了我的 workstation 来做」。
 * 改为：本地 ip-knowledge.ts（Claude 撰写的 20+ IP 简介）+ dir 名抽角色名拼装。
 *
 * 缓存：~/.luvu/model-descriptions.json（保留兼容，避免重新计算）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { getPaths } from './paths'
import { matchIp } from './ip-knowledge'

interface DescriptionCache {
  version: 1
  /** key = model.dir，value = 描述 */
  descriptions: Record<string, { text: string; generated_at: number }>
}

function cachePath(): string {
  return join(getPaths().userDataDir, 'model-descriptions.json')
}

function loadCache(): DescriptionCache {
  const p = cachePath()
  if (!existsSync(p)) return { version: 1, descriptions: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as DescriptionCache
  } catch {
    return { version: 1, descriptions: {} }
  }
}

function saveCache(c: DescriptionCache): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(c, null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
}

/** 读 model3.json 提取 motion group + expression 名作为 LLM 上下文 */
function readModelMeta(modelJsonPath: string): {
  motionGroups: string[]
  expressionNames: string[]
  motionFileNames: string[]
} {
  const out = { motionGroups: [] as string[], expressionNames: [] as string[], motionFileNames: [] as string[] }
  try {
    const json = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as {
      FileReferences?: {
        Motions?: Record<string, Array<{ File?: string; Name?: string }>>
        Expressions?: Array<{ Name?: string; File?: string }>
      }
    }
    const refs = json.FileReferences ?? {}
    if (refs.Motions) {
      for (const [group, arr] of Object.entries(refs.Motions)) {
        out.motionGroups.push(group)
        for (const m of arr) {
          if (m.Name) out.motionFileNames.push(m.Name)
          else if (m.File)
            out.motionFileNames.push(m.File.split('/').pop()!.replace(/\.motion3\.json$/, ''))
        }
      }
    }
    if (Array.isArray(refs.Expressions)) {
      for (const e of refs.Expressions) {
        if (e.Name) out.expressionNames.push(e.Name)
        else if (e.File)
          out.expressionNames.push(e.File.split('/').pop()!.replace(/\.exp3?\.json$/, ''))
      }
    }
  } catch {
    /* skip */
  }
  return out
}

export interface DescribePayload {
  model_dir: string
  model_json_path: string
  display: string
  ip: string // 顶层 IP 文件夹名（如 "BanG Dream!"）
  motion_count: number
  expression_count: number
}

export interface DescribeResult {
  ok: boolean
  text?: string
  reason?: string
  from_cache?: boolean
}

export async function describeModel(payload: DescribePayload): Promise<DescribeResult> {
  const cache = loadCache()
  const cached = cache.descriptions[payload.model_dir]
  if (cached) return { ok: true, text: cached.text, from_cache: true }

  const text = buildLocalDescription(payload)
  cache.descriptions[payload.model_dir] = { text, generated_at: Date.now() }
  saveCache(cache)
  return { ok: true, text }
}

/** 本地拼装：IP 简介 + 抽出的角色名 + motion/expression 数 */
function buildLocalDescription(payload: DescribePayload): string {
  const ip = matchIp(payload.model_dir)
  const charName = extractCharacterName(payload.model_dir, payload.display)
  const meta = readModelMeta(payload.model_json_path)
  const sampleGroups = meta.motionGroups.slice(0, 5).join('/')

  const parts: string[] = []

  if (ip) {
    parts.push(
      `${charName ? `「${charName}」 — ` : ''}来自《${ip.name}》（${ip.kind}${ip.by ? ' · ' + ip.by : ''}）`,
    )
    parts.push(ip.intro)
    if (ip.style) parts.push(`画风：${ip.style}`)
  } else {
    parts.push(charName ? `「${charName}」` : payload.display)
    parts.push(`来源未在内置 IP 库中识别（路径：${payload.ip}）`)
  }

  const stats: string[] = []
  if (payload.motion_count > 0) {
    stats.push(`${payload.motion_count} 动作${sampleGroups ? `（${sampleGroups}）` : ''}`)
  }
  if (payload.expression_count > 0) stats.push(`${payload.expression_count} 表情`)
  if (stats.length) parts.push(stats.join('、'))

  return parts.join('。')
}

/** 从 dir 名 / display 抽角色名 — 去掉常见 view 后缀和扩展名 */
function extractCharacterName(modelDir: string, display: string): string {
  const last = basename(modelDir).replace(/\.(model3?|moc3?|json)$/i, '')
  const cleaned = last
    .replace(/_(default|normal|casual|alt|skin\d*|view\d*|v\d+|\d{2,3})$/i, '')
    .replace(/[-_]+$/, '')
    .trim()
  return cleaned || display || ''
}

/** 清理缓存（主人手动触发或测试） */
export function clearDescriptionCache(): void {
  saveCache({ version: 1, descriptions: {} })
}

/** 读所有缓存（不调 LLM 一次性查所有 cached 描述） */
export function getCachedDescriptions(): Record<string, string> {
  const cache = loadCache()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(cache.descriptions)) out[k] = v.text
  return out
}

// 同 dirname helper 暴露
export { dirname }
