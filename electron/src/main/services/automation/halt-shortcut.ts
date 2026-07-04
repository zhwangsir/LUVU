/**
 * 全局熔断快捷键 — v0.17 E-4
 *
 * Cmd+Shift+Esc（mac）/ Ctrl+Shift+Esc（win/linux）→ 切换 agent halt 状态
 * - 第一次按：halt → 所有 agent 动作立即拒绝
 * - 再次按：恢复
 *
 * 给桌宠"自动化"模式一个保险绳：任何时候用户感觉失控了一键即停。
 */
import { app, globalShortcut, Notification, type BrowserWindow } from 'electron'
import { isHalted, setHalted } from './index'

const ACCEL = process.platform === 'darwin' ? 'CommandOrControl+Shift+Escape' : 'Control+Shift+Escape'

let getWin: (() => BrowserWindow | null) | null = null

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show()
    }
  } catch (e) {
    console.warn('[halt-shortcut] notify failed', e)
  }
  const w = getWin?.()
  if (w && !w.isDestroyed()) {
    w.webContents.send('agent:halt-toggled', { halted: isHalted() })
  }
}

export function registerHaltShortcut(windowGetter: () => BrowserWindow | null): void {
  getWin = windowGetter
  app.whenReady().then(() => {
    const ok = globalShortcut.register(ACCEL, () => {
      const newState = !isHalted()
      setHalted(newState)
      notify(
        newState ? '🛑 Agent 已熔断' : '✅ Agent 已恢复',
        newState
          ? '所有 LUVU 自动化动作立即停止。再按 ' + ACCEL + ' 恢复'
          : 'LUVU 可以再次接受任务',
      )
      console.log(`[halt-shortcut] ${ACCEL} pressed → halt=${newState}`)
    })
    if (!ok) {
      console.warn(`[halt-shortcut] 全局快捷键 ${ACCEL} 注册失败（可能被其他应用占用）`)
    } else {
      console.log(`[halt-shortcut] 全局熔断快捷键已注册: ${ACCEL}`)
    }
  })
}

export function unregisterHaltShortcut(): void {
  try {
    globalShortcut.unregister(ACCEL)
  } catch {
    /* skip */
  }
}
