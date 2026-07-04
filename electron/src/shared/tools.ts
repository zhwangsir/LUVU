/**
 * 工具调用共享类型 —— main / preload / renderer 都用。
 *
 * 设计与 Anthropic tool_use 协议对齐（也兼容 OpenAI function calling）。
 */

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema (subset)：properties + required */
  input_schema: {
    type: 'object'
    properties: Record<
      string,
      { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description?: string; enum?: string[] }
    >
    required?: string[]
  }
  /** 风险等级：low(read-only) / medium(本地无害) / high(可能修改/外发) */
  risk: 'low' | 'medium' | 'high'
  category: 'fs' | 'shell' | 'system' | 'creative' | 'other'
}

export interface ToolInvocation {
  /** Anthropic tool_use.id，对应回 tool_result */
  invocation_id: string
  tool_name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  invocation_id: string
  ok: boolean
  output?: string
  error?: string
  /** 截断标志：output 实际超过传送上限时设 true */
  truncated?: boolean
}

export interface ApprovalRequest {
  invocation_id: string
  tool_name: string
  description: string
  risk: ToolDefinition['risk']
  input: Record<string, unknown>
  /** 风险摘要（人类可读，单行） */
  summary: string
}

export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always'

export interface ToolPolicy {
  /** key = tool_name, value = always_allow / always_deny / null（每次问） */
  [toolName: string]: 'always_allow' | 'always_deny' | undefined
}

/**
 * 把 MCP server 的 inputSchema（可能是完整 JSON Schema 或 undefined）
 * 适配成 ToolDefinition.input_schema 的子集。MCP 协议未约束 inputSchema 形状，
 * 但实际 server 多用 { type: 'object', properties, required } 子集。
 * 留在 shared/ 是因为返回类型属于 ToolDefinition；未来 SSE/HTTP MCP adapter 可复用。
 */
export function adaptMcpInputSchema(raw: unknown): ToolDefinition['input_schema'] {
  if (raw && typeof raw === 'object' && 'properties' in raw) {
    const r = raw as { properties?: Record<string, unknown>; required?: string[] }
    return {
      type: 'object',
      properties: (r.properties as ToolDefinition['input_schema']['properties']) ?? {},
      ...(Array.isArray(r.required) ? { required: r.required } : {}),
    }
  }
  return { type: 'object', properties: {} }
}
