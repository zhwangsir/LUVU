/**
 * 解析 LLM 输出 —— 我们的 output_protocol 要求 JSON {text, emotion, intensity}。
 * 兼容：
 *   1. 完整 JSON
 *   2. JSON 前后带闲话
 *   3. ```json fence
 *   4. 完全不遵守协议（fallback：把整段当 text，emotion=neutral）
 */
import type { EmotionId } from '@shared/types'
import type { BehaviorAction } from '@shared/attention'
import type { ParsedReply } from './types'

const EMOTIONS: EmotionId[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprise',
  'shy',
  'tease',
  'sleepy',
]

export function parseReply(raw: string): ParsedReply {
  const fallback: ParsedReply = {
    text: stripInlineDescriptions(raw.trim()),
    emotion: 'neutral',
    intensity: 0.5,
  }
  const cleaned = stripFence(raw).trim()
  const objs = extractJsonObjects(cleaned)
  for (const obj of objs) {
    if (typeof obj.text === 'string') {
      // text 字段也清掉 LLM 漏写的 (动作描述) *微笑* 【】等
      const cleanText = stripInlineDescriptions(obj.text)
      const actions = parseActionsArray(obj.actions)
      return {
        text: cleanText,
        emotion: normalizeEmotion(obj.emotion),
        intensity: clamp01(typeof obj.intensity === 'number' ? obj.intensity : 0.5),
        ...(actions.length > 0 ? { actions } : {}),
      }
    }
  }
  return fallback
}

/** 删除 text 内部出现的「(动作描述)」「*emote*」「【】」等不该被 TTS 念出来的标注 */
function stripInlineDescriptions(s: string): string {
  return s
    .replace(/[（(][^）)\n]{1,30}[）)]/g, '')
    .replace(/[【\[][^】\]\n]{1,30}[】\]]/g, '')
    .replace(/\*[^*\n]{1,30}\*/g, '')
    .replace(/~[^~\n]{1,20}~/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 校验 LLM 输出的 actions 数组，丢掉不识别的 type / 无效字段 */
function parseActionsArray(raw: unknown): BehaviorAction[] {
  if (!Array.isArray(raw)) return []
  const out: BehaviorAction[] = []
  for (const a of raw.slice(0, 3)) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    switch (String(r.type)) {
      case 'change_emotion':
        out.push({
          type: 'change_emotion',
          emotion: normalizeEmotion(r.emotion),
          intensity: clamp01(Number(r.intensity ?? 0.5)),
        })
        break
      case 'glance_at_screen':
        if (typeof r.screen_x === 'number' && typeof r.screen_y === 'number') {
          out.push({
            type: 'glance_at_screen',
            screen_x: r.screen_x,
            screen_y: r.screen_y,
            duration_ms: Math.min(8000, Math.max(500, Number(r.duration_ms ?? 2000))),
            reason: typeof r.reason === 'string' ? r.reason : 'reply-action',
          })
        }
        break
      case 'look_back_to_master':
        out.push({
          type: 'look_back_to_master',
          duration_ms: Math.min(5000, Math.max(500, Number(r.duration_ms ?? 1500))),
        })
        break
      case 'idle_subtle':
        out.push({
          type: 'idle_subtle',
          duration_ms: Math.min(10000, Math.max(1000, Number(r.duration_ms ?? 3000))),
        })
        break
      case 'play_group':
        if (typeof r.group === 'string' && r.group.length > 0 && r.group.length < 32) {
          out.push({
            type: 'play_group',
            group: r.group,
            ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
          })
        }
        break
      case 'generate_sticker':
        out.push({
          type: 'generate_sticker',
          emotion: normalizeEmotion(r.emotion),
          ...(typeof r.extra_prompt === 'string' && r.extra_prompt.length < 200
            ? { extra_prompt: r.extra_prompt }
            : {}),
          ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
        })
        break
      case 'agent_task':
        if (typeof r.goal === 'string' && r.goal.trim().length > 0 && r.goal.length < 500) {
          out.push({
            type: 'agent_task',
            goal: r.goal.trim(),
            ...(typeof r.max_steps === 'number' && r.max_steps > 0 && r.max_steps <= 30
              ? { max_steps: r.max_steps }
              : {}),
          })
        }
        break
    }
  }
  return out
}

/** 解析流式增量中可能的部分 JSON：用「最大已知前缀」抽取 text 字段 */
export function parsePartialText(buffer: string): string {
  // 简单做法：找 "text":" 后的字符串，到下一个未转义 "
  const m = buffer.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (!m) return ''
  return (m[1] ?? '').replace(/\\n/g, '\n').replace(/\\"/g, '"')
}

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
}

function extractJsonObjects(s: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  let depth = 0
  let start = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        const candidate = s.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate) as Record<string, unknown>
          if (parsed && typeof parsed === 'object') out.push(parsed)
        } catch {
          /* skip malformed */
        }
        start = -1
      }
    }
  }
  return out
}

function normalizeEmotion(v: unknown): EmotionId {
  if (typeof v === 'string') {
    const low = v.trim().toLowerCase() as EmotionId
    if (EMOTIONS.includes(low)) return low
  }
  return 'neutral'
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
