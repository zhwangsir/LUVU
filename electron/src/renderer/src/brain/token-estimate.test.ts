/**
 * token-estimate 单测 (UX R50)。
 */
import { describe, expect, it } from 'vitest'
import { estimateTokens } from './token-estimate'

describe('estimateTokens', () => {
  it('空字符串 → 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('纯中文 100 字 → 约 100 tokens', () => {
    const text = '你好世界'.repeat(25) // 100 字
    expect(estimateTokens(text)).toBe(100)
  })

  it('纯英文 → 1/4 字符', () => {
    const text = 'Hello world'.repeat(10) // 'Hello world' = 10 latin + 1 space = 11 chars
    // 100 latin + 10 space (other) → 100/4 + 10*0.3 = 25 + 3 = 28 → ceil(28)
    const r = estimateTokens(text)
    expect(r).toBeGreaterThan(20)
    expect(r).toBeLessThan(40)
  })

  it('日文平假名 → CJK 计数', () => {
    expect(estimateTokens('こんにちは')).toBe(5) // 5 个平假名
  })

  it('韩文 → CJK 计数', () => {
    expect(estimateTokens('안녕하세요')).toBe(5)
  })

  it('混合中英 → 加权和', () => {
    // 5 中文 + 4 英文 + 1 空格 → 5 + 4/4 + 1*0.3 = 5 + 1 + 0.3 = 6.3 → ceil → 7
    const text = '你好世界吗 hell'
    expect(estimateTokens(text)).toBe(7)
  })

  it('标点 emoji → 其他类 0.3 权重', () => {
    // 10 个标点 → 3 token
    expect(estimateTokens(',.;:!?@#$%')).toBe(3)
  })

  it('单字 → 至少 1', () => {
    expect(estimateTokens('a')).toBe(1) // ceil(0.25) = 1
    expect(estimateTokens('中')).toBe(1)
  })

  it('emoji 单字符 → 0 或 1 (其他类)', () => {
    expect(estimateTokens('🎉')).toBe(1) // ceil(0.3) = 1
  })

  it('1000 字纯中文 → 1000 tokens', () => {
    expect(estimateTokens('字'.repeat(1000))).toBe(1000)
  })
})
