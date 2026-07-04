/**
 * Soul Config Diff — 字段级 before/after 对比 (P5)。
 *
 * 跟 K 评测形成完整闭环:
 *   K = "LLM 对当前 soul 的保真度量化" (drift detection)
 *   diff = "用户改了 soul 什么字段" (变化可观察)
 *   合一起 = 改 soul → 看 diff → 跑 K → 量化改动对 LLM 行为的影响
 *
 * 纯函数 — 不读 fs，输入两个 SoulConfig 输出 SoulDiff 结构。
 */
import type { SoulConfig } from './types'

export type ChangeKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  /** 字段路径 — 形如 'speech_style.catchphrases' */
  path: string
  kind: ChangeKind
  before?: unknown
  after?: unknown
}

export interface SoulDiff {
  changes: FieldChange[]
  /** 简要 summary — 给 UI / commit message 用 */
  summary: string
}

/** 深度比较两个值是否相等（处理 array / object / primitive） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const k of keys) {
    if (!deepEqual(aObj[k], bObj[k])) return false
  }
  return true
}

/**
 * 递归对比两个对象，产出字段级变化列表。
 * - 都有但值不同 → 'changed'
 * - before 没 after 有 → 'added'
 * - before 有 after 没 → 'removed'
 * - 嵌套对象继续递归（path 用 '.' 连接）
 * - array 当作整体比较（不做 element-level diff，避免噪音）
 */
function walkDiff(
  before: unknown,
  after: unknown,
  pathPrefix: string,
  out: FieldChange[],
): void {
  if (deepEqual(before, after)) return

  // 任一非对象/array 当 leaf 比较
  const isLeaf = (v: unknown): boolean =>
    v === null ||
    v === undefined ||
    typeof v !== 'object' ||
    Array.isArray(v)

  if (isLeaf(before) || isLeaf(after)) {
    out.push({ path: pathPrefix, kind: 'changed', before, after })
    return
  }

  const aObj = before as Record<string, unknown>
  const bObj = after as Record<string, unknown>
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const k of keys) {
    const subPath = pathPrefix ? `${pathPrefix}.${k}` : k
    const av = aObj[k]
    const bv = bObj[k]
    if (av === undefined && bv !== undefined) {
      out.push({ path: subPath, kind: 'added', after: bv })
    } else if (bv === undefined && av !== undefined) {
      out.push({ path: subPath, kind: 'removed', before: av })
    } else {
      walkDiff(av, bv, subPath, out)
    }
  }
}

/** 对比两个 SoulConfig，返回 SoulDiff */
export function diffSoulConfigs(before: SoulConfig, after: SoulConfig): SoulDiff {
  const changes: FieldChange[] = []
  walkDiff(before, after, '', changes)

  const counts = { added: 0, changed: 0, removed: 0 }
  for (const c of changes) counts[c.kind] += 1

  const summaryParts: string[] = []
  if (counts.added > 0) summaryParts.push(`+${counts.added} 新增`)
  if (counts.changed > 0) summaryParts.push(`~${counts.changed} 修改`)
  if (counts.removed > 0) summaryParts.push(`-${counts.removed} 删除`)
  const summary =
    summaryParts.length > 0
      ? `${summaryParts.join(' / ')}（共 ${changes.length} 处）`
      : '无变化'

  return { changes, summary }
}

/** 给一个值生成短文本形式（用于 UI 单行显示） */
export function shortValue(v: unknown, maxLen = 60): string {
  if (v === null) return 'null'
  if (v === undefined) return '(无)'
  if (typeof v === 'string') {
    return v.length > maxLen ? `"${v.slice(0, maxLen)}..."` : `"${v}"`
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const s = `[${v.length} 项]`
    if (v.length <= 4) {
      const inner = v.map((x) => shortValue(x, 20)).join(', ')
      return inner.length < maxLen ? `[${inner}]` : s
    }
    return s
  }
  if (typeof v === 'object') {
    return `{${Object.keys(v as object).length} 字段}`
  }
  return String(v)
}

/** 把 SoulDiff 渲染成可读多行文本（commit message / debug log 用） */
export function renderDiff(diff: SoulDiff): string {
  if (diff.changes.length === 0) return '(soul 无变化)'
  const lines = [diff.summary, '']
  for (const c of diff.changes) {
    const symbol = c.kind === 'added' ? '+' : c.kind === 'removed' ? '-' : '~'
    if (c.kind === 'added') {
      lines.push(`${symbol} ${c.path}: ${shortValue(c.after)}`)
    } else if (c.kind === 'removed') {
      lines.push(`${symbol} ${c.path}: ${shortValue(c.before)}`)
    } else {
      lines.push(`${symbol} ${c.path}: ${shortValue(c.before)} → ${shortValue(c.after)}`)
    }
  }
  return lines.join('\n')
}
