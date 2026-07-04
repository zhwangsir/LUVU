/**
 * normalize-endpoint 单测 (UX R55)。
 */
import { describe, expect, it } from 'vitest'
import { normalizeLlmEndpoint, normalizeSimpleUrl } from './normalize-endpoint'

describe('normalizeLlmEndpoint', () => {
  it('空 → 空', () => {
    expect(normalizeLlmEndpoint('')).toBe('')
    expect(normalizeLlmEndpoint('   ')).toBe('')
  })

  it('保留正常 endpoint', () => {
    expect(normalizeLlmEndpoint('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('去末尾 /', () => {
    expect(normalizeLlmEndpoint('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('去多个末尾 /', () => {
    expect(normalizeLlmEndpoint('http://localhost/v1//')).toBe('http://localhost/v1')
  })

  it('去 /chat/completions 补全路径', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/chat/completions')).toBe(
      'http://x.com/v1',
    )
  })

  it('去 /completions', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/completions')).toBe('http://x.com/v1')
  })

  it('去 /models', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/models')).toBe('http://x.com/v1')
  })

  it('去 /embeddings', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/embeddings')).toBe('http://x.com/v1')
  })

  it('去标准 path 大小写不敏感', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/Chat/Completions')).toBe(
      'http://x.com/v1',
    )
  })

  it('补 http scheme', () => {
    expect(normalizeLlmEndpoint('127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('保留 https scheme', () => {
    expect(normalizeLlmEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    )
  })

  it('修复 trailing / + 路径同时', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/chat/completions/')).toBe(
      'http://x.com/v1',
    )
  })

  it('保留无 /v1 的 endpoint (不强加)', () => {
    expect(normalizeLlmEndpoint('http://api.openai.com')).toBe('http://api.openai.com')
  })

  it('保留自定义路径 /api/v2', () => {
    expect(normalizeLlmEndpoint('http://x.com/api/v2')).toBe('http://x.com/api/v2')
  })

  it('去前后空白', () => {
    expect(normalizeLlmEndpoint('  http://x.com/v1  ')).toBe('http://x.com/v1')
  })
})

describe('normalizeSimpleUrl (R67)', () => {
  it('空 → 空', () => {
    expect(normalizeSimpleUrl('')).toBe('')
    expect(normalizeSimpleUrl('   ')).toBe('')
  })

  it('补 scheme + 去末尾 /', () => {
    expect(normalizeSimpleUrl('localhost:8765/')).toBe('http://localhost:8765')
  })

  it('保留 https + path', () => {
    expect(normalizeSimpleUrl('https://x.com/api/tts')).toBe('https://x.com/api/tts')
  })

  it('不去 path (与 LLM 版区别)', () => {
    // LLM 版会去 /models, 这个版本保留
    expect(normalizeSimpleUrl('http://x.com/v1/models')).toBe('http://x.com/v1/models')
  })

  it('多末尾 / 全去', () => {
    expect(normalizeSimpleUrl('http://x.com//')).toBe('http://x.com')
  })

  it('去前后空白', () => {
    expect(normalizeSimpleUrl('  127.0.0.1:8765  ')).toBe('http://127.0.0.1:8765')
  })

  it('R73-fix: 防御 file:// scheme → 剥离 + 补 http://', () => {
    // file:///tmp/sock 剥离后是 /tmp/sock, 加 http:// 即 http:///tmp/sock
    // host 部分变空但至少协议从危险的 file:// 变成 http://, 会被 fetch 报清晰错误
    expect(normalizeSimpleUrl('file:///tmp/sock')).toBe('http:///tmp/sock')
  })

  it('R73-fix: 防御 ftp:// scheme', () => {
    expect(normalizeSimpleUrl('ftp://x.com:8765')).toBe('http://x.com:8765')
  })

  it('R73-fix: 防御 javascript: 协议 (XSS 面)', () => {
    // 注意: javascript:alert(1) 不含 :// 所以正则不匹配，整段会被当主机补 http://
    // 验证我们至少不会原样保留 javascript: 协议
    const r = normalizeSimpleUrl('javascript://alert(1)')
    expect(r.startsWith('http://')).toBe(true)
    expect(r.includes('javascript:')).toBe(false)
  })
})
