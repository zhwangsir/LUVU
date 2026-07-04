/**
 * Phase 1 K: questions 数据完整性 sanity 测试。
 */
import { describe, expect, it } from 'vitest'
import { CHARACTER_EVAL_QUESTIONS, QUESTION_COUNT } from './questions'

describe('CHARACTER_EVAL_QUESTIONS', () => {
  it('总数恰好 50 题', () => {
    expect(QUESTION_COUNT).toBe(50)
    expect(CHARACTER_EVAL_QUESTIONS.length).toBe(50)
  })

  it('每题 id 唯一', () => {
    const ids = new Set(CHARACTER_EVAL_QUESTIONS.map((q) => q.id))
    expect(ids.size).toBe(50)
  })

  it('所有 7 个 category 都有覆盖', () => {
    const cats = new Set(CHARACTER_EVAL_QUESTIONS.map((q) => q.category))
    expect(cats.size).toBe(7)
    for (const c of [
      'identity',
      'personality_core',
      'personality_surface',
      'personality_volatility',
      'speech_style',
      'boundary',
      'emotional',
    ]) {
      expect(cats.has(c as never)).toBe(true)
    }
  })

  it('每题至少有 1 个 trait 检测项', () => {
    for (const q of CHARACTER_EVAL_QUESTIONS) {
      const t = q.expected_traits
      const has =
        (t.contains_any && t.contains_any.length > 0) ||
        (t.contains_all && t.contains_all.length > 0) ||
        (t.forbidden_any && t.forbidden_any.length > 0) ||
        (t.matches && t.matches.length > 0) ||
        t.expected_emotion !== undefined ||
        t.max_chars !== undefined
      expect(has, `question ${q.id} has no trait`).toBe(true)
    }
  })

  it('每题有非空 prompt / rationale', () => {
    for (const q of CHARACTER_EVAL_QUESTIONS) {
      expect(q.prompt.trim().length, `${q.id} empty prompt`).toBeGreaterThan(0)
      expect(q.rationale.trim().length, `${q.id} empty rationale`).toBeGreaterThan(0)
    }
  })

  it('matches regex 都能编译', () => {
    for (const q of CHARACTER_EVAL_QUESTIONS) {
      for (const m of q.expected_traits.matches ?? []) {
        expect(() => new RegExp(m), `${q.id} bad regex: ${m}`).not.toThrow()
      }
    }
  })
})
