/**
 * cubism-multi-context 纯交换逻辑单测。
 * 场景对应 RFC 0002 Q2 多实例:3 个独立 WebGL context 间逐帧切换,
 * 单例(CubismShader_WebGL)的 gl/_shaderSets 必须按 context 缓存/恢复。
 */
import { describe, expect, it, vi } from 'vitest'

// cubism-multi-context 顶层 import 了 pixi-live2d-display/cubism4(重依赖,DOM/GL 语境),
// 纯逻辑单测不真加载它 —— mock 掉只留被引用的形状。
vi.mock('pixi-live2d-display/cubism4', () => ({
  CubismShader_WebGL: class {
    static getInstance(): unknown {
      return null
    }
  },
}))

const { swapShaderContext } = await import('./cubism-multi-context')

function fakeGl(id: number): WebGLRenderingContext {
  return { __id: id } as unknown as WebGLRenderingContext
}

function makeSingleton(): { gl: WebGLRenderingContext | null; _shaderSets: unknown[] } {
  return { gl: null, _shaderSets: [] }
}

describe('swapShaderContext', () => {
  it('首次切到 context A:空集,不收回任何东西', () => {
    const s = makeSingleton()
    const cache = new WeakMap()
    expect(swapShaderContext(s, fakeGl(1), cache)).toBe(true)
    expect(s._shaderSets).toEqual([])
  })

  it('A 渲染产生 shader 集后切到 B:A 的集进缓存,B 拿到空集待编译', () => {
    const s = makeSingleton()
    const cache = new WeakMap()
    const glA = fakeGl(1)
    swapShaderContext(s, glA, cache)
    s._shaderSets = [{ program: 'A0' }, { program: 'A1' }]

    const glB = fakeGl(2)
    expect(swapShaderContext(s, glB, cache)).toBe(true)
    expect(s.gl).toBe(glB)
    expect(s._shaderSets).toEqual([]) // B 待编译
    expect(cache.get(glA)).toEqual([{ program: 'A0' }, { program: 'A1' }]) // A 已缓存
  })

  it('B 编译后切回 A:A 的集原样恢复,零重编译', () => {
    const s = makeSingleton()
    const cache = new WeakMap()
    const glA = fakeGl(1)
    const glB = fakeGl(2)
    swapShaderContext(s, glA, cache)
    const setsA = [{ program: 'A0' }]
    s._shaderSets = setsA
    swapShaderContext(s, glB, cache)
    s._shaderSets = [{ program: 'B0' }, { program: 'B1' }]

    expect(swapShaderContext(s, glA, cache)).toBe(true)
    expect(s.gl).toBe(glA)
    expect(s._shaderSets).toEqual([{ program: 'A0' }])
    expect(cache.get(glB)).toEqual([{ program: 'B0' }, { program: 'B1' }])
  })

  it('同 context 重复调用是 no-op(逐帧 prerender 不抖动)', () => {
    const s = makeSingleton()
    const cache = new WeakMap()
    const glA = fakeGl(1)
    swapShaderContext(s, glA, cache)
    const sets = [{ program: 'A0' }]
    s._shaderSets = sets
    expect(swapShaderContext(s, glA, cache)).toBe(false)
    expect(s._shaderSets).toBe(sets)
  })

  it('单例持空集时切换不污染缓存(updateWebGLContext 置空场景)', () => {
    const s = makeSingleton()
    const cache = new WeakMap()
    const glA = fakeGl(1)
    const glB = fakeGl(2)
    swapShaderContext(s, glA, cache)
    s._shaderSets = [] // 模拟库内 updateWebGLContext 置空(丢引用未删 program)
    expect(swapShaderContext(s, glB, cache)).toBe(true)
    expect(cache.has(glA)).toBe(false) // 空集不入缓存
    expect(s.gl).toBe(glB)
  })
})
