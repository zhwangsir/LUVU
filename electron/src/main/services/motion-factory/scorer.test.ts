/**
 * v0.13 (audit): motion-factory/scorer 单元测试。
 * 评分纯函数，覆盖各维度边界。
 */
import { describe, it, expect } from 'vitest'
import { scoreMotion } from './scorer'
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

describe('scoreMotion — 整体', () => {
  it('空 draft 应返回 0~1 之间', () => {
    const r = scoreMotion(makeDraft())
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeLessThanOrEqual(1)
  })

  it('结果含所有 6 维度 + total + weights', () => {
    const r = scoreMotion(makeDraft())
    expect(r).toHaveProperty('smoothness')
    expect(r).toHaveProperty('param_diversity')
    expect(r).toHaveProperty('description_match')
    expect(r).toHaveProperty('range_usage')
    expect(r).toHaveProperty('loop_compatibility')
    expect(r).toHaveProperty('density')
    expect(r).toHaveProperty('total')
    expect(r).toHaveProperty('weights')
  })

  it('weights 应总和 1.0', () => {
    const r = scoreMotion(makeDraft())
    const sum = Object.values(r.weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 5)
  })
})

describe('scoreMotion — param_diversity', () => {
  it('0 参数 → diversity 0', () => {
    const r = scoreMotion(makeDraft({ tracks: [] }))
    expect(r.param_diversity).toBe(0)
  })

  it('单参数 → diversity 较低', () => {
    const r = scoreMotion(makeDraft({
      tracks: [{ param: 'ParamX', keyframes: [[0, 0], [1, 1]] }],
    }))
    expect(r.param_diversity).toBeLessThanOrEqual(0.3)
  })

  it('6+ 参数 → diversity 满分', () => {
    const tracks = ['A', 'B', 'C', 'D', 'E', 'F'].map((p) => ({
      param: `Param${p}`,
      keyframes: [[0, 0], [1, 1]] as Array<[number, number]>,
    }))
    const r = scoreMotion(makeDraft({ tracks }))
    expect(r.param_diversity).toBe(1)
  })
})

describe('scoreMotion — smoothness', () => {
  it('线性 keyframes（恒速）→ smoothness 高', () => {
    const r = scoreMotion(makeDraft({
      tracks: [{
        param: 'ParamX',
        keyframes: [[0, 0], [1, 1], [2, 2], [3, 3]],
      }],
    }))
    expect(r.smoothness).toBeGreaterThan(0.9)
  })

  it('剧烈跳变 → smoothness 低', () => {
    const r = scoreMotion(makeDraft({
      duration: 0.3,
      tracks: [{
        param: 'ParamX',
        keyframes: [[0, 0], [0.1, 100], [0.2, -100], [0.3, 100]],
      }],
    }))
    expect(r.smoothness).toBeLessThan(0.5)
  })

  it('单 keyframe 不够 → 走 fallback 0.5', () => {
    const r = scoreMotion(makeDraft({
      tracks: [{ param: 'ParamX', keyframes: [[0, 0]] }],
    }))
    // 单点没法算二阶差分，fallback 0.5
    expect(r.smoothness).toBe(0.5)
  })
})

describe('scoreMotion — loop_compatibility', () => {
  it('无 summary + loop=false → 1.0', () => {
    const r = scoreMotion(makeDraft({ loop: false }))
    expect(r.loop_compatibility).toBe(1)
  })

  it('无 summary + loop=true → 0.5', () => {
    const r = scoreMotion(makeDraft({ loop: true }))
    expect(r.loop_compatibility).toBe(0.5)
  })
})

describe('scoreMotion — total clamp', () => {
  it('total 永远 ≤ 1', () => {
    // 构造极端高分场景
    const r = scoreMotion(makeDraft({
      tracks: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((p) => ({
        param: `Param${p}`,
        keyframes: [[0, 0], [0.5, 0.5], [1, 1], [1.5, 1.5], [2, 2]] as Array<[number, number]>,
      })),
    }))
    expect(r.total).toBeLessThanOrEqual(1)
    expect(r.total).toBeGreaterThanOrEqual(0)
  })
})
