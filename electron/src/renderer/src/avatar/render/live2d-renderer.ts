/**
 * Live2D 渲染器 —— 基于 pixi-live2d-display + PixiJS 6。
 *
 * 设计原则：用 SDK 标准 API，不去 hack internalModel 字段（之前的 noop 替换会让
 * SDK update 链路崩 "updateParameters is not a function"）。
 *
 * 行为：
 *   - 加载 .model3.json
 *   - 视线跟随 → 调用 `model.focus(x, y)`，SDK 自动更新 Param 链路
 *   - 自动眨眼：用 SDK 默认 EyeBlink，但把间隔调慢到 4~7s（避免之前的过频）
 *   - 嘴型同步：每帧 setParameterValueById('ParamMouthOpenY', value)
 */
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { ExtLive2DModel } from './live2d-types'

Live2DModel.registerTicker(PIXI.Ticker)

export interface RendererOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  backgroundAlpha?: number
}

export interface ModelOptions {
  scale?: number
  offsetX?: number
  offsetY?: number
}

export class Live2DRenderer {
  readonly app: PIXI.Application
  model: Live2DModel | null = null
  private gazeX = 0
  private gazeY = 0
  private lipsyncValue = 0
  /** Phase 1 W3: wlipsync 输出的元音权重，驱动 ParamMouthForm + ParamMouthA/E/I/O/U */
  private vowelWeights: { A: number; E: number; I: number; O: number; U: number } = { A: 0, E: 0, I: 0, O: 0, U: 0 }
  private destroyed = false
  /** 自增加载序号，用于在并发加载时识别「最新一次请求」，丢弃过期结果 */
  private loadSeq = 0

  constructor(opts: RendererOptions) {
    this.app = new PIXI.Application({
      view: opts.canvas,
      width: opts.width,
      height: opts.height,
      backgroundAlpha: opts.backgroundAlpha ?? 0,
      antialias: true,
      autoStart: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // 关键：让 alpha sampler 能 drawImage canvas 拿到真实像素
      // 默认 false 时 swap buffer 后 readPixels 全是透明，导致鼠标命中判定永远失败
      preserveDrawingBuffer: true,
    })
    // 让我们的参数覆盖（嘴型）在 model.update 之后跑：用 LOW 优先级
    this.app.ticker.add(this.tick, this, PIXI.UPDATE_PRIORITY.LOW)
  }

  async loadModel(modelUrl: string, opts: ModelOptions = {}): Promise<void> {
    if (this.destroyed) throw new Error('renderer destroyed')
    const mySeq = ++this.loadSeq

    console.log(`[live2d] LOAD seq=${mySeq} url=${modelUrl.slice(-120)}`)

    // 1. 同步清理舞台上所有旧模型（不只是 this.model —— race 时可能挂了多个）
    this.disposeAllStageModels()
    console.log(`[live2d] LOAD seq=${mySeq} step=dispose-old-done`)

    // 2. 异步加载新模型
    let model: Live2DModel
    try {
      model = await Live2DModel.from(modelUrl, { autoInteract: false })
    } catch (e) {
      console.error(`[live2d] LOAD seq=${mySeq} step=FROM-FAILED`, e)
      throw e
    }
    const ext = model as ExtLive2DModel
    console.log(
      `[live2d] LOAD seq=${mySeq} step=from-done`,
      {
        hasInternal: !!ext.internalModel,
        originalW: ext.internalModel?.originalWidth,
        originalH: ext.internalModel?.originalHeight,
        textureCount: (model as { textures?: unknown[] }).textures?.length,
      },
    )

    // 3. 加载完成时如果不是最新请求，立即销毁这个 zombie，不挂上 stage
    if (this.destroyed || mySeq !== this.loadSeq) {
      console.log(`[live2d] LOAD seq=${mySeq} step=STALE — discard`)
      try {
        // 同 disposeAllStageModels：不销毁 texture/baseTexture，避免污染 PIXI cache
        model.destroy({ children: true, texture: false, baseTexture: false })
      } catch {
        /* ignore */
      }
      return
    }

    // 4. 再次清理 —— 防御并发期间又有别的 model 被挂上
    this.disposeAllStageModels()
    this.model = model
    this.app.stage.addChild(model)
    console.log(`[live2d] LOAD seq=${mySeq} step=stage-added`)

    model.anchor.set(0.5, 0.5)
    // v0.21 全屏画板：默认按屏高比例给合理大小（不再 fill 满全屏），
    // opts.scale/offsetX/offsetY 是该角色持久化的相对系数 + 画布内偏移
    this.fitModelToCanvas(opts.scale ?? 1.0, opts.offsetX ?? 0, opts.offsetY ?? 0)

    // 调慢默认眨眼到 4500~7500 ms（默认是 4000 ms，那个频率太频繁）
    try {
      const eyeBlink = (model as ExtLive2DModel).internalModel?.eyeBlink
      if (eyeBlink && typeof eyeBlink.setBlinkingInterval === 'function') {
        // 把整个眨眼周期拉长
        eyeBlink.setBlinkingInterval(6000)
      }
    } catch (e) {
      console.warn('[live2d] tune eyeBlink failed', e)
    }

    // v0.8.2: 启动 idle motion — pixi-live2d-display 不自动播放 idle group，
    // 必须显式 motion()。扫描 motion groups 选第一个非空 group 触发循环。
    this.startIdleMotion()
  }

  private idleGroup = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 启动 idle 循环 motion。
   * 修订（v0.8.2）：放弃依赖未文档化的 isFinished API（不同 SDK 版本可能不存在或行为不同）。
   * 改为基于 setTimeout 的「自驱动调度」：触发 motion → 等估算 duration → 再触发下一个。
   * priority=2 IDLE 不会打断 NORMAL/FORCE motion，所以即使 NORMAL motion 正在播，
   * IDLE 也只是被 SDK 自动排队，不会造成视觉打断。
   */
  private startIdleMotion(): void {
    if (!this.model) return
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    try {
      const m = this.model as ExtLive2DModel
      const settings = m.internalModel?.settings
      const motions: Record<string, unknown[]> =
        settings?.motions ?? settings?.json?.FileReferences?.Motions ?? {}
      const groupNames = Object.keys(motions).filter(
        (g) => Array.isArray(motions[g]) && motions[g].length > 0,
      )
      if (groupNames.length === 0) {
        console.warn('[live2d] no motion groups — model is static. 用 Heal 按钮补 idle motion')
        return
      }
      const priority = ['Idle', 'idle', '', 'Recovered', 'Generated']
      this.idleGroup =
        priority.find((g) => motions[g] && (motions[g] as unknown[]).length > 0) || groupNames[0]!

      console.log(
        `[live2d] start idle: group="${this.idleGroup}" (${(motions[this.idleGroup] as unknown[]).length} motions)`,
      )

      this.scheduleNextIdle(50)
    } catch (e) {
      console.warn('[live2d] startIdleMotion failed', e)
    }
  }

  /**
   * 调度下一个 idle motion。setTimeout(estimated_duration + safety)，到时 trigger。
   * 不依赖 isFinished 这种未文档化 API；纯基于估算的 motion duration 推进。
   * 默认 4.5 秒（多数 Live2D idle motion 3-6 秒），priority=2 不会打断 NORMAL/FORCE。
   */
  private scheduleNextIdle(delayMs: number): void {
    if (this.destroyed) return
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.model || !this.idleGroup) return
      try {
        const m = this.model as ExtLive2DModel
        // priority=2 (Cubism IDLE) — 自动排队不打断 NORMAL/FORCE
        m.motion?.(this.idleGroup, undefined, 2)
      } catch (e) {
        console.warn('[live2d] idle motion trigger failed', e)
      }
      // 4.5 秒后再调度下一个（覆盖大多数 idle motion duration）
      this.scheduleNextIdle(4500)
    }, delayMs)
  }

  /** 视线目标：相对于 canvas 的本地坐标。SDK 自动转换到 stage 坐标。 */
  setGaze(x: number, y: number): void {
    if (!this.model) return
    this.gazeX = x
    this.gazeY = y
    try {
      // model.focus(x, y, instant?) - 平滑跟随
      this.model.focus(x, y)
    } catch (e) {
      console.warn('[live2d] focus failed', e)
    }
  }

  /** 嘴型 0~1 (mouthOpen) */
  setLipsync(value: number): void {
    this.lipsyncValue = clamp(value, 0, 1)
  }

  /**
   * Phase 1 W3: wlipsync 输出的 AEIOU 元音权重 — 驱动嘴型形状不只是开合。
   * tick 每帧把权重写入：
   *   - ParamMouthForm: 元音形状 (-1 圆 O/A ~ +1 扁 I/E)
   *   - ParamMouthA/E/I/O/U: VRoid 风格模型独立参数 (Cubism 4 模型多数没有，但 SDK 静默忽略未知 param)
   */
  setVowelWeights(weights: { A: number; E: number; I: number; O: number; U: number }): void {
    this.vowelWeights = {
      A: clamp(weights.A, 0, 1),
      E: clamp(weights.E, 0, 1),
      I: clamp(weights.I, 0, 1),
      O: clamp(weights.O, 0, 1),
      U: clamp(weights.U, 0, 1),
    }
  }

  /**
   * v0.17 B+D：触发 Live2D 模型 motion group 内的随机 motion。
   * priority=3 (Cubism NORMAL) → 会打断 idle 但不会被新的 idle 顶掉；适合「响应情绪」一次性动作。
   * group 不存在时静默返回 false。
   */
  playMotionGroup(group: string): boolean {
    if (!this.model || !group) return false
    try {
      const m = this.model as ExtLive2DModel
      const settings = m.internalModel?.settings
      const motions: Record<string, unknown[]> =
        settings?.motions ?? settings?.json?.FileReferences?.Motions ?? {}
      const arr = motions[group]
      if (!Array.isArray(arr) || arr.length === 0) return false
      // 第二参数 undefined → pixi-live2d-display 在该 group 内 Math.random()
      // priority=3 (NORMAL) 打断当前 idle 让动作可见
      m.motion?.(group, undefined, 3)
      console.log(`[live2d] playMotionGroup "${group}" (${arr.length} candidates)`)
      return true
    } catch (e) {
      console.warn('[live2d] playMotionGroup failed', group, e)
      return false
    }
  }

  /**
   * 列出模型实际拥有的 motion group 名(motions 对象的 key)。
   * 用途:hover 微反应 / 情绪动作 从「模型真有的组」里选,而非硬编码 FlickLeft 等 —
   * 不同模型命名差异大(官方 Mark 用 TapBody,胡桃用 Flick*),硬编码会大量 no-op。
   */
  listMotionGroups(): string[] {
    if (!this.model) return []
    try {
      const m = this.model as ExtLive2DModel
      const settings = m.internalModel?.settings
      const motions: Record<string, unknown[]> =
        settings?.motions ?? settings?.json?.FileReferences?.Motions ?? {}
      return Object.keys(motions).filter((k) => {
        const arr = motions[k]
        return Array.isArray(arr) && arr.length > 0
      })
    } catch {
      return []
    }
  }

  /**
   * P5: 列出模型所有 expression id (优先 settings.expressions 数组；fallback FileReferences.Expressions)。
   * 返回 expressionId/filename 列表 — pixi-live2d-display setExpression() 接受这些。
   */
  listExpressions(): string[] {
    if (!this.model) return []
    try {
      const m = this.model as ExtLive2DModel
      const settings = m.internalModel?.settings
      // 多种来源兼容（Cubism 4 标准在 FileReferences.Expressions, 旧版在 settings.expressions）
      const raw =
        settings?.expressions ??
        settings?.json?.FileReferences?.Expressions ??
        []
      const list = Array.isArray(raw) ? raw : []
      return list
        .map((e: unknown) => {
          if (typeof e === 'string') return e
          if (e && typeof e === 'object') {
            const obj = e as { Name?: string; name?: string; File?: string; file?: string }
            return obj.Name ?? obj.name ?? obj.File ?? obj.file ?? ''
          }
          return ''
        })
        .filter((s) => s.length > 0)
    } catch {
      return []
    }
  }

  /**
   * P5: 切换到指定 expression。
   * @param idOrName  expression id/name/File，跟 listExpressions 返回的一致
   * @returns true 表示触发成功
   */
  setExpression(idOrName: string): boolean {
    if (!this.model || !idOrName) return false
    try {
      const m = this.model as ExtLive2DModel
      // pixi-live2d-display 顶层 .expression(name) API (Live2DModelInternal type)
      if (typeof m.expression === 'function') {
        const r = m.expression(idOrName)
        // r 可能是 boolean 或 Promise<boolean>；同步 false 视为失败，
        // Promise 视为已触发（异步 set 通常会完成）
        console.log(`[live2d] setExpression "${idOrName}" via .expression()`)
        return typeof r === 'boolean' ? r : true
      }
      // fallback: 内部 expressionManager
      const em = m.internalModel?.motionManager?.expressionManager
      if (em && typeof em.setExpression === 'function') {
        em.setExpression(idOrName)
        console.log(`[live2d] setExpression "${idOrName}" via expressionManager`)
        return true
      }
      return false
    } catch (e) {
      console.warn('[live2d] setExpression failed', idOrName, e)
      return false
    }
  }

  /**
   * 强制写入一个参数（每帧自定义动作的入口）。
   * v0.7.4：motion-player 用这个来播 MotionDraft。
   */
  applyParam(id: string, value: number): void {
    if (!this.model) return
    try {
      const cm = (this.model as ExtLive2DModel).internalModel?.coreModel
      if (cm && typeof cm.setParameterValueById === 'function') {
        cm.setParameterValueById(id, value)
      }
    } catch {
      /* ignore */
    }
  }

  /** motion-player 检查模型已就绪 */
  hasModel(): boolean {
    return this.model != null
  }

  /** 重设大小（窗口 resize） */
  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h)
    if (this.model) this.applyTransform()
  }

  /**
   * v0.9: 默认 auto-fit canvas 85% + 优先用 preferences 里 user 调过的 scale。
   * 没 preferences 就基于 internalModel.originalWidth/Height 等比 fit。
   * userScaleHint 是「user 想要的相对系数」（默认 1.0 = 完全 auto-fit；0.5 = 半大；2 = 双倍）。
   * 实际 model.scale = fitScale * userScaleHint。
   */
  private userScaleHint = 1.0
  private userOffsetX = 0
  private userOffsetY = 0
  /** 第一次 fit 时算出的 base scale（model logical → 默认约半屏高） */
  private autoFitBase = 0.001
  private applyTransform(): void {
    if (!this.model) return
    const dpr = window.devicePixelRatio || 1
    const canvasW = this.app.renderer.width / dpr
    const canvasH = this.app.renderer.height / dpr
    const finalScale = this.autoFitBase * this.userScaleHint
    this.model.scale.set(finalScale)
    // v0.21 全屏画板：立绘可在画布内自由定位（相对画布中心的 x/y 偏移）
    this.model.x = canvasW / 2 + this.userOffsetX
    this.model.y = canvasH / 2 + this.userOffsetY
  }

  /** 给外部（zoom 按钮）调用：增量改 userScaleHint，立刻 re-apply */
  applyScaleHint(scaleHint: number): void {
    this.userScaleHint = Math.max(0.1, Math.min(5, scaleHint))
    this.applyTransform()
  }
  /** 当前的 userScaleHint（dock 上 +/- 按钮要看当前值再增减） */
  getScaleHint(): number {
    return this.userScaleHint
  }

  /**
   * v0.21 全屏画板：立绘在画布内自由拖动。
   * dx/dy 为屏幕 CSS px 增量（canvas 全屏 → CSS px 与画布坐标 1:1）。
   * clamp 让立绘中心始终留在画布内，避免拖丢。
   */
  nudgeOffset(dx: number, dy: number): void {
    const dpr = window.devicePixelRatio || 1
    const canvasW = this.app.renderer.width / dpr
    const canvasH = this.app.renderer.height / dpr
    const maxX = canvasW / 2
    const maxY = canvasH / 2
    this.userOffsetX = Math.max(-maxX, Math.min(maxX, this.userOffsetX + dx))
    this.userOffsetY = Math.max(-maxY, Math.min(maxY, this.userOffsetY + dy))
    this.applyTransform()
  }

  /** 当前立绘偏移（相对画布中心，CSS px）— 持久化用 */
  getOffset(): { x: number; y: number } {
    return { x: this.userOffsetX, y: this.userOffsetY }
  }

  /**
   * v0.21：头部锚点（画布 CSS px）—— 气泡跟随立绘头顶定位。
   * = 立绘中心 (model.x/y) 上移半个渲染高度到包围盒顶部（约头顶）。
   */
  getHeadAnchor(): { x: number; y: number } | null {
    if (!this.model) return null
    const h = this.model.height || 0
    return { x: this.model.x, y: this.model.y - h / 2 }
  }

  /** v0.21 全屏画板：默认约 DEFAULT_AVATAR_RATIO 屏高，可 userScaleHint 再放缩；offsetX/Y 定位 */
  fitModelToCanvas(userScale: number, offsetX: number, offsetY: number): void {
    if (!this.model) return
    this.userScaleHint = userScale
    this.userOffsetX = offsetX
    this.userOffsetY = offsetY
    const dpr = window.devicePixelRatio || 1
    const canvasW = this.app.renderer.width / dpr
    const canvasH = this.app.renderer.height / dpr
    // 默认立绘高度约占画布高的一半（全屏画板下 fill 满会过大）
    const DEFAULT_AVATAR_RATIO = 0.5

    let modelW = 0
    let modelH = 0
    const internal = (this.model as ExtLive2DModel).internalModel
    if (internal) {
      modelW = Number(internal.originalWidth) || 0
      modelH = Number(internal.originalHeight) || 0
    }
    if (modelW <= 0 || modelH <= 0) {
      try {
        this.model.scale.set(1)
        const bounds = this.model.getLocalBounds()
        if (bounds.width > 0) modelW = bounds.width
        if (bounds.height > 0) modelH = bounds.height
      } catch {
        /* skip */
      }
    }
    if (modelW <= 0) modelW = 2048
    if (modelH <= 0) modelH = 2048

    // 按高度定默认大小；对超宽模型做宽度 clamp（不超过画布 90% 宽）
    let base = (canvasH * DEFAULT_AVATAR_RATIO) / modelH
    if (base * modelW > canvasW * 0.9) base = (canvasW * 0.9) / modelW
    this.autoFitBase = base
    this.applyTransform()
    console.log(
      `[live2d] fit canvas=${canvasW.toFixed(0)}x${canvasH.toFixed(0)} model=${modelW.toFixed(0)}x${modelH.toFixed(0)} base=${this.autoFitBase.toFixed(4)} userHint=${userScale} off=${offsetX.toFixed(0)},${offsetY.toFixed(0)}`,
    )
  }

  /** legacy 保留 — 未使用 */
  private _legacyFit(userScale: number, offsetY: number): void {
    if (!this.model) return
    this.userScaleHint = userScale
    this.userOffsetY = offsetY
    const dpr = window.devicePixelRatio || 1
    const canvasW = this.app.renderer.width / dpr
    const canvasH = this.app.renderer.height / dpr

    // 目标占比：填充 canvas 85%（留 padding 避免头/边被裁）
    const FILL_RATIO = 0.85
    const targetW = canvasW * FILL_RATIO
    const targetH = canvasH * FILL_RATIO

    // 优先：用 Cubism internalModel 的 originalWidth/Height（logical canvas size）
    // 这是模型设计时的舞台尺寸，最权威反映模型「应该」多大
    let modelW = 0
    let modelH = 0
    const internal = (this.model as ExtLive2DModel).internalModel
    if (internal) {
      modelW = Number(internal.originalWidth) || 0
      modelH = Number(internal.originalHeight) || 0
    }

    // Fallback：scale=1 下取 getLocalBounds（实际渲染包围盒）
    if (modelW <= 0 || modelH <= 0) {
      try {
        this.model.scale.set(1)
        const bounds = this.model.getLocalBounds()
        if (bounds.width > 0) modelW = bounds.width
        if (bounds.height > 0) modelH = bounds.height
      } catch {
        /* skip */
      }
    }

    // 终极 fallback：用经验值 2048（多数 Cubism 4 模型的 canvas）
    if (modelW <= 0) modelW = 2048
    if (modelH <= 0) modelH = 2048

    // 等比 fit
    const fitScale = Math.min(targetW / modelW, targetH / modelH) * userScale
    this.model.scale.set(fitScale)

    this.model.x = canvasW / 2
    this.model.y = canvasH / 2 + offsetY

    console.log(
      `[live2d] fit canvas=${canvasW.toFixed(0)}x${canvasH.toFixed(0)} model=${modelW.toFixed(0)}x${modelH.toFixed(0)} scale=${fitScale.toFixed(3)}`,
    )
  }

  /** v0.8.2: 隐藏模型自带的背景 part（id 含 bg/background/back） */
  private hideBackgroundParts(model: ExtLive2DModel): void {
    try {
      const coreModel = model.internalModel?.coreModel
      if (!coreModel) return
      const partCount =
        typeof coreModel.getPartCount === 'function' ? coreModel.getPartCount() : 0
      const hidden: string[] = []
      for (let i = 0; i < partCount; i++) {
        const id = String(coreModel.getPartId?.(i) ?? '').toLowerCase()
        if (/^(bg|background|back|backdrop|stage_bg|haikei)\b/.test(id) || id.includes('background')) {
          if (typeof coreModel.setPartOpacityByIndex === 'function') {
            coreModel.setPartOpacityByIndex(i, 0)
            hidden.push(id)
          } else if (typeof coreModel.setPartOpacity === 'function') {
            coreModel.setPartOpacity(coreModel.getPartId?.(i) ?? '', 0)
            hidden.push(id)
          }
        }
      }
      if (hidden.length) {
        console.log(`[live2d] hide bg parts: ${hidden.join(', ')}`)
      }
    } catch (e) {
      console.warn('[live2d] hideBackgroundParts failed', e)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.app.ticker.remove(this.tick, this)
    this.disposeAllStageModels()
    this.model = null
    try {
      this.app.destroy(false, { children: true })
    } catch (e) {
      console.warn('[live2d] destroy app failed', e)
    }
  }

  /** 一次清掉 stage 上挂着的所有 Live2DModel —— race 时可能多于 1 个 */
  private disposeAllStageModels(): void {
    const stage = this.app.stage
    const victims: PIXI.DisplayObject[] = []
    for (const child of stage.children) {
      if (child instanceof Live2DModel) victims.push(child)
    }
    for (const v of victims) {
      try {
        stage.removeChild(v)
        // 关键：texture/baseTexture 不能销毁 —— PIXI 全局 cache 里同一 baseTexture
        // 被多个 model 实例共享。重载同一 model3.json 时新 model 拿到的是 cache 里
        // 「已销毁的 baseTexture」→ 纹理失效 → 渲染纯黑剪影。
        // 只销毁 mesh/geometry，让 PIXI/Live2D 的 cache 自然管理纹理生命周期。
        ;(v as Live2DModel).destroy({ children: true, texture: false, baseTexture: false })
      } catch (e) {
        console.warn('[live2d] dispose stage model failed', e)
      }
    }
    this.model = null
  }

  private tick = (): void => {
    if (this.destroyed || !this.model) return
    // 我们只覆盖嘴型 —— 其它参数（眨眼、视线、姿态）走 SDK 默认链路
    try {
      const cm = (this.model as ExtLive2DModel).internalModel?.coreModel
      if (!cm || typeof cm.setParameterValueById !== 'function') return
      cm.setParameterValueById('ParamMouthOpenY', this.lipsyncValue)
      // Phase 1 W3: AEIOU → ParamMouthForm
      //   A/O: 圆嘴 → form 负
      //   I/E: 扁嘴 → form 正
      //   U: 中性偏负（撅嘴）
      //   SDK 对未知 param silent ignore，所以可以无脑全 set
      const v = this.vowelWeights
      const form = (v.I + v.E * 0.5) - (v.O + v.A * 0.3) - v.U * 0.4
      cm.setParameterValueById('ParamMouthForm', clamp(form, -1, 1))
      // VRoid / 高级模型独立 AEIOU 参数（Cubism 4 标准模型通常没有，SDK 静默 ignore）
      cm.setParameterValueById('ParamMouthA', v.A)
      cm.setParameterValueById('ParamMouthE', v.E)
      cm.setParameterValueById('ParamMouthI', v.I)
      cm.setParameterValueById('ParamMouthO', v.O)
      cm.setParameterValueById('ParamMouthU', v.U)
    } catch {
      /* ignore */
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
