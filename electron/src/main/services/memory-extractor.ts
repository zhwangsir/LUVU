/**
 * v0.15 C2 + C3: 对话记忆抽取 + RAG 上下文注入 + 每日 reflection。
 *
 * 设计：
 * - C2: 每对话 turn finalize 后调 extractMemoriesFromTurn — LLM 判断"值得记吗"
 *       → 抽取 fact + 调 embedding → 存 memory.db
 * - C3: chat 时调 buildRagContext — search top-5 相关 memories → prepend prompt
 *       每天首次 chat 时调 dailyReflection — LLM 总结昨天 → 写 reflection
 *
 * MVP: 完整接 LLM 和 embedding 需要 1-2 小时 + careful error handling。
 * 当前提供 stub 框架 — embedding 用 hash fallback，LLM 抽取占位。
 * 实际生产质量需要：
 * - embedding 接 OpenAI-compat /v1/embeddings 或 ollama embed
 * - extractor 用 LLM struct output 抽取 {kind, text, importance}
 *
 * 这是 v0.15 → v0.15.1 持续演进的部分。
 */
import { addMemoryForActive, searchMemories, type Memory } from './memory-store'
import { getActiveCharacter } from './character-store'

/**
 * Fallback embedding — 32 维 hash 编码，无 LLM endpoint 时用。
 * v0.21 export 给 creative tool 等其他写入路径共享,统一向量长度让 RAG cosine 可工作。
 *
 * reviewer M-1 修正:v0.22 真接 embedding endpoint 时,**所有调用点必须改 await**
 * (真 embedding 是 `async (text) => Promise<number[]>`,本同步签名仅为 v0.21 占位)。
 * grep `fallbackEmbedding\(` 找全部调用点,逐个加 await。
 */
export function fallbackEmbedding(text: string): number[] {
  const vec = new Array(32).fill(0) as number[]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const idx = i % 32
    vec[idx]! += (c % 17) / 17 - 0.5
  }
  // normalize
  let mag = 0
  for (const v of vec) mag += v * v
  mag = Math.sqrt(mag) || 1
  return vec.map((v) => v / mag)
}

/**
 * C1+C2: 对话 turn 完成后，决定是否抽取为长期记忆。
 * 简单 heuristic + fallback embedding。
 * 真正版本需要 LLM 调用，这里走 placeholder。
 */
export async function extractMemoriesFromTurn(
  userText: string,
  assistantText: string,
  turnId: string,
): Promise<Memory[]> {
  const active = getActiveCharacter()
  if (!active) return []

  const memories: Memory[] = []

  // Heuristic: 包含「我喜欢/我讨厌/我是」类陈述 → preference
  const preferenceMatch = userText.match(/(我喜欢|我讨厌|我是|我在做|我的工作是|我每天)/)
  if (preferenceMatch) {
    const m = addMemoryForActive({
      kind: 'preference',
      text: userText.slice(0, 200),
      embedding: fallbackEmbedding(userText),
      importance: 0.7,
      source: turnId,
    })
    if (m) memories.push(m)
  }

  // Heuristic: 长对话回合（>50 字符 user input）→ event
  if (userText.length > 50 && !preferenceMatch) {
    const m = addMemoryForActive({
      kind: 'event',
      text: `${userText.slice(0, 100)} → ${assistantText.slice(0, 100)}`,
      embedding: fallbackEmbedding(userText + ' ' + assistantText),
      importance: 0.4,
      source: turnId,
    })
    if (m) memories.push(m)
  }

  return memories
}

/**
 * C3: 给 chat 提供 RAG 上下文 — 搜历史 memories 跟当前 query 相关的，prepend 到 prompt。
 */
export function buildRagContext(queryText: string, k = 5): string {
  const active = getActiveCharacter()
  if (!active) return ''
  const queryEmbedding = fallbackEmbedding(queryText)
  const hits = searchMemories(active.id, queryEmbedding, k)
  if (hits.length === 0) return ''
  const lines = [`# 关于 ${active.call_master_as}（长期记忆，相关度排序）`]
  for (const h of hits) {
    const dateStr = new Date(h.ts).toLocaleDateString('zh-CN')
    lines.push(`- [${dateStr} · ${h.kind}] ${h.text}`)
  }
  lines.push(``)
  return lines.join('\n')
}

/**
 * C3: 每日 reflection — 角色基于过去 24 小时对话总结自己学到了什么。
 * 当前 stub — 等 LLM 集成接入。
 */
export async function dailyReflection(): Promise<{ ok: boolean; reflection?: Memory; reason?: string }> {
  const active = getActiveCharacter()
  if (!active) return { ok: false, reason: 'no active character' }
  // 占位：直接写一条 reflection
  const m = addMemoryForActive({
    kind: 'reflection',
    text: `今天 ${active.call_master_as} 跟我聊了不少（占位 reflection — v0.16 接 LLM 总结）`,
    embedding: fallbackEmbedding('daily reflection'),
    importance: 0.6,
    source: 'daily_reflection',
  })
  return m ? { ok: true, reflection: m } : { ok: false, reason: 'save failed' }
}
