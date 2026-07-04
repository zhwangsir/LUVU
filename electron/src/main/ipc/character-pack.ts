/**
 * Character pack IPC handlers (P5).
 * 用 electron dialog 让用户选保存/打开路径，避免 renderer 直接写盘。
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  characterPackExport,
  characterPackImport,
} from '@shared/channels/character-pack'
import {
  exportCharacterPack,
  importCharacterPack,
} from '../services/character-pack'
import { getActiveCharacter, getCharacter } from '../services/character-store'
import { handleInvoke } from './channel-helpers'

export function registerCharacterPackIpc(getWindow: () => BrowserWindow | null): void {
  handleInvoke(characterPackExport, async (payload) => {
    const targetId = payload?.characterId ?? getActiveCharacter()?.id
    if (!targetId) return { ok: false, reason: 'no character to export' }
    const c = getCharacter(targetId)
    if (!c) return { ok: false, reason: 'character not found' }

    const r = exportCharacterPack(targetId, {
      ...(payload?.includeEmotional !== undefined && {
        includeEmotional: payload.includeEmotional,
      }),
      ...(payload?.includeThumb !== undefined && { includeThumb: payload.includeThumb }),
      ...(payload?.includeMemory !== undefined && { includeMemory: payload.includeMemory }),
      appVersion: app.getVersion(),
    })
    if (!r.ok || !r.buffer) return { ok: false, reason: r.reason ?? 'export failed' }

    const win = getWindow() ?? undefined
    const safeName = c.name.replace(/[^\w一-龥-]/g, '_').slice(0, 32)
    const defaultPath = `LUVU-${safeName}.luvu-pack.zip`
    const save = await dialog.showSaveDialog(win as BrowserWindow, {
      title: '导出角色 pack',
      defaultPath,
      filters: [
        { name: 'LUVU Character Pack', extensions: ['zip', 'luvu-pack'] },
      ],
    })
    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true }
    }
    try {
      writeFileSync(save.filePath, r.buffer)
      return { ok: true, savedPath: save.filePath, size: r.buffer.length }
    } catch (e) {
      return {
        ok: false,
        reason: `写盘失败: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  })

  handleInvoke(characterPackImport, async (payload) => {
    const win = getWindow() ?? undefined
    const open = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '导入角色 pack',
      properties: ['openFile'],
      filters: [
        { name: 'LUVU Character Pack', extensions: ['zip', 'luvu-pack'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (open.canceled || open.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    const path = open.filePaths[0]!
    let buf: Buffer
    try {
      buf = readFileSync(path)
    } catch (e) {
      return {
        ok: false,
        reason: `读盘失败: ${e instanceof Error ? e.message : String(e)}`,
        sourcePath: path,
      }
    }
    const r = importCharacterPack(buf, {
      ...(payload?.newName ? { newName: payload.newName } : {}),
      ...(payload?.includeEmotional !== undefined && {
        includeEmotional: payload.includeEmotional,
      }),
      ...(payload?.includeMemory !== undefined && { includeMemory: payload.includeMemory }),
    })
    return {
      ok: r.ok,
      ...(r.character ? { character: r.character } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      sourcePath: path,
    }
  })
}
