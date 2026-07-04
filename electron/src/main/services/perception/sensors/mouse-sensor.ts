/**
 * 鼠标感知 sensor。
 *
 * 复用现有 cursor-poll (window-control.ts) 拿坐标，
 * 但语义升级：不再直接驱动视线，而是 publish 给 PerceptionBus。
 *
 * 输出事件：
 *   mouse_moved   — 每次移动 (节流 100ms)
 *   mouse_stayed  — 停留 > threshold 触发一次
 *   mouse_left_window — 鼠标离开 LUVU 窗口
 */
import { screen, type BrowserWindow } from 'electron'
import { perception } from '../bus'
import type { PerceptionConfig } from '@shared/perception'

const MOVE_THROTTLE_MS = 100
const STAY_DETECT_MS = 500 // 多久没动算「静止」检测
const SIGNIFICANT_MOVE_PX = 4 // < 4px 不算动

interface State {
  last_screen_x: number
  last_screen_y: number
  last_in_window: boolean
  last_move_at: number
  stayed_emitted: boolean
  stay_start_at: number
}

export class MouseSensor {
  private state: State = {
    last_screen_x: -1,
    last_screen_y: -1,
    last_in_window: false,
    last_move_at: 0,
    stayed_emitted: false,
    stay_start_at: 0,
  }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private config: PerceptionConfig,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 50)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  updateConfig(config: PerceptionConfig): void {
    this.config = config
  }

  private tick(): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    const now = Date.now()
    const cursor = screen.getCursorScreenPoint()

    const b = win.getBounds()
    const wx = cursor.x - b.x
    const wy = cursor.y - b.y
    const inWin = wx >= 0 && wy >= 0 && wx < b.width && wy < b.height

    const dx = Math.abs(cursor.x - this.state.last_screen_x)
    const dy = Math.abs(cursor.y - this.state.last_screen_y)
    const moved = dx + dy >= SIGNIFICANT_MOVE_PX

    if (moved) {
      // 节流 publish
      if (now - this.state.last_move_at >= MOVE_THROTTLE_MS) {
        perception.publish({
          type: 'mouse_moved',
          t: now,
          screen_x: cursor.x,
          screen_y: cursor.y,
          window_x: wx,
          window_y: wy,
          in_window: inWin,
        })
        this.state.last_move_at = now
      }
      // 离开窗口检测
      if (this.state.last_in_window && !inWin) {
        perception.publish({ type: 'mouse_left_window', t: now })
      }
      this.state.last_screen_x = cursor.x
      this.state.last_screen_y = cursor.y
      this.state.last_in_window = inWin
      this.state.stayed_emitted = false
      this.state.stay_start_at = now
    } else {
      // 没动 → 检测停留
      if (this.state.stay_start_at === 0) this.state.stay_start_at = now
      const stayDuration = now - this.state.stay_start_at
      if (
        !this.state.stayed_emitted &&
        stayDuration >= this.config.mouse_stayed_threshold_ms &&
        stayDuration >= STAY_DETECT_MS
      ) {
        perception.publish({
          type: 'mouse_stayed',
          t: now,
          screen_x: cursor.x,
          screen_y: cursor.y,
          duration_ms: stayDuration,
        })
        this.state.stayed_emitted = true
      }
    }
  }
}
