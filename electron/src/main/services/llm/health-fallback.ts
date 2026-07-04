/**
 * LLM 智能 health probe + auto-fallback (v0.17 D-2)
 *
 * 启动时 + 每 N 分钟轮询一次：
 *   1. ping cfg.llm_model 是否在 endpoint 真有实例（小 max_tokens=1 请求 < 8s）
 *   2. 不可用 → 列 /v1/models → 测试前几个，找到第一个 alive 的
 *   3. 自动写回 config.json，console.warn 通知
 *   4. 同时支持 vision_model 走同样逻辑
 */
import { loadConfig, saveConfig } from '../config-store'
import type { RuntimeConfig } from '@shared/types'

const PROBE_TIMEOUT_MS = 8000
const RECHECK_INTERVAL_MS = 5 * 60_000 // 5 分钟

let recheckTimer: ReturnType<typeof setInterval> | null = null

/** POST 一字符 prompt 看模型能不能回 */
async function pingModel(endpoint: string, model: string): Promise<{ alive: boolean; reason?: string }> {
  if (!endpoint || !model) return { alive: false, reason: 'empty endpoint/model' }
  const base = endpoint.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (r.ok) return { alive: true }
    const text = (await r.text().catch(() => '')).slice(0, 200)
    return { alive: false, reason: `HTTP ${r.status} ${text}` }
  } catch (e) {
    return { alive: false, reason: e instanceof Error ? e.message.slice(0, 150) : String(e) }
  }
}

/** 列 endpoint 已注册模型 */
async function listModels(endpoint: string): Promise<string[]> {
  if (!endpoint) return []
  const base = endpoint.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!r.ok) return []
    const j = (await r.json()) as { data?: Array<{ id?: string }> }
    return (j.data ?? []).map((m) => m.id).filter((x): x is string => !!x)
  } catch {
    return []
  }
}

/**
 * 找一个 alive 的 model。
 * 优先级：
 *   1. 当前 currentModel（如果还活）
 *   2. 列出所有模型 → 按推荐顺序探测前 N 个
 */
async function findAliveModel(
  endpoint: string,
  currentModel: string,
  maxProbes = 6,
): Promise<{ model: string | null; tried: string[] }> {
  const tried: string[] = []
  // 1. 先测当前的
  if (currentModel) {
    tried.push(currentModel)
    if ((await pingModel(endpoint, currentModel)).alive) {
      return { model: currentModel, tried }
    }
  }
  // 2. 列模型 → 排个序（instruct/chat 优先，太大的（>100B）放后）
  const all = await listModels(endpoint)
  const scored = all
    .filter((m) => m !== currentModel) // 已测过
    .map((m) => {
      const lower = m.toLowerCase()
      let score = 0
      if (lower.includes('instruct')) score += 30
      if (lower.includes('chat')) score += 25
      if (/qwen|llama|gemma|kimi|minimax/i.test(m)) score += 10
      // 小模型优先（启动快）
      const sizeMatch = m.match(/(\d+)b/i)
      if (sizeMatch) {
        const size = parseInt(sizeMatch[1]!, 10)
        if (size <= 30) score += 8
        else if (size <= 70) score += 3
        else if (size >= 200) score -= 10
      }
      // 8bit / 4bit 量化都行
      if (/4bit|8bit/.test(lower)) score += 2
      // thinking / reasoning 模型扣分（慢）
      if (/thinking|reason/i.test(m)) score -= 5
      // code 模型对 chat 场景扣分
      if (/code/i.test(m)) score -= 8
      return { m, score }
    })
    .sort((a, b) => b.score - a.score)

  for (const { m } of scored.slice(0, maxProbes)) {
    tried.push(m)
    const r = await pingModel(endpoint, m)
    if (r.alive) return { model: m, tried }
  }
  return { model: null, tried }
}

/**
 * 检查并切换。返回新 model 名（无变化或失败 returns null）。
 */
export async function checkAndFallbackLlm(): Promise<{
  changed: boolean
  newModel: string | null
  tried: string[]
  reason?: string
}> {
  const cfg = loadConfig()
  if (!cfg.llm_endpoint || !cfg.llm_model) {
    return { changed: false, newModel: null, tried: [], reason: 'no-config' }
  }
  console.log(`[llm-health] probing ${cfg.llm_endpoint} model=${cfg.llm_model}`)
  const result = await findAliveModel(cfg.llm_endpoint, cfg.llm_model)
  if (!result.model) {
    console.warn(`[llm-health] ⚠️ 该 endpoint 上没有任何 alive 模型（试了 ${result.tried.length} 个）`)
    return { changed: false, newModel: null, tried: result.tried, reason: 'all-dead' }
  }
  if (result.model === cfg.llm_model) {
    console.log(`[llm-health] ✓ current model ${cfg.llm_model} alive`)
    return { changed: false, newModel: result.model, tried: result.tried }
  }
  // 切换并写回 config
  const patch: Partial<RuntimeConfig> = { llm_model: result.model }
  // vision 也跟着切（如果同 endpoint）
  if (cfg.vision_endpoint === cfg.llm_endpoint || !cfg.vision_endpoint) {
    patch.vision_model = result.model
  }
  saveConfig({ ...cfg, ...patch })
  console.warn(
    `[llm-health] 🔄 模型 ${cfg.llm_model} 失活 → 自动切到 ${result.model}（试了 ${result.tried.join(', ')}）`,
  )
  return { changed: true, newModel: result.model, tried: result.tried }
}

/** 启动后台周期检查 — 在 main 进程启动时调一次 */
export function startLlmHealthLoop(): void {
  // 立即跑一次（不阻塞启动）
  void checkAndFallbackLlm().catch((e) => console.warn('[llm-health] initial check failed', e))
  if (recheckTimer) return
  recheckTimer = setInterval(() => {
    void checkAndFallbackLlm().catch((e) => console.warn('[llm-health] periodic check failed', e))
  }, RECHECK_INTERVAL_MS)
  console.log(`[llm-health] background loop started, recheck every ${RECHECK_INTERVAL_MS / 60_000}min`)
}

export function stopLlmHealthLoop(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer)
    recheckTimer = null
  }
}
