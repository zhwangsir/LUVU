/**
 * macOS / Windows 系统状态栏（Tray）— v0.22 重做
 *
 * 状态栏是「全局入口」：即便立绘板被隐藏也能唤起。定位与右键菜单不同——
 * 右键菜单已精简到 5 项贴身操作；状态栏承担全功能入口 + 显隐控制。
 *
 * v0.22 修复 & 优化：
 *   - 修复：转发动作前 win.show()+focus() 抢焦点。否则 accessory 桌宠 + 全屏透明板下，
 *     面板/输入框弹出来却不是 key window → 不能打字、要移上去才响应 → 体感「没用」。
 *   - 优化：原生文字风格（去 emoji 杂乱），砍掉滚轮/快捷键就能做的立绘±与 UI±缩放，
 *     只保留状态栏真正有价值的：显隐开关、对话、切角色、面板入口、复位、置顶、设置、退出。
 *   - 新增：动态「显示 / 隐藏立绘」开关（main 本地处理，最可靠，不依赖 renderer）。
 *
 * 转发动作：tray 点击 → webContents.send('tray:action', id) → renderer onMenuSelect(id)。
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

let tray: Tray | null = null
let getWin: (() => BrowserWindow | null) | null = null

interface TrayActionItem {
  id: string
  label: string
  separator?: boolean
}

/**
 * 转发给 renderer 的功能项（id 与 onMenuSelect 分支一一对应）。
 * 刻意不含立绘±缩放（滚轮）与 UI±缩放（⌘=/-/0）——状态栏不放贴身微调，避免臃肿。
 */
const FORWARD_ITEMS: TrayActionItem[] = [
  { id: 'chat', label: '打开对话' },
  { id: 'pick-character', label: '切换角色' },
  { id: 'sep1', label: '', separator: true },
  { id: 'library', label: '资源商店' },
  { id: 'creator-studio', label: '创作工坊' },
  { id: 'soul-editor', label: '编辑灵魂' },
  { id: 'health-dashboard', label: '模型健康' },
  { id: 'reload', label: '重载模型与灵魂' },
  { id: 'sep2', label: '', separator: true },
  { id: 'zoom-reset', label: '复原立绘位置与大小' },
  { id: 'pin', label: '窗口置顶切换' },
  { id: 'settings', label: '设置…' },
]

/** 转发一个动作给 renderer，并抢焦点让弹出的面板/输入框可交互 */
function forward(id: string): void {
  const win = getWin?.() ?? null
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus() // 关键修复：不 focus 则面板打开后不是 key window，输入框不能打字
  win.webContents.send('tray:action', id)
}

/** 显示/隐藏立绘 —— main 本地处理，不依赖 renderer，最可靠 */
function toggleVisible(): void {
  const win = getWin?.() ?? null
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  refresh()
}

function buildMenu(): Menu {
  const win = getWin?.() ?? null
  const visible = !!win && win.isVisible() && !win.isMinimized()

  const template: MenuItemConstructorOptions[] = [
    { label: visible ? '隐藏立绘' : '显示立绘', click: (): void => toggleVisible() },
    { type: 'separator' as const },
  ]

  for (const it of FORWARD_ITEMS) {
    if (it.separator) template.push({ type: 'separator' as const })
    else template.push({ label: it.label, click: (): void => forward(it.id) })
  }

  template.push(
    { type: 'separator' as const },
    { label: '退出 LUVU', click: (): void => app.quit() },
  )

  return Menu.buildFromTemplate(template)
}

/** 重建菜单 —— 让「显示/隐藏立绘」标签跟随实际显隐状态 */
function refresh(): void {
  if (tray) tray.setContextMenu(buildMenu())
}

export function startTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return
  getWin = getWindow
  try {
    // macOS: 用空图 + setTitle(emoji)，避免找 icon 文件
    tray = new Tray(nativeImage.createEmpty())
    if (process.platform === 'darwin') {
      tray.setTitle('🎀')
    }
    tray.setToolTip('LUVU — 灵魂女友')
    tray.setContextMenu(buildMenu())

    // 显隐变化时刷新菜单，让开关标签始终正确
    const win = getWindow()
    if (win) {
      win.on('show', refresh)
      win.on('hide', refresh)
      win.on('minimize', refresh)
      win.on('restore', refresh)
    }

    // Windows：左键切换显隐；macOS：交给 setContextMenu 自动弹菜单
    tray.on('click', () => {
      if (process.platform !== 'darwin') toggleVisible()
    })
    console.log('[tray] started')
  } catch (e) {
    console.warn('[tray] failed to start:', e)
  }
}

export function stopTray(): void {
  if (tray) {
    try {
      tray.destroy()
    } catch {
      /* skip */
    }
    tray = null
  }
  getWin = null
}
