/**
 * 把 SoulConfig 转成 LLM system prompt — 纯函数，无 fs / IPC 依赖。
 */
import type { SoulConfig } from './types'

export interface BuildSystemPromptOptions {
  /** 可选: 追加的 MCP / 工具描述（main app 注入），不传则不加 */
  toolsDescription?: string
  /** 可选: RAG 检索到的长期记忆 (memory.ts ragContext 输出)，不传则不加 */
  ragContext?: string
}

/**
 * 把 SoulConfig 渲染成 LLM system prompt 字符串。
 *
 * 输出层次:
 *   1. 身份 (name / master / call_master_as)
 *   2. 三层人格 (layer1 底色 / layer2 表层 / layer3 反差)
 *   3. 口头禅 / 禁词
 *   4. 输出协议 + 严格示例
 *   5. text 字段写法警告 (TTS 不能念情感括号)
 *   6. few-shot examples (如 example_dialogues 非空)
 *   7. MCP tools 描述 (可选)
 *   8. RAG context (可选)
 */
export function buildSystemPrompt(
  soul: SoulConfig,
  options: BuildSystemPromptOptions = {},
): string {
  const parts: string[] = [
    `# 你的身份`,
    `你叫 ${soul.name}。你的主人是 ${soul.master}。你称呼主人为「${soul.call_master_as}」。`,
    ``,
    `# 灵魂底色（永远不变）`,
    soul.layer1_core,
    ``,
    `# 表层风格`,
    soul.layer2_surface,
    ``,
    `# 反差波动`,
    soul.layer3_volatility_prompt,
    ``,
    `# 口头禅`,
    `常说：${soul.speech_style.catchphrases.join('、')}`,
    `语气词：${soul.speech_style.speech_tics.join('、')}`,
    `永远不要说：${soul.speech_style.forbidden_words.join('、')}`,
    ``,
    `# 输出协议（严格 JSON）`,
    soul.output_protocol.format,
    `示例：${soul.output_protocol.example}`,
    ``,
    `# 重要：text 字段写法`,
    `text 字段里**绝对不要写情感括号标注**：不要写「（害羞地）」「(撒娇)」「【小声】」「~温柔~」`,
    `「*开心地*」之类的描述词。情感完全用 emotion 字段表达，语气融在话里。`,
    `这些括号会被 TTS 直接念出来，破坏对话沉浸感。`,
  ]

  if (soul.example_dialogues && soul.example_dialogues.length > 0) {
    parts.push(``)
    parts.push(`# 你的说话方式（学习这些示范）`)
    parts.push(
      `下面是 ${soul.name} 在不同场景下应该的回应。请严格模仿这种语气、用词、emotion 选择：`,
    )
    parts.push(``)
    for (const ex of soul.example_dialogues) {
      parts.push(`【主人】 ${ex.user}`)
      parts.push(
        `【${soul.name}】 ${JSON.stringify(
          {
            text: ex.assistant.text,
            emotion: ex.assistant.emotion,
            intensity: ex.assistant.intensity,
          },
          null,
          0,
        )}`,
      )
      parts.push(``)
    }
    parts.push(`记住：上面只是示范，不是模板。要自然变化，但保持这种**语气和性格**。`)
  }

  if (options.toolsDescription && options.toolsDescription.trim()) {
    parts.push(``)
    parts.push(options.toolsDescription)
  }

  if (options.ragContext && options.ragContext.trim()) {
    parts.push(``)
    parts.push(`# 你记得的关于 master 的事（仅供你回忆参考，不要直接复述）`)
    parts.push(options.ragContext)
  }

  return parts.join('\n')
}
