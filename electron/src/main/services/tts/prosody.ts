/**
 * Mood-aware TTS prosody — emotion + intensity → rate/pitch 叠加调整 (P5)。
 *
 * 不改用户 RuntimeConfig 基线 (tts_rate / tts_pitch)，运行时根据情感叠加 delta:
 *   happy/tease 强度高 → 语速 +5~10%，pitch 调高
 *   sad/missing 强度高 → 语速 -5~10%，pitch 调低
 *   shy → 语速略慢 + pitch 略高 (含羞声)
 *   angry → 语速快 + pitch 略低 (压抑的怒)
 *   sleepy → 语速明显慢
 *   其他 (calm/neutral/anxious/surprise) → 不调
 *
 * 输出 SSML 兼容字符串：rate '+8%' / pitch '+3Hz'
 *
 * 纯函数 — 不读 config，调用方传入基线 + 当前 emotion + intensity。
 */

/**
 * mood → (rate %, pitch Hz) 在 intensity=1 时的目标 delta。
 *
 * 这些值是主观调好的经验值 — 改之前先听一下效果。
 * code-reviewer M5: 4 个 no-op 条目 (calm/neutral/anxious/surprise) 是
 * intentionally no-op，明确表达"这些情绪 TTS 不调音"。
 * 移除后调用方未知 emotion 也是返基线 — 但保留显式表达 intent 更好。
 */
const PROSODY_TARGET: Record<string, { rateDelta: number; pitchHz: number }> = {
  happy: { rateDelta: 10, pitchHz: 5 },
  tease: { rateDelta: 8, pitchHz: 4 },
  shy: { rateDelta: -3, pitchHz: 3 },
  sad: { rateDelta: -8, pitchHz: -5 },
  missing: { rateDelta: -6, pitchHz: -4 },
  angry: { rateDelta: 6, pitchHz: -3 },
  sleepy: { rateDelta: -15, pitchHz: -2 },
  // 以下 intentionally no-op (delta=0) — 显式表达"这些情绪不调音"
  calm: { rateDelta: 0, pitchHz: 0 },
  neutral: { rateDelta: 0, pitchHz: 0 },
  anxious: { rateDelta: 0, pitchHz: 0 },
  surprise: { rateDelta: 0, pitchHz: 0 },
}

/** security-reviewer LOW: emotion 长度上限 (避免 IPC 传 10MB 字符串 .toLowerCase() 开销) */
const MAX_EMOTION_LEN = 32

export interface ProsodyBase {
  /** 用户在 settings 设的 rate 基线 (如 '+0%' / '+10%') */
  rate: string
  /** 用户基线 pitch (如 '+0Hz') */
  pitch: string
}

export interface ProsodyAdjusted {
  rate: string
  pitch: string
  /** debug: 哪个 mood / intensity / delta 计算出的 */
  applied?: {
    emotion: string
    intensity: number
    rateDelta: number
    pitchDelta: number
  }
}

/**
 * 解析 SSML 风格的 prosody 字符串 (+10%, -3Hz)，返回数字部分。
 * 无法解析或不带后缀时返 0。
 */
function parseSign(s: string | undefined, suffix: string): number {
  if (!s) return 0
  const re = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${escapeReg(suffix)}$`)
  const m = s.trim().match(re)
  if (!m) {
    // security-reviewer LOW: 解析失败时 warn (避免静默 fallback 到 0 让用户配置失效不知道)
    console.warn(`[tts-prosody] 解析失败 "${s}" 期望格式 "[+-]N${suffix}"，使用 0`)
    return 0
  }
  return parseFloat(m[1]!)
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${Math.round(v)}%`
}

function formatHz(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${Math.round(v)}Hz`
}

/**
 * 根据当前 emotion + intensity，给基线 prosody 叠加 mood 调整。
 *
 * intensity (0..1) 作为缩放因子：
 *   - intensity < 0.3 → delta * 0.5（弱情感小调）
 *   - intensity >= 0.3 → delta * intensity（线性）
 *
 * 未知 emotion 直接返回基线。
 */
export function adjustProsody(
  base: ProsodyBase,
  emotion: string | undefined | null,
  intensity: number | undefined | null,
): ProsodyAdjusted {
  if (!emotion) return { rate: base.rate, pitch: base.pitch }
  // security-reviewer LOW: 长度 cap 防 DoS (10MB emotion .toLowerCase 浪费)
  const safeEmotion = emotion.slice(0, MAX_EMOTION_LEN).toLowerCase()
  const target = PROSODY_TARGET[safeEmotion]
  if (!target) return { rate: base.rate, pitch: base.pitch }

  // ts-reviewer M4: 类型守卫窄化 intensity 为 number
  // intensity 缺省 (null/undefined/NaN) → 0.5；明确 0 → 完全不调
  const i: number =
    typeof intensity === 'number' && Number.isFinite(intensity)
      ? intensity === 0
        ? 0
        : Math.max(0, Math.min(intensity, 1))
      : 0.5
  if (i === 0) return { rate: base.rate, pitch: base.pitch }
  const scale = i < 0.3 ? i * 0.5 : i

  const rateDelta = target.rateDelta * scale
  const pitchDelta = target.pitchHz * scale

  if (Math.abs(rateDelta) < 0.5 && Math.abs(pitchDelta) < 0.5) {
    return { rate: base.rate, pitch: base.pitch }
  }

  const baseRate = parseSign(base.rate, '%')
  const basePitch = parseSign(base.pitch, 'Hz')
  return {
    rate: formatPct(baseRate + rateDelta),
    pitch: formatHz(basePitch + pitchDelta),
    applied: {
      emotion: safeEmotion,
      intensity: i,
      rateDelta,
      pitchDelta,
    },
  }
}
