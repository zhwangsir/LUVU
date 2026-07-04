/**
 * Re-export shared 层 emotional types + main-side factory function。
 *
 * shared/emotional.ts 是 main + renderer 共用接口；这里只放需要 runtime 代码
 * 的工厂函数（不能在 shared/，因 createDefaultEmotionalState 用 Date.now()）。
 */
export type { EmotionalState, Mood, MoodChange, TopicImprint } from '@shared/emotional'
import type { EmotionalState, Mood } from '@shared/emotional'

export function createDefaultEmotionalState(
  characterId: string,
  baseline: Mood = 'calm',
): EmotionalState {
  const now = Date.now()
  return {
    character_id: characterId,
    baseline_mood: baseline,
    current_mood: baseline,
    mood_intensity: 0.3,
    missing_intensity: 0,
    last_chat_at: now,
    updated_at: now,
    topic_imprints: {},
    mood_history: [{ ts: now, mood: baseline, trigger: 'init' }],
  }
}
