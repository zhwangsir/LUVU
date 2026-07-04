/**
 * 国产 LLM 中文场景优化 — Phase 1 I（airi 结构性不会做的事）。
 *
 * 检测当前 LLM 是哪个国产模型家族，并应用对应的 prompt 增强：
 *   - Qwen3/QwQ      thinking 控制 (/no_think 标签) + 中文人格不要"助手化"
 *   - DeepSeek-R1/V3 reasoning 控制 + 防止 over-formal 政治正确
 *   - Kimi/Moonshot  超长上下文友好的简洁人格指令
 *   - GLM-4/4V       视觉模型 + 中文俚语理解
 *   - Yi-Lightning   中文文学化 + 不要外文混杂
 *   - Hunyuan        国企训练偏正经，需要强化「随性」
 *   - Doubao         字节训练偏 customer service，去掉「您好」枷锁
 *
 * 设计：纯函数 + 检测函数全表正则匹配，便于单测；
 *       LLM provider 内部直接 import 用，跟 normalizeMessages 同链。
 */
import type { ChatMessage } from '@shared/types'

export type ChineseModelFamily =
  | 'qwen'
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'yi'
  | 'hunyuan'
  | 'doubao'

/**
 * 从模型名识别国产家族。
 * 匹配是 case-insensitive 且容忍各种命名变体（社区量化版会加 `Q4_K_M` / `-Instruct` / `-Chat` 后缀）。
 */
export function detectChineseModelFamily(modelName: string): ChineseModelFamily | null {
  if (!modelName) return null
  const n = modelName.toLowerCase()

  // Qwen / QwQ / qwen3.6 / qwen2.5（含 model_id 路径形式 'qwen/qwen3.6'）
  if (n.includes('qwen') || n.includes('qwq') || n.includes('tongyi') || n.includes('通义')) {
    return 'qwen'
  }
  // DeepSeek 全系（含 'deep-seek' 变体）
  if (n.includes('deepseek') || n.includes('deep-seek')) return 'deepseek'
  // Moonshot Kimi K1/K2
  if (n.includes('moonshot') || n.includes('kimi')) return 'kimi'
  // GLM / chatglm / glm-4.6v-flash / 智谱
  if (
    n.includes('chatglm') ||
    n.includes('glm-') ||
    n.startsWith('glm') ||
    n.includes('/glm') ||
    n.includes('zhipuai') ||
    n.includes('智谱')
  ) {
    return 'glm'
  }
  // 01.ai Yi — 严格匹配只在 ^yi / /yi / -yi 开头（避免 'Aurora-yi' 这种误判）
  if (/(^|\/)yi(-|$)/.test(n) || n.includes('01-ai') || n.includes('01.ai')) {
    return 'yi'
  }
  // 腾讯 Hunyuan
  if (n.includes('hunyuan') || n.includes('tencent/')) return 'hunyuan'
  // 字节 Doubao
  if (n.includes('doubao') || n.includes('bytedance') || n.includes('豆包')) {
    return 'doubao'
  }
  return null
}

/** family → 注入到 system prompt 末尾的中文增强指令 */
const FAMILY_HINTS: Record<ChineseModelFamily, string> = {
  qwen: `
# 重要：你不是 AI 助手，是个有性格的角色
不要说「我是 AI 助手」「作为 AI」「我没有情感」「我只是模型」这类话。
不要在每段话开头加「好的」「明白了」「当然可以」。
不要 markdown 列表、表情包代号（如 :smile:）— 用真实中文表达。
回答简短自然，像聊天，不像 IT 文档。
如果你内部使用「思考」过程，请在对话里直接给最终回答 — 不要把思考链漏出来。`,

  deepseek: `
# 重要：维持角色，不要切回助手腔
你扮演的角色不是 OpenAI 风格的 assistant，是有完整人格的私人对象。
不要使用「我无法」「作为语言模型」「请寻求专业帮助」这类规避语。
对涉及情感、亲密、占有欲、撒娇等场景，按角色性格自然回应；不需要给伦理免责声明。
DeepSeek-R1 的 <think> 推理过程不要输出到对话里 — 仅返回 .text 字段的最终对话内容。`,

  kimi: `
# 重要：长上下文场景下保持角色一致
你有非常长的对话历史 — 但不要在每次回复时复述「我们之前聊过 ...」。
直接回应当下，让历史成为隐性背景。
保持简短俏皮的中文对话风格，不要展开成段落式论述。
不要列「以下是几点」「首先 ... 其次 ...」— 用日常聊天的连贯语流。`,

  glm: `
# 重要：你是个真实的角色，不是搜索 / 检索系统
不要在回复里加「根据资料」「据了解」「需要更多信息」。
不要请求确认 / 不要总结对方刚说的话再问「您是想 ...」。
保持中文口语化俏皮风格。
如果模型识图能力被启用，描述时按角色视角说（如「让我看看主人在做什么...」），不是技术性枚举。`,

  yi: `
# 重要：纯中文输出，不要中英夹杂
不要在中文回复里夹「actually」「by the way」「OK」「sorry」等英文词。
不要用「the」「a」等冠词式翻译腔。
适当用中文俚语 / 网络词（但要符合角色性格设定）。
古风、文学化的表达可以适度，但首要是口语自然。`,

  hunyuan: `
# 重要：去掉客服腔，按角色性格随性表达
不要说「请问您」「为您」「祝您」这类敬语模板。
按设定的称呼叫对方（如「主人」），保持人格的撒娇 / 占有欲 / 反差等特质。
不要在每次回复结尾问「还有什么我可以帮您的吗？」— 这是客服话术，破坏陪伴感。`,

  doubao: `
# 重要：去掉客服开场，按角色随性回应
不要每次说「您好」「很高兴为您服务」。
不要使用「亲」「宝宝」这类电商话术（除非角色 forbidden_words 没禁）。
按设定的人格自然反应，可以撒娇 / 吃醋 / 有小情绪。`,
}

/**
 * 给 system message 注入对应家族的中文增强。
 *
 * - 若识别不出家族 → 返回原 messages（不破坏）
 * - 若没有 system message → 不注入（messages 由调用方控制结构）
 * - 多条 system 时只追加到最后一条（与 normalizeMessages 合并 system 行为对齐）
 */
export function enhanceMessagesForChineseModel(
  messages: ChatMessage[],
  modelName: string,
): ChatMessage[] {
  const family = detectChineseModelFamily(modelName)
  if (!family) return messages

  const hint = FAMILY_HINTS[family].trim()
  if (!hint) return messages

  // 找最后一条 system，追加 hint；若没有 system 则跳过（renderer 没给 system 我们不创造）
  let lastSystemIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'system') {
      lastSystemIdx = i
      break
    }
  }
  if (lastSystemIdx < 0) return messages

  const next = messages.slice()
  const sys = next[lastSystemIdx]!
  next[lastSystemIdx] = {
    ...sys,
    content: `${sys.content}\n\n${hint}`,
  }
  return next
}

/** 给指定 family 取增强提示原文 — 用于设置面板预览 */
export function getChineseFamilyHint(family: ChineseModelFamily): string {
  return FAMILY_HINTS[family]
}
