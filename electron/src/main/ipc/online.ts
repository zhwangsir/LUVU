/**
 * 在线资源商店 IPC handlers — type-safe channels (Phase 1 G).
 *
 * 浏览 HuggingFace + GitHub 真实 repo 的 RVC 音色 / Live2D 立绘资源，
 * 支持下载安装 + AbortController 中断。
 *
 * online:install-progress / online:install-done 仍走 evt.sender.send 推送 — 不在 channel 范围内。
 */
import {
  onlineCancelInstall,
  onlineCheckInstalled,
  onlineInstall,
  onlineInstallCustom,
  onlineListAssets,
  onlineListRecommended,
} from '@shared/channels/online'
import { handleInvoke } from './channel-helpers'

export function registerOnlineIpc(): void {
  const onlineInstallControllers = new Map<string, AbortController>()

  handleInvoke(onlineListRecommended, async () => {
    const { RECOMMENDED_REPOS } = await import('../services/online-store')
    return RECOMMENDED_REPOS
  })

  handleInvoke(onlineListAssets, async (payload) => {
    const { listRepoAssets } = await import('../services/online-store')
    return listRepoAssets(payload.repo_id, payload.sub_path)
  })

  handleInvoke(onlineCheckInstalled, async (payload) => {
    const { checkRvcInstalled, checkLive2dInstalled } = await import('../services/online-store')
    if (payload.kind === 'rvc' && payload.voice_id) {
      return { installed: await checkRvcInstalled(payload.voice_id) }
    }
    if (payload.kind === 'live2d' && payload.repo_slug && payload.asset_name) {
      return { installed: checkLive2dInstalled(payload.repo_slug, payload.asset_name) }
    }
    return { installed: false }
  })

  handleInvoke(onlineInstall, async (payload, evt) => {
    const installId = `${payload.repo_id}/${payload.asset_path}`
    const old = onlineInstallControllers.get(installId)
    if (old) old.abort()
    const ctrl = new AbortController()
    onlineInstallControllers.set(installId, ctrl)
    const { installAsset } = await import('../services/online-store')
    void installAsset(
      payload.repo_id,
      payload.asset_path,
      payload.kind,
      (p) => {
        try {
          evt.sender.send('online:install-progress', { install_id: installId, ...p })
        } catch {
          /* renderer gone */
        }
      },
      ctrl.signal,
    )
      .then((r) => {
        try {
          evt.sender.send('online:install-done', { install_id: installId, ...r })
        } catch {
          /* skip */
        }
      })
      .finally(() => onlineInstallControllers.delete(installId))
    return { ok: true, install_id: installId }
  })

  handleInvoke(onlineCancelInstall, async (installId) => {
    const ctrl = onlineInstallControllers.get(installId)
    if (ctrl) {
      ctrl.abort()
      onlineInstallControllers.delete(installId)
    }
    return { ok: true }
  })

  handleInvoke(onlineInstallCustom, async (payload, evt) => {
    const installId = `custom/${payload.url}`
    const old = onlineInstallControllers.get(installId)
    if (old) old.abort()
    const ctrl = new AbortController()
    onlineInstallControllers.set(installId, ctrl)
    const { installCustomZip } = await import('../services/online-store')
    void installCustomZip(
      payload.url,
      payload.kind,
      (p) => {
        try {
          evt.sender.send('online:install-progress', { install_id: installId, ...p })
        } catch {
          /* skip */
        }
      },
      ctrl.signal,
    )
      .then((r) => {
        try {
          evt.sender.send('online:install-done', { install_id: installId, ...r })
        } catch {
          /* skip */
        }
      })
      .finally(() => onlineInstallControllers.delete(installId))
    return { ok: true, install_id: installId }
  })
}
