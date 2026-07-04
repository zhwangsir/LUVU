/**
 * 跨角色情感联动 (P5.new) — LUVU 独有，airi 不可能做。
 *
 * 触发场景:
 *   主人正在跟 character A 聊，user_text 提到 character B 的名字 →
 *   B 的 EmotionalState 自动累积 topic_imprint("被主人提到")，
 *   sentiment 取决于该次对话整体情感。
 *
 * 效果:
 *   下次切到 B 当 active 时，B 的 system prompt 会自动出
 *   "最近反复被主人提到 (情感倾向 -0.x，提过 N 次)"，
 *   让 B 表现出"我知道主人最近老说起我/吃醋"。
 *
 * 设计:
 *   - 不直接切 B 的 mood (避免后台 character 突然变 angry 显得突兀)
 *   - 只累积 topic_imprint，让 B 在被切到 active 时自然感受到
 *   - 检测命中需匹配整个名字 (避免子串误判：A 叫 "雨" 不应被 "下雨了" 触发)
 */
import type { Character } from '@shared/character'
import { applyTopicMention } from './evolution'
import { updateEmotionalState } from './store'

const CROSS_TOPIC_KEY = '被主人提到'

/**
 * 从 text 中找出被提及的其他 character (排除 active)。
 * 名字匹配规则:
 *   - 中文/日文/韩文名：直接 includes 匹配（无 word boundary）
 *   - 拉丁字母名：要求两侧是非字母（避免 'Aria' 误匹配 'AriaLynn'）
 *   - 长度 < 2 的名字跳过（太多 false positive）
 */
export function detectOtherCharactersMentioned(
  text: string,
  allChars: Character[],
  activeId: string | null,
): Character[] {
  if (!text || typeof text !== 'string') return []
  const hits: Character[] = []
  for (const c of allChars) {
    if (c.id === activeId) continue
    const name = c.name?.trim()
    if (!name || name.length < 2) continue
    if (isNameInText(name, text)) {
      hits.push(c)
    }
  }
  return hits
}

function isNameInText(name: string, text: string): boolean {
  // 拉丁字母名：用 word boundary 防子串误匹配
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(name)}([^A-Za-z0-9_]|$)`, 'i')
    return re.test(text)
  }
  // CJK / mixed 名字：substring 即可
  return text.includes(name)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 给一个非 active 的 character 应用"被主人提到"印记。
 * 持久化到该 character 的 emotional-state.json (各 character 文件隔离)。
 */
export function applyMentionedToOtherCharacter(
  characterId: string,
  sentiment: number,
): void {
  updateEmotionalState(characterId, (s) =>
    applyTopicMention(s, CROSS_TOPIC_KEY, sentiment),
  )
}

export const CROSS_CHARACTER_TOPIC = CROSS_TOPIC_KEY
