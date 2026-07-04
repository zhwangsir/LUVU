/**
 * ComfyUI workflow 模板工厂 — Phase 2「创作工坊」
 *
 * 5 类生成器，全参数化（接受 checkpoint / cfg / steps / sampler / scheduler / size / seed 等）：
 *   1. buildImageWorkflow      文生图 (T2I) — 通用 SD/SDXL workflow
 *   2. buildI2IWorkflow        图生图 (I2I) — LoadImage + VAEEncode + KSampler(denoise<1)
 *   3. buildVideoT2VWorkflow   文生视频 — Wan2 API 节点封装
 *   4. buildVideoI2VWorkflow   图生视频 — WanImageToVideo 节点
 *   5. buildStickerWorkflow    旧 sticker（保留，给 Phase 1 IPC 用）
 *   6. buildBackgroundWorkflow 旧 background（保留）
 *
 * 设计原则：
 *   - 所有参数默认值 = SD 1.5 通用合理值（用户在 UI 可改）
 *   - workflow 节点 ID 用字符串数字，避免 JSON.stringify 时被改成 number key
 *   - 输入 prompt 优先用户传入，无则用领域默认
 */

// ============ 共享默认 ============

const DEFAULT_NEGATIVE =
  'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, '
  + 'cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, '
  + 'username, blurry, artist name'

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'img'
}

// ============ 通用参数类型 ============

export interface ImageGenParams {
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
  /** 可选：LoRA 列表 [{name, strength_model, strength_clip}] */
  loras?: Array<{ name: string; strength_model?: number; strength_clip?: number }>
  /** 输出文件名前缀 */
  filenamePrefix?: string
}

export interface I2IGenParams extends ImageGenParams {
  /** 输入图片（已经上传到 ComfyUI 后返回的 filename） */
  inputImage: string
  /** 重绘强度 0~1，越低越像原图 */
  denoise?: number
}

export interface VideoT2VParams {
  prompt: string
  /** Wan2 API 模型名（从 model 参数 enum 里挑） */
  model: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  filenamePrefix?: string
}

export interface VideoI2VParams {
  prompt?: string
  negative?: string
  inputImage: string
  /** 视频帧数（24 fps 下 24=1s, 49=2s, 81=3s 等。WAN 通常 81） */
  length?: number
  width?: number
  height?: number
  /** 走本地 pipeline 时需要的 checkpoint + clip + vae 配置 */
  checkpoint: string
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  seed?: number
  filenamePrefix?: string
}

// ============ 1. 文生图 (T2I) ============

export function buildImageWorkflow(p: ImageGenParams): Record<string, unknown> {
  const seed = p.seed ?? randomSeed()
  const negative = p.negative ?? DEFAULT_NEGATIVE
  const prefix = p.filenamePrefix ?? `luvu_t2i_${slug(p.prompt)}`

  // LoRA 链：CheckpointLoader → LoraLoader(链式) → 后续节点
  let modelRef: [string, number] = ['4', 0]
  let clipRef: [string, number] = ['4', 1]
  const wf: Record<string, unknown> = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpoint } },
  }
  let nextId = 100
  for (const lora of p.loras ?? []) {
    const id = String(nextId++)
    wf[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength_model ?? 1.0,
        strength_clip: lora.strength_clip ?? 1.0,
        model: modelRef,
        clip: clipRef,
      },
    }
    modelRef = [id, 0]
    clipRef = [id, 1]
  }

  Object.assign(wf, {
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: p.width ?? 512, height: p.height ?? 512, batch_size: 1 },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: clipRef } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: clipRef } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: p.steps ?? 24,
        cfg: p.cfg ?? 7.5,
        sampler_name: p.sampler ?? 'euler_ancestral',
        scheduler: p.scheduler ?? 'normal',
        denoise: 1.0,
        model: modelRef,
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: ['8', 0] } },
  })
  return wf
}

// ============ 2. 图生图 (I2I) ============

export function buildI2IWorkflow(p: I2IGenParams): Record<string, unknown> {
  const seed = p.seed ?? randomSeed()
  const negative = p.negative ?? DEFAULT_NEGATIVE
  const denoise = p.denoise ?? 0.55
  const prefix = p.filenamePrefix ?? `luvu_i2i_${slug(p.prompt)}`

  let modelRef: [string, number] = ['4', 0]
  let clipRef: [string, number] = ['4', 1]
  const wf: Record<string, unknown> = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpoint } },
    '10': { class_type: 'LoadImage', inputs: { image: p.inputImage } },
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
  }
  let nextId = 100
  for (const lora of p.loras ?? []) {
    const id = String(nextId++)
    wf[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength_model ?? 1.0,
        strength_clip: lora.strength_clip ?? 1.0,
        model: modelRef,
        clip: clipRef,
      },
    }
    modelRef = [id, 0]
    clipRef = [id, 1]
  }

  Object.assign(wf, {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: clipRef } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: clipRef } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: p.steps ?? 28,
        cfg: p.cfg ?? 7.5,
        sampler_name: p.sampler ?? 'euler_ancestral',
        scheduler: p.scheduler ?? 'normal',
        denoise,
        model: modelRef,
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['11', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: ['8', 0] } },
  })
  return wf
}

// ============ 3. 文生视频 (T2V) — Wan2 API 节点 ============

/**
 * 使用 ComfyUI 内置 Wan2TextToVideoApi 节点（API 封装，由 ComfyUI 后端代理 Wan2 服务）
 * 输入很简单：model（动态枚举）+ seed + 标志
 * prompt 通过 CLIPTextEncode 接入（看节点约定）
 *
 * 注：如果用户想本地推理 Wan/Hunyuan T2V，需要单独的 checkpoint 节点链路；
 *     这里默认用 API 节点，简单可靠。
 */
export function buildVideoT2VWorkflow(p: VideoT2VParams): Record<string, unknown> {
  const seed = p.seed ?? randomSeed()
  const prefix = p.filenamePrefix ?? `luvu_t2v_${slug(p.prompt)}`
  // Wan2TextToVideoApi 的 prompt 走节点 widget；按 ComfyUI 标准 wan2 用法是
  // 把 prompt 作为 STRING 直接传给 API 节点；保险起见用 text encoder 走也行
  return {
    '1': {
      class_type: 'Wan2TextToVideoApi',
      inputs: {
        model: p.model,
        seed,
        prompt_extend: p.promptExtend ?? true,
        watermark: p.watermark ?? false,
        // Wan API 节点的 prompt 是 widget 字段而不是 connection；保持兼容性放这里：
        prompt: p.prompt,
      },
    },
    '2': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['1', 0],
        filename_prefix: prefix,
        format: 'mp4',
        codec: 'h264',
      },
    },
  }
}

// ============ 4. 图生视频 (I2V) — WanImageToVideo 本地推理 ============

export function buildVideoI2VWorkflow(p: VideoI2VParams): Record<string, unknown> {
  const seed = p.seed ?? randomSeed()
  const negative = p.negative ?? DEFAULT_NEGATIVE
  const prompt = p.prompt ?? 'cinematic, smooth animation, natural motion'
  const prefix = p.filenamePrefix ?? `luvu_i2v_${Date.now()}`

  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpoint } },
    '10': { class_type: 'LoadImage', inputs: { image: p.inputImage } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    '20': {
      class_type: 'WanImageToVideo',
      inputs: {
        positive: ['6', 0],
        negative: ['7', 0],
        vae: ['4', 2],
        width: p.width ?? 768,
        height: p.height ?? 432,
        length: p.length ?? 81,
        batch_size: 1,
        start_image: ['10', 0],
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: p.steps ?? 30,
        cfg: p.cfg ?? 6.0,
        sampler_name: p.sampler ?? 'uni_pc',
        scheduler: p.scheduler ?? 'simple',
        denoise: 1.0,
        model: ['4', 0],
        positive: ['20', 0],
        negative: ['20', 1],
        latent_image: ['20', 2],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['8', 0],
        filename_prefix: prefix,
        fps: 16,
        lossless: false,
        quality: 80,
        method: 'default',
      },
    },
  }
}

// ============ 5+6. 保留旧 Phase 1 sticker / background ============

export interface StickerParams {
  emotion: 'happy' | 'sad' | 'angry' | 'shy' | 'surprise' | 'tease' | 'sleepy' | 'neutral'
  extraPrompt?: string
  checkpoint?: string
  seed?: number
  steps?: number
  cfg?: number
}

export interface BackgroundParams {
  theme: string
  checkpoint?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
}

export const DEFAULT_CHECKPOINT = 'GhostMix鬼混_V2.0.safetensors'

const EMOTION_PROMPT_MAP: Record<StickerParams['emotion'], string> = {
  happy:    'cute anime girl, big smile, sparkly eyes, hands near face, peace sign, sticker style',
  sad:      'cute anime girl, teary eyes, drooping ears, hugging knees, soft pastel, sticker style',
  angry:    'cute anime chibi, pouting cheeks, angry mark, raised fist, sticker style',
  shy:      'cute anime girl, blushing cheeks, hands covering face, sticker style',
  surprise: 'cute anime girl, wide eyes, open mouth O, hands up surprised, sticker style',
  tease:    'cute anime girl, tongue out, wink, playful pose, sticker style',
  sleepy:   'cute anime girl, half-closed eyes, yawning, holding pillow, sticker style',
  neutral:  'cute anime girl, calm expression, gentle smile, sticker style',
}

export function buildStickerWorkflow(p: StickerParams): Record<string, unknown> {
  const positive = [
    EMOTION_PROMPT_MAP[p.emotion],
    'masterpiece, best quality, official art, white background, isolated character',
    p.extraPrompt ?? '',
  ].filter(Boolean).join(', ')

  return buildImageWorkflow({
    prompt: positive,
    checkpoint: p.checkpoint ?? DEFAULT_CHECKPOINT,
    ...(p.seed != null ? { seed: p.seed } : {}),
    steps: p.steps ?? 24,
    cfg: p.cfg ?? 6.5,
    filenamePrefix: `luvu_sticker_${p.emotion}`,
  })
}

export function buildBackgroundWorkflow(p: BackgroundParams): Record<string, unknown> {
  const positive = [
    p.theme,
    'masterpiece, best quality, wide shot, no humans, scenery, soft lighting, anime background',
  ].join(', ')

  return buildImageWorkflow({
    prompt: positive,
    negative: DEFAULT_NEGATIVE + ', humans, characters, people, faces',
    checkpoint: p.checkpoint ?? DEFAULT_CHECKPOINT,
    ...(p.seed != null ? { seed: p.seed } : {}),
    steps: p.steps ?? 28,
    cfg: p.cfg ?? 7.0,
    width: p.width ?? 1920,
    height: p.height ?? 1080,
    filenamePrefix: `luvu_bg_${slug(p.theme)}`,
  })
}
