/**
 * M8 灵魂社会 闭环 smoke test — Round T
 *
 * 默认 skip,需 SMOKE_TEST=1 才跑(better-sqlite3 native module 在某些
 * arch/electron 版本组合下 vitest 跑 node binary 会架构不匹配崩
 * — production runtime electron 跑没问题,但 test 环境需 rebuild)。
 *
 *   SMOKE_TEST=1 pnpm -F luvu-electron test --run m8-closed-loop.smoke
 *
 * 不 mock memory-store / character-store / planner,只 mock electron + paths
 * (走真 better-sqlite3 + 真 fs)。验证整个数据流真能跑通:
 *
 *   1. 创建 2 个 character A 和 B
 *   2. 把 A + B 都设成 mounted
 *   3. 设 A 为 active
 *   4. 模拟 A speak — 调 notifyOtherMountedCharacters(A.id, plan)
 *   5. 验证 B 的 memory.db 真有一条 kind='event' source='cross_character:<A>'
 *   6. 验证 A 的 memory.db 没有(source 自己不该被自己记)
 *   7. 拿 B 的 planner 实例,collectCrossCharacterContext() 返非空 string
 *   8. 验证返回的 string 含 A 说的话
 *
 * 这测试一旦挂掉,意味着 N → P 链断了(GUI mount toggle 可能也会受影响)。
 *
 * 与单元测试的关系:
 *   - planner/cross-character-context.test.ts 用 mock listMemoriesBySource
 *     验证 prompt 拼接逻辑(快,无 DB)
 *   - attention/index.test.ts 用 mock addMemory 验证 notifyOther 写入路径
 *   - 本 smoke 验证两端真用 better-sqlite3 时能对接 — fixture 端到端
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SHOULD_RUN = process.env.SMOKE_TEST === '1'
import {
  makeTmpUserData,
  mockElectronModule,
  mockPaths,
} from './test-helpers/electron-mock'
import type { BehaviorPlan } from '@shared/attention'

const ctx = makeTmpUserData()
vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
vi.mock('./paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))

// 必须在 mock 之后才 import 被测 service(避免拿到真的 electron / paths)
const { existsSync, rmSync } = await import('node:fs')
const { join } = await import('node:path')

const {
  createCharacter,
  charactersRoot,
  setActiveCharacterId,
  setMountedCharacterIds,
} = await import('./character-store')

const { listMemories, listMemoriesBySource, closeMemoryDb } = await import(
  './memory-store'
)
const { notifyOtherMountedCharacters } = await import('./attention/index')
const { getPlanner, _resetAllPlannersForTest } = await import('./planner')

afterAll(() => ctx.cleanup())

beforeEach(() => {
  // 清干净每 test 间状态
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
  const activeIdPath = join(ctx.userDataDir, 'active-character.json')
  if (existsSync(activeIdPath)) rmSync(activeIdPath)
  closeMemoryDb() // 清所有打开的 memory db 句柄
  _resetAllPlannersForTest() // 清 planner Map cache
})

function makePlanWithSpeak(text: string): BehaviorPlan {
  return {
    t: Date.now(),
    trigger: 'integration_test',
    actions: [
      { type: 'speak', text, emotion: 'happy', intensity: 0.7 },
    ],
    llm_generated: false,
  }
}

describe.skipIf(!SHOULD_RUN)('M8 闭环 integration(Round N write + Round P read)', () => {
  it('A speak → B memory.db 写入 cross_character event,B planner 读出来', () => {
    // 1. 创建 A 和 B
    const A = createCharacter({
      name: 'Alpha',
      call_master_as: 'master',
      live2d_model_dir: 'X',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    const B = createCharacter({
      name: 'Beta',
      call_master_as: 'master',
      live2d_model_dir: 'Y',
      live2d_model_file: 'y.model3.json',
      template: 'custom',
    })

    // 2. mount 两个
    const mountRes = setMountedCharacterIds([A.id, B.id])
    expect(mountRes.ok).toBe(true)

    // 3. A 是 active
    setActiveCharacterId(A.id)

    // 4. A speak
    const plan = makePlanWithSpeak('master 今天吃晚饭了吗?')
    const r = notifyOtherMountedCharacters(A.id, plan)

    // Round N 写入应该成功 1 次(只写 B)
    expect(r).not.toBeNull()
    expect(r?.written).toBe(1)
    expect(r?.skipped).toBe('') // 没失败 id

    // 5. B memory.db 真有
    const bEvents = listMemories(B.id, { kind: 'event', limit: 10 })
    expect(bEvents.length).toBe(1)
    const evt = bEvents[0]!
    expect(evt.text).toContain('master 今天吃晚饭了吗?')
    expect(evt.text).toContain('Alpha') // sourceName
    expect(evt.source).toBe(`cross_character:${A.id}`)
    expect(evt.importance).toBe(0.45)

    // 6. A memory.db 没有自己说的话
    const aEvents = listMemories(A.id, { kind: 'event', limit: 10 })
    expect(aEvents.length).toBe(0)

    // 6b. Round S SQL filter 也能拿到
    const bCrossEvents = listMemoriesBySource(B.id, 'cross_character:', {
      kind: 'event',
      limit: 3,
    })
    expect(bCrossEvents.length).toBe(1)

    // 7-8. Round P:planner(B) 拿 prompt context
    const planB = getPlanner(B.id)
    expect(planB.characterId).toBe(B.id)
    const ctxStr = planB.collectCrossCharacterContext()
    expect(ctxStr).not.toBeNull()
    expect(ctxStr).toContain('Alpha')
    expect(ctxStr).toContain('master 今天吃晚饭了吗?')
    expect(ctxStr).toContain('# 你最近作为旁观者听到的')

    // 9. planner(A) 拿不到任何 cross-char(因为 A 自己 memory.db 没东西)
    const planA = getPlanner(A.id)
    expect(planA.collectCrossCharacterContext()).toBeNull()

    // 10. default planner 永远 null(legacy 兼容)
    const planDefault = getPlanner()
    expect(planDefault.collectCrossCharacterContext()).toBeNull()
  })

  it('mount 仅 active 1 个 → notifyOther 不写,planner 拿不到', () => {
    const A = createCharacter({
      name: 'Solo',
      call_master_as: 'master',
      live2d_model_dir: 'X',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    setMountedCharacterIds([A.id])
    setActiveCharacterId(A.id)

    const r = notifyOtherMountedCharacters(
      A.id,
      makePlanWithSpeak('one soul one speak'),
    )
    expect(r?.skipped).toBe('no_other_mounted')
    expect(r?.written).toBe(0)

    const events = listMemories(A.id, { kind: 'event', limit: 10 })
    expect(events.length).toBe(0)
  })

  it('3 mounted character 时,A speak → B/C 都拿到', () => {
    const A = createCharacter({
      name: 'A',
      call_master_as: 'master',
      live2d_model_dir: 'X',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    const B = createCharacter({
      name: 'B',
      call_master_as: 'master',
      live2d_model_dir: 'Y',
      live2d_model_file: 'y.model3.json',
      template: 'custom',
    })
    const C = createCharacter({
      name: 'C',
      call_master_as: 'master',
      live2d_model_dir: 'Z',
      live2d_model_file: 'z.model3.json',
      template: 'custom',
    })

    setMountedCharacterIds([A.id, B.id, C.id])
    setActiveCharacterId(A.id)

    const r = notifyOtherMountedCharacters(
      A.id,
      makePlanWithSpeak('hello everyone'),
    )
    expect(r?.written).toBe(2)

    // B 和 C 各自 memory.db 都有
    expect(listMemories(B.id, { kind: 'event', limit: 10 }).length).toBe(1)
    expect(listMemories(C.id, { kind: 'event', limit: 10 }).length).toBe(1)
    expect(listMemories(A.id, { kind: 'event', limit: 10 }).length).toBe(0)

    // 两个 planner context 都能 surface
    expect(getPlanner(B.id).collectCrossCharacterContext()).toContain(
      'hello everyone',
    )
    expect(getPlanner(C.id).collectCrossCharacterContext()).toContain(
      'hello everyone',
    )
  })
})
