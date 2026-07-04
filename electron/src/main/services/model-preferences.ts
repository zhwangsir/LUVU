/**
 * 模型个人偏好（v0.9）—— 按 character_id 持久化用户调过的 scale / offset_y。
 *
 * 文件：~/.luvu/model-preferences.json
 * key = character_id (从 model-scanner 的 mocBytes+skeletonFingerprint 哈希得到)
 * value = { scale, offset_y, last_used_at }
 *
 * 加载流程：
 *   1. renderer 加载模型前 → IPC 拿到该模型的 preferences
 *   2. 有 saved scale → 用它；无 → auto-fit canvas 85% 计算一次并存
 *   3. 用户在 dock 点 ⊕⊖ → 立刻 applyTransform + saveModelPreference(character_id, ...)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from './paths'

export interface ModelPreference {
  scale: number
  /** 立绘在画板内的水平偏移（相对画布中心，CSS px；正=右）。老 json 无此字段 → 读出 undefined → 渲染侧默认 0 */
  offset_x?: number
  offset_y: number
  last_used_at: number
}

interface PreferencesFile {
  version: 1
  prefs: Record<string, ModelPreference>
}

function filePath(): string {
  return join(getPaths().userDataDir, 'model-preferences.json')
}

function load(): PreferencesFile {
  const p = filePath()
  if (!existsSync(p)) return { version: 1, prefs: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PreferencesFile
  } catch {
    return { version: 1, prefs: {} }
  }
}

function save(f: PreferencesFile): void {
  try {
    writeFileSync(filePath(), JSON.stringify(f, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[model-prefs] save failed', e)
  }
}

export function getPreference(characterId: string): ModelPreference | null {
  if (!characterId) return null
  const f = load()
  return f.prefs[characterId] ?? null
}

export function setPreference(
  characterId: string,
  pref: Omit<ModelPreference, 'last_used_at'>,
): void {
  if (!characterId) return
  const f = load()
  f.prefs[characterId] = { ...pref, last_used_at: Date.now() }
  save(f)
}

export function allPreferences(): Record<string, ModelPreference> {
  return load().prefs
}
