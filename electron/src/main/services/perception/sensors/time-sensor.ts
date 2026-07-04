/**
 * 时间 sensor — 整点变化时 publish；初始化 publish 一次。
 * 让 AttentionScheduler 能根据时间段调整行为（早安/午餐/深夜安静）。
 */
import { perception } from '../bus'

interface State {
  last_hour: number
}

function periodOf(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  if (hour >= 22) return 'night'
  return 'late_night' // 0-5
}

export class TimeSensor {
  private state: State = { last_hour: -1 }
  private timer: ReturnType<typeof setInterval> | null = null

  start(): void {
    if (this.timer) return
    this.emitNow()
    this.timer = setInterval(() => this.tick(), 60_000) // 每分钟检查
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    const now = new Date()
    const hour = now.getHours()
    if (hour !== this.state.last_hour) {
      this.emitNow()
    }
  }

  private emitNow(): void {
    const now = new Date()
    const hour = now.getHours()
    this.state.last_hour = hour
    perception.publish({
      type: 'time_changed',
      t: Date.now(),
      hour,
      period: periodOf(hour),
    })
  }
}
