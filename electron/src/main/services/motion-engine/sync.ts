/**
 * 同步磁盘 motion 文件 ↔ MotionEngine DB。
 *
 * 用户在 Cubism Editor 直接编辑了 motion3.json / 删除文件后调用此函数，
 * DB 自动 reconcile。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SyncReport } from '@shared/motion-engine'
import { parseMotion3 } from '../motion-factory/parser'
import * as storage from './storage'

interface RawModel3 {
  FileReferences?: {
    Motions?: Record<string, Array<{ File: string; Name?: string }>>
  }
}

export function syncModel(modelDir: string): SyncReport {
  const model3 = findFirstModel3(modelDir)
  if (!model3) {
    return {
      model_dir: modelDir,
      added: 0,
      removed: 0,
      updated: 0,
      total_after: 0,
      added_files: [],
      removed_ids: [],
    }
  }

  // 1. 收集磁盘上的所有 motion
  const onDisk = readDiskMotions(model3, modelDir)
  const onDiskByPath = new Map(onDisk.map((m) => [m.file, m]))

  // 2. 收集 DB 已存的
  const inDb = storage.list({ model_dir: modelDir, limit: 10000 })
  const inDbByPath = new Map(inDb.map((m) => [m.file_path, m]))

  // 3. diff
  const added: typeof onDisk = []
  const updated: typeof onDisk = []
  const removed: typeof inDb = []

  for (const disk of onDisk) {
    const existing = inDbByPath.get(disk.file)
    if (!existing) {
      added.push(disk)
    } else {
      // 比对 duration / loop / param_count
      if (
        existing.duration_ms !== disk.duration_ms ||
        existing.loop_flag !== (disk.loop ? 1 : 0) ||
        existing.param_count !== disk.param_count
      ) {
        updated.push(disk)
      }
    }
  }

  for (const dbEntry of inDb) {
    if (!onDiskByPath.has(dbEntry.file_path)) {
      removed.push(dbEntry)
    }
  }

  // 4. 写入
  for (const a of added) {
    storage.create({
      model_dir: modelDir,
      name: a.name,
      file_path: a.file,
      group_name: a.group,
      source: 'imported',
      duration_ms: a.duration_ms,
      loop_flag: a.loop,
      param_count: a.param_count,
    })
  }
  for (const u of updated) {
    const existing = inDbByPath.get(u.file)
    if (!existing) continue
    storage.update(existing.id, {
      duration_ms: u.duration_ms,
      loop_flag: u.loop ? 1 : 0,
      param_count: u.param_count,
    })
  }
  const removedIds = removed.map((r) => r.id)
  for (const id of removedIds) {
    storage.deleteEntry(id)
  }

  return {
    model_dir: modelDir,
    added: added.length,
    updated: updated.length,
    removed: removed.length,
    total_after: storage.list({ model_dir: modelDir, limit: 10000 }).length,
    added_files: added.map((a) => a.file),
    removed_ids: removedIds,
  }
}

interface DiskMotion {
  name: string
  file: string
  group: string
  duration_ms: number
  loop: boolean
  param_count: number
}

function readDiskMotions(model3Path: string, modelDir: string): DiskMotion[] {
  try {
    const json = JSON.parse(readFileSync(model3Path, 'utf-8')) as RawModel3
    const base = dirname(model3Path)
    const out: DiskMotion[] = []
    if (json.FileReferences?.Motions) {
      for (const [group, arr] of Object.entries(json.FileReferences.Motions)) {
        for (const m of arr) {
          if (!m.File) continue
          const abs = join(base, m.File)
          if (!existsSync(abs)) continue
          const parsed = parseMotion3(abs)
          if (!parsed) continue
          out.push({
            name: m.Name ?? m.File.split('/').pop() ?? 'unknown',
            file: m.File,
            group,
            duration_ms: Math.round(parsed.duration * 1000),
            loop: parsed.loop,
            param_count: parsed.params.size,
          })
        }
      }
    }
    return out
  } catch (e) {
    console.warn(`[motion-engine sync] read model3 failed:`, e)
    return []
  }
  void modelDir // 备用
}

function findFirstModel3(dir: string): string | null {
  try {
    for (const e of readdirSync(dir)) {
      if (/\.model3\.json$/i.test(e)) return join(dir, e)
    }
  } catch {
    /* ignore */
  }
  return null
}
