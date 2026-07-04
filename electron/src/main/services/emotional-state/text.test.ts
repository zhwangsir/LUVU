/**
 * Phase 1 J: emotional-state text 渲染测试。
 */
import { describe, expect, it } from 'vitest'
import { applyTopicMention } from './evolution'
import { CROSS_CHARACTER_TOPIC } from './cross-character'
import {
  emotionalStateOneLiner,
  emotionalStateToPromptFragment,
} from './text'
import { createDefaultEmotionalState } from './types'
const NOW = 1_700_000_000_000

function fresh() {
  return createDefaultEmotionalState('test', 'calm')
}

describe('emotionalStateToPromptFragment', () => {
  it('基础 calm 状态输出含「心情」+「平静」+ intensity', () => {
    const out = emotionalStateToPromptFragment(fresh())
    expect(out).toContain('# 你现在的状态')
    expect(out).toContain('心情:')
    expect(out).toContain('平静')
    expect(out).toContain('intensity=0.30')
    expect(out).toContain('隐性融入')
  })

  it('高 missing_intensity 输出想念句', () => {
    const s = { ...fresh(), missing_intensity: 0.7, last_chat_at: NOW - 12 * 3600_000 }
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toMatch(/12 小时/)
    expect(out).toContain('闹心')
  })

  it('高强度 happy → "很心情很好"', () => {
    const s = { ...fresh(), current_mood: 'happy' as const, mood_intensity: 0.9 }
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toMatch(/很心情很好|很心情/)
  })

  it('强情感话题被列出', () => {
    let s = fresh()
    s = applyTopicMention(s, '工作', -0.6, NOW)
    s = applyTopicMention(s, '工作', -0.5, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('不舒服的话题')
    expect(out).toContain('工作')
    expect(out).toContain('提过 2 次')
  })

  it('弱情感话题不被列出（abs sentiment <= 0.3）', () => {
    let s = fresh()
    s = applyTopicMention(s, '天气', 0.2, NOW)
    s = applyTopicMention(s, '天气', 0.1, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).not.toContain('天气')
  })

  it('低提及次数 (1) 即使强情感也不列', () => {
    const s = applyTopicMention(fresh(), '猫', 0.9, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).not.toContain('猫')
  })

  it('低 missing (0.1) 不渲染想念句', () => {
    const s = { ...fresh(), missing_intensity: 0.1 }
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).not.toContain('小时')
  })

  // P5: 跨角色 topic 特殊渲染
  it('CROSS_CHARACTER topic 用专属语句而非"喜欢/不舒服的话题"', () => {
    let s = fresh()
    s = applyTopicMention(s, CROSS_CHARACTER_TOPIC, -0.5, NOW)
    s = applyTopicMention(s, CROSS_CHARACTER_TOPIC, -0.5, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('跟其他角色聊天里提到过你')
    expect(out).toContain('负面情绪')
    expect(out).toContain('2 次')
    // 不该出现普通 topic 措辞
    expect(out).not.toContain('不舒服的话题')
  })

  it('cross-character 正面情绪渲染', () => {
    const s = applyTopicMention(fresh(), CROSS_CHARACTER_TOPIC, 0.5, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('正面情绪')
  })

  it('cross-character + 普通 topic 共存时分别渲染', () => {
    let s = fresh()
    s = applyTopicMention(s, CROSS_CHARACTER_TOPIC, -0.6, NOW)
    s = applyTopicMention(s, '工作', -0.7, NOW)
    s = applyTopicMention(s, '工作', -0.5, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('跟其他角色聊天里提到过你') // cross
    expect(out).toContain('不舒服的话题') // normal topic
    expect(out).toContain('工作')
  })

  it('cross-character count 1 也触发渲染（不像普通 topic 要 >=2）', () => {
    const s = applyTopicMention(fresh(), CROSS_CHARACTER_TOPIC, -0.7, NOW)
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('跟其他角色聊天里提到过你')
    expect(out).toContain('1 次')
  })
})

describe('P5: 多 mood 渲染', () => {
  it('promptFragment 渲染 secondary "同时也带点"', () => {
    const s = {
      ...fresh(),
      current_mood: 'happy' as const,
      mood_intensity: 0.7,
      secondary_mood: 'shy' as const,
      secondary_intensity: 0.5,
    }
    const out = emotionalStateToPromptFragment(s, NOW)
    expect(out).toContain('心情很好，话多')
    expect(out).toContain('但同时也带点')
    expect(out).toContain('害羞，话少')
    expect(out).toContain('残留 intensity=0.50')
  })

  it('无 secondary 时不渲染同时句', () => {
    const out = emotionalStateToPromptFragment(fresh())
    expect(out).not.toContain('但同时也带点')
    expect(out).not.toContain('残留')
  })

  it('oneLiner 含 + 形式 secondary', () => {
    const s = {
      ...fresh(),
      current_mood: 'happy' as const,
      mood_intensity: 0.7,
      secondary_mood: 'shy' as const,
      secondary_intensity: 0.4,
    }
    expect(emotionalStateOneLiner(s)).toContain('+')
    expect(emotionalStateOneLiner(s)).toContain('害羞')
  })

  it('oneLiner 无 secondary 时不加 +', () => {
    expect(emotionalStateOneLiner(fresh())).not.toContain('+')
  })
})

describe('emotionalStateOneLiner', () => {
  it('基础形态', () => {
    expect(emotionalStateOneLiner(fresh())).toContain('平静')
  })

  it('高想念时追加想念分量', () => {
    const s = { ...fresh(), missing_intensity: 0.7 }
    expect(emotionalStateOneLiner(s)).toContain('想念')
  })

  it('低想念不追加', () => {
    const s = { ...fresh(), missing_intensity: 0.2 }
    expect(emotionalStateOneLiner(s)).not.toContain('想念')
  })
})
