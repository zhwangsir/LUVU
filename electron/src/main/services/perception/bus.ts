/**
 * 主进程内的感知事件总线。
 *
 * 不是 IPC — 是主进程内 publisher (sensors) → subscriber (scheduler) 的直接通道。
 * IPC 用于把摘要事件（不含 image_b64 等大数据）推到 renderer 做调试面板。
 *
 * 设计：
 * - 同步 publish（避免重排序）
 * - 订阅者可选 type 过滤
 * - 保留最近 N 个事件用于 BehaviorPlanner 取上下文
 */
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import type { PerceptionEvent, PerceptionEventType } from '@shared/perception'

const HISTORY_LIMIT = 200

class PerceptionBus extends EventEmitter {
  private history: PerceptionEvent[] = []
  private win: BrowserWindow | null = null

  /** sensors 调用 */
  publish(event: PerceptionEvent): void {
    this.history.push(event)
    if (this.history.length > HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - HISTORY_LIMIT)
    }
    this.emit('event', event)
    this.emit(event.type, event)

    // 推到 renderer（用于调试面板）— 去掉重型字段
    if (this.win && !this.win.isDestroyed()) {
      const safe = sanitizeForIpc(event)
      this.win.webContents.send('perception:event', safe)
    }
  }

  /** 订阅所有 */
  onAny(cb: (e: PerceptionEvent) => void): () => void {
    this.on('event', cb)
    return () => this.off('event', cb)
  }

  /** 订阅特定类型 */
  onType<T extends PerceptionEventType>(
    type: T,
    cb: (e: Extract<PerceptionEvent, { type: T }>) => void,
  ): () => void {
    const wrapped = (ev: unknown): void => cb(ev as Extract<PerceptionEvent, { type: T }>)
    this.on(type, wrapped)
    return () => this.off(type, wrapped)
  }

  /** 取最近 N 个事件（按时间倒序） */
  recent(limit = 50, filter?: (e: PerceptionEvent) => boolean): PerceptionEvent[] {
    const list = filter ? this.history.filter(filter) : this.history
    return list.slice(-limit).reverse()
  }

  /** 按类型查最近一条 */
  latest<T extends PerceptionEventType>(
    type: T,
  ): Extract<PerceptionEvent, { type: T }> | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const ev = this.history[i]!
      if (ev.type === type) return ev as Extract<PerceptionEvent, { type: T }>
    }
    return undefined
  }

  /** 接收 main-window 实例（用于 IPC 推送） */
  attachWindow(getWin: () => BrowserWindow | null): void {
    const win = getWin()
    this.win = win
  }

  setWindow(win: BrowserWindow | null): void {
    this.win = win
  }

  clearHistory(): void {
    this.history.length = 0
  }
}

/**
 * 去掉 PerceptionEvent 中不适合 IPC 传输的大字段（如 image_b64）。
 * v0.13: image_b64 是 optional string，直接 omit 即可，无需 type cast。
 */
function sanitizeForIpc(event: PerceptionEvent): PerceptionEvent {
  if (event.type === 'screen_snapshot' && event.image_b64) {
    // 把大 base64 去掉，保留摘要信息（receiver 知道有图但不传字节）
    const { image_b64, ...rest } = event
    return { ...rest, image_b64_size: image_b64.length } as PerceptionEvent
  }
  return event
}

export const perception = new PerceptionBus()
