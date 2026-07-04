/**
 * R55: LLM endpoint 自动 normalize — 容错用户常见粘贴错误。
 *
 * 常见错误:
 *   - http://x.com/v1/  → http://x.com/v1 (去末尾 /)
 *   - http://x.com/v1/chat/completions → http://x.com/v1 (去补全路径)
 *   - http://x.com/v1/completions → http://x.com/v1
 *   - http://x.com/v1/models → http://x.com/v1
 *   - x.com:1234 → http://x.com:1234 (补 scheme)
 *   - http://x.com (没 /v1) → 不改 (用户也许有意, 让 healthCheck 报错)
 *
 * 纯函数 — 无副作用, 可单测。
 */

export function normalizeLlmEndpoint(input: string): string {
  let url = input.trim()
  if (!url) return ''

  // 补 scheme (用户粘贴 host:port 时常见)
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url
  }

  // 去 OpenAI 标准 path (用户可能从 cURL 例子粘贴整条 URL)
  url = url.replace(/\/(chat\/completions|completions|models|embeddings)\/?$/i, '')

  // 去末尾 /
  url = url.replace(/\/+$/, '')

  return url
}

/**
 * R67: 简化版 — 仅补 scheme + 去末尾 /, 不动 path (适用 TTS sidecar 等任意 endpoint)
 *
 * R73-fix: 防御非 http(s) scheme (file:// / ftp:// 等) — 剥离后补 http://,
 * 避免 TTS 拿到 file:// 协议直接发请求时报不直观错误
 */
export function normalizeSimpleUrl(input: string): string {
  let url = input.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    // 剥离其他 scheme (file:// / ftp:// / 等) 后补 http://
    url = 'http://' + url.replace(/^[a-z][a-z\d+\-.]*:\/\//i, '')
  }
  url = url.replace(/\/+$/, '')
  return url
}
