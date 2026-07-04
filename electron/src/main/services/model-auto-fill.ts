/**
 * v0.15 E2: 模型自动补全工坊升级
 *
 * 把 E1 的 evaluateModel 缺失报告 + 现有 motion-factory + model-healer
 * 串成一键 fillMissing 流程：
 * 1. evaluateModel → 拿 missing_motion_groups + missing_expression_names
 * 2. 对每个 missing motion，调 motion-factory 生成 motion3.json
 * 3. 写文件 + 更新 model3.json FileReferences.Motions
 * 4. 进度通过 onProgress 回调推到 renderer
 *
 * 这是个长任务（每 motion LLM 30-60s × N 个），需要 abort 信号。
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { evaluateModel } from './model-learnings'
import { generateMotion } from './motion-factory/llm-generate'
import { draftToMotion3Json, summarizeModelMotions } from './motion-factory/parser'

export interface FillProgress {
  total: number
  done: number
  current?: string
  message?: string
  failed?: string[]
}

export interface FillResult {
  ok: boolean
  added_motions: string[]
  added_expressions: string[]
  failed: string[]
  reason?: string
}

/**
 * Auto-fill missing motion groups for a model.
 * 现在版本是 stub — 实际接 motion-factory 需要 1-2 小时完整实现。
 * MVP: 框架 + 进度协议 ready，留 fillSingleMotion 给后续实现。
 */
export async function fillMissingForModel(
  modelPath: string,
  options: { skip_expressions?: boolean; signal?: AbortSignal } = {},
  onProgress: (p: FillProgress) => void = () => {},
): Promise<FillResult> {
  const report = evaluateModel(modelPath)
  if (!report) {
    return { ok: false, added_motions: [], added_expressions: [], failed: [], reason: 'evaluate failed' }
  }

  const missingMotions = report.missing_motion_groups
  const missingExps = options.skip_expressions ? [] : report.missing_expression_names
  const total = missingMotions.length + missingExps.length

  if (total === 0) {
    return {
      ok: true,
      added_motions: [],
      added_expressions: [],
      failed: [],
      reason: '该模型已经包含所有行业标准 motion / expression',
    }
  }

  onProgress({ total, done: 0, message: `准备补 ${missingMotions.length} motion + ${missingExps.length} expression` })

  const added_motions: string[] = []
  const added_expressions: string[] = []
  const failed: string[] = []

  const modelDir = dirname(modelPath)

  // Motion 生成 — 暂用模板 placeholder（v0.15.1 接 motion-factory 完整 LLM 生成）
  for (let i = 0; i < missingMotions.length; i++) {
    if (options.signal?.aborted) {
      return { ok: false, added_motions, added_expressions, failed, reason: 'aborted' }
    }
    const group = missingMotions[i]!
    onProgress({ total, done: i, current: group, message: `生成 motion: ${group}` })

    try {
      const ok = await generatePlaceholderMotion(modelDir, group)
      if (ok) added_motions.push(group)
      else failed.push(group)
    } catch (e) {
      failed.push(`${group}: ${String(e).slice(0, 50)}`)
    }
  }

  // Expression — 同样占位（待 LLM 接入）
  for (let i = 0; i < missingExps.length; i++) {
    if (options.signal?.aborted) break
    const expName = missingExps[i]!
    onProgress({
      total,
      done: missingMotions.length + i,
      current: expName,
      message: `生成 expression: ${expName}`,
    })
    try {
      const ok = await generatePlaceholderExpression(modelDir, expName)
      if (ok) added_expressions.push(expName)
      else failed.push(`exp:${expName}`)
    } catch (e) {
      failed.push(`exp:${expName}: ${String(e).slice(0, 50)}`)
    }
  }

  onProgress({
    total,
    done: total,
    message: `完成 — 补 ${added_motions.length} motion + ${added_expressions.length} expression，${failed.length} 失败`,
    failed,
  })

  return {
    ok: failed.length === 0 || added_motions.length + added_expressions.length > 0,
    added_motions,
    added_expressions,
    failed,
  }
}

/**
 * v0.16 T1: 真用 LLM (motion-factory) 生成有意义的 motion，不再 placeholder。
 * 失败时 fallback 到简单占位。
 */
async function generatePlaceholderMotion(modelDir: string, groupName: string): Promise<boolean> {
  const motionDir = join(modelDir, 'motions')
  if (!existsSync(motionDir)) mkdirSync(motionDir, { recursive: true })
  const fileName = `${groupName.toLowerCase()}_auto.motion3.json`
  const filePath = join(motionDir, fileName)
  if (existsSync(filePath)) return false

  // v0.16: 先尝试 LLM 生成真有意义的 motion
  try {
    const summary = summarizeModelMotions(modelDir)
    const description = motionDescriptionFor(groupName)
    const draft = await generateMotion({
      summary,
      description,
      examples: 2,
    })
    const motion3Json = draftToMotion3Json(draft)
    writeFileSync(filePath, motion3Json, 'utf-8')
    return addToModel3References(modelDir, 'Motions', groupName, `motions/${fileName}`)
  } catch (e) {
    console.warn(`[auto-fill] LLM 生成失败 ${groupName}，fallback 占位:`, String(e).slice(0, 100))
    // Fallback: 最简 placeholder
    const motion3 = {
      Version: 3,
      Meta: {
        Duration: 2.0,
        Fps: 30,
        Loop: true,
        CurveCount: 1,
        TotalSegmentCount: 1,
        TotalPointCount: 2,
        AreBeziersRestricted: true,
      },
      Curves: [
        { Target: 'Parameter', Id: 'ParamAngleY', Segments: [0, 0, 0, 2, 0] },
      ],
      UserData: [{ Time: 0, Value: `auto-filled placeholder for ${groupName}` }],
    }
    writeFileSync(filePath, JSON.stringify(motion3, null, 2), 'utf-8')
    return addToModel3References(modelDir, 'Motions', groupName, `motions/${fileName}`)
  }
}

/** 把 motion group 名（Idle / Tap / Talk 等）翻译成 LLM prompt 描述 */
function motionDescriptionFor(groupName: string): string {
  const n = groupName.toLowerCase()
  if (n.includes('idle')) return '自然的待机动作，1-2 秒微微呼吸、轻轻晃头'
  if (n.includes('tap') || n.includes('touch')) return '被点击时的反应，1 秒身体微缩 + 表情变化'
  if (n.includes('talk') || n.includes('speak')) return '说话时的动作，2 秒嘴部张合 + 头部轻晃'
  if (n.includes('shy')) return '害羞时的动作，2 秒头偏 + 眼神向下'
  if (n.includes('angry')) return '生气时的动作，1.5 秒眉毛皱起 + 头部猛转'
  if (n.includes('happy') || n.includes('smile')) return '开心时的动作，2 秒微笑 + 头部轻摆'
  if (n.includes('sad') || n.includes('cry')) return '难过时的动作，2 秒头部下垂 + 眼神低落'
  if (n.includes('nod')) return '点头，1 秒头部 Y 轴上下动作'
  if (n.includes('shake')) return '摇头，1 秒头部 X 轴左右动作'
  return `${groupName} 主题的自然动作，1.5-3 秒`
}

async function generatePlaceholderExpression(modelDir: string, expName: string): Promise<boolean> {
  const expDir = join(modelDir, 'expressions')
  if (!existsSync(expDir)) mkdirSync(expDir, { recursive: true })
  const fileName = `${expName.toLowerCase()}_auto.exp3.json`
  const filePath = join(expDir, fileName)
  if (existsSync(filePath)) return false

  const exp3 = {
    Type: 'Live2D Expression',
    Parameters: [
      { Id: 'ParamMouthForm', Value: 0, Blend: 'Add' },
    ],
  }
  writeFileSync(filePath, JSON.stringify(exp3, null, 2), 'utf-8')

  return addToModel3References(modelDir, 'Expressions', expName, `expressions/${fileName}`)
}

function addToModel3References(
  modelDir: string,
  kind: 'Motions' | 'Expressions',
  name: string,
  relPath: string,
): boolean {
  // 找 model3.json
  try {
    const files = readdirSync(modelDir)
    const m3 = files.find((f) => /\.model3\.json$/i.test(f))
    if (!m3) return false
    const m3Path = join(modelDir, m3)
    const json = JSON.parse(readFileSync(m3Path, 'utf-8')) as {
      FileReferences?: {
        Motions?: Record<string, Array<{ File: string }>>
        Expressions?: Array<{ File: string; Name?: string }>
      }
    }
    json.FileReferences = json.FileReferences ?? {}
    if (kind === 'Motions') {
      json.FileReferences.Motions = json.FileReferences.Motions ?? {}
      json.FileReferences.Motions[name] = json.FileReferences.Motions[name] ?? []
      json.FileReferences.Motions[name].push({ File: relPath })
    } else {
      json.FileReferences.Expressions = json.FileReferences.Expressions ?? []
      json.FileReferences.Expressions.push({ Name: name, File: relPath })
    }
    writeFileSync(m3Path, JSON.stringify(json, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
