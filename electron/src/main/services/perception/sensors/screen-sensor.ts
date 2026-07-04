/**
 * 屏幕截图 sensor —— 定时/事件触发截屏，结果 publish 到 PerceptionBus。
 *
 * 实现：Electron desktopCapturer.getSources（无需 native deps）
 * 截屏后由 vision-analyzer 调用 vision LLM 转描述。
 *
 * 隐私：
 *   - 启动时 vision_enabled=false 默认（用户主动开）
 *   - 检测当前活动窗口在 blacklist 中 → 不截屏 + emit blocked event
 *   - 截屏数据 image_b64 不通过 IPC 推 renderer（avoid memory blowup）
 */
import { desktopCapturer, screen } from 'electron'
import { perception } from '../bus'
import type { PerceptionConfig, ScreenSnapshotEvent } from '@shared/perception'
import { analyzeSnapshot } from '../vision-analyzer'

interface State {
  last_periodic_at: number
}

export class ScreenSensor {
  private state: State = { last_periodic_at: 0 }
  private timer: ReturnType<typeof setInterval> | null = null
  /** 最近一次活动窗口（从 perception 拿） */
  private currentApp = ''
  private currentAppBlacklisted = false
  private unsubAppFocus: (() => void) | null = null

  constructor(private config: PerceptionConfig) {}

  start(): void {
    if (this.timer) return
    // 订阅 app focus 事件
    this.unsubAppFocus = perception.onType('app_focus_changed', (ev) => {
      this.currentApp = ev.app_name
      this.currentAppBlacklisted = ev.is_blacklisted
    })
    // 启动定时巡视
    this.timer = setInterval(() => this.maybeTakePeriodic(), 5_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unsubAppFocus?.()
  }

  updateConfig(config: PerceptionConfig): void {
    this.config = config
  }

  /** 定时巡视：每个 interval 截一次 */
  private async maybeTakePeriodic(): Promise<void> {
    if (!this.config.vision_enabled) return
    const now = Date.now()
    if (now - this.state.last_periodic_at < this.config.vision_periodic_interval_ms) return
    this.state.last_periodic_at = now
    await this.takeAndPublish('periodic_glance')
  }

  /** 外部触发（如鼠标聚焦、用户唤起） */
  async triggerSnapshot(
    reason: ScreenSnapshotEvent['reason'],
  ): Promise<void> {
    if (!this.config.vision_enabled) return
    await this.takeAndPublish(reason)
  }

  private async takeAndPublish(reason: ScreenSnapshotEvent['reason']): Promise<void> {
    // 黑名单检查
    if (this.currentAppBlacklisted) {
      perception.publish({
        type: 'screen_snapshot',
        t: Date.now(),
        reason,
        blocked_by_blacklist: true,
        blocked_app: this.currentApp,
      })
      return
    }
    const snap = await this.capture()
    if (!snap) return
    const ev: ScreenSnapshotEvent = {
      type: 'screen_snapshot',
      t: Date.now(),
      reason,
      image_b64: snap.b64,
      image_mime: 'image/jpeg',
      width: snap.width,
      height: snap.height,
    }
    perception.publish(ev)
    // 异步分析（不阻塞 sensor 主循环）
    void analyzeSnapshot(ev, this.config).catch((e) => {
      console.warn('[vision-analyzer] failed:', e)
    })
  }

  /** 截屏主屏，缩到 1280 宽（节省 vision token），返回 base64 JPEG */
  private async capture(): Promise<{ b64: string; width: number; height: number } | null> {
    try {
      const primary = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: Math.round(1280 * (primary.size.height / primary.size.width)) },
      })
      const main = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
      if (!main) return null
      const img = main.thumbnail
      const buf = img.toJPEG(75) // 75% 质量，节省 vision API 流量
      return {
        b64: buf.toString('base64'),
        width: img.getSize().width,
        height: img.getSize().height,
      }
    } catch (e) {
      console.warn('[screen-sensor] capture failed:', e)
      return null
    }
  }
}
