/**
 * LLM endpoint 自动检测 (UX R20)。
 *
 * 用于 onboarding / settings 一键填充：扫常见本机端口 + 拉 /v1/models 拿可选模型。
 * 用户不用手填 endpoint / model id。
 *
 * 探测顺序（先 localhost 然后 127.0.0.1，因后者更稳）:
 *   - LM Studio  127.0.0.1:1234
 *   - Ollama     127.0.0.1:11434
 *   - vLLM       127.0.0.1:8000
 *   - llama.cpp  127.0.0.1:8080
 *   - 用户填的自定义 endpoint
 *
 * 每个超时 2s，全部并行（5 个 < 3s 完成）。
 *
 * 不验证模型 vision/tool 支持 — 那是 health-check 的事；本服务只做 discovery。
 */
import { validateSidecarUrl } from '../url-guard'

export interface DetectedEndpoint {
  /** 探测的 base URL (含 /v1) */
  endpoint: string
  /** 显示标签 ("LM Studio" / "Ollama" / "vLLM" / "Custom") */
  label: string
  /** 可用模型 id 列表（来自 /v1/models） */
  models: string[]
  /** 探测耗时 ms */
  latencyMs: number
}

export interface AutoDetectResult {
  /** 成功探测到的 endpoint 列表 (按 latency 排序) */
  found: DetectedEndpoint[]
  /** 失败的探测 (debug 用) */
  failed: Array<{ endpoint: string; reason: string }>
  /** 总耗时 */
  totalMs: number
}

interface ProbeTarget {
  endpoint: string
  label: string
}

const PROBE_TARGETS: ProbeTarget[] = [
  { endpoint: 'http://127.0.0.1:1234/v1', label: 'LM Studio' },
  { endpoint: 'http://127.0.0.1:11434/v1', label: 'Ollama' },
  { endpoint: 'http://127.0.0.1:8000/v1', label: 'vLLM' },
  { endpoint: 'http://127.0.0.1:8080/v1', label: 'llama.cpp' },
]

const PROBE_TIMEOUT_MS = 2000
/** SEC: 防御 rogue 本机服务返超大 JSON 拖死 main 进程 */
const MAX_RESPONSE_BYTES = 512 * 1024

/** 探测单个 endpoint — 拉 /models 拿可选模型 */
async function probeOne(target: ProbeTarget): Promise<DetectedEndpoint | { error: string }> {
  // SEC: validateSidecarUrl 已挡 metadata URL (169.254.169.254 等)
  const guard = validateSidecarUrl(target.endpoint)
  if (!guard.ok) return { error: guard.reason ?? 'invalid url' }

  const t0 = Date.now()
  const url = `${target.endpoint.replace(/\/+$/, '')}/models`
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` }
    }
    // SEC R20-fix: 限响应体大小 — 流式服务可能 hang 着回大 JSON，2s timeout 只挡 first-byte
    const buf = await resp.arrayBuffer()
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      return { error: `response too large (${buf.byteLength} bytes)` }
    }
    const data = JSON.parse(new TextDecoder().decode(buf)) as {
      data?: Array<{ id?: string }>
    }
    const models = Array.isArray(data.data)
      ? data.data.map((m) => m.id ?? '').filter((s) => s.length > 0)
      : []
    return {
      endpoint: target.endpoint,
      label: target.label,
      models,
      latencyMs: Date.now() - t0,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80) }
  }
}

/**
 * 并行扫所有 PROBE_TARGETS + 用户提供的自定义 endpoint。
 *
 * @param customEndpoint 用户手填 (可选)
 */
export async function autoDetectLlm(customEndpoint?: string): Promise<AutoDetectResult> {
  const t0 = Date.now()
  const targets: ProbeTarget[] = [...PROBE_TARGETS]
  if (customEndpoint && customEndpoint.trim()) {
    targets.push({ endpoint: customEndpoint.trim(), label: 'Custom' })
  }
  const results = await Promise.all(targets.map(async (t) => ({ target: t, res: await probeOne(t) })))

  const found: DetectedEndpoint[] = []
  const failed: AutoDetectResult['failed'] = []
  for (const { target, res } of results) {
    if ('error' in res) {
      failed.push({ endpoint: target.endpoint, reason: res.error })
    } else {
      found.push(res)
    }
  }
  // 按 latency 升序（最快的 endpoint 优先推荐）— 不可变
  const sortedFound = [...found].sort((a, b) => a.latencyMs - b.latencyMs)
  return { found: sortedFound, failed, totalMs: Date.now() - t0 }
}
