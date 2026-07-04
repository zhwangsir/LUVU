/**
 * v0.17 P — MCP (Model Context Protocol) 外部 stdio server 客户端。
 *
 * MCP 是 Anthropic 提出的标准 JSON-RPC over stdio 协议，让外部进程把"工具"
 * 暴露给 host (Claude Code / LUVU 等)。我们手写最小客户端，不引入 SDK
 * 依赖膨胀风险。
 *
 * 支持：
 *   - initialize / tools/list / tools/call
 *   - 持久 stdio 进程 + JSON-RPC id 路由
 *   - 进程崩溃自动标记 error 状态
 *
 * 不支持（暂）：
 *   - prompts / resources / sampling / notifications
 *   - SSE / HTTP transport（只 stdio）
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { register as registerTool, unregister as unregisterTool } from './tools/registry'
import { adaptMcpInputSchema } from '@shared/tools'

/** MCP `tools/call` 返回 content block — 协议私有类型，不跨 IPC，故不入 @shared/。 */
interface McpContentBlock { type: string; text?: string }
interface McpCallResult { content?: McpContentBlock[] }

function mcpToolRegistryName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`
}

/** registerTool 到全局 registry，impl 转发到 callTool。
 *  risk='high' 因 MCP server 是 3rd-party 进程，未知权限边界 — 用户首次走 requestApproval。 */
function registerMcpToolToRegistry(serverId: string, serverName: string, tool: McpToolDef): void {
  const registryName = mcpToolRegistryName(serverId, tool.name)
  registerTool(
    {
      name: registryName,
      description: tool.description || `MCP tool from ${serverName}`,
      input_schema: adaptMcpInputSchema(tool.inputSchema),
      risk: 'high',
      category: 'other',
    },
    async (input) => {
      const r = await callTool(serverId, tool.name, input)
      if (!r.ok) throw new Error(r.reason)
      const content = (r.result as McpCallResult)?.content ?? []
      const texts = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
      return texts || JSON.stringify(r.result)
    },
  )
}

function unregisterMcpToolsFromRegistry(serverId: string, tools: McpToolDef[]): void {
  for (const t of tools) {
    unregisterTool(mcpToolRegistryName(serverId, t.name))
  }
  // 防御性清空 — 若未来 reload 路径复用同一 srv 对象，避免重复 unregister
  tools.length = 0
}

export interface McpServerSpec {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpServerState {
  id: string
  name: string
  command: string
  status: 'running' | 'stopped' | 'error'
  toolCount: number
}

interface RpcPending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface McpServer {
  spec: McpServerSpec
  child: ChildProcessWithoutNullStreams | null
  tools: McpToolDef[]
  status: 'running' | 'stopped' | 'error'
  pending: Map<number, RpcPending>
  nextId: number
  stdoutBuffer: string
}

const servers = new Map<string, McpServer>()
const RPC_TIMEOUT_MS = 15_000

/**
 * MCP spec 校验 — 防止 renderer XSS 触发任意 RCE (审计 C1)。
 * command: 仅允许字母/数字/`_-./`，禁止 shell 元字符 (|;&$<>` 反引号 引号 空格 newline)
 * args: 每项必须是 string
 * env: 屏蔽动态库注入 (LD_PRELOAD / DYLD_INSERT_LIBRARIES / DYLD_FORCE_FLAT_NAMESPACE)
 *
 * 注意：这只是 defense-in-depth，**用户仍需自己判断**填入的 command 是否可信
 * （MCP 设计前提是用户主动添加 server）— 但 XSS 不应能绕过用户主动确认。
 */
const MCP_CMD_ALLOWED_RE = /^[A-Za-z0-9_\-./]+$/
const MCP_ENV_BLOCKED_KEYS = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FORCE_FLAT_NAMESPACE',
  'DYLD_FALLBACK_LIBRARY_PATH',
])

export function validateMcpServerSpec(spec: unknown): { ok: true; spec: McpServerSpec } | { ok: false; reason: string } {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'spec 不是 object' }
  const s = spec as Record<string, unknown>
  if (typeof s.id !== 'string' || !s.id.trim()) return { ok: false, reason: 'id 必须是非空 string' }
  if (typeof s.name !== 'string') return { ok: false, reason: 'name 必须是 string' }
  if (typeof s.command !== 'string' || !s.command.trim()) return { ok: false, reason: 'command 必须是非空 string' }
  if (!MCP_CMD_ALLOWED_RE.test(s.command)) {
    return { ok: false, reason: `command "${s.command}" 含非法字符 (仅允许 A-Z a-z 0-9 _-./)` }
  }
  let args: string[] | undefined
  if (s.args !== undefined) {
    if (!Array.isArray(s.args)) return { ok: false, reason: 'args 必须是 string[]' }
    if (!s.args.every((a) => typeof a === 'string')) return { ok: false, reason: 'args 每项必须是 string' }
    args = s.args as string[]
  }
  let env: Record<string, string> | undefined
  if (s.env !== undefined) {
    if (typeof s.env !== 'object' || s.env === null) return { ok: false, reason: 'env 必须是 object' }
    env = {}
    for (const [k, v] of Object.entries(s.env)) {
      if (MCP_ENV_BLOCKED_KEYS.has(k)) {
        return { ok: false, reason: `env 含动态库注入键 "${k}" — 已屏蔽` }
      }
      if (typeof v !== 'string') return { ok: false, reason: `env["${k}"] 必须是 string` }
      env[k] = v
    }
  }
  return {
    ok: true,
    spec: {
      id: s.id.trim(),
      name: s.name,
      command: s.command,
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
    },
  }
}

function sendRpc<T = unknown>(srv: McpServer, method: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!srv.child || srv.status !== 'running') {
      reject(new Error(`server ${srv.spec.id} not running`))
      return
    }
    const id = srv.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
    const timeout = setTimeout(() => {
      srv.pending.delete(id)
      reject(new Error(`RPC ${method} timeout after ${RPC_TIMEOUT_MS}ms`))
    }, RPC_TIMEOUT_MS)
    srv.pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timeout,
    })
    srv.child.stdin.write(payload + '\n')
  })
}

function attachStdoutHandler(srv: McpServer): void {
  if (!srv.child) return
  srv.child.stdout.setEncoding('utf-8')
  srv.child.stdout.on('data', (chunk: string) => {
    srv.stdoutBuffer += chunk
    // MCP stdio 用行分隔 JSON
    const lines = srv.stdoutBuffer.split('\n')
    srv.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } }
        if (typeof msg.id === 'number') {
          const pending = srv.pending.get(msg.id)
          if (!pending) continue
          clearTimeout(pending.timeout)
          srv.pending.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error.message))
          else pending.resolve(msg.result ?? null)
        }
        // notifications (无 id) 暂忽略
      } catch (e) {
        console.warn(`[mcp:${srv.spec.id}] bad JSON-RPC line:`, trimmed.slice(0, 200), e)
      }
    }
  })
  srv.child.stderr.setEncoding('utf-8')
  srv.child.stderr.on('data', (chunk: string) => {
    // stderr 是 server 自己的日志 — 输出但不当错误（很多 MCP server 把 info log 写 stderr）
    console.log(`[mcp:${srv.spec.id}:stderr] ${chunk.trimEnd()}`)
  })
  srv.child.on('exit', (code) => {
    console.log(`[mcp:${srv.spec.id}] exited code=${code}`)
    srv.status = code === 0 ? 'stopped' : 'error'
    for (const pending of srv.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`server exited code=${code}`))
    }
    srv.pending.clear()
  })
  srv.child.on('error', (err) => {
    console.warn(`[mcp:${srv.spec.id}] child error:`, err.message)
    srv.status = 'error'
  })
}

/** 注册并启动一个 MCP server — 返回 tool 数量 */
export async function registerServer(spec: McpServerSpec): Promise<{ ok: true; toolCount: number } | { ok: false; reason: string }> {
  if (servers.has(spec.id)) {
    return { ok: false, reason: `server id "${spec.id}" already registered (unregister first)` }
  }
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(spec.command, spec.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(spec.env ?? {}) },
    })
  } catch (e) {
    return { ok: false, reason: `spawn failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const srv: McpServer = {
    spec,
    child,
    tools: [],
    status: 'running',
    pending: new Map(),
    nextId: 1,
    stdoutBuffer: '',
  }
  servers.set(spec.id, srv)
  attachStdoutHandler(srv)

  try {
    // 1. initialize
    await sendRpc(srv, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'luvu', version: '0.17.0' },
    })
    // initialized notification (无 id, 单向)
    if (child.stdin.writable) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    }
    // 2. tools/list
    const toolsResult = await sendRpc<{ tools?: McpToolDef[] }>(srv, 'tools/list')
    srv.tools = toolsResult?.tools ?? []
    for (const t of srv.tools) {
      registerMcpToolToRegistry(spec.id, spec.name, t)
    }
    return { ok: true, toolCount: srv.tools.length }
  } catch (e) {
    srv.status = 'error'
    try { child.kill() } catch { /* skip */ }
    servers.delete(spec.id)
    return { ok: false, reason: `handshake failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function unregisterServer(id: string): { ok: boolean } {
  const srv = servers.get(id)
  if (!srv) return { ok: false }
  unregisterMcpToolsFromRegistry(id, srv.tools)
  try { srv.child?.kill() } catch { /* skip */ }
  servers.delete(id)
  return { ok: true }
}

export function listServers(): McpServerState[] {
  return [...servers.values()].map((srv) => ({
    id: srv.spec.id,
    name: srv.spec.name,
    command: srv.spec.command,
    status: srv.status,
    toolCount: srv.tools.length,
  }))
}

export function listTools(serverId: string): McpToolDef[] {
  return servers.get(serverId)?.tools ?? []
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  const srv = servers.get(serverId)
  if (!srv) return { ok: false, reason: `server "${serverId}" not registered` }
  if (srv.status !== 'running') return { ok: false, reason: `server status=${srv.status}` }
  try {
    const result = await sendRpc(srv, 'tools/call', { name: toolName, arguments: args })
    return { ok: true, result }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** App 退出时全部关停 */
export function shutdownAll(): void {
  for (const id of [...servers.keys()]) unregisterServer(id)
}
