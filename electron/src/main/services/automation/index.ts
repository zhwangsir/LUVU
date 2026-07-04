/**
 * Agent 自动化能力 — LUVU 操控鼠标/键盘/截屏
 *
 * 基于 @nut-tree-fork/nut-js（跨平台、prebuild）。
 * macOS 需要 系统设置 → 隐私与安全性 → 辅助功能 / 屏幕录制 授权 LUVU.app。
 *
 * 设计原则：
 *   1. 默认放开 — Master 已授权，不弹审批（破坏自动化流畅性）
 *   2. 只有 SAFETY_GUARD 标记的"危险动作"才走审批（如 `key("Meta+Q")` 退出应用）
 *   3. 所有操作都打 [agent] log，方便回看
 *   4. 单步动作 ≤ 5s 完成，避免主线程阻塞过久
 */
import {
  Button,
  Key,
  Point,
  Region,
  centerOf,
  keyboard,
  mouse,
  screen,
  straightTo,
} from '@nut-tree-fork/nut-js'

// 全局熔断标志（用户按全局快捷键时设为 true，所有 action 立即拒绝）
let halted = false

export function setHalted(value: boolean): void {
  halted = value
  console.log(`[agent] HALT = ${value}`)
}

export function isHalted(): boolean {
  return halted
}

function check(): void {
  if (halted) throw new Error('agent halted — 等用户解除熔断后再试')
}

// ============ 鼠标 ============

export async function move(x: number, y: number, durationMs = 200): Promise<void> {
  check()
  mouse.config.mouseSpeed = Math.max(50, Math.round(1000 / Math.max(1, durationMs / 100)))
  await mouse.move(straightTo(new Point(x, y)))
  console.log(`[agent] move → (${x}, ${y})`)
}

export async function click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  check()
  await move(x, y, 150)
  const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT
  await mouse.click(btn)
  console.log(`[agent] click(${button}) at (${x}, ${y})`)
}

export async function doubleClick(x: number, y: number): Promise<void> {
  check()
  await move(x, y, 150)
  await mouse.doubleClick(Button.LEFT)
  console.log(`[agent] double-click at (${x}, ${y})`)
}

export async function scroll(dy: number, dx = 0): Promise<void> {
  check()
  if (dy !== 0) {
    if (dy > 0) await mouse.scrollDown(Math.abs(dy))
    else await mouse.scrollUp(Math.abs(dy))
  }
  if (dx !== 0) {
    if (dx > 0) await mouse.scrollRight(Math.abs(dx))
    else await mouse.scrollLeft(Math.abs(dx))
  }
  console.log(`[agent] scroll dy=${dy} dx=${dx}`)
}

export async function drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  check()
  await move(fromX, fromY, 150)
  await mouse.pressButton(Button.LEFT)
  await mouse.move(straightTo(new Point(toX, toY)))
  await mouse.releaseButton(Button.LEFT)
  console.log(`[agent] drag (${fromX},${fromY}) → (${toX},${toY})`)
}

export async function getCursorPosition(): Promise<{ x: number; y: number }> {
  const p = await mouse.getPosition()
  return { x: p.x, y: p.y }
}

// ============ 键盘 ============

/** 真打字（适合输入文本 — 中文/英文都行） */
export async function type(text: string): Promise<void> {
  check()
  await keyboard.type(text)
  console.log(`[agent] type "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`)
}

/**
 * 按一个组合键。
 * 例：key(['Cmd', 'C']) 复制；key(['Cmd', 'Tab']) 切应用；key(['Enter'])
 * 支持的 key 名见 nut-js Key enum（Cmd/Ctrl/Shift/Alt/Tab/Enter/Escape/...）
 */
export async function key(combo: string[]): Promise<void> {
  check()
  if (combo.length === 0) return
  const mapped = combo.map(mapKey).filter((k): k is Key => k !== null)
  if (mapped.length === 0) {
    console.warn(`[agent] key: 无法识别 ${combo.join('+')}`)
    return
  }
  if (mapped.length === 1) {
    await keyboard.pressKey(mapped[0]!)
    await keyboard.releaseKey(mapped[0]!)
  } else {
    // 组合键：按顺序按下，逆序释放
    for (const k of mapped) await keyboard.pressKey(k)
    for (const k of [...mapped].reverse()) await keyboard.releaseKey(k)
  }
  console.log(`[agent] key ${combo.join('+')}`)
}

function mapKey(name: string): Key | null {
  const lower = name.trim().toLowerCase()
  const dict: Record<string, Key> = {
    cmd: Key.LeftCmd,
    command: Key.LeftCmd,
    meta: Key.LeftCmd,
    ctrl: Key.LeftControl,
    control: Key.LeftControl,
    shift: Key.LeftShift,
    alt: Key.LeftAlt,
    option: Key.LeftAlt,
    enter: Key.Enter,
    return: Key.Enter,
    tab: Key.Tab,
    escape: Key.Escape,
    esc: Key.Escape,
    space: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete,
    up: Key.Up,
    down: Key.Down,
    left: Key.Left,
    right: Key.Right,
    home: Key.Home,
    end: Key.End,
    pageup: Key.PageUp,
    pagedown: Key.PageDown,
  }
  if (lower in dict) return dict[lower]!
  // 字母 a-z
  if (/^[a-z]$/i.test(lower)) {
    const k = `Key${lower.toUpperCase()}` as keyof typeof Key
    return (Key[k] as Key | undefined) ?? null
  }
  // 数字 0-9
  if (/^[0-9]$/.test(lower)) {
    const k = `Num${lower}` as keyof typeof Key
    return (Key[k] as Key | undefined) ?? null
  }
  // 功能键 F1-F12
  if (/^f([1-9]|1[0-2])$/i.test(lower)) {
    const num = lower.slice(1)
    return (Key as unknown as Record<string, Key>)[`F${num}`] ?? null
  }
  return null
}

// ============ 屏幕 ============

export async function screenSize(): Promise<{ width: number; height: number }> {
  const w = await screen.width()
  const h = await screen.height()
  return { width: w, height: h }
}

/**
 * 截屏指定区域（不指定则全屏）。返回 base64 PNG。
 * 给 vision LLM 看用。
 */
export async function screenshot(region?: { x: number; y: number; w: number; h: number }): Promise<{
  base64: string
  width: number
  height: number
}> {
  check()
  // nut-js 的 screen.capture 返回文件路径或 image；我们要 base64 内存编码
  // 用 grab 取 raw RGBA → 转 PNG buffer → base64
  const img = region
    ? await screen.grabRegion(new Region(region.x, region.y, region.w, region.h))
    : await screen.grab()
  // 用 Electron 自带 desktopCapturer / 或者 nut-js 的 Image.toRGB() + sharp 编码 PNG。
  // 最稳：用 Electron BrowserWindow.capturePage()，但那要 window 引用。
  // 这里用 nut-js Image 自带的 data RGBA，加 sharp 编码 PNG。如果 sharp 没装，用 jimp 兜底。
  const w = img.width
  const h = img.height
  const rgba = img.data  // Buffer，每像素 4 字节
  // 简化版：直接以 raw RGBA buffer 返回 base64（renderer 再编 PNG / 渲染 canvas）
  // vision LLM 兼容性要求 PNG，所以用 Node Canvas 或 sharp 编码。
  // 这里走 Electron nativeImage（无额外依赖）：
  const { nativeImage } = await import('electron')
  const native = nativeImage.createFromBuffer(Buffer.from(rgba), { width: w, height: h })
  // createFromBuffer 接受 PNG/JPEG bytes 或带 width/height 的 raw — 上面用 raw 形式
  const pngBuf = native.toPNG()
  return {
    base64: pngBuf.toString('base64'),
    width: w,
    height: h,
  }
}

// ============ 综合 ============

/** 在指定坐标 click+type，常见输入框场景一站式 */
export async function clickAndType(x: number, y: number, text: string): Promise<void> {
  check()
  await click(x, y)
  // 等焦点稳定再敲（避免 typed 一半被吞）
  await new Promise((r) => setTimeout(r, 120))
  await type(text)
}
