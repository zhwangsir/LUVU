/**
 * 把 soul 配置改动写回 ~/.luvu/soul/<file>.yaml。
 *
 * 策略：avatar 字段写到 identity.yaml（如果不存在则创建）；
 * 不破坏文件里的其他字段（merge-then-write）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import type { SoulConfig } from '@shared/types'
import { getPaths } from './paths'
import { characterSoulDir, getActiveCharacter } from './character-store'

type Mutable = Record<string, unknown>

/** 把 partial avatar 写回 identity.yaml — 必须与 loadSoul 用同一目录 */
export function saveAvatar(avatar: Partial<SoulConfig['avatar']>): { ok: boolean; path: string; reason?: string } {
  const paths = getPaths()
  // v0.17 修复：loadSoul 优先读 active character 的 soul（characterSoulDir），
  // 之前 saveAvatar 总是写全局 ~/.luvu/soul/identity.yaml — 读写错位，模型切换永远不生效。
  const active = getActiveCharacter()
  const targetDir = active ? characterSoulDir(active.id) : join(paths.userDataDir, 'soul')
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const targetFile = join(targetDir, 'identity.yaml')

  let current: Mutable = {}
  if (existsSync(targetFile)) {
    try {
      const raw = readFileSync(targetFile, 'utf-8')
      // v0.13 security: JSON_SCHEMA 防 !!js/* 注入
      const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
      if (parsed && typeof parsed === 'object') current = parsed as Mutable
    } catch (e) {
      return { ok: false, path: targetFile, reason: `parse failed: ${String(e)}` }
    }
  }

  const prevAvatar = (current.avatar ?? {}) as Mutable
  const nextAvatar: Mutable = { ...prevAvatar, ...avatar }
  const next: Mutable = { ...current, avatar: nextAvatar }

  try {
    const dir = dirname(targetFile)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(targetFile, yaml.dump(next, { indent: 2, lineWidth: 100 }), 'utf-8')
    return { ok: true, path: targetFile }
  } catch (e) {
    return { ok: false, path: targetFile, reason: String(e) }
  }
}
