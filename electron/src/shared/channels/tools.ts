/**
 * Tools + MCP IPC channels (Phase 1 G batch 4).
 *
 * 注：
 *   - tools:approval-decision 是 ipcMain.on（renderer → main 单向 send），不在 channel 范围内
 *   - tools:approval-request 是 main → renderer 推送
 */
import { defineChannel } from '../ipc-channel'
import type { ToolDefinition, ToolInvocation, ToolPolicy, ToolResult } from '../tools'

export const toolsList = defineChannel<void, ToolDefinition[]>('tools:list')

/** v0.21：按需检索 —— 按 query 返回相关工具子集（常驻核心 ∪ 语义 top-K ∪ 关键词兜底） */
export const toolsRelevant = defineChannel<{ query: string; k?: number }, ToolDefinition[]>('tools:relevant')

export const toolsRun = defineChannel<ToolInvocation, ToolResult>('tools:run')

export const toolsPolicyGet = defineChannel<void, ToolPolicy>('tools:policy-get')

export const toolsPolicySet = defineChannel<
  { tool_name: string; decision: 'always_allow' | 'always_deny' | null },
  ToolPolicy
>('tools:policy-set')

export const toolsPolicyClear = defineChannel<void, ToolPolicy>('tools:policy-clear')

// === MCP (v0.15 D1+D2 内置工具) ===
/** MCPTool 信息形 — 不带 run 函数 (mirror main/services/mcp-registry.MCPTool) */
export interface MCPToolInfo {
  name: string
  description: string
  /** JSON schema for input */
  input_schema: Record<string, unknown>
  /** 风险级别 — high 需要 ApprovalDialog 拦 */
  risk: 'low' | 'medium' | 'high'
}

/** runMCPTool 返回 */
export interface MCPRunResult {
  ok: boolean
  result?: unknown
  reason?: string
}

export const mcpListBuiltin = defineChannel<void, MCPToolInfo[]>('mcp:list')

export const mcpRun = defineChannel<
  { name: string; input: Record<string, unknown> },
  MCPRunResult
>('mcp:run')
