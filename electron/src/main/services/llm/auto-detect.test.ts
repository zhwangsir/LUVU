/**
 * LLM auto-detect 测试 (UX R20)。
 *
 * 网络相关 — 用 vi.spyOn(globalThis, 'fetch') mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoDetectLlm } from './auto-detect'

interface MockFetchEntry {
  url: string
  status: number
  body?: unknown
  delay?: number
  reject?: boolean
}

function setupMockFetch(entries: MockFetchEntry[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    for (const e of entries) {
      if (url.includes(e.url)) {
        if (e.delay) await new Promise((r) => setTimeout(r, e.delay))
        if (e.reject) throw new Error('connection refused')
        return new Response(JSON.stringify(e.body ?? { data: [] }), {
          status: e.status,
          headers: { 'content-type': 'application/json' },
        })
      }
    }
    throw new Error('connection refused (default)')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('autoDetectLlm', () => {
  it('全部失败 → found 空 / failed 4 条', async () => {
    setupMockFetch([]) // 所有都 reject
    const r = await autoDetectLlm()
    expect(r.found).toEqual([])
    expect(r.failed.length).toBe(4)
    expect(r.totalMs).toBeGreaterThanOrEqual(0) // mock 几乎瞬间完成
  })

  it('LM Studio 在 1234 返 200 + 2 models → 检测到', async () => {
    setupMockFetch([
      {
        url: '127.0.0.1:1234',
        status: 200,
        body: { data: [{ id: 'qwen3-32b' }, { id: 'llama3-70b' }] },
      },
    ])
    const r = await autoDetectLlm()
    expect(r.found.length).toBe(1)
    expect(r.found[0]!.label).toBe('LM Studio')
    expect(r.found[0]!.models).toEqual(['qwen3-32b', 'llama3-70b'])
    expect(r.failed.length).toBe(3) // ollama/vllm/llama.cpp 仍失败
  })

  it('多个 endpoint 都活 → 按 latency 排序', async () => {
    setupMockFetch([
      { url: '127.0.0.1:1234', status: 200, delay: 50, body: { data: [{ id: 'm1' }] } },
      { url: '127.0.0.1:11434', status: 200, delay: 10, body: { data: [{ id: 'qwen' }] } },
    ])
    const r = await autoDetectLlm()
    expect(r.found.length).toBe(2)
    // Ollama 更快 (10ms vs 50ms)
    expect(r.found[0]!.label).toBe('Ollama')
    expect(r.found[1]!.label).toBe('LM Studio')
  })

  it('endpoint 返非 200 → 算失败', async () => {
    setupMockFetch([{ url: '127.0.0.1:1234', status: 500 }])
    const r = await autoDetectLlm()
    expect(r.found.length).toBe(0)
    expect(r.failed.find((f) => f.endpoint.includes('1234'))?.reason).toMatch(/500/)
  })

  it('endpoint 返 JSON 无 data 字段 → models 空但仍算 found', async () => {
    setupMockFetch([{ url: '127.0.0.1:1234', status: 200, body: { other: 'shape' } }])
    const r = await autoDetectLlm()
    expect(r.found.length).toBe(1)
    expect(r.found[0]!.models).toEqual([])
  })

  it('custom endpoint 也参与探测', async () => {
    setupMockFetch([
      {
        url: 'custom-server:9999',
        status: 200,
        body: { data: [{ id: 'custom-model' }] },
      },
    ])
    const r = await autoDetectLlm('http://custom-server:9999/v1')
    expect(r.found.length).toBe(1)
    expect(r.found[0]!.label).toBe('Custom')
    expect(r.found[0]!.models).toEqual(['custom-model'])
  })

  it('models[].id 缺失的条目被过滤', async () => {
    setupMockFetch([
      {
        url: '127.0.0.1:1234',
        status: 200,
        body: { data: [{ id: 'ok' }, { id: '' }, { other: 'noId' }, { id: 'ok2' }] },
      },
    ])
    const r = await autoDetectLlm()
    expect(r.found[0]!.models).toEqual(['ok', 'ok2'])
  })

  it('SSRF 防御: metadata URL 自定义 endpoint 被拒', async () => {
    setupMockFetch([{ url: '169.254', status: 200, body: { data: [] } }])
    const r = await autoDetectLlm('http://169.254.169.254/v1') // AWS metadata
    // 应该被 validateSidecarUrl 拒，不在 found 也不在 failed (因 fetch 没调)
    expect(r.found.find((f) => f.endpoint.includes('169.254'))).toBeUndefined()
    expect(r.failed.find((f) => f.endpoint.includes('169.254'))).toBeDefined()
  })
})
