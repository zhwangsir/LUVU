/**
 * LUVU v0.6 — Electron 主入口。
 *
 * 五大域之 infra：起一个透明立绘窗口，挂上所有 IPC handler。
 * avatar/brain/hands/presence 由 renderer 实现，主进程只做：
 *   - 透明窗口 + NSPanel + 拖动 + 穿透
 *   - LLM provider 转发（避免 renderer 直接持密钥）
 *   - 文件系统访问（soul / models / config / TTS sidecar）
 */
// v0.11: 通过 pnpm dev 启动后，shell pipe 关闭时 console.log 会触发 EPIPE
// 把整个 main process kill 掉（AttentionScheduler 周期性 log 首先撞上）。
// 捕获 EPIPE 让 app 自己活下去。
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  try {
    // eslint-disable-next-line no-console
    console.error('[main] uncaughtException:', err)
  } catch {
    /* skip — 防 log 再炸 */
  }
})

import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { createMainWindow } from './windows/main-window'
import { registerWindowControlIpc } from './ipc/window-control'
import { registerLlmIpc } from './ipc/llm'
import { registerSystemIpc, markAttentionRunning } from './ipc/system'
import { registerTtsIpc } from './ipc/tts'
import { registerThumbsIpc } from './ipc/thumbs'
import { registerModelsIpc } from './ipc/models'
import { registerOnlineIpc } from './ipc/online'
import { registerCharactersIpc } from './ipc/characters'
import { registerMemoryIpc } from './ipc/memory'
import { registerToolIpc } from './ipc/tools'
import { registerComfyuiIpc } from './ipc/comfyui'
import { registerAutomationIpc } from './ipc/automation'
import { registerMcpIpc } from './ipc/mcp'
import { shutdownAll as shutdownMcp } from './services/mcp-client'
import { registerMarketIpc } from './ipc/market'
import { registerMotionFactoryIpc } from './ipc/motion-factory'
import { registerMotionEngineIpc } from './ipc/motion-engine'
import { registerTriggerIpc } from './ipc/trigger'
import { registerPerceptionIpc } from './ipc/perception'
import { registerEmotionalIpc } from './ipc/emotional'
import { registerEvalIpc } from './ipc/eval'
import { registerCharacterPackIpc } from './ipc/character-pack'
import { registerSoulChangeLogIpc } from './ipc/soul-change-log'
import { registerSoulLearnerIpc } from './ipc/soul-learner'
import { startEmotionalTicker, stopEmotionalTicker } from './services/emotional-state/ticker'
import { startPerception, stopPerception } from './services/perception'
import { startAttention, stopAttention } from './services/attention'
import { startLlmHealthLoop } from './services/llm/health-fallback'
import { startTray, stopTray } from './services/tray'
import { registerHaltShortcut, unregisterHaltShortcut } from './services/automation/halt-shortcut'
import { getPaths } from './services/paths'
import { loadConfig } from './services/config-store'
import { close as closeHistoryDb, pruneOlderThan } from './services/history-store'
import { closeMemoryDb } from './services/memory-store'
import { close as closeMotionEngineDb } from './services/motion-engine/storage'
import { initializeLogger } from './services/logger'
import { registerAssetSchemePrivileges, registerAssetProtocol } from './services/asset-protocol'

// H1 (audit): luvu-asset:// 必须在 app.whenReady 之前注册 scheme privileges
//   privileges 注册时机硬性约束。注册 handler 留到 whenReady 后
registerAssetSchemePrivileges()

// macOS 透明窗口需要硬件加速正确工作
app.commandLine.appendSwitch('enable-features', 'Metal')
// 防止 mojibake
app.commandLine.appendSwitch('lang', 'zh-CN')
// dev 模式抑制 Electron 安全警告噪声（生产构建时自动不显示）
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// v0.13: single-instance lock — 防止双启导致两个透明窗口冲突
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 第二个实例启动时，把现有窗口拉到前面而不是新开
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('moe.luvu')

  // v0.17：桌宠真正"原生化"关键三连
  //   1) macOS：accessory activation policy → 不在 Dock 出现、不在 Cmd+Tab 出现、
  //      不在 Mission Control 当作独立 app 缩略图。完全后台 daemon-style。
  //   2) macOS：避免 Tray 被 Touch Bar 系统当 regular app 接管
  //   3) Tray 是用户的唯一可见入口（顶部菜单栏小图标）
  if (process.platform === 'darwin') {
    try {
      app.setActivationPolicy('accessory')
    } catch (e) {
      console.warn('[main] setActivationPolicy accessory failed:', e)
    }
  }

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 提前确保数据目录存在
  getPaths()

  // H1: 注册 luvu-asset:// handler — 替代 file:// 跨目录加载，allowing webSecurity:true
  registerAssetProtocol()

  // v0.13: 初始化 electron-log，接管 console.* → 写文件到 ~/.luvu/logs/main.log
  initializeLogger()

  // 注册所有 IPC
  registerWindowControlIpc(getMainWindow)
  registerLlmIpc(getMainWindow)
  registerSystemIpc(getMainWindow)
  registerTtsIpc()
  registerThumbsIpc()
  registerModelsIpc()
  registerOnlineIpc()
  registerCharactersIpc(getMainWindow)
  registerMemoryIpc()
  registerToolIpc(getMainWindow)
  registerMarketIpc(getMainWindow)
  registerMotionFactoryIpc(getMainWindow)
  registerMotionEngineIpc()
  registerTriggerIpc()
  registerPerceptionIpc()
  registerComfyuiIpc(getMainWindow)
  registerAutomationIpc(getMainWindow)
  registerMcpIpc(getMainWindow)
  registerEmotionalIpc()
  registerEvalIpc(getMainWindow)
  registerCharacterPackIpc(getMainWindow)
  registerSoulChangeLogIpc()
  registerSoulLearnerIpc()

  // v0.8: 启动主体性感知系统（Mouse/Idle/Window/Time sensors）
  // v0.8.2: 从 RuntimeConfig 透传 vision 三件套（持久化在 config.json）
  const cfg = loadConfig()

  // v0.13 (audit M4): 历史保留策略 — 删除老于 history_retention_days 天的回合
  const days = cfg.history_retention_days ?? 0
  if (days > 0) {
    const pruned = pruneOlderThan(days)
    if (pruned > 0) console.log(`[history] pruned ${pruned} turns older than ${days} days`)
  }
  // v0.21：vision_endpoint 空则回退到 llm_endpoint（多数人 vision 和 LLM 同一个 LM Studio）
  const visionEndpoint = cfg.vision_endpoint || cfg.llm_endpoint || ''
  startPerception(getMainWindow, {
    vision_enabled: cfg.vision_enabled ?? false,
    vision_endpoint: visionEndpoint,
    vision_model: cfg.vision_model ?? '',
  })
  console.log(
    `[perception] vision_enabled=${cfg.vision_enabled ?? false} endpoint=${visionEndpoint || '(none)'} model=${cfg.vision_model || '(none)'}`,
  )

  // Phase 1 J P3: 情感周期 tick — always-on，不依赖 LLM 配置
  startEmotionalTicker()

  // v0.8.2: 启动主体性循环（Scheduler tick + Planner LLM 调用 + 推 plan 给 renderer 执行）
  // v0.13: LLM 未配置时不启动 attention loop — 否则每 60s 撞一次 LLM 调用错误
  // 用户首次在 Settings 配完 endpoint 后由 IPC 触发 startAttention（见 ipc/llm.ts 的 setConfig）
  if (cfg.llm_endpoint && cfg.llm_model) {
    // v0.17 D-2: 后台周期检查 endpoint 模型是否 alive，挂了自动切
    startLlmHealthLoop()
    startAttention(getMainWindow, { proactive_monitor_interval_ms: 45_000 })
    markAttentionRunning(true)
    console.log('[attention] started (proactive every 45s, evaluating every 10s)')
  } else {
    markAttentionRunning(false)
    console.log(
      '[attention] skipped — LLM 未配置（llm_endpoint / llm_model 为空），等用户在 Settings 配完后启动',
    )
  }

  const preloadPath = join(__dirname, '../preload/index.mjs')
  mainWindow = createMainWindow({ preloadPath })

  // v0.17 P3：系统状态栏菜单（macOS 顶部、Windows 系统托盘）
  startTray(getMainWindow)

  // v0.17 E-4：全局熔断快捷键
  registerHaltShortcut(getMainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow({ preloadPath })
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // 桌宠语义：所有窗口关闭仍保留 dock；macOS 习惯
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeHistoryDb()
  closeMotionEngineDb()
  // v0.21:before-quit 关掉所有 per-character memory.db 句柄(M3 长期记忆)
  closeMemoryDb() // 不传 id 关全部
  stopAttention()
  stopPerception()
  stopTray()
  unregisterHaltShortcut()
  shutdownMcp()
  stopEmotionalTicker()
})
