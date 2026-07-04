/**
 * 在线资源商店 IPC channels (Phase 1 G batch 2).
 *
 * 注：online:install-progress / online:install-done 是 main→renderer 推送，
 * 不走 channel（channel 只覆盖 invoke 双向调用）。
 */
import { defineChannel } from '../ipc-channel'

export type OnlineAssetKind = 'rvc' | 'live2d'
export type OnlineRepoSource = 'huggingface' | 'github' | 'browse_only'

export interface RecommendedRepo {
  id: string
  name: string
  description: string
  kind: OnlineAssetKind
  source: OnlineRepoSource
  asset_path?: string
  hint?: string
  browse_url?: string
}

export interface OnlineAssetEntry {
  type: 'file' | 'directory'
  path: string
  /** 字节数；目录通常为 0（main 端 listRepoAssets 用 ?? 0 兜底） */
  size: number
}

export const onlineListRecommended = defineChannel<void, RecommendedRepo[]>(
  'online:list-recommended',
)

export const onlineListAssets = defineChannel<
  { repo_id: string; sub_path?: string },
  OnlineAssetEntry[]
>('online:list-assets')

export const onlineCheckInstalled = defineChannel<
  {
    kind: OnlineAssetKind
    voice_id?: string
    repo_slug?: string
    asset_name?: string
  },
  { installed: boolean }
>('online:check-installed')

export const onlineInstall = defineChannel<
  { repo_id: string; asset_path: string; kind: OnlineAssetKind },
  { ok: boolean; install_id: string }
>('online:install')

export const onlineCancelInstall = defineChannel<string, { ok: boolean }>(
  'online:cancel-install',
)

export const onlineInstallCustom = defineChannel<
  { url: string; kind: OnlineAssetKind },
  { ok: boolean; install_id: string }
>('online:install-custom')
