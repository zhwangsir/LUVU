/**
 * Emotion → sentiment 映射 (Phase 1 J 接通)。
 *
 * LLM 已经在 parsed reply 里给了 emotion + intensity 字段；这里把它转换成
 * applyChatSentiment 期望的 -1.0 ~ 1.0 sentiment，让情感演化真正跑起来。
 *
 * 设计：emotion 类型 → 极性 baseline；intensity 0~1 → 强度缩放。
 */

/** emotion 类型 → 基础极性 (-1 ~ 1)；intensity=1 时的目标 sentiment */
const EMOTION_BASELINE: Record<string, number> = {
  happy: 0.7,
  tease: 0.85,
  shy: 0.3,
  sleepy: -0.1,
  neutral: 0,
  surprise: 0.1,
  sad: -0.7,
  angry: -0.85,
  // 跨 emotional-state Mood 类型的额外项（防 future-proof）
  missing: -0.4,
  anxious: -0.5,
  calm: 0,
}

/**
 * 把 LLM 输出的 emotion + intensity 转成 [-1, 1] sentiment。
 * intensity 缺省视为 0.5（中等）。
 */
export function emotionToSentiment(
  emotion: string | null | undefined,
  intensity: number | null | undefined,
): number {
  if (!emotion) return 0
  const e = emotion.toLowerCase()
  const baseline = EMOTION_BASELINE[e]
  if (baseline === undefined) return 0
  const i = typeof intensity === 'number' && Number.isFinite(intensity) ? intensity : 0.5
  const clampedI = Math.max(0, Math.min(1, i))
  // intensity 缩放：低 intensity 下情感效应衰减
  return baseline * clampedI
}
