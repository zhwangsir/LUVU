/**
 * agent-loop validateLlmDecision 测试 — 覆盖审计 H3 防 prompt injection
 * 让 LLM 输出 → 键鼠驱动这条链上有结构化校验。
 */
import { describe, it, expect } from 'vitest'
import { validateLlmDecision } from './agent-loop'

describe('validateLlmDecision', () => {
  describe('合法 LLM 输出', () => {
    it('find_and_click 带 description', () => {
      const r = validateLlmDecision({ action: 'find_and_click', description: '微信 dock 图标' })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.decision.action).toBe('find_and_click')
        expect(r.decision.description).toBe('微信 dock 图标')
      }
    })

    it('type 带 text', () => {
      const r = validateLlmDecision({ action: 'type', text: '你好' })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.text).toBe('你好')
    })

    it('key 带 combo', () => {
      const r = validateLlmDecision({ action: 'key', combo: ['Cmd', 'C'] })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.combo).toEqual(['Cmd', 'C'])
    })

    it('scroll 带 dy', () => {
      const r = validateLlmDecision({ action: 'scroll', dy: -3 })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.dy).toBe(-3)
    })

    it('scroll 默认 dy=0', () => {
      const r = validateLlmDecision({ action: 'scroll' })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.dy).toBe(0)
    })

    it('wait 带 ms', () => {
      const r = validateLlmDecision({ action: 'wait', ms: 1000 })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.ms).toBe(1000)
    })

    it('done 带 message', () => {
      const r = validateLlmDecision({ action: 'done', message: '完成了' })
      expect(r.ok).toBe(true)
    })

    it('give_up 带 reason', () => {
      const r = validateLlmDecision({ action: 'give_up', reason: '找不到' })
      expect(r.ok).toBe(true)
    })

    it('thought 字段保留 + 截断', () => {
      const r = validateLlmDecision({
        action: 'wait',
        ms: 100,
        thought: 'x'.repeat(500),
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.thought?.length).toBe(200)
    })
  })

  describe('H3 防御：action 枚举', () => {
    it('未知 action 拒绝', () => {
      const r = validateLlmDecision({ action: 'shell_exec', cmd: 'rm -rf /' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('未知 action')
    })

    it('action 不是 string 拒绝', () => {
      expect(validateLlmDecision({ action: 123 }).ok).toBe(false)
    })

    it('缺 action 字段拒绝', () => {
      expect(validateLlmDecision({ description: 'click' }).ok).toBe(false)
    })

    it('action 是恶意 SQL/shell 内容拒绝', () => {
      expect(validateLlmDecision({ action: "'; DROP TABLE--" }).ok).toBe(false)
    })
  })

  describe('H3 防御：参数类型校验', () => {
    it('find_and_click 缺 description 拒绝', () => {
      const r = validateLlmDecision({ action: 'find_and_click' })
      expect(r.ok).toBe(false)
    })

    it('find_and_click description 是 number 拒绝', () => {
      expect(validateLlmDecision({ action: 'find_and_click', description: 42 }).ok).toBe(false)
    })

    it('find_and_click description 空字符串拒绝', () => {
      expect(validateLlmDecision({ action: 'find_and_click', description: '' }).ok).toBe(false)
    })

    it('type 缺 text 拒绝', () => {
      expect(validateLlmDecision({ action: 'type' }).ok).toBe(false)
    })

    it('type text 是 number 拒绝', () => {
      expect(validateLlmDecision({ action: 'type', text: 123 }).ok).toBe(false)
    })

    it('key 缺 combo 拒绝', () => {
      expect(validateLlmDecision({ action: 'key' }).ok).toBe(false)
    })

    it('key combo 是 string 而非数组拒绝', () => {
      expect(validateLlmDecision({ action: 'key', combo: 'Cmd+C' }).ok).toBe(false)
    })

    it('key combo 空数组拒绝', () => {
      expect(validateLlmDecision({ action: 'key', combo: [] }).ok).toBe(false)
    })

    it('key combo 含非 string 拒绝', () => {
      expect(validateLlmDecision({ action: 'key', combo: ['Cmd', 67] }).ok).toBe(false)
    })

    it('scroll dy 是 string 拒绝', () => {
      expect(validateLlmDecision({ action: 'scroll', dy: '-3' }).ok).toBe(false)
    })
  })

  describe('H3 防御：长度/数量 DoS', () => {
    it('type text > 500 字符拒绝（防 N×N 键序）', () => {
      const r = validateLlmDecision({ action: 'type', text: 'a'.repeat(501) })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('500')
    })

    it('type text = 500 边界允许', () => {
      expect(validateLlmDecision({ action: 'type', text: 'a'.repeat(500) }).ok).toBe(true)
    })

    it('key combo > 8 键拒绝', () => {
      const r = validateLlmDecision({
        action: 'key',
        combo: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      })
      expect(r.ok).toBe(false)
    })

    it('key combo 含 ≥32 字符的键名拒绝（防注奇怪 string）', () => {
      expect(
        validateLlmDecision({ action: 'key', combo: ['x'.repeat(33)] }).ok,
      ).toBe(false)
    })

    it('find_and_click description 自动截到 300 字符', () => {
      const long = 'x'.repeat(500)
      const r = validateLlmDecision({ action: 'find_and_click', description: long })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.decision.description?.length).toBe(300)
    })
  })
})
