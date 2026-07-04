/**
 * Live2D Expression 匹配器 (P5) — emotion/mood → expression 文件名。
 *
 * 行业 Live2D 模型 expression 命名各异：
 *   - 直接英文: "happy" / "sad" / "shy"
 *   - F 编号: "F01" "F02"
 *   - 中文: "微笑" "害羞" "生气"
 *   - 复合: "happy_smile" "sad_cry"
 *   - .exp3.json 后缀 (Cubism 4 标准)
 *
 * 这个 matcher 用多套规则 + 优先级匹配，最大化兼容性。
 */

/** Mood → 多组候选英文/中文/编号别名，按优先级排序 */
const EMOTION_ALIASES: Record<string, string[]> = {
  happy: ['happy', 'smile', '微笑', '高兴', '开心', '笑', 'joy', 'glad', 'F01'],
  sad: ['sad', 'cry', '难过', '伤心', '哭', 'sorrow', 'F02'],
  angry: ['angry', '生气', '愤怒', '怒', 'mad', 'rage', 'F03'],
  shy: ['shy', 'blush', '害羞', '羞涩', '脸红', '红', 'embarrassed', 'F04'],
  surprise: ['surprise', '惊讶', '震惊', 'wow', 'shock', 'F05'],
  tease: ['tease', 'wink', '挑逗', '调皮', '俏皮', '坏', 'mischief', 'F06'],
  sleepy: ['sleepy', 'sleep', '困', '困倦', '睡', 'yawn', 'F07'],
  anxious: ['anxious', '焦虑', '紧张', 'nervous', 'worry', 'F08'],
  missing: ['missing', 'lonely', '想念', '寂寞', 'longing', 'sad', 'F02'], // 复用 sad 兜底
  calm: ['calm', 'neutral', '平静', '默认', 'default', 'normal', 'F00'],
  neutral: ['neutral', 'calm', '默认', 'default', 'normal', 'F00'],
}

/**
 * 找到当前 emotion 在 expression 列表中最匹配的项。
 * 匹配规则:
 *   1. 别名精确等于（去 .exp3.json 后缀）
 *   2. expression 文件名 includes 别名（substring）
 *   3. 全失败 → null
 *
 * 返回原 expressionId（含 .exp3.json 后缀如有），pixi-live2d-display 接受原名。
 */
export function matchExpression(
  emotion: string | undefined | null,
  available: string[],
): string | null {
  if (!emotion || available.length === 0) return null
  const aliases = EMOTION_ALIASES[emotion.toLowerCase()] ?? [emotion]

  // 1. 精确匹配（忽略大小写 + 去后缀）
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase()
    for (const expId of available) {
      const baseName = expId
        .replace(/\.exp3?\.json$/i, '')
        .toLowerCase()
      if (baseName === aliasLower) return expId
    }
  }

  // 2. substring 匹配（别名包含在 expression name 里）
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase()
    if (aliasLower.length < 2) continue // 太短跳过
    for (const expId of available) {
      const baseName = expId.toLowerCase()
      if (baseName.includes(aliasLower)) return expId
    }
  }

  return null
}

/** 列出所有别名（debug / settings 展示用） */
export function listAliasesFor(emotion: string): string[] {
  return EMOTION_ALIASES[emotion.toLowerCase()] ?? []
}
