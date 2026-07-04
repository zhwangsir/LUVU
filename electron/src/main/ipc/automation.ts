/**
 * Agent 自动化 IPC handlers — type-safe channels (Phase 1 G).
 *
 * 审计 C2 保留：
 * - agent:run-task 整个 task 一次性审批（goal 显示给用户确认）
 * - 其他 agent:* 原语 (click/type/key 等) 只允许主窗口 sender 调（webview/子窗口拒绝）
 */
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import {
  agentClick,
  agentClickAndType,
  agentCursorPos,
  agentDoubleClick,
  agentDrag,
  agentFind,
  agentFindAndClick,
  agentHalt,
  agentIsHalted,
  agentKey,
  agentMove,
  agentRunTask,
  agentScreenSize,
  agentScreenshot,
  agentScroll,
  agentType,
} from '@shared/channels/automation'
import * as auto from '../services/automation'
import { findAndClick, findOnScreen } from '../services/automation/vision-grounding'
import { runAgentTask, type AgentStep } from '../services/automation/agent-loop'
import { handleInvoke } from './channel-helpers'
import { requestAgentTaskApproval } from './tools'

export function registerAutomationIpc(getWindow?: () => BrowserWindow | null): void {
  /** C2: 只允许主窗口 sender — webview/iframe/子窗口拒绝。XSS 即使在主窗口也只能在此 webContents */
  const checkSender = (evt: IpcMainInvokeEvent): boolean => {
    const win = getWindow?.()
    if (!win || win.isDestroyed()) return false
    return evt.sender.id === win.webContents.id
  }
  const REJECT_SENDER = { ok: false as const, error: 'untrusted sender (sender check failed)' }

  /** action 类原语统一: sender check + try/catch */
  async function runPrim(
    evt: IpcMainInvokeEvent,
    fn: () => Promise<void> | void,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!checkSender(evt)) return REJECT_SENDER
    try {
      await fn()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  handleInvoke(agentHalt, (on, evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    auto.setHalted(on)
    return { halted: auto.isHalted() }
  })
  handleInvoke(agentIsHalted, (_p, evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return { halted: auto.isHalted() }
  })

  // 只读 IPC（cursor-pos / screen-size）也加 sender check 防 fingerprint
  handleInvoke(agentCursorPos, (_p, evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return auto.getCursorPosition()
  })
  handleInvoke(agentScreenSize, (_p, evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return auto.screenSize()
  })

  handleInvoke(agentMove, (p, evt) => runPrim(evt, () => auto.move(p.x, p.y, p.duration_ms)))
  handleInvoke(agentClick, (p, evt) => runPrim(evt, () => auto.click(p.x, p.y, p.button)))
  handleInvoke(agentDoubleClick, (p, evt) => runPrim(evt, () => auto.doubleClick(p.x, p.y)))
  handleInvoke(agentScroll, (p, evt) => runPrim(evt, () => auto.scroll(p.dy, p.dx)))
  handleInvoke(agentDrag, (p, evt) =>
    runPrim(evt, () => auto.drag(p.from_x, p.from_y, p.to_x, p.to_y)),
  )
  handleInvoke(agentType, (p, evt) => runPrim(evt, () => auto.type(p.text)))
  handleInvoke(agentKey, (p, evt) => runPrim(evt, () => auto.key(p.combo)))
  handleInvoke(agentClickAndType, (p, evt) =>
    runPrim(evt, () => auto.clickAndType(p.x, p.y, p.text)),
  )

  handleInvoke(agentScreenshot, async (region, evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try {
      const r = await auto.screenshot(region)
      return { ok: true as const, base64: r.base64, width: r.width, height: r.height }
    } catch (e) {
      return { ok: false as const, error: String(e) }
    }
  })

  // === Vision Grounding：看图找位置 ===
  handleInvoke(agentFind, (p, evt) => {
    if (!checkSender(evt)) return { ok: false, error: REJECT_SENDER.error }
    return findOnScreen(p.description)
  })
  handleInvoke(agentFindAndClick, (p, evt) => {
    if (!checkSender(evt)) return { ok: false, error: REJECT_SENDER.error }
    return findAndClick(p.description)
  })

  // === Agent Loop：目标驱动的循环（goal 走用户审批） ===
  handleInvoke(agentRunTask, async (p, evt) => {
    if (!checkSender(evt)) {
      return { ok: false, goal: p.goal, steps: [], reason: REJECT_SENDER.error }
    }
    // C2: prompt injection → plan-executor agent_task action 可能携带恶意 goal，
    // 弹窗让用户看清 goal 后才开始 agent loop
    const approved = await requestAgentTaskApproval(getWindow ?? null, p.goal, p.max_steps ?? 10)
    if (!approved) {
      return { ok: false, goal: p.goal, steps: [], reason: '用户拒绝了 agent 任务' }
    }
    return runAgentTask(p.goal, {
      ...(p.max_steps != null ? { maxSteps: p.max_steps } : {}),
      onStep: (step: AgentStep) => {
        const win = getWindow?.()
        if (win && !win.isDestroyed()) {
          win.webContents.send('agent:step', step)
        }
      },
    })
  })
}
