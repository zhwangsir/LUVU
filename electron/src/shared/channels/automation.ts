/**
 * Agent 自动化 IPC channels (Phase 1 G batch 3).
 *
 * 全部 handler 都过 main 端 checkSender (主窗口 sender 才允许)；返回类型用
 * `{ok: boolean, error?: string, ...}` 统一形态，覆盖 reject 路径。
 */
import { defineChannel } from '../ipc-channel'

/** 原语统一 reject/success 形态 — sender check fail / 抛异常都走这里 */
export type AgentPrimResult = { ok: true } | { ok: false; error: string }

export const agentHalt = defineChannel<boolean, { halted: boolean } | { ok: false; error: string }>(
  'agent:halt',
)
export const agentIsHalted = defineChannel<
  void,
  { halted: boolean } | { ok: false; error: string }
>('agent:is-halted')

export const agentCursorPos = defineChannel<
  void,
  { x: number; y: number } | { ok: false; error: string }
>('agent:cursor-pos')

export const agentScreenSize = defineChannel<
  void,
  { width: number; height: number } | { ok: false; error: string }
>('agent:screen-size')

export const agentMove = defineChannel<
  { x: number; y: number; duration_ms?: number },
  AgentPrimResult
>('agent:move')

export const agentClick = defineChannel<
  { x: number; y: number; button?: 'left' | 'right' | 'middle' },
  AgentPrimResult
>('agent:click')

export const agentDoubleClick = defineChannel<{ x: number; y: number }, AgentPrimResult>(
  'agent:double-click',
)

export const agentScroll = defineChannel<{ dy: number; dx?: number }, AgentPrimResult>(
  'agent:scroll',
)

export const agentDrag = defineChannel<
  { from_x: number; from_y: number; to_x: number; to_y: number },
  AgentPrimResult
>('agent:drag')

export const agentType = defineChannel<{ text: string }, AgentPrimResult>('agent:type')

export const agentKey = defineChannel<{ combo: string[] }, AgentPrimResult>('agent:key')

export const agentClickAndType = defineChannel<
  { x: number; y: number; text: string },
  AgentPrimResult
>('agent:click-and-type')

export const agentScreenshot = defineChannel<
  { x: number; y: number; w: number; h: number } | undefined,
  | { ok: true; base64: string; width: number; height: number }
  | { ok: false; error: string }
>('agent:screenshot')

/** GroundingResult shape — sender check fail 也返同形 */
export interface AgentGroundingResult {
  ok: boolean
  x?: number
  y?: number
  confidence?: number
  raw?: string
  error?: string
}

export const agentFind = defineChannel<{ description: string }, AgentGroundingResult>(
  'agent:find',
)

export const agentFindAndClick = defineChannel<{ description: string }, AgentGroundingResult>(
  'agent:find-and-click',
)

/** 与 main/services/automation/agent-loop.AgentStep 镜像 */
export interface AgentStep {
  step: number
  ts: number
  thought?: string
  action: string
  params?: Record<string, unknown>
  result?: { ok: boolean; error?: string; coord?: { x: number; y: number } }
}

export interface AgentRunTaskResult {
  ok: boolean
  goal: string
  steps: AgentStep[]
  final_message?: string
  reason?: string
}

export const agentRunTask = defineChannel<{ goal: string; max_steps?: number }, AgentRunTaskResult>(
  'agent:run-task',
)
