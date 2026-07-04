/**
 * M7 创造统一 — creative_generate_sticker tool 测试
 *
 * 覆盖:
 *   - emotion 枚举校验(拒绝非法值)
 *   - extra_prompt 可选 + 空白被 trim
 *   - ComfyUI endpoint 未配置时抛 ComfyError
 *   - 成功路径: emit `comfyui:progress {state:done}` 给 webContents
 *   - ComfyUI 返 0 image 时抛错
 *
 * 实现:真 register builtin tools → 通过 registry.invoke 调用 → mock ComfyClient + paths + config
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// mock loadConfig → 控制 ComfyUI endpoint
vi.mock('../config-store', () => ({
  loadConfig: vi.fn(() => ({ comfyui_endpoint: 'http://127.0.0.1:8188' })),
}))

// mock getPaths → 控制 stickers 落盘目录(到测试用 tmp)
// 注意:builtin.ts 也 import ensureDir,要一起 mock(否则跑 ensureDir(...) 会 fsync 真目录)
vi.mock('../paths', () => ({
  getPaths: vi.fn(() => ({
    userDataDir: '/tmp/luvu-test-creative',
    projectRoot: '/tmp/luvu-test-creative/proj',
    soulDir: '/tmp/luvu-test-creative/soul',
    modelSearchPaths: [],
    historyDbPath: '/tmp/luvu-test-creative/history.sqlite',
  })),
  ensureDir: vi.fn((p: string) => p), // mock no-op,不真创建目录
}))

// mock ComfyClient + getSharedComfyClient
// v0.21:builtin.ts 现在通过 getSharedComfyClient 拿单例,所以 mock 它
const mockGenerate = vi.fn()
const mockDownloadImage = vi.fn()
const mockClientInstance = {
  endpoint: 'http://127.0.0.1:8188',
  generate: mockGenerate,
  downloadImage: mockDownloadImage,
}
vi.mock('../comfyui/client', async () => {
  const actual = (await vi.importActual('../comfyui/client')) as object
  return {
    ...actual,
    // builtin.ts 实际用的入口:默认返 mock client,endpoint 未配置 test 单独 mockImplementationOnce
    getSharedComfyClient: vi.fn(() => mockClientInstance),
    _resetSharedComfyClientForTest: vi.fn(),
  }
})

// mock electron Notification (registerBuiltins 会注册 system.notify 用到)
vi.mock('electron', () => ({
  Notification: { isSupported: () => true },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
}))

function makeMockWindow(): {
  webContents: { send: ReturnType<typeof vi.fn> }
  isDestroyed: () => boolean
} {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
  }
}

describe('creative_generate_sticker tool', () => {
  let invokeCreative: (input: Record<string, unknown>) => Promise<string>
  let win: ReturnType<typeof makeMockWindow>

  beforeEach(async () => {
    mockGenerate.mockReset()
    mockDownloadImage.mockReset()
    mockDownloadImage.mockResolvedValue(undefined)
    mockGenerate.mockResolvedValue({
      promptId: 'p-test',
      images: [{ filename: 'sticker.png', subfolder: '', type: 'output', viewUrl: '' }],
    })

    // 清空 registry + 重 register builtins
    const registry = await import('./registry')
    // 反射式清空:通过 unregister 名单(简化:直接 list + unregister 全部)
    registry.list().forEach((t) => registry.unregister(t.name))

    const { registerBuiltins } = await import('./builtin')
    win = makeMockWindow()
    registerBuiltins(() => win as unknown as Electron.BrowserWindow)

    const got = registry.get('creative_generate_sticker')
    if (!got) throw new Error('register 失败:creative_generate_sticker 不在 registry')
    invokeCreative = got.impl
  })

  afterEach(async () => {
    // 清干净免影响后续 suite
    const registry = await import('./registry')
    registry.list().forEach((t) => registry.unregister(t.name))
    vi.clearAllMocks()
  })

  it('注册成功: creative_generate_sticker 在 registry', async () => {
    const registry = await import('./registry')
    expect(registry.get('creative_generate_sticker')).toBeDefined()
    expect(registry.get('creative_generate_sticker')!.def.category).toBe('creative')
    expect(registry.get('creative_generate_sticker')!.def.risk).toBe('medium')
  })

  it('合法 emotion + 调用成功 → 返回友好字符串 + emit done event', async () => {
    const out = await invokeCreative({ emotion: 'happy', extra_prompt: 'fireworks' })

    expect(out).toContain('happy')
    expect(out).toContain('fireworks')
    expect(out).toContain('已浮在桌面上')

    // 应至少 emit 1 次 'done' state
    const sendCalls = win.webContents.send.mock.calls.filter((c) => {
      const payload = c[1] as { state?: string }
      return payload?.state === 'done'
    })
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('非法 emotion → 抛错', async () => {
    await expect(invokeCreative({ emotion: 'evil' })).rejects.toThrow(/emotion 必须是/)
  })

  it('extra_prompt 全空白 → 忽略不出现在结果里', async () => {
    const out = await invokeCreative({ emotion: 'shy', extra_prompt: '   ' })
    expect(out).toContain('shy')
    expect(out).not.toContain('()') // 没有空括号
  })

  it('ComfyUI 返 0 张图 → 抛错', async () => {
    mockGenerate.mockResolvedValueOnce({ promptId: 'p', images: [] })
    await expect(invokeCreative({ emotion: 'happy' })).rejects.toThrow(/没返回任何图片/)
  })

  /**
   * Reviewer MEDIUM-6 补回:验证 endpoint 未配置时 getSharedComfyClient 抛 ComfyError,
   * impl 不会 swallow 此错误,直接 reject 给 LLM。
   * 用 mockImplementationOnce 局部模拟错误,不污染其他 test。
   */
  it('ComfyUI endpoint 未配置 → 抛 ComfyError', async () => {
    const { getSharedComfyClient, ComfyError } = await import('../comfyui/client')
    vi.mocked(getSharedComfyClient).mockImplementationOnce(() => {
      throw new ComfyError('ComfyUI endpoint 未配置（Settings → ComfyUI endpoint）')
    })
    await expect(invokeCreative({ emotion: 'happy' })).rejects.toThrow(/endpoint 未配置/)
  })
})
