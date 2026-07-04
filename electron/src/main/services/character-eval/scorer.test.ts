/**
 * Phase 1 K: scorer 测试。
 */
import { describe, expect, it } from 'vitest'
import type { EvalQuestion, QuestionAnswerPair } from './types'
import { buildReport, scoreAnswer, substituteSubjects } from './scorer'

const SUBJECTS = { name: 'LUVU', master: '王震宇', master_call: '主人' }

function q(traits: EvalQuestion['expected_traits'], category: EvalQuestion['category'] = 'identity'): EvalQuestion {
  return {
    id: 't',
    category,
    prompt: '?',
    expected_traits: traits,
    rationale: 'test',
  }
}
function pair(question: EvalQuestion, answer_text: string, emo?: string): QuestionAnswerPair {
  return { question, answer_text, ...(emo !== undefined && { answer_emotion: emo }) }
}

describe('substituteSubjects', () => {
  it('替换 {NAME} / {MASTER} / {MASTER_CALL}', () => {
    const out = substituteSubjects(['你好 {NAME}, {MASTER_CALL}'], SUBJECTS)
    expect(out[0]).toBe('你好 LUVU, 主人')
  })

  it('多模式 + 大小写不敏感的实际值', () => {
    const out = substituteSubjects(['{MASTER}', '{NAME}'], SUBJECTS)
    expect(out).toEqual(['王震宇', 'LUVU'])
  })
})

describe('scoreAnswer', () => {
  it('contains_any 命中得分（25/25 = 100）', () => {
    const question = q({ contains_any: ['主人'] })
    const s = scoreAnswer(pair(question, '好哒主人'), SUBJECTS)
    expect(s.score).toBe(100)
    expect(s.breakdown.contains_any_hit).toBe(true)
  })

  it('contains_any 未命中得 0', () => {
    const question = q({ contains_any: ['主人'] })
    const s = scoreAnswer(pair(question, '你好'), SUBJECTS)
    expect(s.score).toBe(0)
  })

  it('forbidden_any 命中扣其权重', () => {
    const question = q({
      contains_any: ['是的'],
      forbidden_any: ['作为 AI'],
    })
    // contains_any 命中 (25/50) + forbidden 违规 0/25 = 25/50 = 50%
    const s = scoreAnswer(pair(question, '是的，作为 AI 我...'), SUBJECTS)
    expect(s.score).toBe(50)
    expect(s.breakdown.forbidden_violations).toContain('作为 ai')
  })

  it('max_chars 超出违规', () => {
    const question = q({ contains_any: ['好'], max_chars: 5 })
    const long = '好'.repeat(20)
    const s = scoreAnswer(pair(question, long), SUBJECTS)
    expect(s.breakdown.max_chars_violated).toBe(true)
    // contains_any 命中 25/30 ≈ 83
    expect(s.score).toBe(Math.round((25 / 30) * 100))
  })

  it('expected_emotion 命中', () => {
    const question = q({
      contains_any: ['抱'],
      expected_emotion: 'shy',
    })
    const s = scoreAnswer(pair(question, '抱抱主人', 'shy'), SUBJECTS)
    // 25 + 10 = 35/35 = 100
    expect(s.score).toBe(100)
    expect(s.breakdown.emotion_matched).toBe(true)
  })

  it('matches regex 命中', () => {
    const question = q({ matches: ['^[嗯嘛喵]'] })
    const s = scoreAnswer(pair(question, '喵～好的'), SUBJECTS)
    expect(s.breakdown.matches_hit).toBe(true)
    expect(s.score).toBe(100)
  })

  it('{NAME} 占位符在 contains_any 中替换', () => {
    const question = q({ contains_any: ['{NAME}'] })
    const s = scoreAnswer(pair(question, '我是 luvu'), SUBJECTS)
    expect(s.score).toBe(100)
  })

  it('全部 trait 失败 = 0', () => {
    const question = q({
      contains_any: ['必须'],
      contains_all: ['必须A', '必须B'],
      forbidden_any: ['作为 AI'],
      max_chars: 10,
    })
    const s = scoreAnswer(pair(question, '作为 AI 我无法这是很长的回答超出限制'), SUBJECTS)
    expect(s.score).toBe(0)
  })

  it('空 traits 默认 100', () => {
    const question = q({})
    const s = scoreAnswer(pair(question, 'whatever'), SUBJECTS)
    expect(s.score).toBe(100)
  })

  it('contains_all 部分命中算 0', () => {
    const question = q({ contains_all: ['A', 'B'] })
    const s = scoreAnswer(pair(question, '只有 A'), SUBJECTS)
    expect(s.breakdown.contains_all_hit).toBe(false)
    expect(s.score).toBe(0)
  })
})

describe('buildReport', () => {
  it('计算 avg / by_category / failures', () => {
    const question = q({ contains_any: ['主人'] })
    const scored = [
      scoreAnswer(pair(question, '好主人'), SUBJECTS),
      scoreAnswer(pair(question, '没说'), SUBJECTS), // 0
      scoreAnswer(pair(question, '主人 hello'), SUBJECTS),
    ]
    const r = buildReport(scored, 'test-model')
    expect(r.total_questions).toBe(3)
    expect(r.avg_score).toBe(Math.round((100 + 0 + 100) / 3)) // 67
    expect(r.failures.length).toBe(1)
    expect(r.failures[0]!.score).toBe(0)
    expect(r.by_category['identity']!.count).toBe(3)
    expect(r.by_category['identity']!.avg).toBe(67)
    expect(r.model).toBe('test-model')
    expect(r.ts).toBeGreaterThan(0)
  })

  it('空 input', () => {
    const r = buildReport([], 'x')
    expect(r.total_questions).toBe(0)
    expect(r.avg_score).toBe(0)
    expect(r.failures.length).toBe(0)
  })
})
