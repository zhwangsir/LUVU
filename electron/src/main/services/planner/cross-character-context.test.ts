/**
 * planner.collectCrossCharacterContext — Round P + Round S 单测
 *
 * 验证 planner 从自己 memory.db 取 cross-character event 拼 prompt 片段:
 *   - default planner(characterId=null)→ 永远 null,不读 db
 *   - characterId set + 无 event → null
 *   - characterId set + 有 event(source 以 cross_character: 开头)→ section string
 *   - Round S:用 listMemoriesBySource('cross_character:', limit:3) SQL 直接 filter
 *     (不再 listMemories 然后 JS filter,避免 over-fetch 漏数据)
 *   - text 截 120 字
 *   - listMemoriesBySource 抛 → console.warn + 返 null,不阻塞 planner
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('../memory-store', () => ({
  listMemoriesBySource: vi.fn(),
}))

import { BehaviorPlanner } from './index'
import { listMemoriesBySource } from '../memory-store'

const mockListBySource = vi.mocked(listMemoriesBySource)

function mem(args: {
  id: string
  text: string
  source: string
  ts?: number
}): {
  id: string
  kind: 'event'
  text: string
  embedding: number[]
  importance: number
  source: string
  ts: number
} {
  return {
    id: args.id,
    kind: 'event',
    text: args.text,
    embedding: [],
    importance: 0.45,
    source: args.source,
    ts: args.ts ?? Date.now(),
  }
}

describe('Round P: planner.collectCrossCharacterContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('characterId null → 不读 db,返 null', () => {
    const p = new BehaviorPlanner(null)
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    expect(mockListBySource).not.toHaveBeenCalled()
  })

  it('characterId set + 没 event → 返 null', () => {
    mockListBySource.mockReturnValue([])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    // Round S:用 listMemoriesBySource SQL 直接 filter,prefix 'cross_character:'
    expect(mockListBySource).toHaveBeenCalledWith('hina', 'cross_character:', {
      kind: 'event',
      limit: 3,
    })
  })

  it('characterId set + 1 个 cross-character event → section string 含该 text', () => {
    mockListBySource.mockReturnValue([
      mem({
        id: '1',
        text: 'Suzy 对 master 说: 晚安',
        source: 'cross_character:suzy',
      }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).not.toBeNull()
    expect(r).toContain('Suzy 对 master 说: 晚安')
    expect(r).toContain('1.') // 列表 prefix
    expect(r).toContain('# 你最近作为旁观者听到的')
  })

  it('Round S:SQL 端已 filter,planner 直接信任 mock 返值', () => {
    // Round S 重塑:filter 在 SQL,不在 planner JS。给 mock 只放 cross-character event。
    // 之前的"过滤非 cross_character source"测试改为验证 SQL 调用参数即可。
    mockListBySource.mockReturnValue([
      mem({
        id: '1',
        text: 'Suzy 对 master 说: hi',
        source: 'cross_character:suzy',
      }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toContain('Suzy 对 master 说: hi')
    // 验证 SQL 端拿了 prefix(planner 不再 JS filter)
    expect(mockListBySource).toHaveBeenCalledWith(
      'hina',
      'cross_character:',
      expect.objectContaining({ kind: 'event', limit: 3 }),
    )
  })

  it('SQL 已限 limit:3,所以 mock 返 3 条全显示', () => {
    // Round S:limit 推到 SQL,planner 不再 slice(0, 3)。test 也跟着改:
    // mock 给 3 条都该显示。
    mockListBySource.mockReturnValue(
      Array.from({ length: 3 }, (_, i) =>
        mem({
          id: `${i}`,
          text: `event ${i}`,
          source: 'cross_character:other',
        }),
      ),
    )
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toContain('event 0')
    expect(r).toContain('event 1')
    expect(r).toContain('event 2')
  })

  it('text 超 120 字 → 截断', () => {
    const longText = 'x'.repeat(300)
    mockListBySource.mockReturnValue([
      mem({ id: '1', text: longText, source: 'cross_character:other' }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()!
    // 提取列表第 1 项的 body(remove "1. " prefix)
    const line = r.split('\n').find((l) => l.startsWith('1. '))
    expect(line).toBeDefined()
    const body = line!.replace(/^1\. /, '')
    expect(body.length).toBe(120)
  })

  it('listMemoriesBySource 抛 → console.warn + 返 null,不阻塞 planner', () => {
    mockListBySource.mockImplementation(() => {
      throw new Error('db locked')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[planner] collectCrossCharacterContext failed:',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})
