/**
 * ComfyClient 单测 — global fetch 打桩,不碰网络、不 mock electron
 * (config-store 打桩绕开 paths → electron 链)。
 *
 * 覆盖批 B 关键行为:
 *   - SaveVideo 的输出(mp4 落在 history outputs 的 images 键)被完整收集
 *   - 「任务完成但 0 输出」不再静默返回空数组,而是抛带诊断串的 ComfyError
 *   - submit 返回 node_errors 时快速失败
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config-store', () => ({
  loadConfig: () => ({ comfyui_endpoint: 'http://mock:8188' }),
}))

const { ComfyClient, ComfyError } = await import('./client')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let historyBody: unknown = {}

function installFetch(opts: { promptBody?: unknown } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/system_stats')) return jsonResponse({ ok: true })
      if (url.endsWith('/prompt')) return jsonResponse(opts.promptBody ?? { prompt_id: 'pid-1', number: 1 })
      if (url.includes('/history/')) return jsonResponse(historyBody)
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ComfyClient.generate', () => {
  it('SaveVideo 输出(images 键,.mp4)被完整收集且带 /view URL', async () => {
    historyBody = {
      'pid-1': {
        status: { completed: true, status_str: 'success' },
        outputs: {
          '2': { images: [{ filename: 'ComfyUI_00001.mp4', subfolder: 'video', type: 'output' }] },
        },
      },
    }
    installFetch()
    const client = new ComfyClient({ endpoint: 'http://mock:8188' })
    const r = await client.generate({ '1': {} })
    expect(r.promptId).toBe('pid-1')
    expect(r.images).toHaveLength(1)
    const video = r.images[0]!
    expect(video.filename).toBe('ComfyUI_00001.mp4')
    expect(video.subfolder).toBe('video')
    expect(video.type).toBe('output')
    expect(video.viewUrl).toContain('http://mock:8188/view?')
    expect(video.viewUrl).toContain('filename=')
  })

  it('完成但 0 输出 → ComfyError 带 status_str / outputs 摘要 / execution_error 明细', async () => {
    historyBody = {
      'pid-1': {
        status: {
          completed: true,
          status_str: 'error',
          messages: [['execution_error', { node_type: 'KSampler', exception_message: 'cusolver error: boom' }]],
        },
        outputs: {},
      },
    }
    installFetch()
    const client = new ComfyClient({ endpoint: 'http://mock:8188' })
    const err = await client.generate({ '1': {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ComfyError)
    const msg = (err as Error).message
    expect(msg).toContain('没有输出文件')
    expect(msg).toContain('status_str=error')
    expect(msg).toContain('outputs{空}')
    expect(msg).toContain('KSampler')
    expect(msg).toContain('cusolver error: boom')
  })

  it('submit 返回 node_errors → 快速失败,不进入轮询', async () => {
    installFetch({
      promptBody: {
        prompt_id: 'pid-1',
        number: 1,
        node_errors: { '1': { errors: [{ type: 'required_input_missing' }] } },
      },
    })
    const client = new ComfyClient({ endpoint: 'http://mock:8188' })
    await expect(client.generate({ '1': {} })).rejects.toThrow(/workflow 节点错误/)
  })
})
