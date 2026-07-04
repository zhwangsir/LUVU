/**
 * PPT 配图 —— 用 ComfyUI 文生图为幻灯片生成插图。
 *
 * 副作用（网络 + 文件下载）隔离在这里，pptx-generator.ts 保持纯函数。
 * 未配 ComfyUI endpoint 或生成失败 → 返回 null，PPT 照常生成（只是少这张图）。
 */
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { getSharedComfyClient } from '../comfyui/client'
import { buildImageWorkflow, DEFAULT_CHECKPOINT } from '../comfyui/workflows'
import { loadConfig } from '../config-store'
import { ensureDir } from '../paths'
import type { PptxSpec } from './pptx-generator'
import type { DocxSpec } from './docx-generator'

/** 单次 PPT 最多生成的插图数（避免 LLM 让每页都生成导致巨慢/占资源） */
const MAX_GENERATED = 12

/** 生成一张插图，下载到本地，返回绝对路径；未配 ComfyUI / 失败返回 null。 */
export async function generateIllustration(prompt: string, index: number): Promise<string | null> {
  const cfg = loadConfig()
  if (!cfg.comfyui_endpoint) return null
  try {
    const client = getSharedComfyClient()
    const wf = buildImageWorkflow({
      prompt,
      checkpoint: DEFAULT_CHECKPOINT,
      width: 1024,
      height: 768,
      filenamePrefix: `luvu_ppt_${index}`,
    })
    const r = await client.generate(wf, {})
    const img = r.images[0]
    if (!img) return null
    const dir = ensureDir(join(homedir(), 'Documents', 'LUVU', 'ppt-assets'))
    const dest = join(dir, `ppt_${index}_${basename(img.filename)}`)
    await client.downloadImage(img.filename, img.subfolder, img.type, dest)
    return dest
  } catch (e) {
    console.warn('[ppt-illustration] 生成失败，跳过插图:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * 解析 spec 中所有 image.generate（且无 path）→ 生成本地图片填回 path。
 * 返回新 spec（不可变更新）。超预算或失败的保持原样（无 path，渲染时跳过该图）。
 */
export async function resolveIllustrations(spec: PptxSpec): Promise<PptxSpec> {
  let budget = MAX_GENERATED
  let index = 0
  const slides: PptxSpec['slides'] = []
  for (const s of spec.slides) {
    const i = index++
    if (s.image?.generate && !s.image.path && budget > 0) {
      budget--
      const path = await generateIllustration(s.image.generate, i)
      slides.push(path ? { ...s, image: { ...s.image, path } } : s)
    } else {
      slides.push(s)
    }
  }
  return { ...spec, slides }
}

/** 同 resolveIllustrations，作用于 Word 的 sections[].image.generate → 填回 path。 */
export async function resolveDocxIllustrations(spec: DocxSpec): Promise<DocxSpec> {
  let budget = MAX_GENERATED
  let index = 0
  const sections: DocxSpec['sections'] = []
  for (const sec of spec.sections) {
    const i = index++
    if (sec.image?.generate && !sec.image.path && budget > 0) {
      budget--
      const path = await generateIllustration(sec.image.generate, i)
      sections.push(path ? { ...sec, image: { ...sec.image, path } } : sec)
    } else {
      sections.push(sec)
    }
  }
  return { ...spec, sections }
}
