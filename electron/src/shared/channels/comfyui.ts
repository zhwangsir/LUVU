/**
 * ComfyUI IPC channels (Phase 1 G batch 4) — Phase 2「创作工坊」
 * 注：comfyui:progress 推送 (kind/state) 走 win.send，不在 channel 范围内。
 *
 * BackgroundParams/StickerParams/Image/I2I/Video 形态从 main service workflows.ts 镜像。
 */
import { defineChannel } from '../ipc-channel'

/** main/services/comfyui/workflows.ts 的对应参数 - 严格镜像（必须保持一致） */
export interface ComfyImageGenParams {
  prompt: string
  negative?: string
  checkpoint: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  seed?: number
  loras?: Array<{ name: string; strength_model?: number; strength_clip?: number }>
  filenamePrefix?: string
}

export interface ComfyI2IGenParams extends ComfyImageGenParams {
  inputImage: string
  /** 重绘强度 0~1，越低越像原图 */
  denoise?: number
}

export interface ComfyVideoT2VParams {
  prompt: string
  /** Wan2 API 模型名（从 model 参数 enum 里挑） */
  model: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  filenamePrefix?: string
}

export interface ComfyVideoI2VParams {
  prompt?: string
  negative?: string
  inputImage: string
  length?: number
  width?: number
  height?: number
  checkpoint: string
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  seed?: number
  filenamePrefix?: string
}

export interface ComfyStickerParams {
  emotion: 'happy' | 'sad' | 'angry' | 'shy' | 'surprise' | 'tease' | 'sleepy' | 'neutral'
  extraPrompt?: string
  checkpoint?: string
  seed?: number
  steps?: number
  cfg?: number
}

export interface ComfyBackgroundParams {
  theme: string
  checkpoint?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
}

export interface ComfyGenerateOutput {
  ok: boolean
  prompt_id?: string
  files?: string[]
  error?: string
}

export interface ComfyListResult<T = string> {
  ok: boolean
  items: T[]
  error?: string
}

export const comfyuiStatus = defineChannel<
  void,
  { ok: boolean; endpoint?: string; detail?: unknown; error?: string }
>('comfyui:status')

export const comfyuiListCheckpoints = defineChannel<void, ComfyListResult>(
  'comfyui:list-checkpoints',
)
export const comfyuiListLoras = defineChannel<void, ComfyListResult>('comfyui:list-loras')

export const comfyuiListSamplers = defineChannel<
  void,
  { ok: boolean; samplers: string[]; schedulers: string[]; error?: string }
>('comfyui:list-samplers')

export const comfyuiListVideoModels = defineChannel<void, ComfyListResult>(
  'comfyui:list-video-models',
)

export const comfyuiUploadImage = defineChannel<
  { srcPath: string },
  {
    ok: boolean
    localCachePath?: string
    comfyName?: string
    subfolder?: string
    type?: string
    error?: string
  }
>('comfyui:upload-image')

export const comfyuiGenerateImage = defineChannel<ComfyImageGenParams, ComfyGenerateOutput>(
  'comfyui:generate-image',
)
export const comfyuiGenerateI2I = defineChannel<ComfyI2IGenParams, ComfyGenerateOutput>(
  'comfyui:generate-i2i',
)
export const comfyuiGenerateVideoT2V = defineChannel<
  ComfyVideoT2VParams,
  ComfyGenerateOutput
>('comfyui:generate-video-t2v')
export const comfyuiGenerateVideoI2V = defineChannel<
  ComfyVideoI2VParams,
  ComfyGenerateOutput
>('comfyui:generate-video-i2v')
export const comfyuiGenerateSticker = defineChannel<ComfyStickerParams, ComfyGenerateOutput>(
  'comfyui:generate-sticker',
)
export const comfyuiGenerateBackground = defineChannel<
  ComfyBackgroundParams,
  ComfyGenerateOutput
>('comfyui:generate-background')

export const comfyuiListRecent = defineChannel<
  'sticker' | 'background' | 'image' | 'video' | 'all' | undefined,
  Array<{ kind: string; path: string; mtime: number; size: number }>
>('comfyui:list-recent')

export const comfyuiCancel = defineChannel<void, { ok: boolean; error?: string }>(
  'comfyui:cancel',
)
