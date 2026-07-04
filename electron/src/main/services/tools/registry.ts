/**
 * Tool Registry —— 主进程内的工具登记 + 调度。
 *
 * 每个 ToolImpl 是一个纯函数 (input) => Promise<output 字符串>。
 * 安全约束在 impl 内自检（如 path 必须在白名单根下）。
 */
import type { ToolDefinition, ToolInvocation, ToolResult } from '@shared/tools'

export type ToolImpl = (input: Record<string, unknown>) => Promise<string>

export interface RegisteredTool {
  def: ToolDefinition
  impl: ToolImpl
}

const tools = new Map<string, RegisteredTool>()

export function register(def: ToolDefinition, impl: ToolImpl): void {
  if (tools.has(def.name)) {
    console.warn(`[tools] override existing tool: ${def.name}`)
  }
  tools.set(def.name, { def, impl })
}

/** v0.17 P：MCP server 关停时移除该 server 暴露过的工具 */
export function unregister(name: string): boolean {
  return tools.delete(name)
}

export function list(): ToolDefinition[] {
  return [...tools.values()].map((t) => t.def)
}

export function get(name: string): RegisteredTool | undefined {
  return tools.get(name)
}

export async function invoke(call: ToolInvocation): Promise<ToolResult> {
  const tool = tools.get(call.tool_name)
  if (!tool) {
    return {
      invocation_id: call.invocation_id,
      ok: false,
      error: `tool '${call.tool_name}' not registered`,
    }
  }
  try {
    const raw = await tool.impl(call.input ?? {})
    const MAX = 16 * 1024 // 16KB 上限，超出截断
    if (raw.length > MAX) {
      return {
        invocation_id: call.invocation_id,
        ok: true,
        output: raw.slice(0, MAX) + `\n[...truncated, total ${raw.length} bytes]`,
        truncated: true,
      }
    }
    return { invocation_id: call.invocation_id, ok: true, output: raw }
  } catch (e) {
    return {
      invocation_id: call.invocation_id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function buildSummary(call: ToolInvocation): string {
  const tool = tools.get(call.tool_name)
  if (!tool) return `调用未知工具 ${call.tool_name}`
  switch (call.tool_name) {
    case 'fs_list_dir':
      return `列出目录：${String(call.input.path ?? '?')}`
    case 'fs_read_file':
      return `读取文件：${String(call.input.path ?? '?')}`
    case 'system_open_path':
      return `用默认应用打开：${String(call.input.path ?? '?')}`
    case 'system_open_url':
      return `在浏览器打开：${String(call.input.url ?? '?')}`
    case 'system_notify':
      return `桌面通知：${String(call.input.title ?? '?')}`
    default: {
      const keys = Object.keys(call.input).slice(0, 3).join(', ')
      return `${tool.def.description}（参数：${keys}）`
    }
  }
}
