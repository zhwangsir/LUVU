/**
 * 透明窗口共享配置 —— 抄自 airi `apps/stage-tamagotchi/src/main/windows/shared/window.ts`。
 *
 * 我们 13 个版本反复修不好的 4 个 bug（拖动 / 穿透 / 设置打不开 / 眨眼）都源于
 * Tauri 在 macOS 上对透明窗口和 ignore_cursor 的实现不稳定。Electron 这 4 行
 * 在 macOS 上是稳定行为，是 airi 项目的根基。
 */
import type { BrowserWindowConstructorOptions } from 'electron'

const isMacOS = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'

export const platform = { isMacOS, isWindows, isLinux }

/**
 * 透明可穿透立绘窗口共享配置。
 * 关键 4 行：
 *   frame: false              —— 去掉窗口框
 *   titleBarStyle: 'hidden'   —— macOS 隐藏标题栏（其他平台无效字段）
 *   transparent: true         —— 真正的透明背景（不是黑色）
 *   hasShadow: false          —— 不要 macOS 默认窗口阴影
 */
export function transparentWindowConfig(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    ...(isMacOS && { titleBarStyle: 'hidden' as const }),
    transparent: true,
    hasShadow: false,
    // v0.17：去掉 resizable: false — 让上层决定。主立绘窗口需要可缩放
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
  }
}
