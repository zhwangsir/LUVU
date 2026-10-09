/**
 * Cubism shader 单例的跨 context 隔离(RFC 0002 Q2 多实例渲染修复)。
 *
 * 根因(2026-10-09 同框真机验证 + 最小复现实验定位):
 *   pixi-live2d-display/cubism4 的 CubismShader_WebGL 是模块级单例,持有一份
 *   `_shaderSets`(已编译 GL program)+ `gl`(当前 context)。它只在模型加载
 *   (startUp / updateWebGLContext)时被指向新 context,逐帧 draw(gl) 不重指。
 *   多个 PIXI.Application(每实例一个 canvas = 独立 WebGL context)下,
 *   「最后加载的模型」把单例留在自己的 context 上,其余实例逐帧用异 context 的
 *   program/buffer → WebGL INVALID_OPERATION → 画布 0 像素(只有 active 看得见)。
 *
 * 修复:每次 app 渲染前(prerender)把单例切到该 app 的 context,并按 context
 *   缓存/恢复各自的 _shaderSets —— 每套 program 只编译一次,切换零重编译。
 *   单例对象本身经 CubismShader_WebGL.getInstance() 公开导出,无需改库文件。
 */
import { CubismShader_WebGL } from 'pixi-live2d-display/cubism4'
/** 每 context 一份 shader 集的缓存(key = WebGL context,app 销毁随 GC 回收) */
const shaderSetsByContext = new WeakMap<WebGLRenderingContext, unknown[]>()

/** 已安装标志(单例是模块级全局,首次成功切换时打点) */
let logged = false

/**
 * 纯交换逻辑(可单测):把单例切到 target gl;
 * 若单例当前持有别的 context 的 shader 集,先收回缓存,再取出 target 的集。
 * @returns 是否发生了切换
 */
export function swapShaderContext(
  singleton: { gl: WebGLRenderingContext | null; _shaderSets: unknown[] },
  targetGl: WebGLRenderingContext,
  cache: WeakMap<WebGLRenderingContext, unknown[]>,
): boolean {
  if (singleton.gl === targetGl && singleton._shaderSets.length > 0) return false
  if (singleton.gl && singleton._shaderSets.length > 0) {
    // 收回当前 context 的集(updateWebGLContext 的置空是丢引用不删 program,集仍有效)
    cache.set(singleton.gl, singleton._shaderSets)
  }
  singleton.gl = targetGl
  const cached = cache.get(targetGl)
  singleton._shaderSets = cached ?? []
  if (!logged) {
    logged = true
    console.log('[live2d] cubism multi-context shader isolation active')
  }
  return true
}

/**
 * 渲染前调用(挂在 app.renderer 的 prerender 事件上):确保单例指向该 app 的 context。
 * 每个 Live2DRenderer(= 每个独立 PIXI.Application)各自绑定自己的 prerender。
 * 参数用结构化最小类型:pixi v6 的 renderer 是 Renderer|AbstractRenderer 联合,取 .gl 即可。
 */
export function bindCubismContext(renderer: { gl: WebGLRenderingContext }): void {
  try {
    const singleton = CubismShader_WebGL.getInstance()
    swapShaderContext(singleton, renderer.gl, shaderSetsByContext)
    // 切换后首帧由 setupShaderProgram 按 _shaderSets 为空自动 generateShaders()
  } catch (e) {
    console.warn('[live2d] bindCubismContext failed', e)
  }
}
