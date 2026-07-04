/**
 * 窗口控制 IPC channels (Phase 1 G batch 3).
 * 注：window:soft-drag 是 ipcMain.on (send-only)，不在 channel 范围内。
 */
import { defineChannel } from '../ipc-channel'

/** 与 Electron.Rectangle 结构对齐 — shared 层不引 electron 全局 */
export interface WindowRectangle {
  x: number
  y: number
  width: number
  height: number
}

export const windowStartDrag = defineChannel<void, { ok: boolean; reason?: string }>(
  'window:start-drag',
)

export const windowSetIgnoreMouse = defineChannel<
  { ignore: boolean; forward?: boolean },
  { ok: boolean; ignore?: boolean; forward?: boolean; reason?: string }
>('window:set-ignore-mouse')

export const windowGetBounds = defineChannel<void, WindowRectangle | null>('window:get-bounds')

export const windowSetBounds = defineChannel<
  Partial<WindowRectangle>,
  { ok: boolean; reason?: string }
>('window:set-bounds')

export const windowClose = defineChannel<void, void>('window:close')
export const windowMinimize = defineChannel<void, void>('window:minimize')
export const windowTogglePin = defineChannel<boolean, void>('window:toggle-pin')

export const cursorPollStart = defineChannel<void, void>('cursor:poll-start')
export const cursorPollStop = defineChannel<void, void>('cursor:poll-stop')
