/**
 * MCP 外部工具 IPC channels (Phase 1 W4)。
 */
import { defineChannel } from '../ipc-channel'

export interface McpServerState {
  id: string
  name: string
  command: string
  status: 'running' | 'stopped' | 'error'
  toolCount: number
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpServerSpec {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export const mcpListServers = defineChannel<void, McpServerState[]>('mcp:list-servers')

export const mcpRegister = defineChannel<
  McpServerSpec,
  { ok: boolean; toolCount?: number; reason?: string }
>('mcp:register')

export const mcpUnregister = defineChannel<string, { ok: boolean }>('mcp:unregister')

export const mcpListTools = defineChannel<string, McpToolDef[]>('mcp:list-tools')

export const mcpCallTool = defineChannel<
  { serverId: string; toolName: string; args: Record<string, unknown> },
  { ok: boolean; result?: unknown; reason?: string }
>('mcp:call-tool')
