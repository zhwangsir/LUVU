/**
 * v0.17 P — MCP IPC handlers (Phase 1 W4 改 type-safe channel).
 */
import { type BrowserWindow } from 'electron'
import {
  callTool,
  listServers,
  listTools,
  registerServer,
  unregisterServer,
  validateMcpServerSpec,
} from '../services/mcp-client'
import {
  mcpCallTool,
  mcpListServers,
  mcpListTools,
  mcpRegister,
  mcpUnregister,
} from '@shared/channels/mcp'
import { handleInvoke } from './channel-helpers'

export function registerMcpIpc(getWindow: () => BrowserWindow | null): void {
  /** 通知 renderer tools registry 内容变了 — 避免 dialog send 热路径 IPC pre-flight。 */
  const notifyToolsChanged = (): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('tools:changed')
  }

  handleInvoke(mcpListServers, () => listServers())

  handleInvoke(mcpRegister, async (payload) => {
    // C1: renderer 传来的 spec 必须先过白名单 — 防 XSS 触发 RCE
    const v = validateMcpServerSpec(payload)
    if (!v.ok) return { ok: false, reason: v.reason }
    const r = await registerServer(v.spec)
    if (r.ok) {
      notifyToolsChanged()
      return { ok: true, toolCount: r.toolCount }
    }
    return { ok: false, reason: r.reason }
  })

  handleInvoke(mcpUnregister, (id) => {
    const r = unregisterServer(id)
    if (r.ok) notifyToolsChanged()
    return r
  })

  handleInvoke(mcpListTools, (serverId) => listTools(serverId))

  handleInvoke(mcpCallTool, async (payload) => {
    return callTool(payload.serverId, payload.toolName, payload.args)
  })
}
