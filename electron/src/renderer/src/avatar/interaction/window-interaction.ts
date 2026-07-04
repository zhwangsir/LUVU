/**
 * 窗口交互编排：拖动 + 穿透状态机 + 视线跟随 + 右键菜单。
 *
 * 设计：
 *   - 默认 ignore=false（响应一切，UI 永远可点）
 *   - 主进程 cursor poll（每 50ms）独立于 webview mousemove，鼠标静止时也能切换
 *   - 鼠标在 UI / 立绘 alpha 命中 → ignore=false；落在透明区 → ignore=true (forward=true)
 *   - 左键长按立绘 → native 拖动；右键立绘 → emit 'avatar:contextmenu' 让 App 弹菜单
 */
import type { AlphaSampler } from './alpha-hit'
import type { Live2DRenderer } from '../render/live2d-renderer'
import { bus } from '../../infra/eventbus'

export interface InteractionOpts {
  container: HTMLElement
  sampler: AlphaSampler
  renderer: Live2DRenderer
  /** 是否启用穿透切换（设置面板等模态打开时返回 false → 永远响应） */
  passthroughEnabled?: () => boolean
}

export class WindowInteraction {
  private currentIgnore = false
  private dragging = false
  private destroyed = false
  /** v0.21 全屏画板：拖立绘时记录上一帧屏幕坐标，算增量驱动立绘在画布内移动 */
  private lastDragScreen: { x: number; y: number } | null = null
  private passthroughEnabled: () => boolean
  private unsubCursor: (() => void) | null = null

  constructor(private opts: InteractionOpts) {
    this.passthroughEnabled = opts.passthroughEnabled ?? (() => true)

    opts.container.addEventListener('mousemove', this.onMouseMove)
    opts.container.addEventListener('mousedown', this.onMouseDown)
    opts.container.addEventListener('contextmenu', this.onContextMenu)
    opts.container.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onWindowMouseMove)

    void window.api.window.setIgnoreMouse(false)
    void window.api.cursor.pollStart()
    this.unsubCursor = window.api.cursor.onTick((pt) => this.onCursorTick(pt))
  }

  /** 强制响应（设置面板 / 右键菜单打开时） */
  forceInteractive(on: boolean): void {
    // v0.17：模态打开/关闭 = DOM 命中元素栈变了，缓存的 hit-test 结果立即失效
    this.lastHitTest = null
    if (on) {
      this.currentIgnore = false
      void window.api.window.setIgnoreMouse(false)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.opts.container.removeEventListener('mousemove', this.onMouseMove)
    this.opts.container.removeEventListener('mousedown', this.onMouseDown)
    this.opts.container.removeEventListener('contextmenu', this.onContextMenu)
    this.opts.container.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onWindowMouseMove)
    this.unsubCursor?.()
    this.unsubCursor = null
    void window.api.cursor.pollStop()
  }

  /** 主进程 cursor tick：唯一负责切 ignore 状态的源 */
  private onCursorTick(pt: { x: number; y: number; inside: boolean }): void {
    if (this.destroyed) return
    if (!this.passthroughEnabled()) {
      if (this.currentIgnore) this.applyIgnore(false)
      return
    }
    if (!pt.inside) return
    const rect = this.opts.container.getBoundingClientRect()
    // v0.17 perf：alpha sampler 是 O(1) cheap，先短路。命中 alpha 就跳过更贵的
    // elementsFromPoint + getComputedStyle 链。90% 桌宠场景鼠标在立绘像素上。
    const overAlpha = this.opts.sampler.hits(pt.x, pt.y, rect.width, rect.height)
    const hit = overAlpha || this.isOverUiElement(pt.x, pt.y)
    bus.emit('avatar:mouse-inside', { inside: hit, x: pt.x, y: pt.y })
    this.applyIgnore(!hit)
  }

  private applyIgnore(ignore: boolean): void {
    if (this.currentIgnore === ignore) return
    this.currentIgnore = ignore
    if (ignore) {
      void window.api.window.setIgnoreMouse(true, true)
    } else {
      void window.api.window.setIgnoreMouse(false)
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.destroyed) return
    // v0.8 主体性架构：
    // 鼠标位置不再直接驱动视线 — 这是反射式。
    // 位置作为「感知信号」由主进程 MouseSensor 通过 PerceptionBus 收集，
    // AttentionScheduler + BehaviorPlanner 决定何时/是否看向鼠标。
    // 此 callback 保留只为：兼容拖动 fallback 软件模拟（onWindowMouseMove）。
    void e
  }

  /**
   * 判断屏幕坐标是否落在 UI 元素上（非 canvas、非 body）。
   * 透明区点击会落到 body 或 canvas 上（这两者算「非 UI」，应当穿透）。
   */
  /** v0.17 perf：缓存 hit-test 结果（鼠标静止时复用，避免每 50ms tick 都 elementsFromPoint） */
  private lastHitTest: { x: number; y: number; result: boolean; t: number } | null = null
  private static readonly HIT_CACHE_TTL_MS = 250

  private isOverUiElement(clientX: number, clientY: number): boolean {
    // 缓存命中：鼠标位置相同且 250ms 内重用
    const cache = this.lastHitTest
    if (
      cache &&
      Math.abs(cache.x - clientX) < 2 &&
      Math.abs(cache.y - clientY) < 2 &&
      Date.now() - cache.t < WindowInteraction.HIT_CACHE_TTL_MS
    ) {
      return cache.result
    }
    // v0.17：用 elementsFromPoint(复数) 拿命中栈，跳过所有 pointer-events:none 的层。
    // 关键 — 之前 .ui-overlay-layer / .sticker-layer 等全屏透明层会被 elementFromPoint
    // 返回，让拖动 / 穿透判定误以为"在 UI 上"立即 return。
    const stack = document.elementsFromPoint(clientX, clientY)
    let result = false
    for (const el of stack) {
      if (el === document.body || el === document.documentElement) break
      if (el.tagName === 'CANVAS') break
      if (el.classList.contains('live2d-stage')) break
      if (el.classList.contains('root')) break
      // 跳过 pointer-events:none 的透明层，继续向下找真正实质性的 UI
      if (window.getComputedStyle(el).pointerEvents === 'none') continue
      result = true
      break
    }
    this.lastHitTest = { x: clientX, y: clientY, result, t: Date.now() }
    return result
  }

  /** 拖立绘：按屏幕坐标增量 emit avatar:move，Live2DInstance 把立绘在画布内挪位 */
  private onWindowMouseMove = (e: MouseEvent): void => {
    if (!this.dragging || !this.lastDragScreen) return
    const dx = e.screenX - this.lastDragScreen.x
    const dy = e.screenY - this.lastDragScreen.y
    if (dx === 0 && dy === 0) return
    this.lastDragScreen = { x: e.screenX, y: e.screenY }
    bus.emit('avatar:move', { dx, dy })
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if (this.destroyed) return
    if (!this.passthroughEnabled()) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return

    // v0.21 全屏画板：窗口固定全屏，拖立绘 = 在画布内移动立绘（不再 native window drag）
    this.dragging = true
    this.lastDragScreen = { x: e.screenX, y: e.screenY }
    e.preventDefault()
  }

  /** 滚轮在立绘 alpha 上 → 缩放立绘（复用 avatar:zoom 通道） */
  private onWheel = (e: WheelEvent): void => {
    if (this.destroyed) return
    if (!this.passthroughEnabled()) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return
    e.preventDefault()
    bus.emit('avatar:zoom', { delta: e.deltaY < 0 ? 0.1 : -0.1 })
  }

  /** 右键立绘 → 弹主菜单。在 UI 元素 / 透明区上右键不响应（让 OS / Vue 子组件自己处理） */
  private onContextMenu = (e: MouseEvent): void => {
    if (this.destroyed) return
    if (!this.passthroughEnabled()) return
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return
    e.preventDefault()
    bus.emit('avatar:contextmenu', { x: e.clientX, y: e.clientY })
  }

  private onMouseUp = (): void => {
    this.dragging = false
    this.lastDragScreen = null
  }
}
