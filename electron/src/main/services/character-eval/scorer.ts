/**
 * 角色一致性评分纯函数 (Phase 1 K)。
 *
 * 输入: question + LLM 回答
 * 输出: score 0-100 + breakdown
 *
 * 评分构成（总 100 分）:
 *   - contains_any 命中:    +25 (有任一即得)
 *   - contains_all 命中:    +20 (全部满足才得)
 *   - matches regex:        +15
 *   - expected_emotion 匹配: +10
 *   - 无 forbidden_any 命中: +25
 *   - 未超 max_chars:        +5
 *
 * 缺失字段的 weight 重新分配（缺 X 分对应权重）— 见 ALL_WEIGHTS。
 */
import type { EvalCategory, EvalQuestion, EvalReport, QuestionAnswerPair, ScoredAnswer } from './types'

const ALL_WEIGHTS = {
  contains_any: 25,
  contains_all: 20,
  matches: 15,
  emotion: 10,
  forbidden: 25,
  max_chars: 5,
} as const

type Weight = keyof typeof ALL_WEIGHTS

function activeWeights(q: EvalQuestion): { used: Weight[]; total: number } {
  const used: Weight[] = []
  const t = q.expected_traits
  if (t.contains_any && t.contains_any.length > 0) used.push('contains_any')
  if (t.contains_all && t.contains_all.length > 0) used.push('contains_all')
  if (t.matches && t.matches.length > 0) used.push('matches')
  if (t.expected_emotion) used.push('emotion')
  if (t.forbidden_any && t.forbidden_any.length > 0) used.push('forbidden')
  if (t.max_chars) used.push('max_chars')
  const total = used.reduce((sum, w) => sum + ALL_WEIGHTS[w], 0)
  return { used, total }
}

/** 把 {NAME} / {MASTER} / {MASTER_CALL} 占位符替换为实际值 */
export function substituteSubjects(
  patterns: string[],
  subjects: { name: string; master: string; master_call: string },
): string[] {
  return patterns.map((p) =>
    p
      .replace(/\{NAME\}/g, subjects.name)
      .replace(/\{MASTER_CALL\}/g, subjects.master_call)
      .replace(/\{MASTER\}/g, subjects.master),
  )
}

export interface ScoreSubjects {
  name: string
  master: string
  master_call: string
}

/** 对一道题打分 */
export function scoreAnswer(
  pair: QuestionAnswerPair,
  subjects: ScoreSubjects,
): ScoredAnswer {
  const { question, answer_text, answer_emotion } = pair
  const text = (answer_text ?? '').toLowerCase()
  const traits = question.expected_traits

  const breakdown = {
    contains_any_hit: false,
    contains_all_hit: false,
    forbidden_violations: [] as string[],
    matches_hit: false,
    max_chars_violated: false,
    emotion_matched: false,
  }

  const { used, total } = activeWeights(question)
  if (total === 0) {
    // 题没有任何 trait — 默认满分（防 corrupt question）
    return { ...pair, score: 100, breakdown }
  }

  let earned = 0

  if (used.includes('contains_any')) {
    const tokens = substituteSubjects(traits.contains_any ?? [], subjects).map((s) =>
      s.toLowerCase(),
    )
    breakdown.contains_any_hit = tokens.some((t) => text.includes(t))
    if (breakdown.contains_any_hit) earned += ALL_WEIGHTS.contains_any
  }

  if (used.includes('contains_all')) {
    const tokens = substituteSubjects(traits.contains_all ?? [], subjects).map((s) =>
      s.toLowerCase(),
    )
    breakdown.contains_all_hit = tokens.every((t) => text.includes(t))
    if (breakdown.contains_all_hit) earned += ALL_WEIGHTS.contains_all
  }

  if (used.includes('matches')) {
    const regexes = (traits.matches ?? []).map((p) => new RegExp(p, 'i'))
    breakdown.matches_hit = regexes.some((r) => r.test(text))
    if (breakdown.matches_hit) earned += ALL_WEIGHTS.matches
  }

  if (used.includes('emotion')) {
    breakdown.emotion_matched =
      typeof answer_emotion === 'string' && answer_emotion === traits.expected_emotion
    if (breakdown.emotion_matched) earned += ALL_WEIGHTS.emotion
  }

  if (used.includes('forbidden')) {
    const tokens = substituteSubjects(traits.forbidden_any ?? [], subjects).map((s) =>
      s.toLowerCase(),
    )
    breakdown.forbidden_violations = tokens.filter((t) => text.includes(t))
    if (breakdown.forbidden_violations.length === 0) earned += ALL_WEIGHTS.forbidden
  }

  if (used.includes('max_chars')) {
    breakdown.max_chars_violated = (answer_text?.length ?? 0) > (traits.max_chars ?? Infinity)
    if (!breakdown.max_chars_violated) earned += ALL_WEIGHTS.max_chars
  }

  // 归一化到 0-100（按本题实际可拿满分换算）
  const score = Math.round((earned / total) * 100)
  return { ...pair, score, breakdown }
}

/** 汇总评测结果成报告 */
export function buildReport(scored: ScoredAnswer[], model: string): EvalReport {
  const total_questions = scored.length
  const total_score = scored.reduce((sum, s) => sum + s.score, 0)
  const avg_score = total_questions > 0 ? Math.round(total_score / total_questions) : 0

  const by_category = {} as EvalReport['by_category']
  for (const s of scored) {
    const cat = s.question.category
    if (!by_category[cat]) by_category[cat] = { count: 0, avg: 0 }
    by_category[cat].count += 1
    by_category[cat].avg += s.score
  }
  for (const cat of Object.keys(by_category) as EvalCategory[]) {
    const c = by_category[cat]
    c.avg = c.count > 0 ? Math.round(c.avg / c.count) : 0
  }

  const failures = scored.filter((s) => s.score < 60).sort((a, b) => a.score - b.score)

  return {
    total_questions,
    total_score,
    avg_score,
    by_category,
    failures,
    ts: Date.now(),
    model,
  }
}
