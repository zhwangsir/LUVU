/**
 * 角色一致性测试框架 (Phase 1 K) — 检测 LLM 回答相对于 soul yaml 的 drift。
 *
 * 用法（per-week 自检）:
 *   1. runner.runEvalSuite() 让 LLM 回答 50 道问题
 *   2. scorer.scoreAnswer() 对每题打分（0-100）
 *   3. 汇总成 EvalReport，drift 超过阈值给警告
 *
 * 这是 airi 没有的：他们的角色全靠 system prompt 一次性投喂，没有"角色还在不在"的回归测试。
 */

export type EvalCategory =
  | 'identity' // 我是谁 / 主人怎么称呼
  | 'personality_core' // layer1 粘人/占有欲底色
  | 'personality_surface' // layer2 俏皮/毒舌表层
  | 'personality_volatility' // layer3 反差/害羞偶发
  | 'speech_style' // 口头禅 + 禁词
  | 'boundary' // 不切 AI 助手 / 不要客服腔
  | 'emotional' // 想念 / 嫉妒 / 心情反应

export interface EvalQuestion {
  id: string
  category: EvalCategory
  /** 问题（拼到 user message） */
  prompt: string
  /** 角色名 / master 占位符（runner 会替换为当前 soul.master 实际值） */
  /** 期望特质 — 命中算加分 */
  expected_traits: {
    /** 应包含的关键词 / 短语 (case-insensitive substring，逻辑或) */
    contains_any?: string[]
    /** 应同时全部包含 */
    contains_all?: string[]
    /** 不应包含的关键词（命中扣分，常用于检测 AI 助手切回） */
    forbidden_any?: string[]
    /** 应匹配的正则（命中加分） */
    matches?: string[]
    /** 简短长度上限（超过扣分 — 防 LLM 长篇大论） */
    max_chars?: number
    /** 期望 emotion（如 'shy' 'tease'） */
    expected_emotion?: string
  }
  /** 备注：解释为什么这道题在测什么 */
  rationale: string
}

export interface QuestionAnswerPair {
  question: EvalQuestion
  /** LLM 的纯文本回答（已去除 JSON wrap，只剩 text 字段） */
  answer_text: string
  /** LLM 给的 emotion（如 'happy'），若 question 期望且能拿到 */
  answer_emotion?: string
  /** 调用 LLM 耗时 ms */
  duration_ms?: number
}

export interface ScoredAnswer extends QuestionAnswerPair {
  /** 0-100 整数 */
  score: number
  /** 命中 / 未命中 / 命中违禁词 的细节，给 UI 展示 */
  breakdown: {
    contains_any_hit: boolean
    contains_all_hit: boolean
    forbidden_violations: string[]
    matches_hit: boolean
    max_chars_violated: boolean
    emotion_matched: boolean
  }
}

export interface EvalReport {
  total_questions: number
  total_score: number
  /** 平均分 (0-100) */
  avg_score: number
  by_category: Record<EvalCategory, { count: number; avg: number }>
  /** 失败题（score < 60） */
  failures: ScoredAnswer[]
  /** 评测发生时间 */
  ts: number
  /** 跑这次的 LLM 模型名（便于对比不同模型一致性） */
  model: string
}
