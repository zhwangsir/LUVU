import { describe, expect, it } from 'vitest'
import { emotionToSentiment } from './sentiment'

describe('emotionToSentiment', () => {
  it('happy + 高 intensity → 正向', () => {
    expect(emotionToSentiment('happy', 1)).toBeCloseTo(0.7, 2)
    expect(emotionToSentiment('happy', 0.5)).toBeCloseTo(0.35, 2)
  })

  it('tease + 高 intensity → 触发 tease 阈值 (>0.85)', () => {
    expect(emotionToSentiment('tease', 1)).toBeCloseTo(0.85, 2)
  })

  it('sad → 负向', () => {
    expect(emotionToSentiment('sad', 0.8)).toBeCloseTo(-0.56, 2)
  })

  it('angry + 满 intensity → 触发 angry 阈值 (<-0.85)', () => {
    expect(emotionToSentiment('angry', 1)).toBeCloseTo(-0.85, 2)
  })

  it('neutral 永远 0', () => {
    expect(emotionToSentiment('neutral', 1)).toBe(0)
    expect(emotionToSentiment('neutral', 0)).toBe(0)
  })

  it('未知 emotion → 0', () => {
    expect(emotionToSentiment('joyful', 0.9)).toBe(0)
    expect(emotionToSentiment('confused', 1)).toBe(0)
  })

  it('case-insensitive', () => {
    expect(emotionToSentiment('HAPPY', 1)).toBeCloseTo(0.7, 2)
    expect(emotionToSentiment('Sad', 0.5)).toBeCloseTo(-0.35, 2)
  })

  it('null / undefined / 空字符串 → 0', () => {
    expect(emotionToSentiment(null, 0.8)).toBe(0)
    expect(emotionToSentiment(undefined, 0.8)).toBe(0)
    expect(emotionToSentiment('', 0.8)).toBe(0)
  })

  it('intensity 缺省 → 视为 0.5', () => {
    expect(emotionToSentiment('happy', null)).toBeCloseTo(0.35, 2)
    expect(emotionToSentiment('happy', undefined)).toBeCloseTo(0.35, 2)
    expect(emotionToSentiment('happy', NaN)).toBeCloseTo(0.35, 2)
  })

  it('intensity 越界 clamp', () => {
    expect(emotionToSentiment('happy', 2)).toBeCloseTo(0.7, 2)
    expect(emotionToSentiment('happy', -0.5)).toBe(0)
  })

  it('intensity = 0 → 0 (允许 ±0 都视为 0)', () => {
    expect(emotionToSentiment('happy', 0)).toBeCloseTo(0, 10)
    expect(emotionToSentiment('angry', 0)).toBeCloseTo(0, 10)
  })
})
