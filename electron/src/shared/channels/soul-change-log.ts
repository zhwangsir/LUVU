/**
 * Soul change log IPC channels (P5).
 *
 * 历史 audit trail — SoulEditor 集成查看 / 清空入口。
 */
import { defineChannel } from '../ipc-channel'

export interface SoulChangeLogEntryShape {
  ts: number
  character_id: string
  filename: string
  summary: string
  changes: Array<{
    path: string
    kind: 'added' | 'removed' | 'changed'
    before?: unknown
    after?: unknown
  }>
}

/** 获取指定 character 的 soul 改动历史 (newest first)；不传 id 用 active */
export const soulChangeLogList = defineChannel<
  { character_id?: string } | undefined,
  SoulChangeLogEntryShape[]
>('soul-change-log:list')

export const soulChangeLogClear = defineChannel<
  { character_id?: string } | undefined,
  { ok: boolean }
>('soul-change-log:clear')
