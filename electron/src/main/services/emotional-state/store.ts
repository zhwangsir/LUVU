/**
 * EmotionalState 持久化 (Phase 1 J) — 按 character_id 一个文件。
 *
 * 文件: ~/.luvu/chars/<id>/emotional-state.json
 * 跟 character preferences / soul 并列。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { characterDir } from '../character-store'
import {
  type EmotionalState,
  type Mood,
  createDefaultEmotionalState,
} from './types'
import {
  applyChatSentiment,
  applyChatTurn,
  applyTick,
  applyTopicMention,
  setMood,
} from './evolution'

function statePath(characterId: string): string {
  return join(characterDir(characterId), 'emotional-state.json')
}

/** 加载（不存在或损坏返回默认）— baseline 可在 character soul 里指定，目前用 calm */
export function loadEmotionalState(characterId: string, baseline: Mood = 'calm'): EmotionalState {
  const p = statePath(characterId)
  if (!existsSync(p)) return createDefaultEmotionalState(characterId, baseline)
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as EmotionalState
    // 简单 sanity check
    if (!parsed.character_id || typeof parsed.mood_intensity !== 'number') {
      return createDefaultEmotionalState(characterId, baseline)
    }
    return parsed
  } catch {
    return createDefaultEmotionalState(characterId, baseline)
  }
}

export function saveEmotionalState(state: EmotionalState): void {
  const p = statePath(state.character_id)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8')
}

/** 加载 → 透 applyXxx → 存盘 — 单调用便利 */
export function updateEmotionalState(
  characterId: string,
  updater: (s: EmotionalState) => EmotionalState,
): EmotionalState {
  const current = loadEmotionalState(characterId)
  const next = updater(current)
  saveEmotionalState(next)
  return next
}

// 高阶便利封装 — IPC handler / planner 直接调用即可
export function onChatTurn(characterId: string, sentiment?: number): EmotionalState {
  return updateEmotionalState(characterId, (s) => {
    let n = applyChatTurn(s)
    if (typeof sentiment === 'number') n = applyChatSentiment(n, sentiment)
    return n
  })
}

export function onTopicMention(
  characterId: string,
  topic: string,
  sentiment: number,
): EmotionalState {
  return updateEmotionalState(characterId, (s) => applyTopicMention(s, topic, sentiment))
}

export function onTick(characterId: string): EmotionalState {
  return updateEmotionalState(characterId, (s) => applyTick(s))
}

export function onSetMood(
  characterId: string,
  mood: Mood,
  intensity: number,
  trigger: string,
): EmotionalState {
  return updateEmotionalState(characterId, (s) => setMood(s, mood, intensity, trigger))
}
