/**
 * Phase 1 J: emotional-state 演化纯函数测试。
 */
import { describe, expect, it } from 'vitest'
import {
  applyChatSentiment,
  applyChatTurn,
  applyTick,
  applyTopicMention,
  setMood,
  strongestTopic,
} from './evolution'
import { createDefaultEmotionalState } from './types'

const NOW = 1_700_000_000_000

function fresh() {
  return createDefaultEmotionalState('test-char', 'calm')
}

describe('applyChatTurn', () => {
  it('清空 missing_intensity + 更新 last_chat_at', () => {
    const s = { ...fresh(), missing_intensity: 0.7, last_chat_at: NOW - 86400_000 }
    const next = applyChatTurn(s, NOW)
    expect(next.missing_intensity).toBe(0)
    expect(next.last_chat_at).toBe(NOW)
  })

  it('sad/anxious/missing 心情触发 chat → mood_intensity 减半', () => {
    const s = { ...fresh(), current_mood: 'sad' as const, mood_intensity: 0.8 }
    const next = applyChatTurn(s, NOW)
    expect(next.current_mood).toBe('sad')
    expect(next.mood_intensity).toBeCloseTo(0.4, 2)
  })

  it('衰减到 <0.2 → 回归 baseline', () => {
    const s = { ...fresh(), current_mood: 'missing' as const, mood_intensity: 0.3 }
    const next = applyChatTurn(s, NOW)
    expect(next.current_mood).toBe('calm')
    expect(next.mood_intensity).toBe(0.3)
    expect(next.mood_history.at(-1)?.trigger).toBe('chat_relief')
  })

  it('正面 mood 不受影响（happy 聊天不会"减半"）', () => {
    const s = { ...fresh(), current_mood: 'happy' as const, mood_intensity: 0.7 }
    const next = applyChatTurn(s, NOW)
    expect(next.current_mood).toBe('happy')
    expect(next.mood_intensity).toBe(0.7)
  })

  it('不修改原 state（immutability）', () => {
    const s = fresh()
    const snap = JSON.stringify(s)
    applyChatTurn(s, NOW)
    expect(JSON.stringify(s)).toBe(snap)
  })
})

describe('applyChatSentiment', () => {
  it('sentiment > 0.5 → happy', () => {
    const next = applyChatSentiment(fresh(), 0.7, NOW)
    expect(next.current_mood).toBe('happy')
    expect(next.mood_intensity).toBeGreaterThan(0.4)
  })

  it('sentiment > 0.85 → tease', () => {
    const next = applyChatSentiment(fresh(), 0.9, NOW)
    expect(next.current_mood).toBe('tease')
  })

  it('sentiment < -0.5 → sad', () => {
    const next = applyChatSentiment(fresh(), -0.7, NOW)
    expect(next.current_mood).toBe('sad')
  })

  it('sentiment < -0.85 → angry', () => {
    const next = applyChatSentiment(fresh(), -0.95, NOW)
    expect(next.current_mood).toBe('angry')
  })

  it('中性 sentiment 维持原 mood', () => {
    const next = applyChatSentiment(fresh(), 0.2, NOW)
    expect(next.current_mood).toBe('calm')
  })

  it('已是 happy 时正向 sentiment 不重复切换', () => {
    const s = { ...fresh(), current_mood: 'happy' as const }
    const next = applyChatSentiment(s, 0.7, NOW)
    expect(next.mood_history.length).toBe(s.mood_history.length) // 没新事件
  })
})

describe('applyTick', () => {
  it('<1 分钟跳过', () => {
    const s = { ...fresh(), updated_at: NOW - 30_000 }
    const next = applyTick(s, NOW)
    expect(next).toBe(s)
  })

  it('long silence (1 day) 后 missing_intensity > 0.6 → 切 missing', () => {
    const dayAgo = NOW - 24 * 3600_000
    const s = { ...fresh(), last_chat_at: dayAgo, updated_at: dayAgo }
    const next = applyTick(s, NOW)
    expect(next.missing_intensity).toBeGreaterThan(0.6)
    expect(next.current_mood).toBe('missing')
    expect(next.mood_history.at(-1)?.trigger).toMatch(/^long_silence_/)
  })

  it('intensity 自然衰减到 <0.2 → 回归 baseline', () => {
    const hoursAgo24 = NOW - 24 * 3600_000
    const s = {
      ...fresh(),
      current_mood: 'tease' as const,
      mood_intensity: 0.5,
      updated_at: hoursAgo24,
      // 让 missing 不要触发切 mood（last_chat 也 chat 完没多久）
      last_chat_at: NOW - 60_000,
    }
    const next = applyTick(s, NOW)
    expect(next.current_mood).toBe('calm')
    expect(next.mood_intensity).toBe(0.3)
  })

  it('短时（5min）不切 missing', () => {
    const s = { ...fresh(), last_chat_at: NOW - 300_000, updated_at: NOW - 120_000 }
    const next = applyTick(s, NOW)
    expect(next.current_mood).toBe('calm')
    expect(next.missing_intensity).toBeLessThan(0.05)
  })
})

describe('applyTopicMention', () => {
  it('第一次提及 → count=1 + sentiment 原值', () => {
    const next = applyTopicMention(fresh(), '工作', -0.6, NOW)
    expect(next.topic_imprints['工作']!.count).toBe(1)
    expect(next.topic_imprints['工作']!.sentiment).toBeCloseTo(-0.6, 2)
  })

  it('重复提及做加权平均 (0.7 旧 + 0.3 新)', () => {
    let s = applyTopicMention(fresh(), '猫', 1.0, NOW)
    s = applyTopicMention(s, '猫', 0.0, NOW + 1000)
    // 0.7 * 1.0 + 0.3 * 0.0 = 0.7
    expect(s.topic_imprints['猫']!.sentiment).toBeCloseTo(0.7, 2)
    expect(s.topic_imprints['猫']!.count).toBe(2)
  })

  it('topic 大小写归一化', () => {
    const next = applyTopicMention(fresh(), '  WORK  ', 0.5, NOW)
    expect(next.topic_imprints['work']).toBeDefined()
    expect(next.topic_imprints['WORK']).toBeUndefined()
  })

  it('空 topic 忽略', () => {
    const next = applyTopicMention(fresh(), '   ', 0.5, NOW)
    expect(Object.keys(next.topic_imprints).length).toBe(0)
  })

  it('LRU: 超过 60 个时丢最旧', () => {
    let s = fresh()
    for (let i = 0; i < 70; i++) {
      s = applyTopicMention(s, `topic${i}`, 0.1, NOW + i * 1000)
    }
    expect(Object.keys(s.topic_imprints).length).toBe(60)
    // 最新的应该还在
    expect(s.topic_imprints['topic69']).toBeDefined()
    // 最旧的（前几个）应该被丢
    expect(s.topic_imprints['topic0']).toBeUndefined()
  })
})

describe('strongestTopic', () => {
  it('空时返回 null', () => {
    expect(strongestTopic(fresh())).toBeNull()
  })

  it('返回 abs(sentiment) * log(count+1) 最大者', () => {
    let s = fresh()
    s = applyTopicMention(s, 'a', 0.3, NOW) // 0.3 * log2 ≈ 0.21
    s = applyTopicMention(s, 'b', -0.9, NOW) // 0.9 * log2 ≈ 0.62
    s = applyTopicMention(s, 'c', 0.5, NOW) // 0.5 * log2 ≈ 0.35
    expect(strongestTopic(s)!.topic).toBe('b')
  })
})

describe('setMood', () => {
  it('显式切换 + 记录 history', () => {
    const next = setMood(fresh(), 'angry', 0.8, 'test_trigger', NOW)
    expect(next.current_mood).toBe('angry')
    expect(next.mood_intensity).toBe(0.8)
    expect(next.mood_history.at(-1)?.trigger).toBe('test_trigger')
  })

  it('intensity 越界 clamp', () => {
    const tooBig = setMood(fresh(), 'happy', 1.5, 't', NOW)
    expect(tooBig.mood_intensity).toBe(1)
    const negative = setMood(fresh(), 'happy', -0.3, 't', NOW)
    expect(negative.mood_intensity).toBe(0)
  })

  it('P5: setMood 清空 secondary (手动选择视为重置)', () => {
    const withSec = {
      ...fresh(),
      secondary_mood: 'shy' as const,
      secondary_intensity: 0.5,
    }
    const next = setMood(withSec, 'angry', 0.8, 't', NOW)
    expect(next.secondary_mood).toBeUndefined()
    expect(next.secondary_intensity).toBeUndefined()
  })
})

describe('P5: 多 mood 并存', () => {
  it('applyChatSentiment 切换时 primary intensity > 0.5 → 旧 mood 留为 secondary', () => {
    const s = { ...fresh(), current_mood: 'shy' as const, mood_intensity: 0.8 }
    // sentiment > 0.5 → 切 happy
    const next = applyChatSentiment(s, 0.7, NOW)
    expect(next.current_mood).toBe('happy')
    expect(next.secondary_mood).toBe('shy')
    expect(next.secondary_intensity).toBeCloseTo(0.8 * 0.7, 2) // 降级时打折
  })

  it('primary intensity < 0.5 → 不保留为 secondary (强度不够)', () => {
    const s = { ...fresh(), current_mood: 'shy' as const, mood_intensity: 0.3 }
    const next = applyChatSentiment(s, 0.7, NOW)
    expect(next.current_mood).toBe('happy')
    expect(next.secondary_mood).toBeUndefined()
  })

  it('切换到 tease (shy + 高 sentiment) → secondary 保留旧 shy', () => {
    const s = { ...fresh(), current_mood: 'shy' as const, mood_intensity: 0.7 }
    const next = applyChatSentiment(s, 0.9, NOW) // 触发 tease (>0.85)
    expect(next.current_mood).toBe('tease')
    expect(next.secondary_mood).toBe('shy')
  })

  it('applyTick: secondary 衰减 2x 速率', () => {
    // 1 小时后衰减计算: primary 0.7 * (1-0.05)^1 ≈ 0.665
    // secondary 0.7 * (1-0.1)^1 = 0.63
    const s = {
      ...fresh(),
      current_mood: 'happy' as const,
      mood_intensity: 0.7,
      secondary_mood: 'shy' as const,
      secondary_intensity: 0.7,
      updated_at: NOW - 3600_000,
      last_chat_at: NOW - 60_000, // 防 missing 触发
    }
    const next = applyTick(s, NOW)
    expect(next.mood_intensity).toBeCloseTo(0.665, 2)
    expect(next.secondary_intensity).toBeCloseTo(0.63, 2)
    expect(next.secondary_intensity!).toBeLessThan(next.mood_intensity)
  })

  it('applyTick: secondary 衰减到 <0.15 自动清空', () => {
    const s = {
      ...fresh(),
      current_mood: 'happy' as const,
      mood_intensity: 0.7,
      secondary_mood: 'shy' as const,
      secondary_intensity: 0.1, // 已经 <0.15
      updated_at: NOW - 3600_000,
      last_chat_at: NOW - 60_000,
    }
    const next = applyTick(s, NOW)
    expect(next.secondary_mood).toBeUndefined()
    expect(next.secondary_intensity).toBeUndefined()
  })

  it('无 secondary 时 applyTick 不报错', () => {
    const s = {
      ...fresh(),
      mood_intensity: 0.5,
      updated_at: NOW - 3600_000,
      last_chat_at: NOW - 60_000,
    }
    const next = applyTick(s, NOW)
    expect(next.secondary_mood).toBeUndefined()
  })

  it('原 mood = new mood 不应替换为 secondary (无意义)', () => {
    // sentiment 触发 happy 但当前已是 happy → 啥都不变
    const s = { ...fresh(), current_mood: 'happy' as const, mood_intensity: 0.7 }
    const next = applyChatSentiment(s, 0.7, NOW)
    expect(next.current_mood).toBe('happy')
    expect(next.secondary_mood).toBeUndefined() // 不会把自己当 secondary
  })

  it('ts-reviewer MEDIUM: applyChatTurn chat_relief 同时清 secondary', () => {
    // 场景：missing 心情 + 有 secondary (tease 残留) → 主人回来 chat → relief
    // 此时旧 primary (missing) 被 chat_relief 重置到 baseline；secondary 失去来源
    const s = {
      ...fresh(),
      current_mood: 'missing' as const,
      mood_intensity: 0.3, // 触发 relief (0.3 * 0.5 = 0.15 < 0.2)
      secondary_mood: 'tease' as const,
      secondary_intensity: 0.5,
    }
    const next = applyChatTurn(s, NOW)
    expect(next.current_mood).toBe('calm') // baseline
    expect(next.secondary_mood).toBeUndefined() // 已清，避免渲染 "calm + tease" 语义矛盾
    expect(next.secondary_intensity).toBeUndefined()
  })
})
