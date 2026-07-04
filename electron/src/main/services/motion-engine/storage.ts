/**
 * MotionEngine SQLite 持久化。
 *
 * 数据库：~/.luvu/motion-engine.sqlite  (与 history.sqlite 分离，方便单独迁移)
 * WAL 模式，写入 sync=NORMAL（桌宠级负载）。
 */
import Database, { type Database as DB } from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  MotionEntry,
  MotionFilter,
  MotionSource,
  MotionVersion,
} from '@shared/motion-engine'
import { getPaths } from '../paths'

let db: DB | null = null

function dbPath(): string {
  return join(getPaths().userDataDir, 'motion-engine.sqlite')
}

function ensure(): DB {
  if (db) return db
  const p = dbPath()
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true })
  const instance = new Database(p)
  instance.pragma('journal_mode = WAL')
  instance.pragma('synchronous = NORMAL')
  instance.pragma('foreign_keys = ON')
  instance.exec(`
    CREATE TABLE IF NOT EXISTS motion_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_dir TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      strategy TEXT,
      prompt TEXT,
      llm_provider TEXT,
      llm_model TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      loop_flag INTEGER NOT NULL DEFAULT 0,
      param_count INTEGER NOT NULL DEFAULT 0,
      validator_score REAL,
      scorer_score REAL,
      user_rating INTEGER NOT NULL DEFAULT 0,
      play_count INTEGER NOT NULL DEFAULT 0,
      parent_entry_id INTEGER,
      emotion_tags TEXT NOT NULL DEFAULT '[]',
      context_tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_entry_id) REFERENCES motion_entries(id)
    );
    CREATE INDEX IF NOT EXISTS idx_me_model ON motion_entries(model_dir);
    CREATE INDEX IF NOT EXISTS idx_me_source ON motion_entries(source);
    CREATE INDEX IF NOT EXISTS idx_me_score ON motion_entries(scorer_score);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_me_path ON motion_entries(model_dir, file_path);

    CREATE TABLE IF NOT EXISTS motion_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(entry_id, version_no),
      FOREIGN KEY (entry_id) REFERENCES motion_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mv_entry ON motion_versions(entry_id);
  `)
  db = instance
  return instance
}

// ============================================================================
// CRUD
// ============================================================================

export interface CreateMotionInput {
  model_dir: string
  name: string
  file_path: string
  group_name?: string
  source: MotionSource
  strategy?: string | null
  prompt?: string | null
  llm_provider?: string | null
  llm_model?: string | null
  duration_ms?: number
  loop_flag?: boolean
  param_count?: number
  validator_score?: number | null
  scorer_score?: number | null
  parent_entry_id?: number | null
  emotion_tags?: string[]
  context_tags?: string[]
}

export function create(input: CreateMotionInput): MotionEntry {
  const now = Date.now()
  const stmt = ensure().prepare(`
    INSERT INTO motion_entries (
      model_dir, name, file_path, group_name,
      source, strategy, prompt, llm_provider, llm_model,
      duration_ms, loop_flag, param_count,
      validator_score, scorer_score, user_rating, play_count,
      parent_entry_id, emotion_tags, context_tags,
      created_at, updated_at
    ) VALUES (
      @model_dir, @name, @file_path, @group_name,
      @source, @strategy, @prompt, @llm_provider, @llm_model,
      @duration_ms, @loop_flag, @param_count,
      @validator_score, @scorer_score, 0, 0,
      @parent_entry_id, @emotion_tags, @context_tags,
      @created_at, @updated_at
    )
    ON CONFLICT(model_dir, file_path) DO UPDATE SET
      name = excluded.name,
      group_name = excluded.group_name,
      source = excluded.source,
      strategy = excluded.strategy,
      prompt = excluded.prompt,
      llm_provider = excluded.llm_provider,
      llm_model = excluded.llm_model,
      duration_ms = excluded.duration_ms,
      loop_flag = excluded.loop_flag,
      param_count = excluded.param_count,
      validator_score = excluded.validator_score,
      scorer_score = excluded.scorer_score,
      parent_entry_id = excluded.parent_entry_id,
      emotion_tags = excluded.emotion_tags,
      context_tags = excluded.context_tags,
      updated_at = excluded.updated_at
  `)
  const result = stmt.run({
    model_dir: input.model_dir,
    name: input.name,
    file_path: input.file_path,
    group_name: input.group_name ?? '',
    source: input.source,
    strategy: input.strategy ?? null,
    prompt: input.prompt ?? null,
    llm_provider: input.llm_provider ?? null,
    llm_model: input.llm_model ?? null,
    duration_ms: input.duration_ms ?? 0,
    loop_flag: input.loop_flag ? 1 : 0,
    param_count: input.param_count ?? 0,
    validator_score: input.validator_score ?? null,
    scorer_score: input.scorer_score ?? null,
    parent_entry_id: input.parent_entry_id ?? null,
    emotion_tags: JSON.stringify(input.emotion_tags ?? []),
    context_tags: JSON.stringify(input.context_tags ?? []),
    created_at: now,
    updated_at: now,
  })
  const id = Number(result.lastInsertRowid)
  return get(id)!
}

export function get(id: number): MotionEntry | null {
  const row = ensure().prepare('SELECT * FROM motion_entries WHERE id = ?').get(id) as
    | MotionEntry
    | undefined
  return row ?? null
}

export function update(id: number, patch: Partial<MotionEntry>): MotionEntry {
  const cur = get(id)
  if (!cur) throw new Error(`motion entry ${id} not found`)
  const merged = { ...cur, ...patch, updated_at: Date.now() }
  ensure()
    .prepare(
      `UPDATE motion_entries SET
        name=@name, file_path=@file_path, group_name=@group_name,
        source=@source, strategy=@strategy, prompt=@prompt,
        llm_provider=@llm_provider, llm_model=@llm_model,
        duration_ms=@duration_ms, loop_flag=@loop_flag, param_count=@param_count,
        validator_score=@validator_score, scorer_score=@scorer_score,
        user_rating=@user_rating, play_count=@play_count,
        parent_entry_id=@parent_entry_id,
        emotion_tags=@emotion_tags, context_tags=@context_tags,
        updated_at=@updated_at
       WHERE id=@id`,
    )
    .run({
      id,
      name: merged.name,
      file_path: merged.file_path,
      group_name: merged.group_name,
      source: merged.source,
      strategy: merged.strategy,
      prompt: merged.prompt,
      llm_provider: merged.llm_provider,
      llm_model: merged.llm_model,
      duration_ms: merged.duration_ms,
      loop_flag: merged.loop_flag,
      param_count: merged.param_count,
      validator_score: merged.validator_score,
      scorer_score: merged.scorer_score,
      user_rating: merged.user_rating,
      play_count: merged.play_count,
      parent_entry_id: merged.parent_entry_id,
      emotion_tags: merged.emotion_tags,
      context_tags: merged.context_tags,
      updated_at: merged.updated_at,
    })
  return get(id)!
}

export function deleteEntry(id: number): void {
  ensure().prepare('DELETE FROM motion_entries WHERE id = ?').run(id)
}

export function list(filter: MotionFilter = {}): MotionEntry[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.model_dir) {
    where.push('model_dir = @model_dir')
    params.model_dir = filter.model_dir
  }
  if (filter.source) {
    const arr = Array.isArray(filter.source) ? filter.source : [filter.source]
    where.push(`source IN (${arr.map((_, i) => `@src${i}`).join(',')})`)
    arr.forEach((s, i) => {
      params[`src${i}`] = s
    })
  }
  if (filter.min_score != null) {
    where.push('(scorer_score >= @min_score OR scorer_score IS NULL)')
    params.min_score = filter.min_score
  }
  if (filter.emotion) {
    where.push('emotion_tags LIKE @emo')
    params.emo = `%"${filter.emotion}"%`
  }
  if (filter.context) {
    where.push('context_tags LIKE @ctx')
    params.ctx = `%"${filter.context}"%`
  }
  if (filter.search) {
    where.push('(name LIKE @search OR prompt LIKE @search)')
    params.search = `%${filter.search}%`
  }
  const orderBy = filter.order_by ?? 'updated_at'
  const orderDir = (filter.order_dir ?? 'desc').toUpperCase()
  const limit = filter.limit ?? 100
  const offset = filter.offset ?? 0
  const sql = `
    SELECT * FROM motion_entries
    ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy} ${orderDir === 'ASC' ? 'ASC' : 'DESC'}
    LIMIT @limit OFFSET @offset
  `
  return ensure().prepare(sql).all({ ...params, limit, offset }) as MotionEntry[]
}

// ============================================================================
// 版本
// ============================================================================

export function saveVersion(
  entryId: number,
  snapshotJson: string,
  editedBy: string,
): MotionVersion {
  const last = ensure()
    .prepare('SELECT version_no FROM motion_versions WHERE entry_id = ? ORDER BY version_no DESC LIMIT 1')
    .get(entryId) as { version_no?: number } | undefined
  const versionNo = (last?.version_no ?? 0) + 1
  const r = ensure()
    .prepare(
      `INSERT INTO motion_versions (entry_id, version_no, snapshot_json, edited_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(entryId, versionNo, snapshotJson, editedBy, Date.now())
  return {
    id: Number(r.lastInsertRowid),
    entry_id: entryId,
    version_no: versionNo,
    snapshot_json: snapshotJson,
    edited_by: editedBy,
    created_at: Date.now(),
  }
}

export function listVersions(entryId: number): MotionVersion[] {
  return ensure()
    .prepare('SELECT * FROM motion_versions WHERE entry_id = ? ORDER BY version_no DESC')
    .all(entryId) as MotionVersion[]
}

export function getVersion(entryId: number, versionNo: number): MotionVersion | null {
  return (
    (ensure()
      .prepare('SELECT * FROM motion_versions WHERE entry_id = ? AND version_no = ?')
      .get(entryId, versionNo) as MotionVersion | undefined) ?? null
  )
}

// ============================================================================
// 行为
// ============================================================================

export function recordPlay(id: number): void {
  ensure().prepare('UPDATE motion_entries SET play_count = play_count + 1 WHERE id = ?').run(id)
}

export function setRating(id: number, rating: -1 | 0 | 1): void {
  ensure()
    .prepare('UPDATE motion_entries SET user_rating = ?, updated_at = ? WHERE id = ?')
    .run(rating, Date.now(), id)
}

export function findByEmotion(modelDir: string, emotion: string, limit = 5): MotionEntry[] {
  return list({
    model_dir: modelDir,
    emotion,
    order_by: 'scorer_score',
    order_dir: 'desc',
    limit,
  })
}

export function findByContext(modelDir: string, context: string, limit = 5): MotionEntry[] {
  return list({
    model_dir: modelDir,
    context,
    order_by: 'scorer_score',
    order_dir: 'desc',
    limit,
  })
}

export function topRated(modelDir: string, n = 10): MotionEntry[] {
  return list({
    model_dir: modelDir,
    order_by: 'user_rating',
    order_dir: 'desc',
    limit: n,
  })
}

export function deleteByModelDir(modelDir: string): number {
  return ensure().prepare('DELETE FROM motion_entries WHERE model_dir = ?').run(modelDir).changes
}

export function close(): void {
  if (db) {
    db.close()
    db = null
  }
}
