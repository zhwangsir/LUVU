/**
 * Character IPC channels (Phase 1 G batch 2) — v0.14 多角色系统。
 */
import { defineChannel } from '../ipc-channel'
import type { Character, CreateCharacterInput } from '../character'

export const charactersList = defineChannel<void, Character[]>('characters:list')

export const charactersActive = defineChannel<void, Character | null>('characters:active')

export const charactersGet = defineChannel<string, Character | null>('characters:get')

export type CharacterResult =
  | { ok: true; character: Character }
  | { ok: false; reason: string }

export const charactersCreate = defineChannel<CreateCharacterInput, CharacterResult>(
  'characters:create',
)

export const charactersUpdate = defineChannel<
  { id: string; patch: Partial<Character> },
  CharacterResult
>('characters:update')

export const charactersDelete = defineChannel<string, { ok: boolean; reason?: string }>(
  'characters:delete',
)

export const charactersClone = defineChannel<
  { source_id: string; new_name?: string },
  { ok: boolean; character?: Character; reason?: string }
>('characters:clone')

export const charactersReadSoulFile = defineChannel<
  { id: string; filename: string },
  { ok: boolean; content?: string; reason?: string }
>('characters:read-soul-file')

export const charactersWriteSoulFile = defineChannel<
  { id: string; filename: string; content: string },
  { ok: boolean; reason?: string }
>('characters:write-soul-file')

export const charactersRecordChat = defineChannel<
  void,
  { ok: true; character: Character | null } | { ok: false; reason: string }
>('characters:record-chat')

export const charactersSwitch = defineChannel<
  string,
  { ok: boolean; character?: Character; reason?: string }
>('characters:switch')

/**
 * v0.21 Round J:M8 灵魂社会前置 IPC。
 *
 * "Mounted" = 代码层并行存活的 character id 列表(每个有独立 planner / memory.db)。
 * 跟 active(GUI 焦点单选)区分。
 *
 * 设计选择(架构师建议):返回 Character[] 而非 string[],让 renderer
 * 不用二次 charactersGet 拿元数据。性能可接受(mounted 通常 ≤ 5)。
 */
export const charactersListMounted = defineChannel<void, Character[]>(
  'characters:list-mounted',
)

export const charactersSetMounted = defineChannel<
  string[],
  { ok: true; mounted_ids: string[]; mounted: Character[] } | { ok: false; reason: string }
>('characters:set-mounted')
