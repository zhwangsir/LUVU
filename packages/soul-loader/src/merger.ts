/**
 * 把多个 yaml partial 对象 (identity / personality / learned_traits / core_memories)
 * 合并成单一 SoulConfig，缺字段 fallback DEFAULT_SOUL。
 *
 * 纯函数 — 不读 fs，不依赖 yaml parser。调用方负责 yaml.load() 解析后传入。
 */
import type { SoulConfig } from './types'
import { DEFAULT_SOUL } from './types'

export interface MergeInput {
  /** identity.yaml 解析后对象（如有） */
  identity?: Record<string, unknown>
  /** personality.yaml */
  personality?: Record<string, unknown>
  /** learned_traits.yaml */
  learnedTraits?: Record<string, unknown>
  /** core_memories.yaml */
  coreMemories?: Record<string, unknown>
}

/**
 * 把多个 partial yaml 对象按 DEFAULT_SOUL 模板合并。
 * 设计：personality.layerN_xxx 与顶层 layerN_xxx 二选一（layer 字段优先 personality 嵌套形式）。
 */
export function mergeSoulPartials(input: MergeInput): SoulConfig {
  // deep clone DEFAULT_SOUL 防 mutation 污染
  const merged: SoulConfig = JSON.parse(JSON.stringify(DEFAULT_SOUL))

  // 把所有 partial 平铺成 src — 后面的覆盖前面的
  const src: Record<string, unknown> = {
    ...(input.coreMemories ?? {}),
    ...(input.learnedTraits ?? {}),
    ...(input.personality ?? {}),
    ...(input.identity ?? {}),
  }

  return mergeWithDefaults(merged, src)
}

/**
 * 把单一 src 对象合并到 base SoulConfig。
 * 兼容旧 single-file `default.yaml` 格式：layer 字段可能在顶层或 personality 嵌套内。
 */
export function mergeWithDefaults(base: SoulConfig, src: Record<string, unknown>): SoulConfig {
  const merged: SoulConfig = { ...base }

  const pick = <K extends keyof SoulConfig>(key: K): void => {
    if (src[key as string] !== undefined && src[key as string] !== null) {
      ;(merged as unknown as Record<string, unknown>)[key] = src[key as string]
    }
  }
  ;(['schema_version', 'name', 'master', 'call_master_as', 'flip_probability'] as const).forEach(pick)

  // layer1/2/3 可能写在 personality 子对象中
  const personality = (src.personality ?? {}) as Record<string, unknown>
  merged.layer1_core = (src.layer1_core ?? personality.layer1_core ?? merged.layer1_core) as string
  merged.layer2_surface = (src.layer2_surface ??
    personality.layer2_surface ??
    merged.layer2_surface) as string
  merged.layer3_volatility_prompt = (src.layer3_volatility_prompt ??
    personality.layer3_volatility_prompt ??
    merged.layer3_volatility_prompt) as string

  const speech = (src.speech_style ?? personality.speech_style) as
    | Partial<SoulConfig['speech_style']>
    | undefined
  if (speech) {
    merged.speech_style = {
      catchphrases: speech.catchphrases ?? merged.speech_style.catchphrases,
      speech_tics: speech.speech_tics ?? merged.speech_style.speech_tics,
      forbidden_words: speech.forbidden_words ?? merged.speech_style.forbidden_words,
    }
  }

  const protocol = (src.output_protocol ?? personality.output_protocol) as
    | Partial<SoulConfig['output_protocol']>
    | undefined
  if (protocol) {
    merged.output_protocol = {
      format: protocol.format ?? merged.output_protocol.format,
      example: protocol.example ?? merged.output_protocol.example,
    }
  }

  const avatar = (src.avatar ?? {}) as Partial<SoulConfig['avatar']>
  merged.avatar = {
    model_dir: avatar.model_dir ?? merged.avatar.model_dir,
    model_file: avatar.model_file ?? merged.avatar.model_file,
    scale: avatar.scale ?? merged.avatar.scale,
    offset_y: avatar.offset_y ?? merged.avatar.offset_y,
    search_paths: avatar.search_paths ?? merged.avatar.search_paths,
  }

  // example_dialogues — few-shot 数据（exactOptionalPropertyTypes 下条件展开）
  if (Array.isArray(src.example_dialogues)) {
    return {
      ...merged,
      example_dialogues: src.example_dialogues as NonNullable<SoulConfig['example_dialogues']>,
    }
  }

  return merged
}
