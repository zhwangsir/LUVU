/**
 * useCmdKey (R79) — platform 感知快捷键修饰符标签。
 *
 * 返回 '⌘' (macOS) 或 'Ctrl' (其他)。单次计算, 模块顶层 const。
 * 优先 navigator.userAgentData (Chromium 90+), fallback userAgent。
 */
function detectCmdKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  const uad = (navigator as unknown as { userAgentData?: { platform?: string } })
    .userAgentData
  const isMac =
    uad?.platform === 'macOS' || /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  return isMac ? '⌘' : 'Ctrl'
}

export const CMD_KEY = detectCmdKey()
