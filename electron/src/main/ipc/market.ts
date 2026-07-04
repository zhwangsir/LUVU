/**
 * 模型市场 IPC handlers — type-safe channels (Phase 1 G).
 * 注：market:installed 是 main→renderer 推送，不走 channel（channel 只覆盖 invoke）。
 */
import type { BrowserWindow } from 'electron'
import {
  marketInstallPath,
  marketInstallPaths,
  marketInstallUrl,
  marketInstallZip,
} from '@shared/channels/market'
import { installFromPath, installFromUrl, installFromZip } from '../services/model-market'
import { handleInvoke } from './channel-helpers'

export function registerMarketIpc(getWindow: () => BrowserWindow | null): void {
  handleInvoke(marketInstallZip, (zipPath) => installFromZip(zipPath))
  handleInvoke(marketInstallUrl, (url) => installFromUrl(url))
  handleInvoke(marketInstallPath, (path) => installFromPath(path))

  handleInvoke(marketInstallPaths, async (paths) => {
    const results = []
    for (const p of paths) {
      results.push(await installFromPath(p))
    }
    const win = getWindow()
    if (win && !win.isDestroyed() && results.some((r) => r.ok)) {
      win.webContents.send('market:installed', results.filter((r) => r.ok))
    }
    return results
  })
}
