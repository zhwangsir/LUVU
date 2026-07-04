/**
 * v0.16 T4: 参数命名标准化检测。
 *
 * **重要限制**：参数名定义在 .moc3 二进制里，由 Cubism Editor 决定。
 * 改 motion3/exp3 里的引用名 = runtime 找不到参数 (因为 .moc3 内还是旧名)。
 * **真正的 rename 需要 Cubism Editor 重新导出 .moc3**。
 *
 * 所以这个 service 只做：
 * 1. 扫描模型从现有 motion3/exp3 抽出实际使用的参数名
 * 2. 用 heuristic + 行业标准对比，识别"非标准命名"
 * 3. LLM (可选) 推断每个非标准名「可能是什么功能」
 * 4. 输出报告 — 让用户知道这个模型的参数命名问题
 *
 * 实际 rename 留给用户在 Cubism Editor 手动改。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ParamUsage {
  /** 实际参数名（出现在 motion3 / exp3 里的） */
  param_id: string
  /** 引用它的 motion 文件数 */
  motion_refs: number
  /** 引用它的 expression 文件数 */
  expression_refs: number
  /** 值范围估算（motion 里看到的 min/max） */
  observed_min: number
  observed_max: number
  /** 是不是非标准命名 */
  non_standard: boolean
  /** 非标准原因 */
  reason?: string
  /** 建议的标准名（基于值范围 + 命名启发） */
  suggested_id?: string
}

const STANDARD_PARAM_NAMES = new Set([
  // 头部
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  // 眼睛
  'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY',
  'ParamEyeLSmile', 'ParamEyeRSmile',
  // 眉
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLX', 'ParamBrowRX',
  'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamBrowLForm', 'ParamBrowRForm',
  // 嘴
  'ParamMouthOpenY', 'ParamMouthForm',
  // 身体
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  // 呼吸 / 脸颊
  'ParamBreath', 'ParamCheek',
  // 头发 / 裙摆 (物理 output)
  'ParamHairFront', 'ParamHairSide', 'ParamHairBack', 'ParamHairLeft', 'ParamHairRight',
  'ParamSkirtFront', 'ParamSkirtBack', 'ParamSkirtLeft', 'ParamSkirtRight',
])

function isNonStandard(paramId: string): { non_standard: boolean; reason?: string } {
  if (STANDARD_PARAM_NAMES.has(paramId)) return { non_standard: false }
  // Param01 / Param99 类
  if (/^Param\d+$/i.test(paramId)) return { non_standard: true, reason: '纯数字后缀（如 Param01）' }
  // 全大写 / 蛇形（PARAM_XXX_01）
  if (/^[A-Z_]+\d*$/.test(paramId) && paramId.includes('_')) {
    return { non_standard: true, reason: '蛇形命名 (PARAM_XXX_01)' }
  }
  // 单字母或两字母
  if (paramId.length <= 2) return { non_standard: true, reason: '过短（不知什么意思）' }
  // 含中文
  if (/[一-龥]/.test(paramId)) return { non_standard: true, reason: '含中文（runtime 兼容性差）' }
  // 不以 Param 开头但又不在标准列表
  if (!paramId.startsWith('Param')) return { non_standard: true, reason: '不以 Param 开头（非约定）' }
  // 以 Param 开头但不在标准列表 — 可能是画师自定义（如 ParamFlower、ParamWing），算合理
  return { non_standard: false }
}

/** 启发式建议名 — 基于值范围 */
function suggestStandardName(usage: { param_id: string; observed_min: number; observed_max: number }): string | undefined {
  const range = usage.observed_max - usage.observed_min
  // 0-1 范围 → 可能是开度 / 强度
  if (usage.observed_min >= 0 && usage.observed_max <= 1.1) {
    if (/eye/i.test(usage.param_id)) return 'ParamEyeLOpen / ParamEyeROpen'
    if (/mouth/i.test(usage.param_id)) return 'ParamMouthOpenY'
    if (/cheek/i.test(usage.param_id)) return 'ParamCheek'
    return '0-1 范围 → 可能是 ParamEye*Open / ParamMouthOpenY / ParamCheek 之一'
  }
  // -1 到 1 → 表情形态
  if (usage.observed_min >= -1.1 && usage.observed_max <= 1.1 && range > 1) {
    if (/mouth/i.test(usage.param_id)) return 'ParamMouthForm'
    if (/brow/i.test(usage.param_id)) return 'ParamBrowL/RForm'
    return '-1~1 范围 → 可能是 ParamMouthForm / ParamBrowL/RForm'
  }
  // -30 到 30 → 角度
  if (usage.observed_min >= -45 && usage.observed_max <= 45 && range > 5) {
    if (/x$/i.test(usage.param_id) || /horiz/i.test(usage.param_id)) return 'ParamAngleX (头水平转)'
    if (/y$/i.test(usage.param_id) || /vert/i.test(usage.param_id)) return 'ParamAngleY (头垂直转)'
    if (/z$/i.test(usage.param_id) || /tilt/i.test(usage.param_id)) return 'ParamAngleZ (头倾斜)'
    return '±30 范围 → 可能是 ParamAngleX/Y/Z'
  }
  return undefined
}

/**
 * 扫一个模型目录，统计所有 motion + expression 引用的参数。
 */
export function analyzeModelParams(modelDir: string): {
  total_params: number
  non_standard_count: number
  usages: ParamUsage[]
} {
  const usagesMap = new Map<string, ParamUsage>()

  // 收集 motion3 引用
  const motionDir = join(modelDir, 'motions')
  if (existsSync(motionDir)) {
    walkAndScanMotions(motionDir, usagesMap)
  }

  // 收集 expression 引用
  const expDir = join(modelDir, 'expressions')
  if (existsSync(expDir)) {
    walkAndScanExpressions(expDir, usagesMap)
  }

  // 后处理：判定非标准 + 建议名
  for (const u of usagesMap.values()) {
    const check = isNonStandard(u.param_id)
    u.non_standard = check.non_standard
    if (check.reason !== undefined) u.reason = check.reason
    if (u.non_standard) {
      const sug = suggestStandardName(u)
      if (sug !== undefined) u.suggested_id = sug
    }
  }

  const usages = [...usagesMap.values()].sort((a, b) => {
    if (a.non_standard !== b.non_standard) return a.non_standard ? -1 : 1
    return b.motion_refs + b.expression_refs - (a.motion_refs + a.expression_refs)
  })

  return {
    total_params: usages.length,
    non_standard_count: usages.filter((u) => u.non_standard).length,
    usages,
  }
}

function walkAndScanMotions(dir: string, map: Map<string, ParamUsage>): void {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          walkAndScanMotions(full, map)
          continue
        }
        if (!/\.motion3\.json$/i.test(entry)) continue
        const raw = readFileSync(full, 'utf-8')
        const json = JSON.parse(raw) as {
          Curves?: Array<{ Target?: string; Id?: string; Segments?: number[] }>
        }
        for (const c of json.Curves ?? []) {
          if (c.Target !== 'Parameter' || !c.Id) continue
          const u = map.get(c.Id) ?? {
            param_id: c.Id,
            motion_refs: 0,
            expression_refs: 0,
            observed_min: Infinity,
            observed_max: -Infinity,
            non_standard: false,
          }
          u.motion_refs++
          // segments[1] = 起点值，再往后每 type=0 段 [type, time, value]
          const seg = c.Segments ?? []
          if (seg.length >= 2 && seg[1] !== undefined) {
            u.observed_min = Math.min(u.observed_min, seg[1])
            u.observed_max = Math.max(u.observed_max, seg[1])
          }
          for (let i = 2; i < seg.length; ) {
            const type = seg[i]
            if (type === 0 || type === 2 || type === 3) {
              const v = seg[i + 2]
              if (v !== undefined) {
                u.observed_min = Math.min(u.observed_min, v)
                u.observed_max = Math.max(u.observed_max, v)
              }
              i += 3
            } else if (type === 1) {
              const v = seg[i + 6]
              if (v !== undefined) {
                u.observed_min = Math.min(u.observed_min, v)
                u.observed_max = Math.max(u.observed_max, v)
              }
              i += 7
            } else i++
          }
          map.set(c.Id, u)
        }
      } catch { /* skip 单文件错误 */ }
    }
  } catch { /* skip dir 错误 */ }
}

function walkAndScanExpressions(dir: string, map: Map<string, ParamUsage>): void {
  try {
    for (const entry of readdirSync(dir)) {
      if (!/\.exp3\.json$/i.test(entry)) continue
      const full = join(dir, entry)
      try {
        const json = JSON.parse(readFileSync(full, 'utf-8')) as {
          Parameters?: Array<{ Id?: string; Value?: number }>
        }
        for (const p of json.Parameters ?? []) {
          if (!p.Id) continue
          const u = map.get(p.Id) ?? {
            param_id: p.Id,
            motion_refs: 0,
            expression_refs: 0,
            observed_min: Infinity,
            observed_max: -Infinity,
            non_standard: false,
          }
          u.expression_refs++
          if (p.Value !== undefined) {
            u.observed_min = Math.min(u.observed_min, p.Value)
            u.observed_max = Math.max(u.observed_max, p.Value)
          }
          map.set(p.Id, u)
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}
