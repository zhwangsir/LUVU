/**
 * soul-change-log integration tests (P5).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTmpUserData,
  mockElectronModule,
  mockPaths,
} from './test-helpers/electron-mock'

const ctx = makeTmpUserData()
vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
vi.mock('./paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))

const {
  clearSoulChangeLog,
  loadSoulChangeLog,
  recordSoulChange,
} = await import('./soul-change-log')
const { createCharacter, charactersRoot } = await import('./character-store')
const { rmSync, existsSync } = await import('node:fs')

afterAll(() => ctx.cleanup())

beforeEach(() => {
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
})

function mkChar(): { id: string } {
  return createCharacter({
    name: 'LogTest',
    call_master_as: '主人',
    live2d_model_dir: 'x',
    live2d_model_file: 'x.model3.json',
    template: 'custom',
  })
}

describe('recordSoulChange', () => {
  it('真实 yaml 改动 → 写一条 log entry', () => {
    const c = mkChar()
    const entry = recordSoulChange(
      c.id,
      'identity.yaml',
      'name: Old\nmaster: M',
      'name: New\nmaster: M',
    )
    expect(entry).not.toBeNull()
    expect(entry!.character_id).toBe(c.id)
    expect(entry!.filename).toBe('identity.yaml')
    expect(entry!.changes.length).toBe(1)
    expect(entry!.changes[0]!.path).toBe('name')
    expect(entry!.changes[0]!.before).toBe('Old')
    expect(entry!.changes[0]!.after).toBe('New')
    expect(entry!.summary).toContain('~1 修改')
  })

  it('完全一致的 yaml → 不写 log (null)', () => {
    const c = mkChar()
    const entry = recordSoulChange(
      c.id,
      'identity.yaml',
      'name: X',
      'name: X',
    )
    expect(entry).toBeNull()
    expect(loadSoulChangeLog(c.id)).toEqual([])
  })

  it('损坏 yaml 不 crash (best-effort)', () => {
    const c = mkChar()
    const entry = recordSoulChange(
      c.id,
      'broken.yaml',
      'name: X',
      '{{{ broken',
    )
    // 即使损坏，也可能根据 parseYamlSafe 返回 {} 然后跟 {name:'X'} diff → removed name
    // 重点：不能 throw
    expect(() => entry).not.toThrow()
  })

  it('空 yaml → 视为 {} → 不算 diff', () => {
    const c = mkChar()
    const entry = recordSoulChange(c.id, 'empty.yaml', '', '')
    expect(entry).toBeNull()
  })
})

describe('loadSoulChangeLog', () => {
  it('未写过 → 空数组', () => {
    const c = mkChar()
    expect(loadSoulChangeLog(c.id)).toEqual([])
  })

  it('多次 append → newest first', () => {
    const c = mkChar()
    recordSoulChange(c.id, 'identity.yaml', 'name: A', 'name: B')
    recordSoulChange(c.id, 'identity.yaml', 'name: B', 'name: C')
    const log = loadSoulChangeLog(c.id)
    expect(log.length).toBe(2)
    // 最新的在前 (newest first)
    expect(log[0]!.changes[0]!.after).toBe('C')
    expect(log[1]!.changes[0]!.after).toBe('B')
  })

  it('NDJSON 一行一条', () => {
    const c = mkChar()
    recordSoulChange(c.id, 'a.yaml', 'name: X', 'name: Y')
    recordSoulChange(c.id, 'b.yaml', 'master: M', 'master: N')
    const log = loadSoulChangeLog(c.id)
    expect(log.length).toBe(2)
    expect(log.map((e) => e.filename).sort()).toEqual(['a.yaml', 'b.yaml'])
  })

  it('LRU 周期 compact (写超 1.5x=300 触发截到 200，期间累积 <= 300)', () => {
    const c = mkChar()
    // code-reviewer M1: appendFileSync 纯追加 + 周期 compact (性能 O(1)/write)
    // 写 N 条后 log 最多保留 300 (compact 阈值)，最少 200 (compact 后)
    for (let i = 0; i < 310; i++) {
      recordSoulChange(c.id, 'identity.yaml', `name: A${i}`, `name: A${i + 1}`)
    }
    const log = loadSoulChangeLog(c.id)
    // 关键不变量: 不会无限增长 (>= 300 时 compact 触发)
    expect(log.length).toBeLessThanOrEqual(300)
    // 最新的应该是 A310 (newest first)
    expect(log[0]!.changes[0]!.after).toBe('A310')
  })

  it('LRU 跨多轮 compact: 写 600 条仍维持 <= 300', () => {
    const c = mkChar()
    for (let i = 0; i < 600; i++) {
      recordSoulChange(c.id, 'identity.yaml', `name: A${i}`, `name: A${i + 1}`)
    }
    const log = loadSoulChangeLog(c.id)
    expect(log.length).toBeLessThanOrEqual(300)
    expect(log[0]!.changes[0]!.after).toBe('A600')
  })
})

describe('clearSoulChangeLog', () => {
  it('清空后 load 返回空', () => {
    const c = mkChar()
    recordSoulChange(c.id, 'identity.yaml', 'name: A', 'name: B')
    expect(loadSoulChangeLog(c.id).length).toBe(1)
    clearSoulChangeLog(c.id)
    expect(loadSoulChangeLog(c.id)).toEqual([])
  })
})

describe('P0 SEC H2: characterId 验证防路径污染', () => {
  it('record: 路径穿越 characterId → 拒绝 (返 null)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(recordSoulChange('../etc', 'identity.yaml', 'a: 1', 'a: 2')).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('record: 非法字符 characterId → 拒绝', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(recordSoulChange('/etc/cron', 'identity.yaml', 'a: 1', 'a: 2')).toBeNull()
    expect(recordSoulChange('with space', 'identity.yaml', 'a: 1', 'a: 2')).toBeNull()
    expect(recordSoulChange('', 'identity.yaml', 'a: 1', 'a: 2')).toBeNull()
    warnSpy.mockRestore()
  })

  it('record: 不存在的 characterId → 拒绝', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(recordSoulChange('nonexistent-id', 'identity.yaml', 'a: 1', 'a: 2')).toBeNull()
    warnSpy.mockRestore()
  })

  it('record: 非法 filename → 拒绝', () => {
    const c = mkChar()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(recordSoulChange(c.id, '../passwd', 'a: 1', 'a: 2')).toBeNull()
    expect(recordSoulChange(c.id, 'shell.sh', 'a: 1', 'a: 2')).toBeNull()
    expect(recordSoulChange(c.id, '/etc/passwd', 'a: 1', 'a: 2')).toBeNull()
    warnSpy.mockRestore()
  })

  it('load: 非法 characterId → 空数组 (不读 fs)', () => {
    expect(loadSoulChangeLog('../etc')).toEqual([])
    expect(loadSoulChangeLog('/etc/cron')).toEqual([])
    expect(loadSoulChangeLog('nonexistent')).toEqual([])
  })

  it('clear: 非法 characterId → 静默 no-op', () => {
    expect(() => clearSoulChangeLog('../etc')).not.toThrow()
    expect(() => clearSoulChangeLog('nonexistent')).not.toThrow()
  })
})
