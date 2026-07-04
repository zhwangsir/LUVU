/**
 * Character IPC (v0.14) — type-safe channels (Phase 1 G).
 */
import type { BrowserWindow } from 'electron'
import {
  charactersActive,
  charactersClone,
  charactersCreate,
  charactersDelete,
  charactersGet,
  charactersList,
  charactersListMounted,
  charactersReadSoulFile,
  charactersRecordChat,
  charactersSetMounted,
  charactersSwitch,
  charactersUpdate,
  charactersWriteSoulFile,
} from '@shared/channels/characters'
import {
  cloneCharacter,
  createCharacter,
  deleteCharacter,
  getActiveCharacter,
  getCharacter,
  getMountedCharacterIds,
  listCharacters,
  readCharacterSoulFile,
  recordChatInteraction,
  setActiveCharacterId,
  setMountedCharacterIds,
  updateCharacter,
  writeCharacterSoulFile,
} from '../services/character-store'
import { reopenForActiveCharacter } from '../services/history-store'
import { onChatTurn as emotionalOnChatTurn } from '../services/emotional-state/store'
import type { Character } from '@shared/character'
import { handleInvoke } from './channel-helpers'

export function registerCharactersIpc(getWindow: () => BrowserWindow | null): void {
  handleInvoke(charactersList, () => listCharacters())
  handleInvoke(charactersActive, () => getActiveCharacter())
  handleInvoke(charactersGet, (id) => getCharacter(id))

  handleInvoke(charactersCreate, (input) => {
    try {
      return { ok: true as const, character: createCharacter(input) }
    } catch (e) {
      return { ok: false as const, reason: String(e).slice(0, 300) }
    }
  })

  handleInvoke(charactersUpdate, (payload) => {
    const c = updateCharacter(payload.id, payload.patch)
    return c
      ? { ok: true as const, character: c }
      : { ok: false as const, reason: 'not_found' }
  })

  handleInvoke(charactersDelete, (id) => deleteCharacter(id))
  handleInvoke(charactersClone, (payload) =>
    cloneCharacter(payload.source_id, payload.new_name),
  )

  /** v0.14 T8: 读 character 灵魂目录的 yaml 文件 */
  handleInvoke(charactersReadSoulFile, (payload) =>
    readCharacterSoulFile(payload.id, payload.filename),
  )
  handleInvoke(charactersWriteSoulFile, (payload) => {
    const r = writeCharacterSoulFile(payload.id, payload.filename, payload.content)
    // 写完通知 renderer 重新 reload soul
    const win = getWindow()
    if (r.ok && win && !win.isDestroyed()) {
      win.webContents.send('soul:changed')
    }
    return r
  })

  /** v0.14 T5: 每轮对话完成后调用，更新 last_chat_at + total_chats + intimacy 成长。
   *  Phase 1 J: 同步触发 emotional-state.onChatTurn（清空 missing + 缓解 negative mood） */
  handleInvoke(charactersRecordChat, () => {
    const active = getActiveCharacter()
    if (!active) return { ok: false as const, reason: 'no_active' }
    recordChatInteraction(active.id)
    emotionalOnChatTurn(active.id)
    const updated = getCharacter(active.id)
    return { ok: true as const, character: updated }
  })

  handleInvoke(charactersSwitch, (id) => {
    const r = setActiveCharacterId(id)
    if (!r.ok) return r
    // 关键：切换后让 history-store 重新打开新 character 的 db
    reopenForActiveCharacter()
    // 通知 renderer 重新加载 soul / dialog 历史
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('character:switched', r.character)
    }
    return r
  })

  /**
   * v0.21 Round J:M8 灵魂社会 — list mounted characters。
   * 返 Character[] 让 renderer 不用二次 charactersGet 拿元数据。
   */
  handleInvoke(charactersListMounted, () => {
    const ids = getMountedCharacterIds()
    // 过滤掉可能 stale 的 id(character 已被删但 mounted 还在)
    const chars: Character[] = []
    for (const id of ids) {
      const c = getCharacter(id)
      if (c) chars.push(c)
    }
    return chars
  })

  /**
   * v0.21 Round J:M8 — 设置 mounted character 列表。
   * 校验失败返 reason(empty / not_found / etc)。
   * DoS 防护:超 16 个拒绝(实际 use case 不会 > 5)。
   */
  handleInvoke(charactersSetMounted, (ids) => {
    if (!Array.isArray(ids)) {
      return { ok: false as const, reason: 'not_an_array' }
    }
    if (ids.length > 16) {
      // 防 DoS:renderer 恶意 / bug 发巨大数组
      // reviewer R-J MEDIUM-3:reason 改 snake_case 机器可读,16 限制写注释而非括号
      return { ok: false as const, reason: 'too_many_ids' }
    }
    // TODO M8-GUI:加 ids.every(x => typeof x === 'string') 校验(reviewer R-J MEDIUM-2)
    //   当前 getCharacter 接受非 string 时返 undefined → character_not_found,
    //   不崩溃但 error 信息混乱。GUI consumer 真做时一起加。
    const r = setMountedCharacterIds(ids)
    if (!r.ok) return { ok: false as const, reason: r.reason ?? 'failed' }
    const mountedIds = r.mounted_ids ?? []
    const mounted: Character[] = []
    for (const id of mountedIds) {
      const c = getCharacter(id)
      if (c) mounted.push(c)
    }
    return { ok: true as const, mounted_ids: mountedIds, mounted }
  })
}
