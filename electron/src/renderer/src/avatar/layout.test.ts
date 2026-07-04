/**
 * layout.ts 单测(RFC 0002 Round Q2)。
 *
 * 重点:count<=1 必须返回填满整舞台(保证 N=1 行为与 Q1 等价)。
 */
import { describe, expect, it } from 'vitest'
import { computeInstanceLayout } from './layout'

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
