/**
 * v0.15 D1: MCP server 注册表 — 内置 3 个简单 server。
 *
 * MVP 实现：tools 概念已有 (ipc/tools.ts)，这里加：
 * 1. 内置工具定义（不需要外部 MCP server 进程）
 * 2. tools:list 返回的 schema 让 LLM 知道能用什么
 * 3. tools:run 路由到对应执行
 *
 * 完整 MCP server discovery（外部进程协议）留 v0.16
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getActiveCharacter } from './character-store'
import { listMemories } from './memory-store'

export interface MCPTool {
  name: string
  description: string
  /** JSON schema for input */
  input_schema: Record<string, unknown>
  /** 风险级别 — high 需要 ApprovalDialog 拦 */
  risk: 'low' | 'medium' | 'high'
  /** 执行函数 */
  run: (input: Record<string, unknown>) => Promise<unknown>
}

const TOOLS: MCPTool[] = [
  {
    name: 'get_current_time',
    description: '获取当前时间（master 本机时间，含时区）',
    input_schema: { type: 'object', properties: {} },
    risk: 'low',
    run: async () => {
      const d = new Date()
      return {
        iso: d.toISOString(),
        local: d.toLocaleString('zh-CN'),
        weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()],
      }
    },
  },
  {
    name: 'list_recent_files',
    description: '列出 master 桌面或下载目录最近的文件名（不读内容）',
    input_schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', enum: ['desktop', 'downloads', 'documents'], default: 'desktop' },
        limit: { type: 'number', default: 10 },
      },
    },
    risk: 'low',
    run: async (input) => {
      const dirMap: Record<string, string> = {
        desktop: join(homedir(), 'Desktop'),
        downloads: join(homedir(), 'Downloads'),
        documents: join(homedir(), 'Documents'),
      }
      const which = (input.dir as string) ?? 'desktop'
      const path = dirMap[which]
      if (!path || !existsSync(path)) return { files: [], reason: 'dir not found' }
      const limit = Math.min(20, (input.limit as number) ?? 10)
      const files = readdirSync(path)
        .filter((f) => !f.startsWith('.'))
        .map((f) => {
          try {
            const st = statSync(join(path, f))
            return { name: f, mtime: st.mtimeMs, size: st.size, is_dir: st.isDirectory() }
          } catch {
            return null
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b!.mtime ?? 0) - (a!.mtime ?? 0))
        .slice(0, limit)
      return { dir: path, files }
    },
  },
  {
    name: 'recall_memory',
    description: '检索关于 master 的长期记忆（按关键词模糊匹配）',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词或问题' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    risk: 'low',
    run: async (input) => {
      const active = getActiveCharacter()
      if (!active) return { memories: [] }
      const q = ((input.query as string) ?? '').toLowerCase()
      const all = listMemories(active.id, { limit: 100 })
      const hits = all
        .filter((m) => m.text.toLowerCase().includes(q))
        .slice(0, (input.limit as number) ?? 5)
      return { memories: hits.map((m) => ({ kind: m.kind, text: m.text, ts: m.ts })) }
    },
  },
]

export function listMCPTools(): Array<Omit<MCPTool, 'run'>> {
  return TOOLS.map(({ run, ...rest }) => rest)
}

export async function runMCPTool(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; reason?: string }> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { ok: false, reason: `unknown tool: ${name}` }
  try {
    const result = await tool.run(input)
    return { ok: true, result }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

/** v0.15 D2: 把 MCP tools 注入 system prompt，告诉 LLM 能用什么工具 */
export function buildMCPToolsPrompt(): string {
  if (TOOLS.length === 0) return ''
  const lines = [`# 你可以用的工具（MCP）`]
  lines.push(`需要查信息或做事时，输出 tool_use JSON：{"tool_use": {"name": "tool_name", "input": {...}}}`)
  lines.push(`工具列表：`)
  for (const t of TOOLS) {
    lines.push(`- ${t.name}: ${t.description}`)
  }
  return lines.join('\n')
}
