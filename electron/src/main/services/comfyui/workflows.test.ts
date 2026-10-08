/**
 * ComfyUI workflow 模板工厂单测。
 *
 * t2v 的 DynamicCombo 点号键格式、seed INT32 钳制、SaveVideo 的 mp4/h264
 * 均依据 2026-10-09 workstation :8188 真机验证(批 B1 诊断):
 *   - v1 /prompt payload:combo 选中 key + "model.*" 嵌套子键(上游
 *     execution_test/dynamic_inputs_test.py 同格式)
 *   - Wan API 节点 seed max = 2147483647,超界 400 value_bigger_than_max
 *   - SaveVideo 输出经 PreviewVideo 落 history 的 images 键
 */
import { describe, expect, it } from 'vitest'
import {
  buildBackgroundWorkflow,
  buildI2IWorkflow,
  buildImageWorkflow,
  buildStickerWorkflow,
  buildVideoI2VWorkflow,
  buildVideoT2VWorkflow,
} from './workflows'

/** 类型化取 workflow 节点(Record<string, unknown> 直接 .class_type 过不了 tsc 严格模式) */
function node(wf: Record<string, unknown>, id: string): { class_type: string; inputs: Record<string, unknown> } {
  return wf[id] as { class_type: string; inputs: Record<string, unknown> }
}

describe('buildVideoT2VWorkflow', () => {
  it('DynamicCombo 点号键:选中 key + model.* 嵌套必填', () => {
    const wf = buildVideoT2VWorkflow({ prompt: '一只猫', model: 'wan2.7-t2v', seed: 42 })
    expect(node(wf, '1').class_type).toBe('Wan2TextToVideoApi')
    const inputs = node(wf, '1').inputs as Record<string, unknown>
    expect(inputs.model).toBe('wan2.7-t2v')
    expect(inputs['model.prompt']).toBe('一只猫')
    expect(inputs['model.negative_prompt']).toBe('')
    expect(inputs['model.resolution']).toBe('720P')
    expect(inputs['model.ratio']).toBe('16:9')
    expect(inputs['model.duration']).toBe(5)
    expect(inputs.prompt_extend).toBe(true)
    expect(inputs.watermark).toBe(false)
  })

  it('seed 钳制到 INT32(Wan API 节点 max 2147483647,真机 400 教训)', () => {
    const wf = buildVideoT2VWorkflow({ prompt: 'x', model: 'm', seed: 3_235_019_584 })
    const seed = (node(wf, '1').inputs as Record<string, unknown>).seed as number
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(2147483647)
  })

  it('随机 seed 也始终落在 INT32 范围', () => {
    for (let i = 0; i < 20; i++) {
      const wf = buildVideoT2VWorkflow({ prompt: 'x', model: 'm' })
      const seed = (node(wf, '1').inputs as Record<string, unknown>).seed as number
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(2147483647)
    }
  })

  it('分辨率/比例/时长/负向/开关透传', () => {
    const wf = buildVideoT2VWorkflow({
      prompt: 'x',
      model: 'm',
      seed: 1,
      resolution: '1080P',
      ratio: '9:16',
      duration: 10,
      negativePrompt: 'nsfw',
      promptExtend: false,
      watermark: true,
    })
    const inputs = node(wf, '1').inputs as Record<string, unknown>
    expect(inputs['model.resolution']).toBe('1080P')
    expect(inputs['model.ratio']).toBe('9:16')
    expect(inputs['model.duration']).toBe(10)
    expect(inputs['model.negative_prompt']).toBe('nsfw')
    expect(inputs.prompt_extend).toBe(false)
    expect(inputs.watermark).toBe(true)
  })

  it('SaveVideo 节点 mp4/h264,消费 Wan 节点输出', () => {
    const wf = buildVideoT2VWorkflow({ prompt: 'x', model: 'm', seed: 1 })
    expect(node(wf, '2').class_type).toBe('SaveVideo')
    const inputs = node(wf, '2').inputs as Record<string, unknown>
    expect(inputs.format).toBe('mp4')
    expect(inputs.codec).toBe('h264')
    expect(inputs.video).toEqual(['1', 0])
  })
})

describe('buildVideoI2VWorkflow', () => {
  it('图生视频链:LoadImage → WanImageToVideo(start_image) → KSampler → SaveAnimatedWEBP', () => {
    const wf = buildVideoI2VWorkflow({ inputImage: 'in.png', checkpoint: 'aio.safetensors' })
    expect(node(wf, '4').class_type).toBe('CheckpointLoaderSimple')
    expect(node(wf, '10').class_type).toBe('LoadImage')
    expect(node(wf, '20').class_type).toBe('WanImageToVideo')
    expect((node(wf, '20').inputs as Record<string, unknown>).start_image).toEqual(['10', 0])
    const ks = node(wf, '3').inputs as Record<string, unknown>
    expect(ks.latent_image).toEqual(['20', 2])
    expect(ks.model).toEqual(['4', 0])
    // 默认采样器必须 euler_ancestral:uni_pc 在 Blackwell+新 torch 栈真机必崩 cusolver(批 B 真机实证)
    expect(ks.sampler_name).toBe('euler_ancestral')
    expect(node(wf, '9').class_type).toBe('SaveAnimatedWEBP')
  })

  it('确定性 seed 透传到 KSampler,默认参数合理(length 81 = 3s@24fps 口径)', () => {
    const wf = buildVideoI2VWorkflow({ inputImage: 'in.png', checkpoint: 'aio.safetensors', seed: 7 })
    expect((node(wf, '3').inputs as Record<string, unknown>).seed).toBe(7)
    expect((node(wf, '20').inputs as Record<string, unknown>).length).toBe(81)
  })
})

describe('buildImageWorkflow / buildI2IWorkflow(回归保护)', () => {
  it('t2i 基本结构 + 确定性 seed', () => {
    const wf = buildImageWorkflow({ prompt: 'p', checkpoint: 'c.safetensors', seed: 5 })
    expect(node(wf, '4').class_type).toBe('CheckpointLoaderSimple')
    expect((node(wf, '3').inputs as Record<string, unknown>).seed).toBe(5)
    expect(node(wf, '9').class_type).toBe('SaveImage')
  })

  it('i2i:VAEEncode 接 LoadImage,denoise 默认 0.55', () => {
    const wf = buildI2IWorkflow({ prompt: 'p', checkpoint: 'c.safetensors', inputImage: 'in.png' })
    expect(node(wf, '11').class_type).toBe('VAEEncode')
    expect((node(wf, '11').inputs as Record<string, unknown>).pixels).toEqual(['10', 0])
    expect((node(wf, '3').inputs as Record<string, unknown>).denoise).toBe(0.55)
  })

  it('sticker / background 旧 Phase 1 工作流仍可构建', () => {
    expect(node(buildStickerWorkflow({ emotion: 'happy' }), '9').class_type).toBe('SaveImage')
    expect(node(buildBackgroundWorkflow({ theme: 'rain' }), '9').class_type).toBe('SaveImage')
  })
})
