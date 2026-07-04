/**
 * R87: 对话历史导出为 markdown。
 *
 * 格式:
 *   # LUVU 对话 · {character_name} · {date}
 *
 *   **🧑 主人** · 2026-05-22 14:32
 *   用户文本…
 *
 *   **🤖 角色** · 2026-05-22 14:32 · 情绪 happy 80%
 *   助手文本…
 *
 * 纯函数, 不读 IPC, 调用方传 turns + character name。
 */

export interface ExportTurn {
  role: 'user' | 'assistant' | 'system'
  text: string
  ts: number
  emotion?: string | null
  intensity?: number | null
  error?: string | null
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * R92-fix (MED): escape 行首 markdown 标记字符, 防 user/assistant text 污染导出格式。
 * 仅转义最常导致结构破坏的: # header, --- ___ hr; 不动 **bold** `code` 等 inline。
 */
function escapeMdStructural(text: string): string {
  return text.replace(/^(#{1,6}\s|---+\s*$|___+\s*$)/gm, '\\$1')
}

export function exportTurnsToMarkdown(
  turns: readonly ExportTurn[],
  characterName: string,
): string {
  const today = fmtTs(Date.now()).slice(0, 10)
  const header = `# LUVU 对话 · ${characterName} · ${today}\n\n`
  if (turns.length === 0) {
    return `${header}_（暂无对话历史）_\n`
  }
  const lines: string[] = [header]
  for (const t of turns) {
    if (t.role === 'system') continue // 系统消息不导出
    const ts = fmtTs(t.ts)
    const roleLabel =
      t.role === 'user' ? '🧑 主人' : `🤖 ${characterName}`
    let meta = ts
    if (t.role === 'assistant' && t.emotion && t.emotion !== 'neutral') {
      const pct =
        typeof t.intensity === 'number'
          ? ` ${Math.round(Math.max(0, Math.min(1, t.intensity)) * 100)}%`
          : ''
      meta += ` · 情绪 ${t.emotion}${pct}`
    }
    if (t.error) {
      meta += ` · ❌ 失败`
    }
    const safeText = t.text ? escapeMdStructural(t.text) : '_（空）_'
    lines.push(`**${roleLabel}** · ${meta}\n\n${safeText}\n`)
  }
  return lines.join('\n')
}
