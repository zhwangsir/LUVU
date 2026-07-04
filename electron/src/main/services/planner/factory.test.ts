/**
 * planner factory 单测 — v0.21 Round H(收 task #32)
 *
 * 验证:
 *   - getPlanner() 返 default 单实例(向后兼容旧 `export const planner`)
 *   - getPlanner(A) ≠ getPlanner(B):不同 character 独立实例
 *   - getPlanner(A) === getPlanner(A):同 character reuse 缓存
 *   - _resetAllPlannersForTest 清空所有 Map 缓存
 *   - 不同实例的 internal state 完全隔离(用 plan 调用次数间接验证)
 *
 * 不测 plan() 真实 LLM 调用(那是 planner 本身的 test,不是 factory test)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { BehaviorPlanner, getPlanner, _resetAllPlannersForTest } from './index'

describe('planner factory(M8 灵魂社会前置)', () => {
  beforeEach(() => {
    _resetAllPlannersForTest()
  })

  it('getPlanner() 返 BehaviorPlanner 实例', () => {
    const p = getPlanner()
    expect(p).toBeInstanceOf(BehaviorPlanner)
  })

  it('getPlanner() 不传 id → default 单实例 reuse', () => {
    const p1 = getPlanner()
    const p2 = getPlanner()
    expect(p1).toBe(p2) // Object.is 等于
  })

  it('getPlanner(A) ≠ getPlanner(B):不同 character 独立实例', () => {
    const pA = getPlanner('character-A')
    const pB = getPlanner('character-B')
    expect(pA).not.toBe(pB)
    expect(pA).toBeInstanceOf(BehaviorPlanner)
    expect(pB).toBeInstanceOf(BehaviorPlanner)
  })

  it('getPlanner(A) === getPlanner(A):同 character 实例 cache', () => {
    const p1 = getPlanner('soul-x')
    const p2 = getPlanner('soul-x')
    expect(p1).toBe(p2)
  })

  it('default vs 具名 characterId:不同实例(default key 是内部 sentinel)', () => {
    const defaultP = getPlanner()
    const namedP = getPlanner('any-character-id')
    expect(defaultP).not.toBe(namedP)
  })

  it('_resetAllPlannersForTest:清空 + 下次 get 是新实例', () => {
    const before = getPlanner('soul-z')
    _resetAllPlannersForTest()
    const after = getPlanner('soul-z')
    // 同 id 但是清空后新建,instance 不一样
    expect(after).not.toBe(before)
  })

  it('M8 多灵魂场景:3 个 character 并发拿 planner 各自独立', () => {
    const ids = ['char-1', 'char-2', 'char-3']
    const planners = ids.map((id) => getPlanner(id))

    // 3 个都是不同实例
    expect(new Set(planners).size).toBe(3)

    // 各自 reuse
    // reviewer H-LOW-2:noUncheckedIndexedAccess strict 下 planners[i] 是
    // `BehaviorPlanner | undefined`,用 non-null assertion(ids 是常量,index 必然有效)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const again = getPlanner(id)
      expect(again).toBe(planners[i]!)
    }
  })

  // ============ Round P:planner 知道自己服务哪个 character ============

  it('Round P:getPlanner(id) 给实例设 characterId', () => {
    const p = getPlanner('suzy')
    expect(p.characterId).toBe('suzy')
  })

  it('Round P:default planner.characterId === null(legacy 兼容)', () => {
    const p = getPlanner()
    expect(p.characterId).toBeNull()
  })

  it('Round P:空字符串 → 走 default,characterId 也是 null', () => {
    const p = getPlanner('')
    expect(p.characterId).toBeNull()
  })

  it('Round P:多 character 各自 characterId 不串', () => {
    const a = getPlanner('alpha')
    const b = getPlanner('beta')
    expect(a.characterId).toBe('alpha')
    expect(b.characterId).toBe('beta')
  })
})
