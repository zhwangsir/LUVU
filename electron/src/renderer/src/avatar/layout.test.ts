/**
 * layout.ts 单测(RFC 0002 Round Q2)。
 *
 * 重点:count<=1 必须返回填满整舞台(保证 N=1 行为与 Q1 等价)。
 */
import { describe, expect, it } from 'vitest'
import { VISUAL_STATE_IDLE, computeInstanceLayout, computeVisualState } from './layout'

describe('computeInstanceLayout', () => {
  it('count=1 → 填满整舞台(N=1 等价 inset:0)', () => {
    expect(computeInstanceLayout(1, 0)).toEqual({
      leftPercent: 0,
      widthPercent: 100,
      topPercent: 0,
      heightPercent: 100,
    })
  })

  it('count=0 → 防御退化为填满', () => {
    expect(computeInstanceLayout(0, 0)).toEqual({
      leftPercent: 0,
      widthPercent: 100,
      topPercent: 0,
      heightPercent: 100,
    })
  })

  it('count=2 → 等宽两栏,index 0 在左 index 1 在右', () => {
    expect(computeInstanceLayout(2, 0)).toEqual({
      leftPercent: 0,
      widthPercent: 50,
      topPercent: 0,
      heightPercent: 100,
    })
    expect(computeInstanceLayout(2, 1)).toEqual({
      leftPercent: 50,
      widthPercent: 50,
      topPercent: 0,
      heightPercent: 100,
    })
  })

  it('count=3 → 三等分', () => {
    const l0 = computeInstanceLayout(3, 0)
    const l1 = computeInstanceLayout(3, 1)
    const l2 = computeInstanceLayout(3, 2)
    expect(l0.leftPercent).toBeCloseTo(0)
    expect(l1.leftPercent).toBeCloseTo(100 / 3)
    expect(l2.leftPercent).toBeCloseTo(200 / 3)
    for (const l of [l0, l1, l2]) {
      expect(l.widthPercent).toBeCloseTo(100 / 3)
      expect(l.heightPercent).toBe(100)
    }
  })

  it('count=4 → 四等分,各 25%', () => {
    for (let i = 0; i < 4; i++) {
      const l = computeInstanceLayout(4, i)
      expect(l.leftPercent).toBe(i * 25)
      expect(l.widthPercent).toBe(25)
    }
  })

  it('index 越界 → 防御退化为填满(不抛)', () => {
    expect(computeInstanceLayout(2, 5)).toEqual({
      leftPercent: 0,
      widthPercent: 100,
      topPercent: 0,
      heightPercent: 100,
    })
    expect(computeInstanceLayout(2, -1)).toEqual({
      leftPercent: 0,
      widthPercent: 100,
      topPercent: 0,
      heightPercent: 100,
    })
  })

  it('横排 slot 无缝拼接(left[i+1] == left[i] + width[i])', () => {
    const count = 3
    for (let i = 0; i < count - 1; i++) {
      const cur = computeInstanceLayout(count, i)
      const next = computeInstanceLayout(count, i + 1)
      expect(next.leftPercent).toBeCloseTo(cur.leftPercent + cur.widthPercent)
    }
  })
})

describe('computeVisualState(Q3 视觉强调)', () => {
  it('active → 满强度(scale/opacity/saturate 全 1)', () => {
    expect(computeVisualState(true, true)).toEqual({ scale: 1, opacity: 1, saturate: 1 })
    expect(computeVisualState(true, false)).toEqual({ scale: 1, opacity: 1, saturate: 1 })
  })

  it('非 active + 多灵魂同框 → 后退档(scale<1 且变暗降饱和)', () => {
    const idle = computeVisualState(false, true)
    expect(idle.scale).toBeLessThan(1)
    expect(idle.opacity).toBeLessThan(1)
    expect(idle.saturate).toBeLessThan(1)
    expect(idle).toEqual(VISUAL_STATE_IDLE)
  })

  it('非 active + 单灵魂(N=1)→ 满强度(与 Q1 行为等价)', () => {
    expect(computeVisualState(false, false)).toEqual({ scale: 1, opacity: 1, saturate: 1 })
  })

  it('后退档数值合理(scale 0.5~0.9,opacity/saturate 不为 0)', () => {
    const idle = computeVisualState(false, true)
    expect(idle.scale).toBeGreaterThanOrEqual(0.5)
    expect(idle.scale).toBeLessThanOrEqual(0.9)
    expect(idle.opacity).toBeGreaterThan(0)
    expect(idle.saturate).toBeGreaterThan(0)
  })
})
