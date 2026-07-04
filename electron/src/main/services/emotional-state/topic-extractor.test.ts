import { describe, expect, it } from 'vitest'
import { extractTopics } from './topic-extractor'

describe('extractTopics', () => {
  it('空 / null 返回空数组', () => {
    expect(extractTopics('')).toEqual([])
    expect(extractTopics(null as unknown as string)).toEqual([])
  })

  it('单关键词命中 → 1 hit', () => {
    const out = extractTopics('今天加班好累')
    expect(out).toEqual([
      { topic: '工作', hits: 1 },
      { topic: '健康', hits: 1 },
    ])
  })

  it('多关键词命中累加 + 按 hits 排序', () => {
    const out = extractTopics('我今天上班开会写代码加班，老板还让我做日报')
    expect(out[0]!.topic).toBe('工作')
    expect(out[0]!.hits).toBeGreaterThanOrEqual(5) // capped at 5
  })

  it('单 topic 上限 5 防 spam', () => {
    const text = '工作工作工作工作工作工作工作工作工作工作'
    const out = extractTopics(text)
    expect(out[0]!.hits).toBe(5)
  })

  it('topic 总数上限 3', () => {
    const text = '工作 学习 游戏 吃饭 睡觉 朋友 家人 天气 跑步'
    const out = extractTopics(text)
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it('case-insensitive 英文关键词', () => {
    const out = extractTopics('今天的 BUG 改完了')
    expect(out[0]!.topic).toBe('工作')
  })

  it('家人 + 健康 同时命中', () => {
    const out = extractTopics('妈妈感冒了')
    const topics = out.map((t) => t.topic)
    expect(topics).toContain('家人')
    expect(topics).toContain('健康')
  })

  it('无命中返回空数组', () => {
    expect(extractTopics('asdf qwerty 1234')).toEqual([])
  })
})
