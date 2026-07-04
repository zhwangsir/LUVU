/**
 * Agent Loop — 目标驱动的循环（截屏 → LLM 决策 → 执行 → 验证 → 下一步）
 *
 * 输入：goal（"打开微信" / "把这段代码复制到聊天" / "搜索 XXX 然后点第一个结果"）
 * 输出：成功 / 失败 + 操作日志
 *
 * 安全：max_steps 限制 + halt 检查 + 每步报告
 */
import { loadConfig } from '../config-store'
import * as auto from './index'
import { findAndClick, findOnScreen } from './vision-grounding'
import { scheduler } from '../attention/scheduler'

export interface AgentStep {
  step: number
  ts: number
  thought?: string
  action: string
  params?: Record<string, unknown>
  result?: { ok: boolean; error?: string; coord?: { x: number; y: number } }
}

export interface AgentRunResult {
  ok: boolean
  goal: string
  steps: AgentStep[]
  final_message?: string
  reason?: string
}

const DEFAULT_MAX_STEPS = 10
const STEP_PAUSE_MS = 700

const SYSTEM_PROMPT = `你是一个 macOS / Windows 桌面自动化助手。你看截图，决定下一步操作。

每一步只输出一个 JSON action：

\`\`\`
{ "thought": "我看到 XX，应该 YY", "action": "find_and_click", "description": "微信图标 / dock 上" }
\`\`\`

可用 action：
- find_and_click：截图找东西并点击。参数 description（自然语言描述 — 越具体越好）
- find_and_double_click：双击
- type：在当前焦点输入文字。参数 text
- key：按键。参数 combo（数组，例 ["Cmd","Space"]、["Enter"]、["Cmd","C"]）
- scroll：滚动。参数 dy（正下负上，单位 wheel ticks）
- wait：等待 N 毫秒（应用启动 / 加载时用）。参数 ms
- done：任务完成。参数 message（向用户报告）
- give_up：放弃。参数 reason

规则：
- thought 字段必填（说明你看到什么 + 为什么这么做）
- 一次只走一步，不要罗列计划
- 找按钮/图标时给详细描述（颜色/形状/位置/相邻元素）
- type 之前先确认焦点在输入框（用 find_and_click 把光标放进去）
- 如果连续 2 步都没进展 → give_up
- 不要假设固定坐标，全部用 find_and_click`

/** 已知 action 的封闭枚举 — 任何其他值都被 validator 拒绝 */
const VALID_ACTIONS = new Set([
  'find_and_click',
  'find_and_double_click',
  'type',
  'key',
  'scroll',
  'wait',
  'done',
  'give_up',
] as const)

type ValidAction =
  | 'find_and_click'
  | 'find_and_double_click'
  | 'type'
  | 'key'
  | 'scroll'
  | 'wait'
  | 'done'
  | 'give_up'

interface LlmDecision {
  thought?: string
  action: ValidAction
  description?: string
  text?: string
  combo?: string[]
  dy?: number
  ms?: number
  message?: string
  reason?: string
}

/**
 * H3 (audit): 结构化校验 LLM 输出 — 之前 `parsed as unknown as LlmDecision` 强转
 * 让 prompt injection / 异常输出能让下游用 undefined 参数驱动键鼠。
 *
 * 约束:
 * - action 必须在 VALID_ACTIONS 内 (拒绝任何其他字符串)
 * - 每个 action 的必需字段类型严格检查
 * - text 长度上限 500 (防巨型 key sequence)
 * - combo 上限 8 键 (防 N×N 组合爆炸)
 */
export function validateLlmDecision(parsed: Record<string, unknown>): { ok: true; decision: LlmDecision } | { ok: false; error: string } {
  const action = parsed.action
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action as ValidAction)) {
    return { ok: false, error: `未知 action: ${String(action).slice(0, 50)}` }
  }
  const out: LlmDecision = { action: action as ValidAction }
  if (typeof parsed.thought === 'string') out.thought = parsed.thought.slice(0, 200)

  switch (action) {
    case 'find_and_click':
    case 'find_and_double_click':
      if (typeof parsed.description !== 'string' || !parsed.description.trim()) {
        return { ok: false, error: `${action} 需要 description string` }
      }
      out.description = parsed.description.slice(0, 300)
      break
    case 'type':
      if (typeof parsed.text !== 'string') {
        return { ok: false, error: 'type 需要 text string' }
      }
      if (parsed.text.length > 500) {
        return { ok: false, error: `type text 超过 500 字符 (${parsed.text.length})` }
      }
      out.text = parsed.text
      break
    case 'key':
      if (!Array.isArray(parsed.combo) || parsed.combo.length === 0 || parsed.combo.length > 8) {
        return { ok: false, error: 'key 需要 combo string[] (1-8 键)' }
      }
      if (!parsed.combo.every((k) => typeof k === 'string' && k.length < 32)) {
        return { ok: false, error: 'key combo 每项必须是 <32 字符 string' }
      }
      out.combo = parsed.combo as string[]
      break
    case 'scroll':
      if (parsed.dy !== undefined && typeof parsed.dy !== 'number') {
        return { ok: false, error: 'scroll dy 必须是 number' }
      }
      out.dy = typeof parsed.dy === 'number' ? parsed.dy : 0
      break
    case 'wait':
      if (parsed.ms !== undefined && typeof parsed.ms !== 'number') {
        return { ok: false, error: 'wait ms 必须是 number' }
      }
      out.ms = typeof parsed.ms === 'number' ? parsed.ms : 500
      break
    case 'done':
      if (typeof parsed.message === 'string') out.message = parsed.message.slice(0, 500)
      break
    case 'give_up':
      if (typeof parsed.reason === 'string') out.reason = parsed.reason.slice(0, 500)
      break
  }
  return { ok: true, decision: out }
}

async function askLlmForNextStep(
  goal: string,
  history: AgentStep[],
  screenshotBase64: string,
  width: number,
  height: number,
): Promise<LlmDecision | { error: string }> {
  const cfg = loadConfig()
  if (!cfg.llm_endpoint || !cfg.llm_model) {
    return { error: 'LLM 未配置' }
  }
  const base = cfg.llm_endpoint.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`

  const userText = [
    `目标：${goal}`,
    `屏幕分辨率：${width}×${height}`,
    history.length > 0
      ? `已执行 ${history.length} 步：\n` +
        history
          .map((s) => `${s.step}. ${s.action}(${JSON.stringify(s.params ?? {})}) → ${s.result?.ok ? 'OK' : 'FAIL:' + s.result?.error}`)
          .join('\n')
      : '（这是第一步）',
    '当前截图见下。请输出下一步 action JSON。',
  ].join('\n\n')

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.vision_model || cfg.llm_model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
            ],
          },
        ],
        max_tokens: 400,
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!r.ok) {
      const t = (await r.text().catch(() => '')).slice(0, 200)
      return { error: `LLM HTTP ${r.status}: ${t}` }
    }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = j.choices?.[0]?.message?.content ?? ''
    const parsed = extractJson(content)
    if (!parsed) {
      return { error: `LLM 输出非 JSON: ${content.slice(0, 200)}` }
    }
    const v = validateLlmDecision(parsed)
    if (!v.ok) {
      return { error: `LLM 输出校验失败: ${v.error} (raw=${content.slice(0, 120)})` }
    }
    return v.decision
  } catch (e) {
    return { error: `LLM 调用失败: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown> } catch { /* */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) { try { return JSON.parse(fence[1]!) as Record<string, unknown> } catch { /* */ } }
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) { try { return JSON.parse(obj[0]) as Record<string, unknown> } catch { /* */ } }
  return null
}

/**
 * 运行 agent loop。
 * 任意时刻调 auto.setHalted(true) 可立即停止。
 */
export async function runAgentTask(
  goal: string,
  opts: { maxSteps?: number; onStep?: (step: AgentStep) => void } = {},
): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const steps: AgentStep[] = []
  console.log(`[agent-loop] start goal="${goal}" maxSteps=${maxSteps}`)

  // v0.21 Round C:agent 跑期间暂停 attention scheduler,避免 attention
  // 在 nut-js 操作期间每 45s 触发 plan ("glance_at_screen" 之类)撕裂 UX。
  // try/finally 保证异常路径也 resume。agent-loop / scheduler 之间无循环依赖,
  // 用顶部 static import(避 vite "dynamically imported but also statically imported" 警告)。
  scheduler.pause(`agent_task: ${goal.slice(0, 40)}`)

  try {
    return await runAgentTaskInner(goal, maxSteps, steps, opts)
  } finally {
    scheduler.resume()
  }
}

async function runAgentTaskInner(
  goal: string,
  maxSteps: number,
  steps: AgentStep[],
  opts: { onStep?: (step: AgentStep) => void },
): Promise<AgentRunResult> {
  for (let i = 1; i <= maxSteps; i++) {
    if (auto.isHalted()) {
      return { ok: false, goal, steps, reason: 'halted by user' }
    }
    // 1. 截屏
    let shot
    try {
      shot = await auto.screenshot()
    } catch (e) {
      const reason = `截屏失败: ${e instanceof Error ? e.message : String(e)}`
      return { ok: false, goal, steps, reason }
    }
    // 2. 问 LLM
    const decision = await askLlmForNextStep(goal, steps, shot.base64, shot.width, shot.height)
    if ('error' in decision) {
      const step: AgentStep = { step: i, ts: Date.now(), action: 'llm_call', result: { ok: false, error: decision.error } }
      steps.push(step)
      opts.onStep?.(step)
      return { ok: false, goal, steps, reason: decision.error }
    }
    const step: AgentStep = {
      step: i,
      ts: Date.now(),
      ...(decision.thought ? { thought: decision.thought } : {}),
      action: decision.action,
      params: extractParams(decision),
    }
    console.log(`[agent-loop] step ${i}: ${decision.action}  | ${decision.thought ?? ''}`)
    // 3. 执行
    try {
      switch (decision.action) {
        case 'find_and_click': {
          if (!decision.description) throw new Error('缺 description')
          const r = await findAndClick(decision.description)
          step.result = r.ok
            ? { ok: true, coord: { x: r.x ?? 0, y: r.y ?? 0 } }
            : { ok: false, ...(r.error ? { error: r.error } : {}) }
          break
        }
        case 'find_and_double_click': {
          if (!decision.description) throw new Error('缺 description')
          const r = await findOnScreen(decision.description)
          if (!r.ok || r.x == null || r.y == null) {
            step.result = { ok: false, ...(r.error ? { error: r.error } : {}) }
          } else {
            await auto.doubleClick(r.x, r.y)
            step.result = { ok: true, coord: { x: r.x, y: r.y } }
          }
          break
        }
        case 'type':
          if (typeof decision.text !== 'string') throw new Error('缺 text')
          await auto.type(decision.text)
          step.result = { ok: true }
          break
        case 'key':
          if (!Array.isArray(decision.combo)) throw new Error('缺 combo')
          await auto.key(decision.combo)
          step.result = { ok: true }
          break
        case 'scroll':
          await auto.scroll(decision.dy ?? 0)
          step.result = { ok: true }
          break
        case 'wait': {
          const ms = Math.min(10_000, Math.max(100, Number(decision.ms ?? 500)))
          await new Promise((r) => setTimeout(r, ms))
          step.result = { ok: true }
          break
        }
        case 'done':
          step.result = { ok: true }
          steps.push(step)
          opts.onStep?.(step)
          return {
            ok: true,
            goal,
            steps,
            final_message: decision.message ?? '完成',
          }
        case 'give_up':
          step.result = { ok: false, error: decision.reason ?? 'gave up' }
          steps.push(step)
          opts.onStep?.(step)
          return { ok: false, goal, steps, reason: decision.reason ?? 'agent gave up' }
        default:
          throw new Error(`未识别的 action: ${decision.action}`)
      }
    } catch (e) {
      step.result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    steps.push(step)
    opts.onStep?.(step)
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS))
  }
  return { ok: false, goal, steps, reason: `达到 maxSteps=${maxSteps} 未完成` }
}

function extractParams(d: LlmDecision): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (d.description) p.description = d.description
  if (d.text) p.text = d.text.slice(0, 100)
  if (d.combo) p.combo = d.combo
  if (d.dy != null) p.dy = d.dy
  if (d.ms != null) p.ms = d.ms
  return p
}
