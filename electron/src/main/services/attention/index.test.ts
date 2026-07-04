/**
 * attention/index — Round N(M8 灵魂↔灵魂)
 *
 * 验证 notifyOtherMountedCharacters 把 active character 的 speak action
 * 作为 event memory 写入其他 mounted character 的 memory.db。
 *
 * 设计 invariant:
 *   - source character 不写自己 memory(自己说的话不应作为"听到的"事件再记一遍)
 *   - 只有 plan 含 speak action 才触发
 *   - mounted ≤ 1 时不写(只有 active 自己,没有"其他人")
 *   - source 找不到时 fallback 用 id 作 name
 *   - text 截 200 字
 *   - importance 0.45(低于普通 event 0.5)避免淹没 RAG
 *   - kind='event' + source 含 'cross_character:' 前缀(可识别)
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { BehaviorPlan } from '@shared/attention'

// 必须在 import 前 mock(vi.mock 会自动 hoist)
vi.mock('../character-store', () => ({
  getCharacter: vi.fn(),
  getMountedCharacterIds: vi.fn(),
  getActiveCharacterId: vi.fn(),
}))
vi.mock('../memory-store', () => ({
  addMemory: vi.fn(),
}))
vi.mock('../perception', () => ({
  triggerScreenSnapshot: vi.fn(),
}))
vi.mock('./scheduler', () => ({
  scheduler: {
    updateConfig: vi.fn(),
    onTrigger: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getConfig: vi.fn(),
    snapshot: vi.fn(),
    markActionTaken: vi.fn(),
  },
}))
vi.mock('../planner', () => ({
  getPlanner: vi.fn(),
}))

import { notifyOtherMountedCharacters } from './index'
import { getCharacter, getMountedCharacterIds } from '../character-store'
import { addMemory } from '../memory-store'

const mockGetCharacter = vi.mocked(getCharacter)
const mockGetMountedIds = vi.mocked(getMountedCharacterIds)
const mockAddMemory = vi.mocked(addMemory)

/** 测试辅助:造一个含 speak action 的 minimal BehaviorPlan */
function makePlan(speakText: string | null): BehaviorPlan {
  // reviewer N-HIGH-1:BehaviorPlan.llm_generated 是必填 boolean,
  // vitest 用 esbuild 跳 typecheck 所以 runtime 没炸,tsc 真编译时报 TS2741
  const plan: BehaviorPlan = {
    t: Date.now(),
    trigger: 'test',
    actions: [],
    llm_generated: false,
  }
  if (speakText !== null) {
    plan.actions.push({
      type: 'speak',
      text: speakText,
      emotion: 'neutral',
      intensity: 0.5,
    })
  }
  return plan
}

describe('Round N: notifyOtherMountedCharacters(M8 灵魂↔灵魂 passive listening)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无 source id → 跳过', () => {
    const r = notifyOtherMountedCharacters(undefined, makePlan('hi'))
    expect(r?.skipped).toBe('no_source')
    expect(mockAddMemory).not.toHaveBeenCalled()
  })

  it('plan 不含 speak action → 跳过', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b'])
    const r = notifyOtherMountedCharacters('a', makePlan(null))
    expect(r?.skipped).toBe('no_speak_action')
    expect(mockAddMemory).not.toHaveBeenCalled()
  })

  it('speak 但 text 为空 → 跳过', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b'])
    const r = notifyOtherMountedCharacters('a', makePlan(''))
    expect(r?.skipped).toBe('no_speak_action')
    expect(mockAddMemory).not.toHaveBeenCalled()
  })

  it('mounted 只有 source 自己 → 不写', () => {
    mockGetMountedIds.mockReturnValue(['a'])
    const r = notifyOtherMountedCharacters('a', makePlan('hello'))
    expect(r?.skipped).toBe('no_other_mounted')
    expect(mockAddMemory).not.toHaveBeenCalled()
  })

  it('mounted 空数组 → 不写', () => {
    mockGetMountedIds.mockReturnValue([])
    const r = notifyOtherMountedCharacters('a', makePlan('hello'))
    expect(r?.skipped).toBe('no_other_mounted')
    expect(mockAddMemory).not.toHaveBeenCalled()
  })

  it('2 mounted: 给非 source 的 character 写 event memory', () => {
    mockGetMountedIds.mockReturnValue(['suzy', 'hina'])
    mockGetCharacter.mockImplementation((id: string) =>
      id === 'suzy'
        ? ({ id: 'suzy', name: 'Suzy' } as never)
        : null,
    )
    const r = notifyOtherMountedCharacters('suzy', makePlan('master 晚安~'))
    expect(r?.written).toBe(1)
    expect(mockAddMemory).toHaveBeenCalledTimes(1)
    const [calledCharId, mem] = mockAddMemory.mock.calls[0]!
    expect(calledCharId).toBe('hina') // 不是 source 本身
    expect(mem.kind).toBe('event')
    expect(mem.text).toContain('Suzy') // 用 name 不是 id
    expect(mem.text).toContain('master 晚安~')
    expect(mem.source).toBe('cross_character:suzy')
    expect(mem.importance).toBe(0.45)
    expect(mem.embedding).toEqual([])
  })

  it('3 mounted: 给两个非 source 都写一份', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b', 'c'])
    mockGetCharacter.mockImplementation(
      (id: string) => ({ id, name: id.toUpperCase() } as never),
    )
    const r = notifyOtherMountedCharacters('a', makePlan('hello world'))
    expect(r?.written).toBe(2)
    expect(mockAddMemory).toHaveBeenCalledTimes(2)
    const targetIds = mockAddMemory.mock.calls.map((c) => c[0])
    expect(new Set(targetIds)).toEqual(new Set(['b', 'c']))
  })

  it('source character 找不到 → 用 id 当 name fallback', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b'])
    mockGetCharacter.mockReturnValue(null) // source 查不到
    const r = notifyOtherMountedCharacters('a', makePlan('hi'))
    expect(r?.written).toBe(1)
    const mem = mockAddMemory.mock.calls[0]?.[1]
    expect(mem?.text).toContain('a 对 master 说') // 用 source id
  })

  it('text 超 200 字 → 截断', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b'])
    mockGetCharacter.mockReturnValue({ id: 'a', name: 'A' } as never)
    const longText = '啊'.repeat(500)
    notifyOtherMountedCharacters('a', makePlan(longText))
    const mem = mockAddMemory.mock.calls[0]?.[1]
    expect(mem?.text).toBeDefined()
    // 截到 200 char text body,加上 prefix "A 对 master 说: " 后总长
    // 不算 prefix 只校验 body 截断
    const body = mem!.text.replace(/^A 对 master 说: /, '')
    expect(body.length).toBe(200)
  })

  it('addMemory 抛 → 静默 console.warn,继续给下一个写,失败 id 进 skipped', () => {
    mockGetMountedIds.mockReturnValue(['a', 'b', 'c'])
    mockGetCharacter.mockReturnValue({ id: 'a', name: 'A' } as never)
    // b 写入抛错,c 应该照样写入
    mockAddMemory.mockImplementationOnce(() => {
      throw new Error('disk full simulated')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = notifyOtherMountedCharacters('a', makePlan('hi'))
    expect(r?.written).toBe(1) // 只 c 成功
    expect(mockAddMemory).toHaveBeenCalledTimes(2) // 试了 2 次(b 抛 + c)
    expect(warnSpy).toHaveBeenCalled()
    // reviewer N-MEDIUM-5:失败 id 列表写进 skipped 给可观测性
    expect(r?.skipped).toBe('b')
    warnSpy.mockRestore()
  })

  it('getMountedCharacterIds 抛 → 整体 try/catch 兜底返 null', () => {
    mockGetMountedIds.mockImplementation(() => {
      throw new Error('character-store down')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = notifyOtherMountedCharacters('a', makePlan('hi'))
    expect(r).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[attention] notifyOtherMountedCharacters failed:',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})
