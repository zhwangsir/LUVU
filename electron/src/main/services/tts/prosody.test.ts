/**
 * Mood-aware TTS prosody 单元测试 (P5).
 */
import { describe, expect, it, vi } from 'vitest'
import { adjustProsody } from './prosody'

const BASE = { rate: '+0%', pitch: '+0Hz' }

describe('adjustProsody', () => {
  it('emotion 缺失 → 原基线', () => {
    expect(adjustProsody(BASE, null, 0.8)).toEqual({ rate: '+0%', pitch: '+0Hz' })
    expect(adjustProsody(BASE, undefined, 0.8)).toEqual({ rate: '+0%', pitch: '+0Hz' })
    expect(adjustProsody(BASE, '', 0.8)).toEqual({ rate: '+0%', pitch: '+0Hz' })
  })

  it('未知 emotion → 原基线', () => {
    expect(adjustProsody(BASE, 'custom_mood', 0.8)).toEqual({ rate: '+0%', pitch: '+0Hz' })
  })

  it('happy + 高 intensity → 加快 + 调高', () => {
    const out = adjustProsody(BASE, 'happy', 1)
    expect(out.rate).toBe('+10%')
    expect(out.pitch).toBe('+5Hz')
    expect(out.applied?.emotion).toBe('happy')
  })

  it('sad + 高 intensity → 减慢 + 调低', () => {
    const out = adjustProsody(BASE, 'sad', 1)
    expect(out.rate).toBe('-8%')
    expect(out.pitch).toBe('-5Hz')
  })

  it('sleepy 是最慢的', () => {
    const out = adjustProsody(BASE, 'sleepy', 1)
    expect(out.rate).toBe('-15%')
  })

  it('intensity 缺失 → 视为 0.5 (中等)', () => {
    const out = adjustProsody(BASE, 'happy', null)
    expect(out.rate).toBe('+5%')
  })

  it('intensity 0.5 + happy = delta * 0.5', () => {
    const out = adjustProsody(BASE, 'happy', 0.5)
    expect(out.rate).toBe('+5%') // 10 * 0.5
    expect(out.pitch).toBe('+3Hz') // 5 * 0.5 = 2.5 → round 3
  })

  it('intensity < 0.3 → 额外衰减 (delta * intensity * 0.5)', () => {
    const out = adjustProsody(BASE, 'happy', 0.2)
    // 10 * 0.2 * 0.5 = 1
    expect(out.rate).toBe('+1%')
  })

  it('intensity > 1 不放大', () => {
    const out = adjustProsody(BASE, 'happy', 2.5)
    expect(out.rate).toBe('+10%') // 跟 intensity=1 一致
  })

  it('叠加用户基线', () => {
    const out = adjustProsody({ rate: '+5%', pitch: '+3Hz' }, 'sad', 1)
    // -8 + 5 = -3, -5 + 3 = -2
    expect(out.rate).toBe('-3%')
    expect(out.pitch).toBe('-2Hz')
  })

  it('用户基线 + 同向情感 → 累加', () => {
    const out = adjustProsody({ rate: '+10%', pitch: '+5Hz' }, 'happy', 1)
    expect(out.rate).toBe('+20%')
    expect(out.pitch).toBe('+10Hz')
  })

  it('calm/neutral/anxious/surprise 不调 (delta=0)', () => {
    for (const e of ['calm', 'neutral', 'anxious', 'surprise']) {
      expect(adjustProsody(BASE, e, 1)).toEqual({ rate: '+0%', pitch: '+0Hz' })
    }
  })

  it('intensity = 0 → 原基线', () => {
    const out = adjustProsody(BASE, 'happy', 0)
    expect(out.rate).toBe('+0%')
  })

  it('case-insensitive emotion', () => {
    expect(adjustProsody(BASE, 'HAPPY', 1).rate).toBe('+10%')
    expect(adjustProsody(BASE, 'Happy', 1).rate).toBe('+10%')
  })

  it('angry 加快但调低 (压抑的怒)', () => {
    const out = adjustProsody(BASE, 'angry', 1)
    expect(out.rate).toBe('+6%')
    expect(out.pitch).toBe('-3Hz')
  })

  it('shy 慢 + 高 (含羞声)', () => {
    const out = adjustProsody(BASE, 'shy', 1)
    expect(out.rate).toBe('-3%')
    expect(out.pitch).toBe('+3Hz')
  })

  it('missing 慢 + 低 (轻沉)', () => {
    const out = adjustProsody(BASE, 'missing', 1)
    expect(out.rate).toBe('-6%')
    expect(out.pitch).toBe('-4Hz')
  })

  it('applied debug 字段含 rateDelta / pitchDelta', () => {
    const out = adjustProsody(BASE, 'happy', 0.8)
    expect(out.applied).toBeDefined()
    expect(out.applied!.rateDelta).toBeCloseTo(8, 1)
    expect(out.applied!.pitchDelta).toBeCloseTo(4, 1)
  })

  it('损坏 base 字符串容错 + warn 日志', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const out = adjustProsody({ rate: 'invalid', pitch: 'oops' }, 'happy', 1)
    expect(out.rate).toBe('+10%')
    expect(out.pitch).toBe('+5Hz')
    expect(warnSpy).toHaveBeenCalled() // 含 [tts-prosody] 解析失败
    warnSpy.mockRestore()
  })

  it('emotion 超长截断到 32 字符防 DoS', () => {
    const huge = 'x'.repeat(10_000_000) + 'happy' // 10 MB 字符串
    const out = adjustProsody(BASE, huge, 1)
    // 前 32 字符都是 x → 未匹配 PROSODY_TARGET → 返回基线
    expect(out).toEqual({ rate: '+0%', pitch: '+0Hz' })
    // 没 crash 就行 (测 DoS 防护)
  })
})
