/**
 * 简单的运行时测试 — 在 IPC handler 里调一次，把结果 console.log，便于 dev 调试。
 * 不是正式单元测试（v0.7.3 加 vitest）。
 */
import { introspect } from './parameter-introspector'

export function dumpIntrospection(modelDir: string): string {
  const result = introspect(modelDir)
  const lines: string[] = []
  lines.push(`# Introspection: ${modelDir}`)
  lines.push(`Overall confidence: ${(result.confidence * 100).toFixed(1)}%`)
  lines.push(`Total params: ${result.params.length}`)
  lines.push('')
  lines.push('## By semantic')
  for (const [sem, list] of Object.entries(result.by_semantic)) {
    if (!list) continue
    lines.push(`- **${sem}**: ${list.map((p) => `${p.param_id} (${(p.confidence * 100).toFixed(0)}%)`).join(', ')}`)
  }
  lines.push('')
  lines.push('## Unknown params (sorted by usage in cooccurs)')
  const unknowns = result.params.filter((p) => p.semantic === 'unknown')
  for (const u of unknowns.slice(0, 20)) {
    lines.push(`- ${u.param_id} : range ${u.range.min.toFixed(1)}~${u.range.max.toFixed(1)} : 协同 ${u.cooccurs_with.length} 个`)
  }
  return lines.join('\n')
}
