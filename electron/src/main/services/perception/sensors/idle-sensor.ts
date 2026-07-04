/**
 * 用户活动 sensor — 检测 idle / active 切换 + typing burst。
 *
 * 用 Electron powerMonitor.getSystemIdleTime() (秒)。
 * 这是 OS 级别的"距上次键盘/鼠标输入的时间"，无需 root。
 */
import { powerMonitor } from 'electron'
import { perception } from '../bus'
import type { PerceptionConfig } from '@shared/perception'

const IDLE_THRESHOLDS_MS = [10_000, 30_000, 60_000, 180_000, 600_000] // 多档触发

interface State {
  last_idle_ms: number
  /** 已经触发过的 idle 档位 idx */
  emitted_threshold_idx: number
  /** 最近一次 active 时间（用作 typing burst 检测） */
  active_history: number[]
}

export class IdleSensor {
  private state: State = {
    last_idle_ms: 0,
    emitted_threshold_idx: -1,
    active_history: [],
  }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private config: PerceptionConfig) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.config.idle_check_interval_ms)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  updateConfig(config: PerceptionConfig): void {
    this.config = config
    if (this.timer) {
      this.stop()
      this.start()
    }
  }

  private tick(): void {
    const now = Date.now()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const idleMs = idleSeconds * 1000

    // 从 idle 回到 active
    if (this.state.last_idle_ms > 5000 && idleMs < 2000) {
      perception.publish({
        type: 'user_active',
        t: now,
        was_idle_ms: this.state.last_idle_ms,
      })
      this.state.emitted_threshold_idx = -1
      this.state.active_history.push(now)
      if (this.state.active_history.length > 10) this.state.active_history.shift()
      this.detectTypingBurst(now)
    }
    // 仍在 idle → 按 threshold 升级触发
    if (idleMs > 5000) {
      for (let i = this.state.emitted_threshold_idx + 1; i < IDLE_THRESHOLDS_MS.length; i++) {
        if (idleMs >= IDLE_THRESHOLDS_MS[i]!) {
          perception.publish({ type: 'user_idle', t: now, idle_ms: idleMs })
          this.state.emitted_threshold_idx = i
        }
      }
    }
    this.state.last_idle_ms = idleMs
  }

  /** 短时间内多次 active 切换 = 打字 burst */
  private detectTypingBurst(now: number): void {
    const recentActive = this.state.active_history.filter((t) => now - t < 5000)
    if (recentActive.length >= 3) {
      const intensity = Math.min(1, recentActive.length / 8)
      perception.publish({ type: 'typing_burst', t: now, intensity })
    }
  }
}
