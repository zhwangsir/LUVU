/**
 * 窗口位置/大小/置顶状态持久化（~/.luvu/window-state.json）。
 *
 * 启动时返回上次保存的 bounds（验证在 display 范围内才用，否则回退默认）。
 * 关闭时主动 save 一次；运行中节流 1s save，防抖动拖动。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, type Rectangle } from 'electron'
import { getPaths } from './paths'

export interface WindowState {
  bounds: Rectangle
  alwaysOnTop: boolean
}

const DEFAULT_W = 480
const DEFAULT_H = 720

function statePath(): string {
  return join(getPaths().userDataDir, 'window-state.json')
}

/** 计算默认 bounds：屏幕右下贴边 */
function defaultBounds(): Rectangle {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  return {
    x: sw - DEFAULT_W - 40,
    y: sh - DEFAULT_H - 20,
    width: DEFAULT_W,
    height: DEFAULT_H,
  }
}

/** 检查 bounds 是否仍在任意 display 工作区内（避免拔显示器后窗口跑到屏幕外） */
function isOnVisibleDisplay(b: Rectangle): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((d) => {
    const a = d.workArea
    return (
      b.x + b.width > a.x &&
      b.x < a.x + a.width &&
      b.y + b.height > a.y &&
      b.y < a.y + a.height
    )
  })
}

export function loadWindowState(): WindowState {
  const p = statePath()
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<WindowState>
      if (
        parsed.bounds &&
        Number.isFinite(parsed.bounds.x) &&
        Number.isFinite(parsed.bounds.y) &&
        parsed.bounds.width >= 240 &&
        parsed.bounds.height >= 360 &&
        isOnVisibleDisplay(parsed.bounds)
      ) {
        return {
          bounds: parsed.bounds,
          alwaysOnTop: parsed.alwaysOnTop !== false,
        }
      }
    } catch (e) {
      console.warn('[window-state] parse failed, falling back to default:', e)
    }
  }
  return { bounds: defaultBounds(), alwaysOnTop: true }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSave(state: WindowState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow(state), 800)
}

export function saveNow(state: WindowState): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[window-state] save failed:', e)
  }
}
