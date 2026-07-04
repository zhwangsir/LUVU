/**
 * Soul change log IPC handlers (P5).
 */
import {
  soulChangeLogClear,
  soulChangeLogList,
} from '@shared/channels/soul-change-log'
import { getActiveCharacter } from '../services/character-store'
import {
  clearSoulChangeLog,
  loadSoulChangeLog,
} from '../services/soul-change-log'
import { handleInvoke } from './channel-helpers'

export function registerSoulChangeLogIpc(): void {
  handleInvoke(soulChangeLogList, (payload) => {
    const id = payload?.character_id ?? getActiveCharacter()?.id
    if (!id) return []
    return loadSoulChangeLog(id)
  })

  handleInvoke(soulChangeLogClear, (payload) => {
    const id = payload?.character_id ?? getActiveCharacter()?.id
    if (!id) return { ok: false }
    clearSoulChangeLog(id)
    return { ok: true }
  })
}
