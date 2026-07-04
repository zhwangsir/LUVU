/**
 * Vision Grounding — 让 LUVU 看屏幕找东西的位置
 *
 * 流程：
 *   1. 截全屏 → base64 PNG
 *   2. 调 vision LLM 问「<描述> 在屏幕上哪个位置？返回 JSON {x, y}」
 *   3. LLM 返回坐标 → 验证范围合法 → 返回给 caller
 *
 * Caller 拿到 (x, y) 后用 automation.click(x, y) 触发点击。
 * 这是 agent 智能的核心 — 让 LLM「看图操作」而不是硬编码坐标。
 */
import { loadConfig } from '../config-store'
import * as auto from './index'

export interface GroundingResult {
  ok: boolean
  x?: number
  y?: number
  confidence?: number
  raw?: string
  error?: string
}

const SYSTEM_PROMPT = `你是一个屏幕视觉定位助手。看用户截屏，找到用户描述的目标，输出 JSON。

输出格式（严格 JSON，无 markdown，无解释）：
{ "x": 数字, "y": 数字, "confidence": 0~1, "found": true/false }

规则：
- (x, y) 是目标在截图上的像素坐标（截图左上角为原点 0,0）
- found=false 时 x,y 可以为 0
- confidence 是你对这次定位的信心（0.9 = 非常确信，0.5 = 不确定，<0.3 = 几乎找不到）
- 若同时有多个候选，选最显眼/最居中的那个
- 找按钮 / 图标 / 输入框时，给的 (x, y) 应该是它的中心点`

/**
 * 让 vision LLM 找目标在屏幕上的坐标。
 * description 例："微信窗口的搜索框" / "VS Code 中的运行按钮" / "屏幕右下角的菜单"
 */
export async function findOnScreen(description: string): Promise<GroundingResult> {
  const cfg = loadConfig()
  if (!cfg.vision_endpoint || !cfg.vision_model) {
    return { ok: false, error: 'vision_endpoint / vision_model 未配置' }
  }
  // 1. 截屏
  let shot: Awaited<ReturnType<typeof auto.screenshot>>
  try {
    shot = await auto.screenshot()
  } catch (e) {
    return { ok: false, error: `截屏失败: ${e instanceof Error ? e.message : String(e)}` }
  }
  // 2. 调 vision LLM (OpenAI 兼容 multimodal)
  const base = cfg.vision_endpoint.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  const payload = {
    model: cfg.vision_model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `截图分辨率: ${shot.width}×${shot.height}。请找：${description}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${shot.base64}` } },
        ],
      },
    ],
    max_tokens: 200,
    temperature: 0.1,
    stream: false,
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 200)
      return { ok: false, error: `vision HTTP ${r.status}: ${txt}` }
    }
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    const parsed = extractJson(content)
    if (!parsed) {
      return { ok: false, raw: content, error: 'LLM 未返回有效 JSON' }
    }
    if (parsed.found === false) {
      return { ok: false, raw: content, error: 'LLM 在屏幕上没找到目标' }
    }
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    const conf = Number(parsed.confidence ?? 0.5)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, raw: content, error: '坐标不是有效数字' }
    }
    if (x < 0 || y < 0 || x > shot.width + 10 || y > shot.height + 10) {
      return { ok: false, raw: content, error: `坐标超界 (${x}, ${y}) 屏幕只有 ${shot.width}×${shot.height}` }
    }
    console.log(
      `[vision-grounding] "${description.slice(0, 60)}" → (${Math.round(x)}, ${Math.round(y)}) conf=${conf}`,
    )
    return { ok: true, x: Math.round(x), y: Math.round(y), confidence: conf, raw: content }
  } catch (e) {
    return { ok: false, error: `vision LLM 调用失败: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function extractJson(text: string): { x?: unknown; y?: unknown; confidence?: unknown; found?: boolean } | null {
  // 尝试直接 parse
  try {
    return JSON.parse(text) as ReturnType<typeof extractJson>
  } catch {
    /* */
  }
  // 尝试找 ```json ... ``` 块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try {
      return JSON.parse(fence[1]!) as ReturnType<typeof extractJson>
    } catch {
      /* */
    }
  }
  // 尝试找 { ... }
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) {
    try {
      return JSON.parse(obj[0]) as ReturnType<typeof extractJson>
    } catch {
      /* */
    }
  }
  return null
}

/**
 * 综合：找位置 + 点击。常用一站式接口。
 * 失败时不点击，返回错误。
 */
export async function findAndClick(description: string): Promise<GroundingResult> {
  const r = await findOnScreen(description)
  if (!r.ok || r.x == null || r.y == null) return r
  await auto.click(r.x, r.y)
  return r
}
