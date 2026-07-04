/**
 * Memory 域 IPC channels (Phase 1 W4)。
 *
 * 8 个 handler 全部 type-safe，main 实现签名跟服务层 (memory-store / memory-extractor) 对齐。
 */
import { defineChannel } from '../ipc-channel'

export type MemoryKind = 'fact' | 'preference' | 'event' | 'reflection'

export interface Memory {
  id: string
  kind: MemoryKind
  text: string
  embedding: number[]
  importance: number
  source: string
  ts: number
}

export interface MemorySearchHit extends Memory {
  score: number
}

export const memoryList = defineChannel<
  { kind?: MemoryKind; limit?: number } | undefined,
  Memory[]
>('memory:list')

export const memoryCount = defineChannel<void, number>('memory:count')

export const memoryAdd = defineChannel<
  {
    kind: MemoryKind
    text: string
    importance: number
    embedding?: number[]
  },
  { ok: boolean; memory?: Memory; reason?: string }
>('memory:add')

export const memoryDelete = defineChannel<
  string,
  { ok: boolean; reason?: string }
>('memory:delete')

export const memorySearch = defineChannel<
  { query_embedding: number[]; k?: number },
  MemorySearchHit[]
>('memory:search')

/** main 实际返回 Memory[] (extractMemoriesFromTurn 直接 return)，不是 { ok, extracted } —
 *  之前 api.ts 写的伪类型让 dialog.ts 拿到错的 shape — type-safe channel 揪出此 bug */
export const memoryExtractFromTurn = defineChannel<
  { user_text: string; assistant_text: string; turn_id: string },
  Memory[]
>('memory:extract-from-turn')

/** 注：service 返回 string，main wrapper 包装成 { ok, context, matches } */
export const memoryRagContext = defineChannel<
  { query_text: string; k?: number },
  { ok: boolean; context?: string; matches?: number; reason?: string }
>('memory:rag-context')

export const memoryDailyReflection = defineChannel<
  void,
  { ok: boolean; reflection?: Memory; reason?: string }
>('memory:daily-reflection')

/**
 * v0.21 Round U(M8 灵魂社会 inspector 入口):列指定 character 的
 * cross-character event memory(Round N 写入的 source='cross_character:<id>')。
 *
 * 跟 `memoryList` 区别:
 *   - `memoryList`:active character only,所有 kind / 所有 source
 *   - `memoryListCrossCharacter`:任意 character id(允许 inspect 非 active 的
 *     mounted character),只返 kind='event' source 前缀 cross_character:
 *
 * UI consumer(未来 Round R):CharacterPicker 卡片展开 / Settings 面板
 * "🌐 灵魂社会"tab,让用户能看到"哪个灵魂记得听过哪些话"。
 */
export const memoryListCrossCharacter = defineChannel<
  { characterId: string; limit?: number },
  Memory[]
>('memory:list-cross-character')
