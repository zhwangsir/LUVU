/**
 * R50: 粗估 LLM token 数 — 不引 tokenizer 依赖的启发式。
 *
 * 适用场景: InputBar 显示估算 tokens, 让用户控制 prompt 大小;
 * 绝对不可作为 hard limit 判断 (差异可达 ±30%, 用真实 tokenizer 校验)。
 *
 * 经验系数 (基于 GPT-4 实测均值):
 *   - CJK (中日韩文字): 1 token / 字
 *   - Latin alphanumeric: 1 token / 4 字
 *   - 其他 (空白 / 标点 / emoji): 0.3 token / 字
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let latin = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
      (code >= 0x3040 && code <= 0x30ff) || // 平假名 / 片假名
      (code >= 0xac00 && code <= 0xd7af) // 韩文音节
    ) {
      cjk++
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      latin++
    } else {
      other++
    }
  }
  return Math.ceil(cjk + latin / 4 + other * 0.3)
}
