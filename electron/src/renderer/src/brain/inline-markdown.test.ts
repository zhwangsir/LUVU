/**
 * inline-markdown 单测 (UX R51)。
 */
import { describe, expect, it } from 'vitest'
import { parseInlineMarkdown } from './inline-markdown'

describe('parseInlineMarkdown', () => {
  it('空字符串 → 空数组', () => {
    expect(parseInlineMarkdown('')).toEqual([])
  })

  it('纯文本 → 单 text 段', () => {
    expect(parseInlineMarkdown('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ])
  })

  it('单 bold → 拆 3 段', () => {
    expect(parseInlineMarkdown('hi **world** !')).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'bold', text: 'world' },
      { type: 'text', text: ' !' },
    ])
  })

  it('单 code → 拆 3 段', () => {
    expect(parseInlineMarkdown('run `npm test` now')).toEqual([
      { type: 'text', text: 'run ' },
      { type: 'code', text: 'npm test' },
      { type: 'text', text: ' now' },
    ])
  })

  it('bold + code 混合', () => {
    expect(parseInlineMarkdown('**hi** and `code`')).toEqual([
      { type: 'bold', text: 'hi' },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'code' },
    ])
  })

  it('开头 bold', () => {
    expect(parseInlineMarkdown('**bold** rest')).toEqual([
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' rest' },
    ])
  })

  it('结尾 bold', () => {
    expect(parseInlineMarkdown('prefix **end**')).toEqual([
      { type: 'text', text: 'prefix ' },
      { type: 'bold', text: 'end' },
    ])
  })

  it('未闭合的 ** → 当 plain text', () => {
    expect(parseInlineMarkdown('hello **world')).toEqual([
      { type: 'text', text: 'hello **world' },
    ])
  })

  it('未闭合的 ` → 当 plain text', () => {
    expect(parseInlineMarkdown('hello `world')).toEqual([
      { type: 'text', text: 'hello `world' },
    ])
  })

  it('空 ** → 不算 bold', () => {
    expect(parseInlineMarkdown('a ****b')).toEqual([
      { type: 'text', text: 'a ****b' },
    ])
  })

  it('空 `` → 不算 code', () => {
    expect(parseInlineMarkdown('a ``b')).toEqual([
      { type: 'text', text: 'a ``b' },
    ])
  })

  it('不支持嵌套 — **`code`** 被解析为 bold {`code`}', () => {
    expect(parseInlineMarkdown('**`code`**')).toEqual([
      { type: 'bold', text: '`code`' },
    ])
  })

  it('多 bold 串联', () => {
    expect(parseInlineMarkdown('**a** **b** **c**')).toEqual([
      { type: 'bold', text: 'a' },
      { type: 'text', text: ' ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'bold', text: 'c' },
    ])
  })

  it('中文 bold', () => {
    expect(parseInlineMarkdown('你好 **世界** 啊')).toEqual([
      { type: 'text', text: '你好 ' },
      { type: 'bold', text: '世界' },
      { type: 'text', text: ' 啊' },
    ])
  })

  it('HTML 字符不被特殊处理 (依赖 Vue 模板插值 escape)', () => {
    const r = parseInlineMarkdown('hello <script>alert(1)</script>')
    // 不解析也不转义 — 纯文本片段, Vue 渲染时会 HTML escape
    expect(r).toEqual([{ type: 'text', text: 'hello <script>alert(1)</script>' }])
  })
})
