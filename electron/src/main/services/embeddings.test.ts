import { describe, expect, it } from 'vitest'
import { cosineSim } from './embeddings'

describe('cosineSim', () => {
  it('相同向量 → 1', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
  })
  it('正交向量 → 0', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })
  it('反向向量 → -1', () => {
    expect(cosineSim([1, 2], [-1, -2])).toBeCloseTo(-1, 6)
  })
  it('长度不一致（真/hash 混用）→ 0 安全降级', () => {
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0)
  })
  it('空向量 / 零向量 → 0', () => {
    expect(cosineSim([], [])).toBe(0)
    expect(cosineSim([0, 0], [0, 0])).toBe(0)
  })
})
