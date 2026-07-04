/**
 * Alpha 命中：根据 canvas 当前帧的 alpha 通道判断鼠标是否「在立绘像素上」。
 *
 * 这个能力直接决定窗口何时穿透 / 何时响应。
 * 我们维护一张降采样的 alpha mask（默认 96x144），16ms 更新一次。
 */
import type { Live2DRenderer } from '../render/live2d-renderer'

export interface AlphaSamplerOptions {
  sampleW?: number
  sampleH?: number
  /** alpha 阈值（0~255），高于此值视为命中立绘 */
  threshold?: number
  /** 采样频率 ms */
  updateMs?: number
}

export class AlphaSampler {
  private mask: Uint8Array
  private sw: number
  private sh: number
  private threshold: number
  private timer: ReturnType<typeof setInterval> | null = null
  private offscreen: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** 第一次 sample 是否完成；未完成前 hits() 一律返回 true 防止被误判穿透 */
  private ready = false
  /** 任何像素 ≥ threshold 才认为采样成功；全 0 表示 WebGL preserveDrawingBuffer 还没生效 */
  private hasAnyOpaque = false

  constructor(
    private renderer: Live2DRenderer,
    opts: AlphaSamplerOptions = {},
  ) {
    this.sw = opts.sampleW ?? 96
    this.sh = opts.sampleH ?? 144
    this.threshold = opts.threshold ?? 16
    this.mask = new Uint8Array(this.sw * this.sh)
    this.offscreen = document.createElement('canvas')
    this.offscreen.width = this.sw
    this.offscreen.height = this.sh
    const ctx = this.offscreen.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('AlphaSampler: cannot get 2d context')
    this.ctx = ctx
    const updateMs = opts.updateMs ?? 80
    // 立即首采（不等 80ms 第一个 interval）
    requestAnimationFrame(() => this.sample())
    this.timer = setInterval(() => this.sample(), updateMs)
  }

  /** 判断屏幕坐标（窗口内）是否命中立绘 */
  hits(x: number, y: number, winW: number, winH: number): boolean {
    if (winW <= 0 || winH <= 0) return false
    // 关键：第一次 sample 还没完成 / 采样到的画面完全透明（说明 WebGL buffer 没保留）
    // → 安全 fallback：当作命中（让窗口保持响应，宁可少穿透不可点不到）
    if (!this.ready || !this.hasAnyOpaque) return true
    const sx = Math.floor((x / winW) * this.sw)
    const sy = Math.floor((y / winH) * this.sh)
    if (sx < 0 || sy < 0 || sx >= this.sw || sy >= this.sh) return false
    return (this.mask[sy * this.sw + sx] ?? 0) >= this.threshold
  }

  /** 暴露状态供诊断 */
  isReady(): boolean {
    return this.ready
  }
  hasOpaque(): boolean {
    return this.hasAnyOpaque
  }

  destroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private sample(): void {
    const app = this.renderer.app
    if (!app || !app.renderer) return
    const src = app.view as HTMLCanvasElement
    try {
      this.ctx.clearRect(0, 0, this.sw, this.sh)
      this.ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.sw, this.sh)
      const data = this.ctx.getImageData(0, 0, this.sw, this.sh).data
      let anyOpaque = false
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const a = data[i + 3] ?? 0
        this.mask[j] = a
        if (a >= this.threshold) anyOpaque = true
      }
      this.hasAnyOpaque = anyOpaque
      this.ready = true
    } catch (e) {
      console.warn('[alpha] sample failed', e)
    }
  }
}
