/**
 * 情感状态演化纯函数 (Phase 1 J)。
 *
 * 全部 immutable — 返回新 state，不 mutate 输入。
 */
import type { EmotionalState, Mood, MoodChange, TopicImprint } from './types'

const MOOD_HISTORY_MAX = 30
const TOPIC_IMPRINTS_MAX = 60
/** missing_intensity 增长曲线：4h 后开始有感，1d 达 0.6，3d 达 0.95 */
const MISSING_HALF_DAY_MS = 12 * 60 * 60 * 1000
/** 心情每小时向 baseline 衰减比率（0.05 = 1h 衰减 5%） */
const MOOD_DECAY_PER_HOUR = 0.05
/** P5 多 mood: secondary 衰减是 primary 的 2 倍（残留情绪应该消得更快） */
const SECONDARY_DECAY_MULTIPLIER = 2.0
/** secondary intensity 低于此值时自动清空（不再渲染到 prompt） */
const SECONDARY_CLEAR_THRESHOLD = 0.15
/** primary 切换时保留为 secondary 的最低 intensity 门槛（避免无强度 mood 残留干扰） */
const PROMOTE_TO_SECONDARY_MIN = 0.5

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function appendMoodHistory(state: EmotionalState, change: MoodChange): MoodChange[] {
  const next = [...state.mood_history, change]
  if (next.length > MOOD_HISTORY_MAX) {
    return next.slice(next.length - MOOD_HISTORY_MAX)
  }
  return next
}

/**
 * 用户每次说话后调用。
 * - 重置 missing_intensity → 0
 * - last_chat_at = now
 * - 若当前 mood 是 sad/anxious/missing → 轻度回归 baseline（聊上了心情会好）
 * - 不直接改 current_mood（mood 切换走 applyChatSentiment）
 */
export function applyChatTurn(
  state: EmotionalState,
  now: number = Date.now(),
): EmotionalState {
  const next: EmotionalState = {
    ...state,
    last_chat_at: now,
    missing_intensity: 0,
    updated_at: now,
  }
  // negative moods 在 chat 触发下减半（聊上了就开心一些）
  if (state.current_mood === 'sad' || state.current_mood === 'anxious' || state.current_mood === 'missing') {
    const newIntensity = state.mood_intensity * 0.5
    if (newIntensity < 0.2) {
      // mood 回归 baseline
      next.current_mood = state.baseline_mood
      next.mood_intensity = 0.3
      next.mood_history = appendMoodHistory(state, {
        ts: now,
        mood: state.baseline_mood,
        trigger: 'chat_relief',
      })
      // ts-reviewer MEDIUM: chat_relief 是非 sentiment 切换 — 旧 secondary 已失去
      // 来源 primary，清空避免下次 prompt 渲染 calm + tease 这种语义矛盾
      delete next.secondary_mood
      delete next.secondary_intensity
    } else {
      next.mood_intensity = newIntensity
    }
  }
  return next
}

/**
 * 用户消息的情感分析结果（外部 sentiment scorer 或 LLM 给）传进来微调 mood。
 *
 * @param sentiment -1.0 ~ 1.0
 *   - >0.5  → happy/tease 倾向
 *   - <-0.5 → sad/angry 倾向
 *   - 中间  → 维持当前 mood
 */
export function applyChatSentiment(
  state: EmotionalState,
  sentiment: number,
  now: number = Date.now(),
): EmotionalState {
  const next: EmotionalState = { ...state, updated_at: now }
  let newPrimary: Mood | undefined
  let newIntensity = 0
  if (sentiment > 0.5 && state.current_mood !== 'happy' && state.current_mood !== 'tease') {
    newPrimary = sentiment > 0.85 ? 'tease' : 'happy'
    newIntensity = clamp(0.4 + (sentiment - 0.5) * 0.6, 0.4, 0.95)
  } else if (sentiment < -0.5 && state.current_mood !== 'sad' && state.current_mood !== 'angry') {
    newPrimary = sentiment < -0.85 ? 'angry' : 'sad'
    newIntensity = clamp(0.4 + Math.abs(sentiment + 0.5) * 0.6, 0.4, 0.9)
  }
  if (!newPrimary) return next

  // P5 多 mood: 若当前 primary intensity 还高，保留为 secondary（"我开心，但还有点害羞"）
  if (state.mood_intensity >= PROMOTE_TO_SECONDARY_MIN && state.current_mood !== newPrimary) {
    next.secondary_mood = state.current_mood
    next.secondary_intensity = state.mood_intensity * 0.7 // 降级时打个折
  } else {
    // intensity 不够，丢
    delete next.secondary_mood
    delete next.secondary_intensity
  }

  next.current_mood = newPrimary
  next.mood_intensity = newIntensity
  next.mood_history = appendMoodHistory(state, {
    ts: now,
    mood: newPrimary,
    trigger: `chat_sentiment${sentiment >= 0 ? '+' : ''}${sentiment.toFixed(2)}`,
  })
  return next
}

/**
 * 心跳：定时（如 attention loop 5min）调用，让情感随时间自然演化。
 *
 * - missing_intensity 按 last_chat_at 间隔增长（指数饱和到 1.0）
 * - current_mood 强度向 baseline 缓慢衰减（每小时 -MOOD_DECAY_PER_HOUR）
 * - 当 missing_intensity 高（>0.6）且当前不是 missing/sad → 切到 missing
 */
export function applyTick(
  state: EmotionalState,
  now: number = Date.now(),
): EmotionalState {
  const dtMs = Math.max(0, now - state.updated_at)
  if (dtMs < 60_000) return state // <1 min 跳过避免高频写盘

  const sinceChatMs = now - state.last_chat_at
  // 指数饱和: 1 - 2^(-sinceChat / halfLife)
  const missing = 1 - Math.pow(2, -sinceChatMs / MISSING_HALF_DAY_MS)
  const missingClamped = clamp(missing, 0, 1)

  // mood 衰减
  const decayed = state.mood_intensity * Math.pow(1 - MOOD_DECAY_PER_HOUR, dtMs / 3_600_000)
  const newIntensity = clamp(decayed, 0, 1)

  const next: EmotionalState = {
    ...state,
    missing_intensity: missingClamped,
    mood_intensity: newIntensity,
    updated_at: now,
  }

  // P5 多 mood: secondary 衰减更快 (2x)，<0.15 自动清空
  if (state.secondary_mood && typeof state.secondary_intensity === 'number') {
    const secDecayed =
      state.secondary_intensity *
      Math.pow(1 - MOOD_DECAY_PER_HOUR * SECONDARY_DECAY_MULTIPLIER, dtMs / 3_600_000)
    if (secDecayed < SECONDARY_CLEAR_THRESHOLD) {
      delete next.secondary_mood
      delete next.secondary_intensity
    } else {
      next.secondary_intensity = clamp(secDecayed, 0, 1)
    }
  }

  // mood 强度衰减到 < 0.2 → 回归 baseline（情绪自然平复）
  if (newIntensity < 0.2 && state.current_mood !== state.baseline_mood) {
    next.current_mood = state.baseline_mood
    next.mood_intensity = 0.3
    next.mood_history = appendMoodHistory(state, {
      ts: now,
      mood: state.baseline_mood,
      trigger: 'periodic_decay',
    })
  }

  // missing 大且当前不是负面 mood → 切 missing（这是 negative mood 但角色性质决定，
  // 粘人角色更易切 missing；冷静角色切 sad）
  if (missingClamped > 0.6 && state.current_mood !== 'missing' && state.current_mood !== 'sad') {
    next.current_mood = 'missing'
    next.mood_intensity = missingClamped
    next.mood_history = appendMoodHistory(next, {
      ts: now,
      mood: 'missing',
      trigger: `long_silence_${Math.round(sinceChatMs / 3_600_000)}h`,
    })
  }

  return next
}

/**
 * 记录一个话题印记。topic 关键词由调用方（LLM / planner）提取。
 *
 * @param sentiment 这次提到该话题的情感倾向 -1~1
 * 多次提及会做加权平均（旧 sentiment * 0.7 + 新 * 0.3）
 */
export function applyTopicMention(
  state: EmotionalState,
  topic: string,
  sentiment: number,
  now: number = Date.now(),
): EmotionalState {
  const key = topic.trim().toLowerCase()
  if (!key) return state

  const prior = state.topic_imprints[key]
  const merged: TopicImprint = prior
    ? {
        topic: key,
        sentiment: prior.sentiment * 0.7 + sentiment * 0.3,
        count: prior.count + 1,
        last_at: now,
      }
    : {
        topic: key,
        sentiment,
        count: 1,
        last_at: now,
      }

  // LRU：保留 TOPIC_IMPRINTS_MAX 个最新
  const allEntries = { ...state.topic_imprints, [key]: merged }
  const sorted = Object.values(allEntries).sort((a, b) => b.last_at - a.last_at)
  const kept = sorted.slice(0, TOPIC_IMPRINTS_MAX)
  const nextImprints: Record<string, TopicImprint> = {}
  for (const t of kept) nextImprints[t.topic] = t

  return {
    ...state,
    topic_imprints: nextImprints,
    updated_at: now,
  }
}

/** 查最强情感的话题（用于"突然想到 X"主动 plan） */
export function strongestTopic(state: EmotionalState): TopicImprint | null {
  const arr = Object.values(state.topic_imprints)
  if (arr.length === 0) return null
  return arr.reduce((best, cur) =>
    Math.abs(cur.sentiment) * Math.log(cur.count + 1) >
    Math.abs(best.sentiment) * Math.log(best.count + 1)
      ? cur
      : best,
  )
}

/** 强制切换 mood（如 LLM 显式 plan "change_mood" action 触发） */
export function setMood(
  state: EmotionalState,
  mood: Mood,
  intensity: number,
  trigger: string,
  now: number = Date.now(),
): EmotionalState {
  // P5 多 mood: 手动 setMood 视为显式选择，清空 secondary（没有"残留"含义）
  const next: EmotionalState = {
    ...state,
    current_mood: mood,
    mood_intensity: clamp(intensity, 0, 1),
    updated_at: now,
    mood_history: appendMoodHistory(state, { ts: now, mood, trigger }),
  }
  delete next.secondary_mood
  delete next.secondary_intensity
  return next
}
