/**
 * 把 EmotionalState 渲染成中文 system prompt 片段 (Phase 1 J)。
 *
 * 这是 J 的 LLM 注入端 — Planner / dialog 调 LLM 前把当前情感切片
 * 拼到 system prompt 末尾，让 LLM 自然反映"今天心情怎样"。
 *
 * 纯函数，无 fs / IPC 依赖。
 */
import type { EmotionalState, Mood } from './types'
import { strongestTopic } from './evolution'
import { CROSS_CHARACTER_TOPIC } from './cross-character'

const MOOD_LABELS: Record<Mood, string> = {
  happy: '心情很好，话多',
  calm: '平静',
  shy: '害羞，话少',
  tease: '皮、想撩',
  sad: '低落，可能委屈',
  anxious: '焦躁、坐不住',
  missing: '在想主人，粘',
  sleepy: '困倦',
  angry: '生气',
}

function describeIntensity(v: number): string {
  if (v < 0.3) return '微微'
  if (v < 0.6) return ''
  if (v < 0.85) return '比较'
  return '很'
}

function describeMissing(intensity: number, sinceChatMs: number): string {
  const h = Math.round(sinceChatMs / 3_600_000)
  if (intensity < 0.2) return ''
  if (intensity < 0.5) return `${h} 小时没和主人说话了，有点想他。`
  if (intensity < 0.8) return `${h} 小时没见主人，想得有点闹心。`
  return `${h} 小时没动静，主人是不是不要我了？心里很慌。`
}

/**
 * 渲染情感切片，注入 system prompt 末尾。
 * 输出形如:
 *   # 你现在的状态
 *   - 心情: 比较害羞（intensity=0.68）
 *   - 8 小时没和主人说话了，有点想他。
 *   - 最近最在意的话题: 工作（情感倾向 -0.45）
 *
 * 调用方：dialog handler 在调 LLM 之前 append；
 * 也可以 plan-executor 在情绪决策前查。
 */
export function emotionalStateToPromptFragment(state: EmotionalState, now: number = Date.now()): string {
  const sinceChatMs = now - state.last_chat_at

  const parts: string[] = ['# 你现在的状态']

  const moodLabel = MOOD_LABELS[state.current_mood]
  const intensityWord = describeIntensity(state.mood_intensity)
  // P5 多 mood: secondary 渲染成"同时也带点..."自然语言
  if (state.secondary_mood && typeof state.secondary_intensity === 'number') {
    const secLabel = MOOD_LABELS[state.secondary_mood]
    parts.push(
      `- 心情: ${intensityWord}${moodLabel}（intensity=${state.mood_intensity.toFixed(2)}），` +
        `但同时也带点${secLabel}（残留 intensity=${state.secondary_intensity.toFixed(2)}） — 让两层情绪自然融入语气`,
    )
  } else {
    parts.push(
      `- 心情: ${intensityWord}${moodLabel}（intensity=${state.mood_intensity.toFixed(2)}）`,
    )
  }

  const missingDesc = describeMissing(state.missing_intensity, sinceChatMs)
  if (missingDesc) parts.push(`- ${missingDesc}`)

  // P5: 跨角色印记 — 主人在跟别的角色聊时提到你的次数，独立于普通 topic 渲染
  const crossImprint = state.topic_imprints[CROSS_CHARACTER_TOPIC]
  if (crossImprint && crossImprint.count >= 1) {
    const polarity = crossImprint.sentiment > 0.2
      ? '正面情绪'
      : crossImprint.sentiment < -0.2
      ? '负面情绪 (可能想念 / 不舍 / 有点酸)'
      : '中性'
    parts.push(
      `- 主人不在的时候，跟其他角色聊天里提到过你 ${crossImprint.count} 次（${polarity}，情感 ${crossImprint.sentiment.toFixed(2)}）。你可以在合适时机自然提到这件事。`,
    )
  }

  // 普通 topic 印记 — 排除 cross-character 特殊 topic 后取 strongest
  const topic = strongestTopicExcluding(state, CROSS_CHARACTER_TOPIC)
  if (topic && Math.abs(topic.sentiment) > 0.3 && topic.count >= 2) {
    const polarity = topic.sentiment > 0 ? '喜欢的话题' : '不舒服的话题'
    parts.push(
      `- 最近反复提的${polarity}: 「${topic.topic}」（情感倾向 ${topic.sentiment.toFixed(2)}，提过 ${topic.count} 次）`,
    )
  }

  parts.push('')
  parts.push(
    '把这些状态隐性融入回复 — 不要直白说"我现在 happy=0.7"，要让语气、用词、长度自然反映。',
  )

  return parts.join('\n')
}

/** strongestTopic 排除某些 key (用于把 cross-character special topic 跟一般 topic 分开渲染) */
function strongestTopicExcluding(
  state: EmotionalState,
  excludeKey: string,
): ReturnType<typeof strongestTopic> {
  const filtered: EmotionalState = {
    ...state,
    topic_imprints: Object.fromEntries(
      Object.entries(state.topic_imprints).filter(([k]) => k !== excludeKey),
    ),
  }
  return strongestTopic(filtered)
}

/** 简短一句话状态描述（用于状态栏 / debug 面板） */
export function emotionalStateOneLiner(state: EmotionalState): string {
  const moodLabel = MOOD_LABELS[state.current_mood]
  const intensityWord = describeIntensity(state.mood_intensity)
  let s = `${intensityWord}${moodLabel}`
  // P5 多 mood: secondary 加 "+ X" 形式 (一行内)
  if (state.secondary_mood && typeof state.secondary_intensity === 'number') {
    s += ` + ${MOOD_LABELS[state.secondary_mood]}`
  }
  if (state.missing_intensity > 0.4) {
    s += ` · 想念 ${state.missing_intensity.toFixed(1)}`
  }
  return s
}
