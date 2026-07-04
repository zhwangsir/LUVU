/**
 * Tool IPC + 审批协议（主进程视角）— type-safe channels (Phase 1 G).
 *
 * 工作流：
 *   1. LLM 在 stream 中产生 tool_use → renderer 调 'tools:run' 把 ToolInvocation 发给主进程
 *   2. 主进程查 policy:
 *      - always_allow → 直接执行
 *      - always_deny → 直接返回 denied result
 *      - undefined → webContents.send('tools:approval-request', req)，等 renderer 回 'tools:approval-decision'
 *   3. 用户 allow/deny → 主进程根据决策执行/拒绝
 *   4. 结果通过 invoke promise 返回给 renderer
 */
import { ipcMain, type BrowserWindow } from 'electron'
import {
  mcpListBuiltin,
  mcpRun,
  toolsList,
  toolsPolicyClear,
  toolsPolicyGet,
  toolsPolicySet,
  toolsRelevant,
  toolsRun,
} from '@shared/channels/tools'
import {
  buildSummary,
  invoke as invokeTool,
  list as listTools,
} from '../services/tools/registry'
import * as policy from '../services/tools/policy-store'
import { registerBuiltins } from '../services/tools/builtin'
import { loadConfig } from '../services/config-store'
import type { ApprovalDecision, ApprovalRequest, ToolInvocation } from '@shared/tools'
import { handleInvoke } from './channel-helpers'

const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()

/** 不可逆/高危动作：即使信任模式，默认仍弹确认（agent_confirm_dangerous 可关） */
const DANGEROUS_TOOLS = new Set(['fs_delete', 'fs_move', 'system_run_shell'])

export function registerToolIpc(getWindow: () => BrowserWindow | null): void {
  // M7: getWindow 传给 builtins 让 creative_generate_sticker 能 emit comfyui:progress
  registerBuiltins(getWindow)

  handleInvoke(toolsList, () => listTools())

  // v0.21：按需检索相关工具（语义 + 常驻核心 + 关键词兜底）
  handleInvoke(toolsRelevant, async (payload) => {
    const { selectRelevantTools } = await import('../services/tools/tool-retrieval')
    return selectRelevantTools(payload.query, payload.k ?? 12)
  })

  // v0.15 D1+D2: MCP 内置工具
  handleInvoke(mcpListBuiltin, async () => {
    const { listMCPTools } = await import('../services/mcp-registry')
    return listMCPTools()
  })
  handleInvoke(mcpRun, async (payload) => {
    const { runMCPTool } = await import('../services/mcp-registry')
    return runMCPTool(payload.name, payload.input)
  })

  handleInvoke(toolsPolicyGet, () => policy.load())
  handleInvoke(toolsPolicySet, (payload) => {
    policy.setPolicy(payload.tool_name, payload.decision)
    return policy.load()
  })
  handleInvoke(toolsPolicyClear, () => {
    policy.clearAll()
    return policy.load()
  })

  handleInvoke(toolsRun, async (call) => {
    const p = policy.get(call.tool_name)
    if (p === 'always_deny') {
      return {
        invocation_id: call.invocation_id,
        ok: false,
        error: '用户先前设置永远拒绝此工具',
      }
    }
    let decision: ApprovalDecision = 'allow_once'
    // v0.21 真控信任模式：全放行时未设 policy 的工具也直接执行（always_deny 仍拒）。
    // 但不可逆的 DANGEROUS 动作（删/移动覆盖/shell）默认仍弹确认，除非用户关掉 agent_confirm_dangerous。
    const cfg = loadConfig()
    const trustMode = cfg.agent_trust_mode === true
    const gatedDangerous = DANGEROUS_TOOLS.has(call.tool_name) && cfg.agent_confirm_dangerous !== false
    if (p === 'always_allow' || (trustMode && !gatedDangerous)) {
      decision = 'allow_once'
    } else {
      // 走审批
      decision = await requestApproval(getWindow, call)
      if (decision === 'allow_always') policy.setPolicy(call.tool_name, 'always_allow')
      if (decision === 'deny_always') policy.setPolicy(call.tool_name, 'always_deny')
    }
    if (decision === 'deny_once' || decision === 'deny_always') {
      return {
        invocation_id: call.invocation_id,
        ok: false,
        error: '用户拒绝此次调用',
      }
    }
    return invokeTool(call)
  })

  /** renderer 回应审批 — ipcMain.on (renderer→main 单向 send，不走 invoke channel) */
  ipcMain.on(
    'tools:approval-decision',
    (_evt, payload: { invocation_id: string; decision: ApprovalDecision }) => {
      const resolver = pendingApprovals.get(payload.invocation_id)
      if (resolver) {
        pendingApprovals.delete(payload.invocation_id)
        resolver(payload.decision)
      }
    },
  )
}

function requestApproval(
  getWindow: () => BrowserWindow | null,
  call: ToolInvocation,
): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return resolve('deny_once')
    const tool = listTools().find((t) => t.name === call.tool_name)
    const req: ApprovalRequest = {
      invocation_id: call.invocation_id,
      tool_name: call.tool_name,
      description: tool?.description ?? '(unknown tool)',
      risk: tool?.risk ?? 'high',
      input: call.input,
      summary: buildSummary(call),
    }
    pendingApprovals.set(call.invocation_id, resolve)
    win.webContents.send('tools:approval-request', req)

    // 60s 超时自动拒绝（避免悬挂）
    setTimeout(() => {
      if (pendingApprovals.has(call.invocation_id)) {
        pendingApprovals.delete(call.invocation_id)
        resolve('deny_once')
      }
    }, 60_000)
  })
}

/**
 * C2: agent:run-task 入口审批 — 一次性弹窗确认整个 task goal。
 * 复用 tools 审批弹窗 UI（同一个 ApprovalRequest 通道），
 * 用 invocation_id 前缀 `agent-task-` 区分。
 * 返回 true = allow，false = deny。120s 超时拒绝。
 */
export function requestAgentTaskApproval(
  getWindow: BrowserWindow | (() => BrowserWindow | null) | null,
  goal: string,
  maxSteps: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    // v0.21 真控信任模式：全放行时 agent 自主任务不弹窗直接批准（Cmd+Shift+Esc 仍可熔断）
    if (loadConfig().agent_trust_mode === true) return resolve(true)
    const win = typeof getWindow === 'function' ? getWindow() : getWindow
    if (!win || win.isDestroyed()) return resolve(false)
    const id = `agent-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const req: ApprovalRequest = {
      invocation_id: id,
      tool_name: 'agent:run-task',
      description: `Agent 自主操控鼠标/键盘最多 ${maxSteps} 步`,
      risk: 'high',
      input: { goal, max_steps: maxSteps },
      summary: `🤖 LUVU 想自己操作电脑：${goal.slice(0, 100)}`,
    }
    pendingApprovals.set(id, (decision) => {
      resolve(decision === 'allow_once' || decision === 'allow_always')
    })
    win.webContents.send('tools:approval-request', req)
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id)
        resolve(false)
      }
    }, 120_000)
  })
}
