/**
 * Tool 审批 policy 持久化 ~/.luvu/tool-policy.json
 *
 * 用户在审批 dialog 选「永远允许」/「永远拒绝」时写入此文件。
 * 下次同名工具调用时主进程直接根据 policy 决定。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolPolicy } from '@shared/tools'
import { getPaths } from '../paths'

let cached: ToolPolicy | null = null

function path(): string {
  return join(getPaths().userDataDir, 'tool-policy.json')
}

/**
 * v0.21 Round D:tool name 从 `fs.list_dir` 改 `fs_list_dir` 等(OpenAI function
 * name regex 兼容)。老用户的 policy 文件可能存了旧 key,加 migration 自动转。
 */
const TOOL_NAME_MIGRATIONS: Record<string, string> = {
  'creative.generate_sticker': 'creative_generate_sticker',
  'fs.list_dir': 'fs_list_dir',
  'fs.read_file': 'fs_read_file',
  'system.open_path': 'system_open_path',
  'system.open_url': 'system_open_url',
  'system.notify': 'system_notify',
}

function migrateLegacyNames(p: ToolPolicy): { policy: ToolPolicy; migrated: number } {
  let migrated = 0
  for (const [oldName, newName] of Object.entries(TOOL_NAME_MIGRATIONS)) {
    if (p[oldName] !== undefined && p[newName] === undefined) {
      p[newName] = p[oldName]
      delete p[oldName]
      migrated++
    }
  }
  return { policy: p, migrated }
}

export function load(): ToolPolicy {
  if (cached) return cached
  const p = path()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as ToolPolicy
      const { policy: migrated, migrated: count } = migrateLegacyNames(raw)
      if (count > 0) {
        console.log(`[tool-policy] migrated ${count} legacy tool name(s) to underscore form`)
        // 持久化迁移后的 policy
        try {
          writeFileSync(path(), JSON.stringify(migrated, null, 2), 'utf-8')
        } catch (e) {
          console.warn('[tool-policy] save migration failed:', e)
        }
      }
      cached = migrated
      return cached
    } catch (e) {
      console.warn('[tool-policy] parse failed:', e)
    }
  }
  cached = {}
  return cached
}

export function setPolicy(toolName: string, decision: 'always_allow' | 'always_deny' | null): void {
  const p = load()
  if (decision === null) delete p[toolName]
  else p[toolName] = decision
  cached = p
  try {
    writeFileSync(path(), JSON.stringify(p, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[tool-policy] save failed:', e)
  }
}

export function get(toolName: string): 'always_allow' | 'always_deny' | undefined {
  return load()[toolName]
}

export function clearAll(): void {
  cached = {}
  try {
    writeFileSync(path(), '{}', 'utf-8')
  } catch (e) {
    console.warn('[tool-policy] clear failed:', e)
  }
}
