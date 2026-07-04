/**
 * v0.15 C1: 长期记忆向量库（per-character）。
 *
 * 简化方案：不装 sqlite-vec extension（编译依赖复杂），用 better-sqlite3 +
 * embedding JSON 字段 + 应用层 cosine similarity 搜索。
 * 100-500 条记忆内搜索 <50ms，够个人用。
 *
 * 每个 character 独立 memory.db：~/.luvu/chars/<id>/memory.db
 */
import Database, { type Database as DB } from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { characterDir, getActiveCharacter } from './character-store'

export interface Memory {
  id: string
  /** 'fact' = 客观事实，'preference' = 偏好，'event' = 事件，'reflection' = 角色总结 */
  kind: 'fact' | 'preference' | 'event' | 'reflection'
  /** 内容文本 */
  text: string
  /** embedding 向量（JSON 序列化的 number[]） */
  embedding: number[]
  /** 重要度 0-1（影响检索排序权重） */
  importance: number
  /** 来源 (turn_id / 'daily_reflection' / 'manual') */
  source: string
  /** 创建时间 ms */
  ts: number
}

let dbs = new Map<string, DB>()

function memoryDbPath(characterId: string): string {
  return join(characterDir(characterId), 'memory.db')
}

function ensureDb(characterId: string): DB {
  const cached = dbs.get(characterId)
  if (cached) return cached
  const path = memoryDbPath(characterId)
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('fact','preference','event','reflection')),
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      source TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind, ts DESC);
  `)
  dbs.set(characterId, db)
  return db
}

export function closeMemoryDb(characterId?: string): void {
  if (characterId) {
    const db = dbs.get(characterId)
    if (db) { try { db.close() } catch { /* skip */ } }
    dbs.delete(characterId)
  } else {
    for (const db of dbs.values()) {
      try { db.close() } catch { /* skip */ }
    }
    dbs.clear()
  }
}

export function addMemory(characterId: string, memory: Omit<Memory, 'id' | 'ts'> & { id?: string; ts?: number }): Memory {
  const id = memory.id ?? `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const ts = memory.ts ?? Date.now()
  const m: Memory = { ...memory, id, ts }
  ensureDb(characterId).prepare(`
    INSERT OR REPLACE INTO memories (id, kind, text, embedding, importance, source, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(m.id, m.kind, m.text, JSON.stringify(m.embedding), m.importance, m.source, m.ts)
  return m
}

export function listMemories(characterId: string, opts: { kind?: Memory['kind']; limit?: number } = {}): Memory[] {
  const limit = opts.limit ?? 50
  const rows = opts.kind
    ? ensureDb(characterId)
        .prepare(`SELECT * FROM memories WHERE kind = ? ORDER BY ts DESC LIMIT ?`)
        .all(opts.kind, limit) as Array<Omit<Memory, 'embedding'> & { embedding: string }>
    : ensureDb(characterId)
        .prepare(`SELECT * FROM memories ORDER BY ts DESC LIMIT ?`)
        .all(limit) as Array<Omit<Memory, 'embedding'> & { embedding: string }>
  return rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) as number[] }))
}

/**
 * v0.21 Round S(收 Round P LOW-1):按 source 前缀 SQL 直接 filter,
 * 避免 listMemories 拿 N 条再 JS filter 的 over-fetch 漏数据问题。
 *
 * 用例:`cross_character:` 前缀过滤跨灵魂 event,M8 灵魂回响 prompt context。
 *
 * `sourcePrefix` 通过 `LIKE ${prefix}%` 拼接 — 参数化绑定避免 SQL 注入,
 * `%` 通配符走 SQL 引擎不走 JS。`escapeLikeWildcard` 处理 `%/_` 在 prefix 里出现的
 * 极端情况(实战 source 是 `cross_character:<uuid>` 没这俩字符,加这层防御)。
 */
function escapeLikeWildcard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function listMemoriesBySource(
  characterId: string,
  sourcePrefix: string,
  opts: { kind?: Memory['kind']; limit?: number } = {},
): Memory[] {
  const limit = opts.limit ?? 50
  const likePattern = `${escapeLikeWildcard(sourcePrefix)}%`
  const rows = opts.kind
    ? ensureDb(characterId)
        .prepare(
          `SELECT * FROM memories WHERE kind = ? AND source LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`,
        )
        .all(opts.kind, likePattern, limit) as Array<
        Omit<Memory, 'embedding'> & { embedding: string }
      >
    : ensureDb(characterId)
        .prepare(
          `SELECT * FROM memories WHERE source LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`,
        )
        .all(likePattern, limit) as Array<
        Omit<Memory, 'embedding'> & { embedding: string }
      >
  return rows.map((r) => ({
    ...r,
    embedding: JSON.parse(r.embedding) as number[],
  }))
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Top-K 检索 — cosine similarity * importance 综合排序 */
export function searchMemories(characterId: string, queryEmbedding: number[], k = 5): Array<Memory & { score: number }> {
  const all = listMemories(characterId, { limit: 500 })
  if (queryEmbedding.length === 0) return []
  return all
    .map((m) => ({ ...m, score: cosine(queryEmbedding, m.embedding) * (0.5 + m.importance * 0.5) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export function deleteMemory(characterId: string, id: string): boolean {
  const r = ensureDb(characterId).prepare(`DELETE FROM memories WHERE id = ?`).run(id)
  return r.changes > 0
}

export function countMemories(characterId: string): number {
  const r = ensureDb(characterId).prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }
  return r.c
}

/** v0.15 C1: 给当前 active character 加记忆（最常用入口） */
export function addMemoryForActive(memory: Omit<Memory, 'id' | 'ts'>): Memory | null {
  const active = getActiveCharacter()
  if (!active) return null
  return addMemory(active.id, memory)
}
