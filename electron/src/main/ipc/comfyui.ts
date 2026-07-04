/**
 * ComfyUI IPC handlers — type-safe channels (Phase 1 G).
 *
 * Renderer 可调能力：
 *   - comfyui:status / list-* / upload-image / generate-* / list-recent / cancel
 *
 * 进度事件：webContents.send('comfyui:progress', {kind, state, ...})
 */
import type { BrowserWindow } from 'electron'
import { copyFile } from 'node:fs/promises'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  comfyuiCancel,
  comfyuiGenerateBackground,
  comfyuiGenerateI2I,
  comfyuiGenerateImage,
  comfyuiGenerateSticker,
  comfyuiGenerateVideoI2V,
  comfyuiGenerateVideoT2V,
  comfyuiListCheckpoints,
  comfyuiListLoras,
  comfyuiListRecent,
  comfyuiListSamplers,
  comfyuiListVideoModels,
  comfyuiStatus,
  comfyuiUploadImage,
} from '@shared/channels/comfyui'
import {
  ComfyClient,
  ComfyError,
  getSharedComfyClient,
  type ComfyOutputImage,
} from '../services/comfyui/client'
import {
  buildBackgroundWorkflow,
  buildI2IWorkflow,
  buildImageWorkflow,
  buildStickerWorkflow,
  buildVideoI2VWorkflow,
  buildVideoT2VWorkflow,
} from '../services/comfyui/workflows'
import { ensureDir, getPaths } from '../services/paths'
import { handleInvoke } from './channel-helpers'

// v0.21:用 services/comfyui/client.ts 的 getSharedComfyClient 替代本地 activeClient 缓存
// 跟 tools/builtin.ts 共享同一份单例,endpoint 切换时同步失效
const getClient = getSharedComfyClient
const stickersDir = (): string => ensureDir(join(getPaths().userDataDir, 'stickers'))
const backgroundsDir = (): string => ensureDir(join(getPaths().userDataDir, 'backgrounds'))
const imagesDir = (): string => ensureDir(join(getPaths().userDataDir, 'images'))
const videosDir = (): string => ensureDir(join(getPaths().userDataDir, 'videos'))
const uploadsDir = (): string => ensureDir(join(getPaths().userDataDir, 'uploads'))

/** 把生成结果（图/视频）下载到本地目录 */
async function downloadAll(
  client: ComfyClient,
  images: ComfyOutputImage[],
  destDir: string,
  prefix: string,
): Promise<string[]> {
  const saved: string[] = []
  for (const img of images) {
    const ext = extname(img.filename) || '.png'
    const fname = `${prefix}_${Date.now()}_${basename(img.filename)}`
    const dest = join(destDir, fname)
    try {
      await client.downloadImage(img.filename, img.subfolder, img.type, dest)
      saved.push(dest)
    } catch (e) {
      console.warn('[comfyui] download skipped', img.filename, e)
    }
    void ext
  }
  return saved
}

function progressEmitter(
  getWindow: () => BrowserWindow | null,
  kind: string,
  extra: Record<string, unknown> = {},
) {
  return (state: 'queued' | 'running' | 'done'): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('comfyui:progress', { kind, state, ...extra })
    }
  }
}

export function registerComfyuiIpc(getWindow: () => BrowserWindow | null): void {
  // ============ 基础 ============

  handleInvoke(comfyuiStatus, async () => {
    try {
      const client = getClient()
      const r = await client.status()
      return {
        ok: r.ok,
        endpoint: client.endpoint,
        detail: r.detail,
        ...(r.error !== undefined && { error: r.error }),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 动态列资源 ============

  handleInvoke(comfyuiListCheckpoints, async () => {
    try {
      const info = (await getClient().objectInfo('CheckpointLoaderSimple')) as Record<
        string,
        { input?: { required?: Record<string, unknown> } }
      >
      const enumList = (info.CheckpointLoaderSimple?.input?.required?.ckpt_name as unknown[])?.[0] as
        | string[]
        | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiListLoras, async () => {
    try {
      const info = (await getClient().objectInfo('LoraLoader')) as Record<
        string,
        { input?: { required?: Record<string, unknown> } }
      >
      const enumList = (info.LoraLoader?.input?.required?.lora_name as unknown[])?.[0] as
        | string[]
        | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiListSamplers, async () => {
    try {
      const info = (await getClient().objectInfo('KSampler')) as Record<
        string,
        { input?: { required?: Record<string, unknown> } }
      >
      const samplers = (info.KSampler?.input?.required?.sampler_name as unknown[])?.[0] as
        | string[]
        | undefined
      const schedulers = (info.KSampler?.input?.required?.scheduler as unknown[])?.[0] as
        | string[]
        | undefined
      return { ok: true, samplers: samplers ?? [], schedulers: schedulers ?? [] }
    } catch (e) {
      return {
        ok: false,
        samplers: [],
        schedulers: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  handleInvoke(comfyuiListVideoModels, async () => {
    try {
      const info = (await getClient().objectInfo('Wan2TextToVideoApi')) as Record<
        string,
        { input?: { required?: Record<string, unknown> } }
      >
      const enumList = (info.Wan2TextToVideoApi?.input?.required?.model as unknown[])?.[0] as
        | string[]
        | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 图片上传 ============

  handleInvoke(comfyuiUploadImage, async (payload) => {
    try {
      // 1) 复制到 ~/.luvu/uploads/<ts>_<basename>
      const src = payload.srcPath
      if (!existsSync(src)) throw new Error(`源文件不存在: ${src}`)
      const dest = join(uploadsDir(), `${Date.now()}_${basename(src)}`)
      await copyFile(src, dest)
      // 2) 上传到 ComfyUI 的 input/
      const client = getClient()
      const r = await client.uploadImage({ path: dest })
      console.log(`[comfyui] upload-image: ${basename(src)} → ${r.name} (uploads cache: ${dest})`)
      return {
        ok: true,
        localCachePath: dest,
        comfyName: r.name,
        subfolder: r.subfolder,
        type: r.type,
      }
    } catch (e) {
      console.error('[comfyui] upload-image failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 生成 endpoints ============

  handleInvoke(comfyuiGenerateImage, async (payload) => {
    const progress = progressEmitter(getWindow, 'image', { prompt: payload.prompt.slice(0, 60) })
    try {
      const client = getClient()
      const wf = buildImageWorkflow(payload)
      console.log(
        `[comfyui] generate-image checkpoint=${payload.checkpoint} prompt="${payload.prompt.slice(0, 80)}"`,
      )
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, imagesDir(), 'image')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-image failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiGenerateI2I, async (payload) => {
    const progress = progressEmitter(getWindow, 'i2i', { prompt: payload.prompt.slice(0, 60) })
    try {
      const client = getClient()
      const wf = buildI2IWorkflow(payload)
      console.log(
        `[comfyui] generate-i2i input=${payload.inputImage} denoise=${payload.denoise ?? 0.55}`,
      )
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, imagesDir(), 'i2i')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-i2i failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiGenerateVideoT2V, async (payload) => {
    const progress = progressEmitter(getWindow, 'video-t2v', {
      prompt: payload.prompt.slice(0, 60),
      model: payload.model,
    })
    try {
      const client = getClient()
      const wf = buildVideoT2VWorkflow(payload)
      console.log(`[comfyui] generate-video-t2v model=${payload.model}`)
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 15 * 60_000 })
      const files = await downloadAll(client, r.images, videosDir(), 't2v')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-video-t2v failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiGenerateVideoI2V, async (payload) => {
    const progress = progressEmitter(getWindow, 'video-i2v', { input: payload.inputImage })
    try {
      const client = getClient()
      const wf = buildVideoI2VWorkflow(payload)
      console.log(
        `[comfyui] generate-video-i2v input=${payload.inputImage} length=${payload.length ?? 81}`,
      )
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 15 * 60_000 })
      const files = await downloadAll(client, r.images, videosDir(), 'i2v')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-video-i2v failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 旧 Phase 1（保留兼容） ============

  handleInvoke(comfyuiGenerateSticker, async (payload) => {
    const progress = progressEmitter(getWindow, 'sticker', { emotion: payload.emotion })
    try {
      const client = getClient()
      const wf = buildStickerWorkflow(payload)
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, stickersDir(), `sticker_${payload.emotion}`)
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  handleInvoke(comfyuiGenerateBackground, async (payload) => {
    const progress = progressEmitter(getWindow, 'background', { theme: payload.theme })
    try {
      const client = getClient()
      const wf = buildBackgroundWorkflow(payload)
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 10 * 60_000 })
      const files = await downloadAll(client, r.images, backgroundsDir(), 'bg')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 历史 + 中断 ============

  handleInvoke(comfyuiListRecent, (kind) => {
    const k = kind ?? 'all'
    const out: Array<{ kind: string; path: string; mtime: number; size: number }> = []
    const dirs: Array<[string, string]> = []
    if (k === 'all' || k === 'sticker') dirs.push(['sticker', stickersDir()])
    if (k === 'all' || k === 'background') dirs.push(['background', backgroundsDir()])
    if (k === 'all' || k === 'image') dirs.push(['image', imagesDir()])
    if (k === 'all' || k === 'video') dirs.push(['video', videosDir()])
    for (const [tag, d] of dirs) {
      if (!existsSync(d)) continue
      for (const name of readdirSync(d)) {
        if (!/\.(png|jpg|jpeg|webp|gif|mp4|mov|webm)$/i.test(name)) continue
        const p = join(d, name)
        try {
          const st = statSync(p)
          out.push({ kind: tag, path: p, mtime: st.mtimeMs, size: st.size })
        } catch {
          /* ignore */
        }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out.slice(0, 80)
  })

  handleInvoke(comfyuiCancel, async () => {
    try {
      await getClient().interrupt()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
