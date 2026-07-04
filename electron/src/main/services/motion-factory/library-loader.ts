/**
 * 加载 motion-library/*.yaml 模板，缓存到内存。
 *
 * 路径优先级：
 *   1. ~/.luvu/motion-library/  (用户自定义，最高)
 *   2. electron/resources/motion-library/  (内置)
 *
 * 用户可以放自己写的 yaml 模板进 ~/.luvu/motion-library/ 扩展。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { app } from 'electron'
import type { LibrarySummary, MotionTemplate } from '@shared/motion-library'
import { getPaths } from '../paths'

let cache: Map<string, MotionTemplate> | null = null

function builtinDir(): string {
  // 开发：__dirname = out/main → ../../resources/motion-library
  // 生产：__dirname = resources/app.asar/out/main → ../../resources/motion-library
  //       但 asarUnpack 后 resources 在 process.resourcesPath
  if (app.isPackaged) {
    return join(process.resourcesPath, 'motion-library')
  }
  return resolve(__dirname, '..', '..', 'resources', 'motion-library')
}

function userDir(): string {
  return join(getPaths().userDataDir, 'motion-library')
}

function ensureUserDir(): void {
  const d = userDir()
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

/** 强制重新加载所有模板（用户修改 yaml 后调） */
export function reload(): Map<string, MotionTemplate> {
  cache = new Map()
  ensureUserDir()
  // 先加载内置
  loadDir(builtinDir(), cache, 'builtin')
  // 再加载用户（同 id 覆盖内置 — 允许用户改写）
  loadDir(userDir(), cache, 'user')
  return cache
}

function loadDir(dir: string, into: Map<string, MotionTemplate>, source: 'builtin' | 'user'): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue
    const full = join(dir, entry)
    try {
      const raw = readFileSync(full, 'utf-8')
      // v0.13 security: JSON_SCHEMA 防 !!js/* 注入
      const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as unknown
      if (!parsed || typeof parsed !== 'object') continue
      const t = parsed as MotionTemplate
      // 基本验证
      if (!t.id || !t.duration || !Array.isArray(t.tracks)) continue
      into.set(t.id, t)
    } catch (e) {
      console.warn(`[motion-library] failed to load ${source}/${entry}:`, e)
    }
  }
}

export function ensureLoaded(): Map<string, MotionTemplate> {
  if (!cache) reload()
  return cache!
}

export function list(): MotionTemplate[] {
  return [...ensureLoaded().values()]
}

export function get(id: string): MotionTemplate | undefined {
  return ensureLoaded().get(id)
}

export function summary(): LibrarySummary {
  const all = list()
  const byTag: Record<string, number> = {}
  const byEmotion: Record<string, number> = {}
  for (const t of all) {
    for (const tag of t.tags) byTag[tag] = (byTag[tag] ?? 0) + 1
    for (const e of t.emotions ?? []) byEmotion[e] = (byEmotion[e] ?? 0) + 1
  }
  return {
    total: all.length,
    by_tag: byTag,
    by_emotion: byEmotion,
    templates: all.map((t) => ({
      id: t.id,
      display_name_zh: t.display_name_zh,
      duration: t.duration,
      loop: t.loop,
      tags: t.tags,
      emotions: t.emotions ?? [],
      required_semantics: t.required_semantics ?? [],
    })),
  }
}
