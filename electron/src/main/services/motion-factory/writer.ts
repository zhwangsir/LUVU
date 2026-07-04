/**
 * 把新生成的 motion3.json 写入模型目录 + 更新 model3.json 的 Motions 引用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MotionDraft } from '@shared/motion'
import { draftToMotion3Json } from './parser'

interface RawModel3 {
  Version: number
  FileReferences: {
    Moc: string
    Motions?: Record<string, Array<{ File: string; Name?: string }>>
    [k: string]: unknown
  }
  [k: string]: unknown
}

export interface WriteResult {
  ok: boolean
  motion_path?: string
  motion_relative?: string
  group?: string
  reason?: string
}

/**
 * @param modelJsonPath  绝对路径 .../foo.model3.json
 * @param draft          LLM 生成的高层动作
 * @param group          要写入的 motion group 名（默认 'Generated'）
 */
export function writeMotion(
  modelJsonPath: string,
  draft: MotionDraft,
  group = 'Generated',
): WriteResult {
  if (!existsSync(modelJsonPath)) {
    return { ok: false, reason: `model3.json 不存在：${modelJsonPath}` }
  }
  let model: RawModel3
  try {
    model = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as RawModel3
  } catch (e) {
    return { ok: false, reason: `model3.json 解析失败：${String(e)}` }
  }

  const base = dirname(modelJsonPath)
  const motionsDir = join(base, 'motions')
  mkdirSync(motionsDir, { recursive: true })

  // 文件名 dedup
  let fileName = sanitize(draft.name) + '.motion3.json'
  let i = 2
  while (existsSync(join(motionsDir, fileName))) {
    fileName = `${sanitize(draft.name)}-${i}.motion3.json`
    i++
    if (i > 100) return { ok: false, reason: 'too many dups' }
  }
  const motionPath = join(motionsDir, fileName)
  const relative = `motions/${fileName}`

  try {
    writeFileSync(motionPath, draftToMotion3Json(draft), 'utf-8')
  } catch (e) {
    return { ok: false, reason: `写 motion 失败：${String(e)}` }
  }

  // 更新 model3.json 的 Motions
  if (!model.FileReferences.Motions) model.FileReferences.Motions = {}
  if (!model.FileReferences.Motions[group]) model.FileReferences.Motions[group] = []
  model.FileReferences.Motions[group].push({ File: relative, Name: draft.name })

  try {
    writeFileSync(modelJsonPath, JSON.stringify(model, null, 2), 'utf-8')
  } catch (e) {
    return { ok: false, reason: `更新 model3.json 失败：${String(e)}` }
  }

  return { ok: true, motion_path: motionPath, motion_relative: relative, group }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) || 'generated'
}
