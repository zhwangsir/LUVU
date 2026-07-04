/**
 * LLM 健康自检 — 一键诊断当前配置的 LLM 是否能正常工作。
 *
 * 5 项测试：
 *   1. 连通 (HTTP HEAD /v1/models)
 *   2. 模型存在 (GET /v1/models 看清单)
 *   3. 基础 chat 非流式 (拿到 content)
 *   4. Streaming (delta 流到位)
 *   5. (可选) Vision 支持检测 (发 16x16 PNG — 1x1 会触发 llama.cpp 的 GGML_ASSERT)
 *
 * 输出按测试逐条报告，用于在 UI 上展示给用户。
 */
import { deflateSync } from 'node:zlib'
import type { LlmProvider, RuntimeConfig } from '@shared/types'

export interface HealthCheckResult {
  test: string
  ok: boolean
  detail: string
  /** thinking 模型识别 */
  is_thinking_model?: boolean
  /** vision 支持 */
  supports_vision?: boolean
  latency_ms?: number
}

export interface FullHealthReport {
  provider: LlmProvider
  endpoint: string
  model: string
  overall_ok: boolean
  results: HealthCheckResult[]
  recommendations: string[]
}

// llama.cpp vision projector 内部 GGML_ASSERT 要求图像 >= 2x2，1x1 PNG 会让模型 abort。
// 动态生成 16x16 纯色 PNG 用作 vision 探测（base64 ~80 字节）。
const TEST_PNG_BASE64 = makeTinyPngBase64(16, 16)

function makeTinyPngBase64(w: number, h: number): string {
  const crc32 = (buf: Buffer): number => {
    let c: number
    const table: number[] = []
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    let crc = 0xffffffff
    for (const b of buf) crc = (table[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crcBuf])
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = 1 + w * 3
  const raw = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0 // filter: None
    for (let x = 0; x < w; x++) {
      const off = y * stride + 1 + x * 3
      raw[off] = 128
      raw[off + 1] = 128
      raw[off + 2] = 128
    }
  }
  const idat = deflateSync(raw)
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}

export async function runHealthCheck(
  cfg: Pick<RuntimeConfig, 'llm_provider' | 'llm_endpoint' | 'llm_model' | 'llm_api_key'>,
  options: { test_vision?: boolean } = {},
): Promise<FullHealthReport> {
  const results: HealthCheckResult[] = []
  const recommendations: string[] = []

  // 1. 连通
  results.push(await testConnectivity(cfg))
  if (!results[0]!.ok) {
    return buildReport(cfg, results, recommendations, [
      'endpoint 不可达，检查 LM Studio 是否在跑 / 防火墙 / IP+端口正确',
    ])
  }

  // 2. 模型存在
  results.push(await testModelExists(cfg))
  if (!results[1]!.ok) {
    recommendations.push('模型未在 LM Studio 加载 — 在 LM Studio 内 Load 此模型')
  }

  // 3. 基础 chat
  const chatResult = await testBasicChat(cfg)
  results.push(chatResult)
  if (chatResult.is_thinking_model) {
    recommendations.push('✓ 检测到 thinking 模型 — max_tokens 已设 8000+ 自动适配')
  }
  if (!chatResult.ok) {
    recommendations.push(
      'chat 失败：可能 max_tokens 太小 / model 不响应 / jinja template bug — 已自动尝试合并 system',
    )
  }

  // 4. Streaming
  if (chatResult.ok) {
    results.push(await testStreaming(cfg))
  }

  // 5. Vision (可选)
  if (options.test_vision) {
    const visionResult = await testVision(cfg)
    results.push(visionResult)
    if (!visionResult.ok) {
      recommendations.push(
        '⚠ 此模型不支持 vision — 视觉感知必须配独立 endpoint（如 Qwen2.5-VL）',
      )
    }
  }

  return buildReport(cfg, results, recommendations)
}

function buildReport(
  cfg: Pick<RuntimeConfig, 'llm_provider' | 'llm_endpoint' | 'llm_model'>,
  results: HealthCheckResult[],
  recommendations: string[],
  extraRec: string[] = [],
): FullHealthReport {
  return {
    provider: cfg.llm_provider,
    endpoint: cfg.llm_endpoint,
    model: cfg.llm_model,
    overall_ok: results.every((r) => r.ok),
    results,
    recommendations: [...recommendations, ...extraRec],
  }
}

// ============ 各测试 ============

async function testConnectivity(
  cfg: Pick<RuntimeConfig, 'llm_endpoint' | 'llm_api_key'>,
): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const url = `${cfg.llm_endpoint.replace(/\/+$/, '')}/v1/models`
    const r = await fetch(url, {
      method: 'GET',
      headers: cfg.llm_api_key ? { authorization: `Bearer ${cfg.llm_api_key}` } : {},
      signal: AbortSignal.timeout(10_000),
    })
    return {
      test: '1. 连通 (/v1/models)',
      ok: r.ok,
      detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ${r.statusText}`,
      latency_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: '1. 连通 (/v1/models)',
      ok: false,
      detail: `连接失败：${e instanceof Error ? e.message : String(e)}`,
      latency_ms: Date.now() - start,
    }
  }
}

async function testModelExists(
  cfg: Pick<RuntimeConfig, 'llm_endpoint' | 'llm_model' | 'llm_api_key'>,
): Promise<HealthCheckResult> {
  try {
    const url = `${cfg.llm_endpoint.replace(/\/+$/, '')}/v1/models`
    const r = await fetch(url, {
      method: 'GET',
      headers: cfg.llm_api_key ? { authorization: `Bearer ${cfg.llm_api_key}` } : {},
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) {
      return { test: '2. 模型清单', ok: false, detail: `HTTP ${r.status}` }
    }
    const json = (await r.json()) as { data?: Array<{ id: string }> }
    const ids = (json.data ?? []).map((m) => m.id)
    const found = ids.includes(cfg.llm_model)
    return {
      test: '2. 模型清单',
      ok: found,
      detail: found
        ? `model "${cfg.llm_model}" 在清单中`
        : `model "${cfg.llm_model}" 不在清单！可用: ${ids.join(', ') || '(空)'}`,
    }
  } catch (e) {
    return {
      test: '2. 模型清单',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

async function testBasicChat(
  cfg: Pick<RuntimeConfig, 'llm_endpoint' | 'llm_model' | 'llm_api_key'>,
): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const url = `${cfg.llm_endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.llm_api_key ? { authorization: `Bearer ${cfg.llm_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.llm_model,
        messages: [{ role: 'user', content: '回复一个字: 好' }],
        max_tokens: 8000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return {
        test: '3. 基础 chat',
        ok: false,
        detail: `HTTP ${r.status}: ${text.slice(0, 200)}`,
        latency_ms: Date.now() - start,
      }
    }
    const json = (await r.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string }
        finish_reason?: string
      }>
      error?: { message?: string }
    }
    if (json.error?.message) {
      return {
        test: '3. 基础 chat',
        ok: false,
        detail: `model 错误：${json.error.message}`,
        latency_ms: Date.now() - start,
      }
    }
    const choice = json.choices?.[0]
    const content = choice?.message?.content ?? ''
    const reasoning = choice?.message?.reasoning_content ?? ''
    const isThinking = reasoning.length > 50
    if (!content && !reasoning) {
      return {
        test: '3. 基础 chat',
        ok: false,
        detail: '空响应',
        latency_ms: Date.now() - start,
      }
    }
    if (isThinking && !content) {
      return {
        test: '3. 基础 chat',
        ok: false,
        detail: `thinking 模型：思考 ${reasoning.length} 字符但 content 空，max_tokens 不够`,
        is_thinking_model: true,
        latency_ms: Date.now() - start,
      }
    }
    return {
      test: '3. 基础 chat',
      ok: true,
      detail: `content="${content.trim()}" ${isThinking ? `(thinking ${reasoning.length} 字符)` : ''} finish=${choice?.finish_reason ?? '?'}`,
      is_thinking_model: isThinking,
      latency_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: '3. 基础 chat',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      latency_ms: Date.now() - start,
    }
  }
}

async function testStreaming(
  cfg: Pick<RuntimeConfig, 'llm_endpoint' | 'llm_model' | 'llm_api_key'>,
): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const url = `${cfg.llm_endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.llm_api_key ? { authorization: `Bearer ${cfg.llm_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.llm_model,
        messages: [{ role: 'user', content: '回复: ok' }],
        max_tokens: 8000,
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok || !r.body) {
      return {
        test: '4. Streaming',
        ok: false,
        detail: `HTTP ${r.status}`,
        latency_ms: Date.now() - start,
      }
    }
    let sawContent = false
    let sawReasoning = false
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx = buf.indexOf('\n\n')
      while (idx !== -1) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const ev = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
              }
              const d = ev.choices?.[0]?.delta
              if (d?.content) sawContent = true
              if (d?.reasoning_content) sawReasoning = true
            } catch {
              /* skip */
            }
          }
        }
        idx = buf.indexOf('\n\n')
      }
    }
    return {
      test: '4. Streaming',
      ok: sawContent,
      detail: sawContent
        ? `delta.content 收到 ${sawReasoning ? '+ thinking chunks' : ''}`
        : sawReasoning
        ? 'delta 只有 reasoning_content，无 content（max_tokens 不够 thinking）'
        : '无 delta',
      is_thinking_model: sawReasoning,
      latency_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: '4. Streaming',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      latency_ms: Date.now() - start,
    }
  }
}

async function testVision(
  cfg: Pick<RuntimeConfig, 'llm_endpoint' | 'llm_model' | 'llm_api_key'>,
): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const url = `${cfg.llm_endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.llm_api_key ? { authorization: `Bearer ${cfg.llm_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.llm_model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what color' },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${TEST_PNG_BASE64}` },
              },
            ],
          },
        ],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return {
        test: '5. Vision 支持',
        ok: false,
        detail: `HTTP ${r.status}: ${text.slice(0, 200)}`,
        supports_vision: false,
        latency_ms: Date.now() - start,
      }
    }
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (json.error?.message) {
      const msg = json.error.message
      const isCrash = /crashed|exit code|model error/i.test(msg)
      return {
        test: '5. Vision 支持',
        ok: false,
        detail: isCrash ? `模型 crash（不支持 vision）: ${msg.slice(0, 150)}` : msg,
        supports_vision: false,
        latency_ms: Date.now() - start,
      }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    return {
      test: '5. Vision 支持',
      ok: !!content,
      detail: content ? `vision OK: ${content.slice(0, 100)}` : '空响应',
      supports_vision: !!content,
      latency_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: '5. Vision 支持',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      supports_vision: false,
      latency_ms: Date.now() - start,
    }
  }
}
