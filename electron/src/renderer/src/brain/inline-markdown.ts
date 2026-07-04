/**
 * R51: 极简 inline markdown 渲染 — 支持 **bold** / `code` 两种语法。
 *
 * 设计原则:
 *   - 不引依赖 (markdown-it / marked 都太重)
 *   - 不支持块级 / link / image / html — 防 XSS 滥用 + 桌宠场景用不上
 *   - 通过 Vue 模板插值渲染段, 自动 HTML escape 不用 v-html
 *   - 故意不支持嵌套 (**`code`**)，简化解析
 *
 * 用法:
 *   const segs = parseInlineMarkdown('hello **world** and `code`')
 *   // → [{type:'text', text:'hello '}, {type:'bold', text:'world'},
 *   //    {type:'text', text:' and '}, {type:'code', text:'code'}]
 */

export type InlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }

/**
 * 顺序扫描, 优先匹配最近的 ** 或 `, 不嵌套。
 * 不完整标记 (单 ** 或 `) 当 plain text 留下。
 */
export function parseInlineMarkdown(input: string): InlineSegment[] {
  const out: InlineSegment[] = []
  if (!input) return out

  let i = 0
  let buf = ''

  function flushBuf(): void {
    if (buf.length > 0) {
      out.push({ type: 'text', text: buf })
      buf = ''
    }
  }

  while (i < input.length) {
    // 匹配 **bold**
    if (input[i] === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2)
      if (end !== -1 && end > i + 2) {
        flushBuf()
        out.push({ type: 'bold', text: input.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    // 匹配 `code`
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1)
      if (end !== -1 && end > i + 1) {
        flushBuf()
        out.push({ type: 'code', text: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    buf += input[i]
    i++
  }
  flushBuf()
  return out
}
