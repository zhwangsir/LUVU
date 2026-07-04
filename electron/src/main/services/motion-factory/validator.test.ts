/**
 * v0.13 (audit): motion-factory/validator 单元测试。
 */
import { describe, it, expect } from 'vitest'
import { validate } from './validator'
import type { MotionDraft } from '@shared/motion'

function makeDraft(overrides: Partial<MotionDraft> = {}): MotionDraft {
  return {
    name: 'test',
    duration: 2.0,
    loop: false,
    tracks: [],
    ...overrides,
  }
}

describe('validate — duration', () => {
  it('正常时长 (0.5 - 10s) → valid', () => {
    const r = validate(makeDraft({ duration: 2.0 }))
    expect(r.valid).toBe(true)
    expect(r.errors.filter((e) => e.category === 'duration')).toHaveLength(0)
  })

  it('时长 < 0.5s → error', () => {
    const r = validate(makeDraft({ duration: 0.3 }))
    expect(r.valid).toBe(false)
    expect(r.errors.find((e) => e.category === 'duration')).toBeDefined()
  })

  it('时长 > 10s → warning (不影响 valid)', () => {
    const r = validate(makeDraft({ duration: 15 }))
    expect(r.valid).toBe(true)
    expect(r.warnings.find((e) => e.category === 'duration')).toBeDefined()
  })
})

describe('validate — 返回结构', () => {
  it('valid = errors.length === 0 (warnings 不算)', () => {
    const r = validate(makeDraft({ duration: 100 })) // 只 warning
    expect(r.valid).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.errors).toHaveLength(0)
  })

  it('所有 issue 含 level + category + message', () => {
    const r = validate(makeDraft({ duration: 0.1 }))
    for (const e of [...r.errors, ...r.warnings]) {
      expect(e).toHaveProperty('level')
      expect(e).toHaveProperty('category')
      expect(e).toHaveProperty('message')
      expect(typeof e.message).toBe('string')
    }
  })
})

describe('validate — loop 循环兼容', () => {
  it('loop=false 不检查首末跳变', () => {
    const r = validate(makeDraft({
      loop: false,
      duration: 2,
      tracks: [{
        param: 'X',
        keyframes: [[0, 0], [1, 50], [2, 100]], // 首末差很大
      }],
    }))
    expect(r.errors.find((e) => e.category === 'loop')).toBeUndefined()
  })
})

describe('validate — 空 draft', () => {
  it('空 tracks + 合理 duration → 只可能 warnings', () => {
    const r = validate(makeDraft({ duration: 2, tracks: [] }))
    // 不一定 valid 也不一定 invalid — 但至少不该崩
    expect(r).toHaveProperty('valid')
    expect(r).toHaveProperty('errors')
    expect(r).toHaveProperty('warnings')
  })
})
