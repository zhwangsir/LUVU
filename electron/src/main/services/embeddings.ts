/**
 * 文本 embedding —— 真调 OpenAI-compat /v1/embeddings；未配 endpoint 或失败 → hash 兜底。
 *
 * v0.21：先给「工具按需检索」用（tool-retrieval）；memory RAG 后续也可切到这里
 * （目前 memory 仍用 fallbackEmbedding，见 memory-extractor 的 v0.22 TODO）。
 */
import { loadConfig } from './config-store'
import { fallbackEmbedding } from './memory-extractor'

function embeddingsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '')
  if (/\/embeddings$/.test(base)) return base
  if (/\/v1$/.test(base)) return `${base}/embeddings`
  return `${base}/v1/embeddings`
}

/** 返回 text 的 embedding 向量。真 endpoint 优先，失败/未配 → 32 维 hash 兜底。 */
export async function embedText(text: string): Promise<number[]> {
  const cfg = loadConfig()
  const endpoint = cfg.embedding_endpoint?.trim()
  const model = cfg.embedding_model?.trim()
  if (!endpoint || !model) return fallbackEmbedding(text)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(embeddingsUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text.slice(0, 8000) }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
      const vec = json.data?.[0]?.embedding
      if (Array.isArray(vec) && vec.length > 0) return vec
      throw new Error('响应无 embedding')
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    console.warn('[embeddings] 失败，回退 hash:', e instanceof Error ? e.message : e)
    return fallbackEmbedding(text)
  }
}

/** cosine 相似度；长度不一致（真/hash 混用）返回 0，安全降级。 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    ma += a[i]! * a[i]!
    mb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb)
  return denom ? dot / denom : 0
}
