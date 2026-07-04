/**
 * v0.16 T2: 8 标准 expression 模板 — 一键给模型加全套表情。
 *
 * 基于 Live2D Cubism 行业标准参数命名（ParamMouthForm/EyeLOpen 等）。
 * 每个表情 = .exp3.json 文件（Parameters 数组 + Blend 类型）。
 *
 * Blend Add (加上 base) 是最安全的，不会跟 motion / breath / lipsync 冲突。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EmotionId } from '@shared/types'

interface Exp3Parameter {
  Id: string
  Value: number
  Blend: 'Add' | 'Multiply' | 'Overwrite'
}

interface Exp3File {
  Type: 'Live2D Expression'
  Parameters: Exp3Parameter[]
}

const STANDARD_EXPRESSIONS: Record<EmotionId, Exp3File> = {
  neutral: {
    Type: 'Live2D Expression',
    Parameters: [],
  },
  happy: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: 0.7, Blend: 'Add' },
      { Id: 'ParamMouthOpenY', Value: 0.15, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamCheek', Value: 0.4, Blend: 'Add' },
    ],
  },
  sad: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: -0.5, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: -0.5, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: -0.5, Blend: 'Add' },
      { Id: 'ParamBrowLAngle', Value: -0.5, Blend: 'Add' },
      { Id: 'ParamBrowRAngle', Value: 0.5, Blend: 'Add' },
      { Id: 'ParamEyeLOpen', Value: -0.2, Blend: 'Add' },
      { Id: 'ParamEyeROpen', Value: -0.2, Blend: 'Add' },
    ],
  },
  angry: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: -0.7, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: -1.0, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: -1.0, Blend: 'Add' },
      { Id: 'ParamBrowLAngle', Value: 1.0, Blend: 'Add' },
      { Id: 'ParamBrowRAngle', Value: -1.0, Blend: 'Add' },
    ],
  },
  surprise: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthOpenY', Value: 0.7, Blend: 'Add' },
      { Id: 'ParamEyeLOpen', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamEyeROpen', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: 0.7, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: 0.7, Blend: 'Add' },
    ],
  },
  shy: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamEyeLOpen', Value: -0.3, Blend: 'Add' },
      { Id: 'ParamEyeROpen', Value: -0.3, Blend: 'Add' },
      { Id: 'ParamEyeBallY', Value: -0.3, Blend: 'Add' },
      { Id: 'ParamCheek', Value: 1.0, Blend: 'Add' },
      { Id: 'ParamAngleY', Value: -10, Blend: 'Add' },
    ],
  },
  tease: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: 0.5, Blend: 'Add' },
      { Id: 'ParamEyeLOpen', Value: -0.2, Blend: 'Add' },
      { Id: 'ParamEyeROpen', Value: -0.2, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamCheek', Value: 0.3, Blend: 'Add' },
      { Id: 'ParamAngleZ', Value: 8, Blend: 'Add' },
    ],
  },
  sleepy: {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamEyeLOpen', Value: -0.7, Blend: 'Add' },
      { Id: 'ParamEyeROpen', Value: -0.7, Blend: 'Add' },
      { Id: 'ParamMouthOpenY', Value: 0.2, Blend: 'Add' },
      { Id: 'ParamBrowLY', Value: -0.3, Blend: 'Add' },
      { Id: 'ParamBrowRY', Value: -0.3, Blend: 'Add' },
      { Id: 'ParamAngleZ', Value: 10, Blend: 'Add' },
    ],
  },
}

export const STANDARD_EXPRESSION_NAMES: EmotionId[] = [
  'neutral', 'happy', 'sad', 'angry', 'surprise', 'shy', 'tease', 'sleepy',
]

/**
 * 给模型应用 8 标准 expression — 在 expressions/ 目录下创建 .exp3.json
 * + 更新 model3.json 的 FileReferences.Expressions。
 * 已存在同名 expression 不覆盖。
 */
export async function applyStandardExpressionPack(modelDir: string): Promise<{
  ok: boolean
  added: EmotionId[]
  skipped: EmotionId[]
  reason?: string
}> {
  const expDir = join(modelDir, 'expressions')
  if (!existsSync(expDir)) mkdirSync(expDir, { recursive: true })

  const added: EmotionId[] = []
  const skipped: EmotionId[] = []

  for (const name of STANDARD_EXPRESSION_NAMES) {
    const fileName = `${name}.exp3.json`
    const filePath = join(expDir, fileName)
    if (existsSync(filePath)) {
      skipped.push(name)
      continue
    }
    try {
      writeFileSync(filePath, JSON.stringify(STANDARD_EXPRESSIONS[name], null, 2), 'utf-8')
      if (addExpressionToModel3(modelDir, name, `expressions/${fileName}`)) {
        added.push(name)
      }
    } catch {
      /* skip 单项错误 */
    }
  }

  return { ok: true, added, skipped }
}

function addExpressionToModel3(modelDir: string, name: string, relPath: string): boolean {
  // 复用 model-auto-fill 同样逻辑：找 model3.json + 加 Expressions 引用
  const { readdirSync, readFileSync, writeFileSync: wfs } = require('node:fs') as typeof import('node:fs')
  try {
    const files = readdirSync(modelDir)
    const m3 = files.find((f) => /\.model3\.json$/i.test(f))
    if (!m3) return false
    const m3Path = join(modelDir, m3)
    const json = JSON.parse(readFileSync(m3Path, 'utf-8')) as {
      FileReferences?: { Expressions?: Array<{ File: string; Name?: string }> }
    }
    json.FileReferences = json.FileReferences ?? {}
    json.FileReferences.Expressions = json.FileReferences.Expressions ?? []
    // 不重复加同名
    if (json.FileReferences.Expressions.some((e) => e.Name === name || e.File === relPath)) {
      return false
    }
    json.FileReferences.Expressions.push({ Name: name, File: relPath })
    wfs(m3Path, JSON.stringify(json, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
