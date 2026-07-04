/**
 * 模型市场 IPC channels (Phase 1 G batch 1).
 */
import { defineChannel } from '../ipc-channel'

export interface MarketInstallResult {
  ok: boolean
  installed_to?: string
  detected_name?: string
  model_file?: string
  reason?: string
}

export const marketInstallZip = defineChannel<string, MarketInstallResult>('market:install-zip')

export const marketInstallUrl = defineChannel<string, MarketInstallResult>('market:install-url')

export const marketInstallPath = defineChannel<string, MarketInstallResult>('market:install-path')

export const marketInstallPaths = defineChannel<string[], MarketInstallResult[]>(
  'market:install-paths',
)
