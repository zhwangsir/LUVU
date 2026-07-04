/**
 * 模型收藏 + 最近使用（v0.12）。
 *
 * 文件：~/.luvu/model-favorites.json
 * key = model_dir
 *
 * 收藏：用户主动 ⭐ 标记，永久保留
 * 最近：每次切换该 model 自动追加到队列末尾（上限 30 个）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from './paths'

interface FavoritesFile {
  version: 1
  /** 用户收藏的 model_dir 集合（保持插入顺序） */
  favorites: string[]
  /** 最近使用 model_dir，按时间倒序（最新在前），上限 RECENT_LIMIT */
  recent: Array<{ dir: string; used_at: number }>
}

const RECENT_LIMIT = 30

function filePath(): string {
  return join(getPaths().userDataDir, 'model-favorites.json')
}

function load(): FavoritesFile {
  const p = filePath()
  if (!existsSync(p)) return { version: 1, favorites: [], recent: [] }
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as FavoritesFile
    // 字段兼容性
    if (!Array.isArray(data.favorites)) data.favorites = []
    if (!Array.isArray(data.recent)) data.recent = []
    return data
  } catch {
    return { version: 1, favorites: [], recent: [] }
  }
}

function save(f: FavoritesFile): void {
  try {
    writeFileSync(filePath(), JSON.stringify(f, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[model-favorites] save failed', e)
  }
}

export function getFavorites(): string[] {
  return load().favorites
}

export function getRecent(): Array<{ dir: string; used_at: number }> {
  return load().recent
}

export function getAll(): { favorites: string[]; recent: Array<{ dir: string; used_at: number }> } {
  const f = load()
  return { favorites: f.favorites, recent: f.recent }
}

export function toggleFavorite(dir: string): { is_favorite: boolean } {
  if (!dir) return { is_favorite: false }
  const f = load()
  const idx = f.favorites.indexOf(dir)
  if (idx >= 0) {
    f.favorites.splice(idx, 1)
    save(f)
    return { is_favorite: false }
  } else {
    f.favorites.push(dir)
    save(f)
    return { is_favorite: true }
  }
}

export function markRecent(dir: string): void {
  if (!dir) return
  const f = load()
  // 已存在的先删（保持唯一），再放到队首
  f.recent = f.recent.filter((r) => r.dir !== dir)
  f.recent.unshift({ dir, used_at: Date.now() })
  if (f.recent.length > RECENT_LIMIT) f.recent = f.recent.slice(0, RECENT_LIMIT)
  save(f)
}

export function clearRecent(): void {
  const f = load()
  f.recent = []
  save(f)
}
