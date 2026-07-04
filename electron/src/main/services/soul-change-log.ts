/**
 * Soul Change Log (P5) — 每次 SoulEditor 保存 yaml 后追加 audit trail。
 *
 * 文件: ~/.luvu/chars/<id>/soul-changes.log (NDJSON 每行 JSON)
 * 字段: { ts, character_id, filename, summary, changes }
 *
 * 设计:
 *   - NDJSON 便于追加 (无需 rewrite 全文件)
 *   - 每次 append 截断到 200 行 LRU (避免无限增长)
 *   - 失败不影响主 save 流程 (try/catch swallow)
 *   - 调用方传入 before/after yaml 内容字符串 → 这里做 yaml parse + diff
 */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { diffSoulConfigs, type FieldChange, type SoulConfig } from '@luvu/soul-loader'
import { characterDir, getCharacter } from './character-store'

const MAX_LOG_ENTRIES = 200

export interface SoulChangeLogEntry {
  ts: number
  character_id: string
  filename: string
  summary: string
  changes: FieldChange[]
}

/**
 * P0 SEC (H2): characterId 在用于 fs path 之前必须验证存在，
 * 防 '../etc' / '/etc/cron' 类路径污染从 IPC 传入。
 */
function isValidCharacterId(characterId: string): boolean {
  if (!characterId || typeof characterId !== 'string') return false
  if (!/^[a-zA-Z0-9_-]+$/.test(characterId)) return false
  return getCharacter(characterId) !== null
}

function logPath(characterId: string): string {
  return join(characterDir(characterId), 'soul-changes.log')
}

/**
 * 计算 diff + append 一条 log entry。
 * 完全 best-effort — yaml 解析失败 / 写盘失败都 swallow。
 */
export function recordSoulChange(
  characterId: string,
  filename: string,
  beforeYaml: string,
  afterYaml: string,
): SoulChangeLogEntry | null {
  // P0 SEC (H2): characterId 必须验证
  if (!isValidCharacterId(characterId)) {
    console.warn('[soul-change-log] 非法 characterId 拒绝写 log:', characterId)
    return null
  }
  // filename 必须是合法 yaml 文件名 (跟 writeCharacterSoulFile 约束一致)
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    console.warn('[soul-change-log] 非法 filename 拒绝:', filename)
    return null
  }
  try {
    const beforeObj = parseYamlSafe(beforeYaml)
    const afterObj = parseYamlSafe(afterYaml)
    // 用 partial 对象当 SoulConfig (diff 不依赖完整字段) — 双 cast 绕过 TS 严格检查
    const diff = diffSoulConfigs(
      beforeObj as unknown as SoulConfig,
      afterObj as unknown as SoulConfig,
    )
    if (diff.changes.length === 0) return null

    const entry: SoulChangeLogEntry = {
      ts: Date.now(),
      character_id: characterId,
      filename,
      summary: diff.summary,
      changes: diff.changes,
    }
    appendToFile(characterId, entry)
    return entry
  } catch (e) {
    console.error('[soul-change-log] recordSoulChange failed (non-fatal):', e)
    return null
  }
}

function parseYamlSafe(text: string): Record<string, unknown> {
  if (!text || !text.trim()) return {}
  try {
    const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA })
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * code-reviewer M1 修: 改用 appendFileSync 纯追加消除 read-write race lost-update。
 * LRU 截断改为周期性 compact (写入超过 1.5x 上限时触发) — O(1) 写而非 O(n)。
 */
function appendToFile(characterId: string, entry: SoulChangeLogEntry): void {
  const p = logPath(characterId)
  // 原子追加 — 单 syscall，多并发写不会互相覆盖
  appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8')
  // 周期 compact: 当行数 > 1.5x 上限时重写截断 (避免每次都 O(n))
  try {
    const raw = readFileSync(p, 'utf-8')
    const lineCount = raw.split('\n').filter((l) => l.trim()).length
    if (lineCount > MAX_LOG_ENTRIES * 1.5) {
      compactLog(p, raw)
    }
  } catch {
    /* compact 失败不影响主流程 */
  }
}

function compactLog(p: string, raw: string): void {
  const entries: SoulChangeLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      /* 损坏行跳过 */
    }
  }
  const kept = entries.slice(-MAX_LOG_ENTRIES)
  writeFileSync(p, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
}

/** 读出某 character 的全部历史（按时间倒序 newest first） */
export function loadSoulChangeLog(characterId: string): SoulChangeLogEntry[] {
  // P0 SEC (H2): 验证 characterId 防路径污染
  if (!isValidCharacterId(characterId)) return []
  const p = logPath(characterId)
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const entries: SoulChangeLogEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line))
      } catch {
        /* 损坏行跳过 */
      }
    }
    return entries.reverse() // newest first
  } catch {
    return []
  }
}

export function clearSoulChangeLog(characterId: string): void {
  // P0 SEC (H2): 验证 characterId 防路径污染
  if (!isValidCharacterId(characterId)) return
  const p = logPath(characterId)
  // code-reviewer L3: 用 unlinkSync 而非 truncate (语义更明确)
  if (existsSync(p)) {
    try {
      unlinkSync(p)
    } catch {
      writeFileSync(p, '', 'utf-8') // fallback (e.g. 权限)
    }
  }
}
