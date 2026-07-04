/**
 * Soul Auto-Learner (P5) — 把 EmotionalState 积累的高频/强情感 topic_imprints
 * 周期性写回 learned_traits.yaml，让灵魂真的"演化"。
 *
 * 不调 LLM (复用已有数据)，每 24h 由 emotional ticker 触发一次。
 *
 * 写入 learned_traits.yaml 形态:
 *   ---
 *   auto_learned:
 *     updated_at: 2026-05-21T...
 *     master_interests:
 *       - { topic: 工作, sentiment: -0.62, count: 8, polarity: "讨厌" }
 *       - { topic: 猫, sentiment: 0.85, count: 12, polarity: "喜欢" }
 *
 * 写完自动走 writeCharacterSoulFile → 触发 soul-change-log audit log。
 */
import yaml from 'js-yaml'
import { characterSoulDir, getCharacter, writeCharacterSoulFile } from './character-store'
import { loadEmotionalState } from './emotional-state/store'
import type { TopicImprint } from '@shared/emotional'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** topic 进入 auto_learned 的门槛 */
const MIN_COUNT = 5
const MIN_ABS_SENTIMENT = 0.3
const MAX_KEPT = 12 // learned_traits 里最多保留 N 条 — 防 yaml 无限膨胀

/** 默认每 24h 自动同步一次 */
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface LearnedTrait {
  topic: string
  sentiment: number
  count: number
  /** 中文极性标签便于 LLM 读 */
  polarity: '喜欢' | '讨厌' | '中性'
}

export interface SyncResult {
  ok: boolean
  applied?: number
  reason?: string
}

function polarityOf(sentiment: number): LearnedTrait['polarity'] {
  if (sentiment > 0.3) return '喜欢'
  if (sentiment < -0.3) return '讨厌'
  return '中性'
}

/** 从 topic_imprints 抽出符合阈值的 traits，按 |sentiment|*log(count) 排序 */
export function pickTraitsFromImprints(
  imprints: Record<string, TopicImprint>,
): LearnedTrait[] {
  const candidates: LearnedTrait[] = []
  for (const imp of Object.values(imprints)) {
    // 跳过特殊 cross-character topic (它有专属 prompt fragment，不入 learned_traits)
    if (imp.topic === '被主人提到') continue
    if (imp.count < MIN_COUNT) continue
    if (Math.abs(imp.sentiment) < MIN_ABS_SENTIMENT) continue
    candidates.push({
      topic: imp.topic,
      sentiment: Math.round(imp.sentiment * 100) / 100,
      count: imp.count,
      polarity: polarityOf(imp.sentiment),
    })
  }
  // 强度 * log(count+1) 排序
  candidates.sort(
    (a, b) =>
      Math.abs(b.sentiment) * Math.log(b.count + 1) -
      Math.abs(a.sentiment) * Math.log(a.count + 1),
  )
  return candidates.slice(0, MAX_KEPT)
}

/**
 * 把 traits 合并到 learned_traits.yaml 的 auto_learned 段。
 * 保留用户手写的其他字段不动 (yaml 合并 not 覆盖)。
 */
function buildLearnedTraitsYaml(
  traits: LearnedTrait[],
  existingYaml: string,
): string {
  // 解析已有
  let existing: Record<string, unknown> = {}
  if (existingYaml && existingYaml.trim()) {
    try {
      const parsed = yaml.load(existingYaml, { schema: yaml.JSON_SCHEMA })
      if (parsed && typeof parsed === 'object') {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      /* parse fail → 覆盖空 */
    }
  }
  // 覆盖 auto_learned 字段（用户手写的其他字段保留）
  existing.auto_learned = {
    updated_at: new Date().toISOString(),
    master_interests: traits.map((t) => ({
      topic: t.topic,
      sentiment: t.sentiment,
      count: t.count,
      polarity: t.polarity,
    })),
  }
  return yaml.dump(existing, { lineWidth: 100, noRefs: true })
}

/**
 * 同步指定 character 的 topic_imprints → learned_traits.yaml。
 * traits 数 < 1 时 skip (没足够数据)。
 */
export function syncLearnedTraits(characterId: string): SyncResult {
  const c = getCharacter(characterId)
  if (!c) return { ok: false, reason: 'character not found' }

  const state = loadEmotionalState(characterId)
  const traits = pickTraitsFromImprints(state.topic_imprints)
  if (traits.length === 0) {
    return { ok: true, applied: 0, reason: '没有足够强度的 topic 可学习' }
  }

  // 读 existing learned_traits.yaml (若有)
  const learnedPath = join(characterSoulDir(characterId), 'learned_traits.yaml')
  const existing = existsSync(learnedPath) ? safeRead(learnedPath) : ''

  const newContent = buildLearnedTraitsYaml(traits, existing)
  // code-reviewer M2 修: 排除 updated_at 时间戳后比较，避免每 24h 必重写
  if (sameAutoLearnedInterests(newContent, existing)) {
    return { ok: true, applied: 0, reason: 'no change (interests 一致)' }
  }

  const r = writeCharacterSoulFile(characterId, 'learned_traits.yaml', newContent)
  if (!r.ok) {
    return { ok: false, ...(r.reason !== undefined && { reason: r.reason }) }
  }
  // ts-reviewer L2: DEBUG flag 控制 (跟项目约定一致)
  if (process.env.LUVU_DEBUG === '1' || process.env.MAIN_APP_DEBUG === '1') {
    console.log(
      `[soul-learner] ${characterId}: ${traits.length} traits → learned_traits.yaml`,
    )
  }
  return { ok: true, applied: traits.length }
}

/** 比较 master_interests 数组本身（排除 updated_at）— 避免时间戳变化触发无意义重写 */
function sameAutoLearnedInterests(newYaml: string, oldYaml: string): boolean {
  try {
    const nObj = yaml.load(newYaml, { schema: yaml.JSON_SCHEMA }) as
      | { auto_learned?: { master_interests?: unknown[] } }
      | null
      | undefined
    const oObj = yaml.load(oldYaml, { schema: yaml.JSON_SCHEMA }) as
      | { auto_learned?: { master_interests?: unknown[] } }
      | null
      | undefined
    const nInterests = JSON.stringify(nObj?.auto_learned?.master_interests ?? [])
    const oInterests = JSON.stringify(oObj?.auto_learned?.master_interests ?? [])
    return nInterests === oInterests
  } catch {
    return false // 解析失败 → 认定不同，触发写
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf-8')
  } catch (e) {
    // security-reviewer LOW: 失败时 warn (避免静默丢用户手写字段)
    console.warn('[soul-learner] safeRead failed; 用户手写字段可能丢:', e)
    return ''
  }
}
