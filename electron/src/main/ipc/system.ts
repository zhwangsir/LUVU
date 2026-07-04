/**
 * 系统级 IPC：配置读写、模型扫描、灵魂加载、历史、缩略图、磁盘。
 * Type-safe channels (Phase 1 G batch 4).
 *
 * 拆分历史（v0.13 audit architecture HIGH god-file 拆分）：
 *   - tts/online/thumbs/models 子域 → 独立 ipc/*.ts
 *   - models:scan 仍在此（bootstrap 必经路径）
 */
import { app, dialog, shell, type BrowserWindow } from 'electron'
import {
  configLoad,
  configSave,
  historyAppend,
  historyClear,
  historyListRecent,
  modelsScan,
  soulLoad,
  soulPickDirectory,
  soulSaveAvatar,
  soulSystemPrompt,
  systemCleanPath,
  systemDiskUsage,
  systemOpenExternal,
  systemPaths,
  systemRevealDataDir,
  systemRevealModelsDir,
  systemVersion,
} from '@shared/channels/system'
import { scanModels, toFileUrl } from '../services/model-scanner'
import { loadSoul } from '../services/soul-loader'
import { saveAvatar } from '../services/soul-saver'
import { loadConfig, saveConfig } from '../services/config-store'
import { getPaths } from '../services/paths'
import { appendTurn, clearAll, listRecent, type StoredTurn } from '../services/history-store'
import { startAttention, stopAttention } from '../services/attention'
import { computeDiskUsage, cleanPath } from '../services/disk-usage'
import { handleInvoke } from './channel-helpers'

// v0.13: 跟踪 attention 是否已启动，避免重复 start / 误 stop
let attentionRunning = false
export function markAttentionRunning(v: boolean): void {
  attentionRunning = v
}

export function registerSystemIpc(getWindow: () => BrowserWindow | null): void {
  handleInvoke(systemVersion, () => app.getVersion())
  handleInvoke(systemPaths, () => getPaths())

  handleInvoke(systemRevealDataDir, async () => {
    const p = getPaths().userDataDir
    await shell.openPath(p)
    return p
  })

  handleInvoke(systemRevealModelsDir, async () => {
    const list = getPaths().modelSearchPaths
    const target = list[0]
    if (target) await shell.openPath(target)
    return target
  })

  // v0.12: 用系统默认浏览器打开外部链接
  handleInvoke(systemOpenExternal, async (url) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid url' }
    await shell.openExternal(url)
    return { ok: true }
  })

  // v0.13: 磁盘占用统计 + 清理（H1 audit）
  handleInvoke(systemDiskUsage, (force) => computeDiskUsage(!!force))
  handleInvoke(systemCleanPath, (path) => cleanPath(path))

  handleInvoke(configLoad, () => loadConfig())

  handleInvoke(configSave, (dto) => {
    const merged = saveConfig(dto)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('config:changed', merged)
    }
    // v0.13: LLM 配置状态变化时切换 attention loop
    const llmReady = !!(merged.llm_endpoint && merged.llm_model)
    if (llmReady && !attentionRunning) {
      startAttention(getWindow, { proactive_monitor_interval_ms: 45_000 })
      attentionRunning = true
      console.log('[attention] started (LLM 配置完成)')
    } else if (!llmReady && attentionRunning) {
      stopAttention()
      attentionRunning = false
      console.log('[attention] stopped (LLM 配置被清空)')
    }
    return merged
  })

  handleInvoke(modelsScan, () =>
    scanModels().map((m) => ({ ...m, file_url: toFileUrl(m.absolute_path) })),
  )

  handleInvoke(soulLoad, () => {
    const loaded = loadSoul()
    return { config: loaded.config, sources: loaded.sourceFiles }
  })

  handleInvoke(soulSystemPrompt, () => loadSoul().systemPrompt)

  handleInvoke(historyListRecent, (limit) => listRecent(limit ?? 50))
  handleInvoke(historyAppend, (turn) => {
    appendTurn(turn as Omit<StoredTurn, 'session_id'>)
    return { ok: true }
  })
  handleInvoke(historyClear, () => ({ deleted: clearAll() }))

  handleInvoke(soulSaveAvatar, (avatar) => {
    const result = saveAvatar(avatar)
    if (result.ok) {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('soul:changed')
      }
    }
    return result
  })

  handleInvoke(soulPickDirectory, async () => {
    const win = getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择模型目录',
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
}
