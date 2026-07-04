/**
 * highlight-match 单测 (UX R81)。
 */
import { describe, expect, it } from 'vitest'
import { highlightMatch } from './highlight-match'

describe('highlightMatch', () => {
  it('空 text → 空', () => {
    expect(highlightMatch('', 'x')).toEqual([])
  })

  it('空 query → 整段未匹配', () => {
    expect(highlightMatch('hello', '')).toEqual([{ text: 'hello', matched: false }])
    expect(highlightMatch('hello', '   ')).toEqual([{ text: 'hello', matched: false }])
  })

  it('无匹配 → 整段未匹配', () => {
    expect(highlightMatch('hello', 'xyz')).toEqual([{ text: 'hello', matched: false }])
  })

  it('中间匹配 → 3 段', () => {
    expect(highlightMatch('hello world', 'lo')).toEqual([
      { text: 'hel', matched: false },
      { text: 'lo', matched: true },
      { text: ' world', matched: false },
    ])
  })

  it('开头匹配 → 2 段', () => {
    expect(highlightMatch('hello world', 'hel')).toEqual([
      { text: 'hel', matched: true },
      { text: 'lo world', matched: false },
    ])
  })

  it('结尾匹配 → 2 段', () => {
    expect(highlightMatch('hello world', 'world')).toEqual([
      { text: 'hello ', matched: false },
      { text: 'world', matched: true },
    ])
  })

  it('全匹配 → 1 段', () => {
    expect(highlightMatch('foo', 'foo')).toEqual([{ text: 'foo', matched: true }])
  })

  it('大小写不敏感', () => {
    expect(highlightMatch('Hello', 'ell')).toEqual([
      { text: 'H', matched: false },
      { text: 'ell', matched: true },
      { text: 'o', matched: false },
    ])
  })

  it('中文匹配', () => {
    expect(highlightMatch('打开设置', '设置')).toEqual([
      { text: '打开', matched: false },
      { text: '设置', matched: true },
    ])
  })

  it('仅匹配第一次出现 (不重复匹配)', () => {
    expect(highlightMatch('foo foo', 'foo')).toEqual([
      { text: 'foo', matched: true },
      { text: ' foo', matched: false },
    ])
  })

  it('R86-fix: 大小写不同长度时 slice 不越界 (土耳其 İ)', () => {
    // 'İ'.toLowerCase() = 'i̇' (i + combining dot, length 2)
    // 用 qLower.length 才能正确切; 用 q.length=1 会越界吞下一个字符
    const r = highlightMatch('aİb', 'İ')
    // 至少 matched 段是 'İ' (或 lower 后等价), 不应吞 'b'
    const matchedSeg = r.find((s) => s.matched)
    expect(matchedSeg).toBeDefined()
    // 'b' 必须保留在未匹配段
    const after = r[r.length - 1]
    expect(after?.text).toContain('b')
  })
})
