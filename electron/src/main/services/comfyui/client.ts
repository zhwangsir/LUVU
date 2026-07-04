/**
 * ComfyUI HTTP 客户端 — Phase 1 基础设施
 *
 * 目标：提交 workflow JSON、轮询状态、取生成图，**不依赖** ComfyUI 在线就能编译。
 *
 * 协议参考：ComfyUI 默认走 8188 端口，REST + WebSocket。
 *   POST /prompt       {prompt, client_id}    → {prompt_id, number, node_errors}
 *   GET  /queue                                → {queue_running, queue_pending}
 *   GET  /history/<prompt_id>                  → {<prompt_id>: {outputs: {...}}}
 *   GET  /view?filename=&type=output&subfolder= → image bytes
 *   POST /interrupt                            → 中断当前任务
 *
 * Phase 1 用 HTTP 轮询 (1 Hz)，足够满足"生成 1 张图"的场景。
 * 后续 Phase 2 如果要实时进度条再上 WebSocket。
 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

export interface ComfyClientOpts {
  /** ComfyUI 服务地址，例 http://192.168.71.100:8188 */
  endpoint: string
  /** 客户端 ID（出现在 /prompt 体里），缺省自动生成一个 UUID */
  clientId?: string
  /** 单次 HTTP 请求超时 ms（默认 30s） */
  requestTimeoutMs?: number
}

export interface SubmitResult {
  promptId: string
  number: number
  nodeErrors?: Record<string, unknown>
}

export interface ComfyOutputImage {
  filename: string
  subfolder: string
  type: string
  /** 完整可下载 URL（拼好 /view?... 的） */
  viewUrl: string
}

export interface GenerationResult {
  promptId: string
  images: ComfyOutputImage[]
  rawHistory: unknown
}

export class ComfyError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ComfyError'
  }
}

export class ComfyClient {
  readonly clientId: string
  readonly endpoint: string
  private readonly timeoutMs: number
  /**
   * v0.21 Round C:instance-level AbortController,abortAll() 调时 cancel
   * 当前 client 所有 in-flight 请求(生图最长 30s 期间用户改 endpoint 切到新 client,
   * 旧 client 的请求应立即停)。
   */
  private readonly aborter = new AbortController()

  constructor(opts: ComfyClientOpts) {
    if (!opts.endpoint) throw new ComfyError('endpoint 为空')
    this.endpoint = opts.endpoint.replace(/\/+$/, '')
    this.clientId = opts.clientId ?? randomUUID()
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000
  }

  /**
   * v0.21 Round C:取消当前 client 所有 in-flight requests。
   * sharedClient 切换 endpoint 时调旧 client.abortAll(),避免旧请求
   * 完成后把结果写入新 endpoint 语境的文件目录。
   */
  abortAll(reason: string): void {
    if (this.aborter.signal.aborted) return
    console.log(`[comfy-client] abortAll: endpoint=${this.endpoint} reason="${reason}"`)
    this.aborter.abort(reason)
  }

  /** 当前 client 是否已被 abort(切换后不应再使用) */
  isAborted(): boolean {
    return this.aborter.signal.aborted
  }

  /** 探活 — GET /system_stats */
  async status(): Promise<{ ok: boolean; detail?: unknown; error?: string }> {
    try {
      const res = await this.fetch('/system_stats', { method: 'GET' })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const json: unknown = await res.json()
      return { ok: true, detail: json }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 提交 workflow JSON，返回 prompt_id */
  async submit(prompt: unknown): Promise<SubmitResult> {
    const res = await this.fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: this.clientId }),
    })
    if (!res.ok) {
      const text = await safeText(res)
      throw new ComfyError(`POST /prompt 失败 HTTP ${res.status}: ${text}`, undefined, res.status)
    }
    const json = (await res.json()) as { prompt_id?: string; number?: number; node_errors?: Record<string, unknown> }
    if (!json.prompt_id) throw new ComfyError(`/prompt 返回缺 prompt_id: ${JSON.stringify(json)}`)
    return {
      promptId: json.prompt_id,
      number: json.number ?? 0,
      ...(json.node_errors ? { nodeErrors: json.node_errors } : {}),
    }
  }

  /** 取 prompt_id 的历史输出；若任务未完成返回 null */
  async getHistory(promptId: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetch(`/history/${encodeURIComponent(promptId)}`, { method: 'GET' })
    if (!res.ok) throw new ComfyError(`GET /history 失败 HTTP ${res.status}`, undefined, res.status)
    const json = (await res.json()) as Record<string, unknown>
    const entry = json[promptId]
    if (!entry || typeof entry !== 'object') return null
    return entry as Record<string, unknown>
  }

  /** 中断当前任务 */
  async interrupt(): Promise<void> {
    await this.fetch('/interrupt', { method: 'POST' })
  }

  /** 拼 /view URL（不发请求，给 renderer 用） */
  buildViewUrl(filename: string, subfolder: string, type: string): string {
    const qs = new URLSearchParams({ filename, subfolder, type }).toString()
    return `${this.endpoint}/view?${qs}`
  }

  /**
   * 上传图片到 ComfyUI 的 input/ 目录，返回 ComfyUI 端的 filename（给 LoadImage 节点用）
   * 支持文件路径或 Buffer
   */
  async uploadImage(source: { path: string } | { buffer: Buffer; filename: string }, overwrite = true): Promise<{
    name: string
    subfolder: string
    type: string
  }> {
    const form = new FormData()
    let blob: Blob
    let name: string
    if ('path' in source) {
      const buf = await readFile(source.path)
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      blob = new Blob([ab])
      name = basename(source.path)
    } else {
      const ab = source.buffer.buffer.slice(
        source.buffer.byteOffset,
        source.buffer.byteOffset + source.buffer.byteLength,
      ) as ArrayBuffer
      blob = new Blob([ab])
      name = source.filename
    }
    form.append('image', blob, name)
    if (overwrite) form.append('overwrite', 'true')
    const res = await this.fetch('/upload/image', { method: 'POST', body: form })
    if (!res.ok) {
      const t = await safeText(res)
      throw new ComfyError(`/upload/image 失败 HTTP ${res.status}: ${t}`, undefined, res.status)
    }
    return (await res.json()) as { name: string; subfolder: string; type: string }
  }

  /** 列 object_info — 用于动态读 checkpoint / LoRA / sampler 等可选项 */
  async objectInfo(nodeClass?: string): Promise<Record<string, unknown>> {
    const path = nodeClass ? `/object_info/${encodeURIComponent(nodeClass)}` : '/object_info'
    const res = await this.fetch(path, { method: 'GET' })
    if (!res.ok) throw new ComfyError(`/object_info 失败 HTTP ${res.status}`, undefined, res.status)
    return (await res.json()) as Record<string, unknown>
  }

  /** 下载图片到本地路径 */
  async downloadImage(filename: string, subfolder: string, type: string, destPath: string): Promise<void> {
    const url = `/view?${new URLSearchParams({ filename, subfolder, type }).toString()}`
    const res = await this.fetch(url, { method: 'GET' })
    if (!res.ok) throw new ComfyError(`/view 下载失败 HTTP ${res.status}`, undefined, res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(destPath, buf)
  }

  /**
   * 提交 + 轮询 + 收集图片输出。
   * 一站式：submit() → 每 pollIntervalMs ms 轮询 /history 直到出结果或超时。
   */
  async generate(
    prompt: unknown,
    opts: { pollIntervalMs?: number; maxWaitMs?: number; onProgress?: (state: 'queued' | 'running' | 'done') => void } = {},
  ): Promise<GenerationResult> {
    const pollMs = opts.pollIntervalMs ?? 1000
    const maxWait = opts.maxWaitMs ?? 5 * 60_000 // 默认 5 分钟
    const onProgress = opts.onProgress

    const { promptId, nodeErrors } = await this.submit(prompt)
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      throw new ComfyError(`workflow 节点错误: ${JSON.stringify(nodeErrors)}`)
    }
    onProgress?.('queued')

    const deadline = Date.now() + maxWait
    let announcedRunning = false
    while (Date.now() < deadline) {
      // v0.21 Round C 收 reviewer HIGH-1:每轮先检查 instance abort
      // 之前 `.catch(() => null)` 把 abort 引发的 ComfyError 吞成 null,
      // 让轮询循环继续 sleep 到 deadline(最长 5 分钟),"立即停"语义失效
      if (this.aborter.signal.aborted) {
        throw new ComfyError(`生成被中断 (client 废弃): prompt_id=${promptId}`)
      }
      const hist = await this.getHistory(promptId).catch((e: unknown) => {
        // 如果是 instance abort 引发的,rethrow 让循环立即退出
        if (this.aborter.signal.aborted) {
          throw e
        }
        return null
      })
      if (hist) {
        const status = (hist.status ?? {}) as { completed?: boolean; status_str?: string }
        if (status.completed) {
          onProgress?.('done')
          return { promptId, images: extractImages(hist, this), rawHistory: hist }
        }
      }
      if (!announcedRunning) {
        announcedRunning = true
        onProgress?.('running')
      }
      // sleep 也要支持 abort 中断 — race instance signal vs timeout
      await Promise.race([
        sleep(pollMs),
        new Promise<void>((_, reject) => {
          const onAbort = (): void => {
            reject(new ComfyError(`生成被中断 (client 废弃): prompt_id=${promptId}`))
          }
          if (this.aborter.signal.aborted) {
            onAbort()
          } else {
            this.aborter.signal.addEventListener('abort', onAbort, { once: true })
          }
        }),
      ])
    }
    throw new ComfyError(`生成超时 (${maxWait}ms) prompt_id=${promptId}`)
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const timeoutCtl = new AbortController()
    const timer = setTimeout(() => timeoutCtl.abort(), this.timeoutMs)
    // v0.21 Round C:链 instance aborter,任一 abort 都触发
    // AbortSignal.any 是 Node 20.3+/Chromium 116+,Electron 33 支持
    const combined = AbortSignal.any([timeoutCtl.signal, this.aborter.signal])
    try {
      return await fetch(`${this.endpoint}${path}`, { ...init, signal: combined })
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // 区分 instance abort vs 单次超时
        if (this.aborter.signal.aborted) {
          throw new ComfyError(`请求被中断 (client 废弃): ${path}`, e)
        }
        throw new ComfyError(`请求超时 ${this.timeoutMs}ms: ${path}`, e)
      }
      throw new ComfyError(`fetch 失败: ${path} — ${(e as Error).message}`, e)
    } finally {
      clearTimeout(timer)
    }
  }
}

function extractImages(history: Record<string, unknown>, client: ComfyClient): ComfyOutputImage[] {
  const outputs = (history.outputs ?? {}) as Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
  const all: ComfyOutputImage[] = []
  for (const node of Object.values(outputs)) {
    for (const img of node.images ?? []) {
      all.push({
        filename: img.filename,
        subfolder: img.subfolder,
        type: img.type,
        viewUrl: client.buildViewUrl(img.filename, img.subfolder, img.type),
      })
    }
  }
  return all
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return '(无法读 body)'
  }
}

/**
 * v0.21 共享 ComfyClient 单例 —— 之前 ipc/comfyui.ts 和 tools/builtin.ts 各持
 * 一份 module-level client cache 让 endpoint 改动时各自 stale 失同步。
 * 这里集中一处,configChanged 时所有调用方一起拿到新 endpoint 的 client。
 *
 * 注意:模块单例的 in-flight 请求(client.generate 最长 30s)在 endpoint 切换时
 * 会继续完成(旧 client),返回结果会被丢弃。新调用方拿到的是新 client。
 */
import { loadConfig } from '../config-store'

let sharedClient: ComfyClient | null = null
export function getSharedComfyClient(): ComfyClient {
  const cfg = loadConfig()
  const endpoint = cfg.comfyui_endpoint?.trim()
  if (!endpoint) {
    throw new ComfyError('ComfyUI endpoint 未配置（Settings → ComfyUI endpoint）')
  }
  if (!sharedClient || sharedClient.endpoint !== endpoint) {
    // v0.21 Round C:endpoint 切换时,旧 client 所有 in-flight 请求立即取消
    // 避免旧请求完成后把结果写入跟新 endpoint 不对齐的文件目录/state
    if (sharedClient) {
      sharedClient.abortAll(`endpoint changed: ${sharedClient.endpoint} → ${endpoint}`)
    }
    sharedClient = new ComfyClient({ endpoint })
  }
  return sharedClient
}

/** test 用:reset 单例 cache(方便单测隔离) */
export function _resetSharedComfyClientForTest(): void {
  sharedClient = null
}
