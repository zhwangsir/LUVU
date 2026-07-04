/**
 * 老 v0.1 单文件 default.yaml → v2.0 4 yaml 拆分 schema migration。
 *
 * 老格式（v0.1）结构 (见早期 docs/SOUL_SCHEMA.md):
 *   identity: { name, master, birthday }
 *   appearance: { live2d_model_dir, model_file, anchor: { scale, x_offset, y_offset } }
 *   personality: {
 *     layer1_core, layer2_surface,
 *     layer3_volatility: { flip_probability, flip_modes }
 *   }
 *   speech_style: { max_length, signature_lines, call_master_as, use_emoticons }
 *   emotions: {...}   ← 不迁移（v2 删了 emotion live2d 表，挪到 motion-engine）
 *   behavior: {...}   ← 不迁移（挪到 RuntimeConfig）
 *   learned_traits / tts / vision   ← 不迁移
 *
 * 新格式（v2.0）拆 4 yaml — 见 MergeInput。
 *
 * 设计:
 *   - 纯函数 + 不读 fs（调用方负责加载 yaml）
 *   - 老字段不存在时跳过（不覆盖 v2 默认）
 *   - 老 signature_lines → 新 speech_style.catchphrases
 *   - 老 layer3_volatility.flip_modes → 拼成 layer3_volatility_prompt 自然语言
 */
import type { MergeInput } from './merger'

export interface LegacySoulV01 {
  schema_version?: string
  identity?: {
    name?: string
    master?: string
    birthday?: string
  }
  appearance?: {
    live2d_model_dir?: string
    model_file?: string
    anchor?: {
      scale?: number
      x_offset?: number
      y_offset?: number
    }
  }
  personality?: {
    layer1_core?: string
    layer2_surface?: string
    layer3_volatility?: {
      flip_probability?: number
      flip_modes?: string[]
    }
  }
  speech_style?: {
    max_length?: number
    signature_lines?: string[]
    call_master_as?: string
    use_emoticons?: boolean
  }
}

/** 检测一个 yaml 对象是否是 v0.1 老格式（schema_version 缺失或 < 2.0，且有 v0.1 特征字段） */
export function isLegacyV01Schema(obj: Record<string, unknown>): boolean {
  if (!obj || typeof obj !== 'object') return false
  const ver = (obj.schema_version as string | undefined) ?? ''
  if (ver.startsWith('2.')) return false
  // v0.1 特征：personality.layer3_volatility (对象 with flip_modes) — v2 用 layer3_volatility_prompt 字符串
  const p = obj.personality as Record<string, unknown> | undefined
  if (p && typeof p === 'object' && 'layer3_volatility' in p) {
    return typeof p.layer3_volatility === 'object'
  }
  // 或 appearance.anchor — v2 没这字段
  const a = obj.appearance as Record<string, unknown> | undefined
  if (a && typeof a === 'object' && 'anchor' in a) {
    return true
  }
  // 或 speech_style.signature_lines — v2 用 catchphrases
  const s = obj.speech_style as Record<string, unknown> | undefined
  if (s && typeof s === 'object' && 'signature_lines' in s) {
    return true
  }
  return false
}

/**
 * 把 v0.1 单文件 yaml 对象 → v2.0 MergeInput (4 partial)。
 *
 * 只迁移**还在 v2 schema 范围内**的字段，丢弃 emotions / behavior / tts / vision 等。
 * 调用方可继续 merge: `mergeSoulPartials(migrate(legacy))`
 */
export function migrateV01ToV2(legacy: LegacySoulV01): MergeInput {
  const identity: Record<string, unknown> = {}
  const personality: Record<string, unknown> = {}

  // identity.* + speech_style.call_master_as → identity.yaml
  if (legacy.identity?.name) identity.name = legacy.identity.name
  if (legacy.identity?.master) identity.master = legacy.identity.master
  if (legacy.speech_style?.call_master_as) {
    identity.call_master_as = legacy.speech_style.call_master_as
  }

  // appearance → avatar (字段名变了)
  if (legacy.appearance) {
    const avatar: Record<string, unknown> = {}
    if (legacy.appearance.live2d_model_dir) avatar.model_dir = legacy.appearance.live2d_model_dir
    if (legacy.appearance.model_file) avatar.model_file = legacy.appearance.model_file
    if (typeof legacy.appearance.anchor?.scale === 'number') {
      avatar.scale = legacy.appearance.anchor.scale
    }
    // x_offset / y_offset → v2 只有 offset_y（x 移除，居中渲染）
    if (typeof legacy.appearance.anchor?.y_offset === 'number') {
      // 老格式 y_offset 在 0..1 归一化，v2 是像素 — 估算 50 像素当默认
      // 若老值 abs < 1 假设是归一化，乘 100；否则当像素
      const y = legacy.appearance.anchor.y_offset
      avatar.offset_y = Math.abs(y) < 1 ? Math.round(y * 100) : Math.round(y)
    }
    if (Object.keys(avatar).length > 0) identity.avatar = avatar
  }

  // personality 三层
  if (legacy.personality?.layer1_core) personality.layer1_core = legacy.personality.layer1_core
  if (legacy.personality?.layer2_surface) {
    personality.layer2_surface = legacy.personality.layer2_surface
  }
  // layer3_volatility 对象 → 拼成自然语言 prompt
  const vol = legacy.personality?.layer3_volatility
  if (vol && typeof vol === 'object') {
    if (typeof vol.flip_probability === 'number') {
      personality.flip_probability = vol.flip_probability
    }
    if (Array.isArray(vol.flip_modes) && vol.flip_modes.length > 0) {
      const pct = Math.round((vol.flip_probability ?? 0.15) * 100)
      personality.layer3_volatility_prompt = `有 ${pct}% 概率出现反差：${vol.flip_modes.join('、')} 让人物更立体。`
    }
  }

  // signature_lines → catchphrases（v2 schema 重命名）
  if (legacy.speech_style?.signature_lines && legacy.speech_style.signature_lines.length > 0) {
    personality.speech_style = {
      catchphrases: legacy.speech_style.signature_lines.slice(0, 10),
    }
  }

  return {
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
    ...(Object.keys(personality).length > 0 ? { personality } : {}),
  }
}
