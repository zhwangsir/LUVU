/**
 * Character pack IPC channels (P5 落地)。
 *
 * - characterPackExport: 走系统保存对话框，用户选 .luvu-pack 文件位置
 * - characterPackImport: 走系统打开对话框，让用户选 zip 后解包
 */
import { defineChannel } from '../ipc-channel'
import type { Character } from '../character'

export interface CharacterPackExportPayload {
  /** 要导出的 character id（默认 active） */
  characterId?: string
  /** 是否含 emotional state (默认 true) */
  includeEmotional?: boolean
  /** 是否含 thumb (默认 true) */
  includeThumb?: boolean
  /** 是否含 memory.db (默认 false，隐私敏感) */
  includeMemory?: boolean
}

export interface CharacterPackExportResult {
  ok: boolean
  /** 实际写入的路径（用户取消则 undefined + canceled=true） */
  savedPath?: string
  canceled?: boolean
  reason?: string
  /** 字节大小（成功时） */
  size?: number
}

export const characterPackExport = defineChannel<
  CharacterPackExportPayload | undefined,
  CharacterPackExportResult
>('character-pack:export')

export interface CharacterPackImportPayload {
  /** 新 character 名（覆盖 pack meta.source_name） */
  newName?: string
  /** 是否导入 emotional state (默认 true) */
  includeEmotional?: boolean
  /** 是否导入 memory.db (默认 true 若 pack 含) */
  includeMemory?: boolean
}

export interface CharacterPackImportResult {
  ok: boolean
  character?: Character
  canceled?: boolean
  reason?: string
  sourcePath?: string
}

export const characterPackImport = defineChannel<
  CharacterPackImportPayload | undefined,
  CharacterPackImportResult
>('character-pack:import')
