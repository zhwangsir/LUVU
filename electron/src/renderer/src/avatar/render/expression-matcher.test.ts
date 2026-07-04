/**
 * Phase 1 P5 expression matcher 单元测试。
 */
import { describe, expect, it } from 'vitest'
import { listAliasesFor, matchExpression } from './expression-matcher'

describe('matchExpression', () => {
  it('精确匹配英文 (含 .exp3.json 后缀)', () => {
    expect(matchExpression('happy', ['happy.exp3.json', 'sad.exp3.json'])).toBe(
      'happy.exp3.json',
    )
  })

  it('精确匹配中文', () => {
    expect(matchExpression('happy', ['微笑.exp3.json', 'sad.exp3.json'])).toBe(
      '微笑.exp3.json',
    )
  })

  it('精确匹配 F 编号', () => {
    expect(matchExpression('happy', ['F01.exp3.json', 'F02.exp3.json'])).toBe(
      'F01.exp3.json',
    )
  })

  it('substring 兜底 (happy_smile)', () => {
    expect(matchExpression('happy', ['happy_smile.exp3.json'])).toBe('happy_smile.exp3.json')
  })

  it('大小写不敏感', () => {
    expect(matchExpression('HAPPY', ['Happy.exp3.json'])).toBe('Happy.exp3.json')
  })

  it('emotion 未注册 → 用原 string 当 alias 尝试匹配', () => {
    expect(matchExpression('custom_mood', ['custom_mood.exp3.json'])).toBe(
      'custom_mood.exp3.json',
    )
  })

  it('完全无匹配 → null', () => {
    expect(matchExpression('happy', ['xyz.exp3.json'])).toBeNull()
  })

  it('空 available 或 emotion → null', () => {
    expect(matchExpression('', ['a.exp3.json'])).toBeNull()
    expect(matchExpression(null, ['a.exp3.json'])).toBeNull()
    expect(matchExpression('happy', [])).toBeNull()
  })

  it('missing fallback 到 sad alias', () => {
    // missing 命中 sad 别名
    expect(matchExpression('missing', ['sad.exp3.json'])).toBe('sad.exp3.json')
    // missing 同时有自己的命名时优先用自己的
    expect(matchExpression('missing', ['missing.exp3.json', 'sad.exp3.json'])).toBe(
      'missing.exp3.json',
    )
  })

  it('calm/neutral 互为别名', () => {
    expect(matchExpression('calm', ['neutral.exp3.json'])).toBe('neutral.exp3.json')
    expect(matchExpression('neutral', ['calm.exp3.json'])).toBe('calm.exp3.json')
    expect(matchExpression('calm', ['F00.exp3.json'])).toBe('F00.exp3.json')
  })

  it('优先精确 > substring', () => {
    // happy 精确 vs happy_old substring — 应选精确
    expect(matchExpression('happy', ['happy_old.exp3.json', 'happy.exp3.json'])).toBe(
      'happy.exp3.json',
    )
  })

  it('substring 真正命中 (F00 在 some-F00-anim 中)', () => {
    expect(matchExpression('calm', ['some-F00-anim.exp3.json'])).toBe(
      'some-F00-anim.exp3.json',
    )
  })

  it('substring 不匹配 (F00 不在 F0X 中)', () => {
    expect(matchExpression('calm', ['something-F0X.exp3.json'])).toBeNull()
  })
})

describe('listAliasesFor', () => {
  it('已注册 emotion 返回 alias 列表', () => {
    expect(listAliasesFor('happy')).toContain('smile')
    expect(listAliasesFor('shy')).toContain('blush')
    expect(listAliasesFor('shy')).toContain('害羞')
  })

  it('未注册 → 空数组', () => {
    expect(listAliasesFor('whatever')).toEqual([])
  })

  it('case-insensitive', () => {
    expect(listAliasesFor('HAPPY')).toContain('smile')
  })
})
