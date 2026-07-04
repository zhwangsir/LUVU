/**
 * 跨角色情感联动测试 (P5)。
 *
 * detectOtherCharactersMentioned 纯函数 — 不依赖 fs/store。
 * applyMentionedToOtherCharacter 集成测试用 mockPaths 隔离。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character } from '@shared/character'
import {
  CROSS_CHARACTER_TOPIC,
  detectOtherCharactersMentioned,
} from './cross-character'
import {
  makeTmpUserData,
  mockElectronModule,
  mockPaths,
} from '../test-helpers/electron-mock'

const ctx = makeTmpUserData()
vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
vi.mock('../paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))

const { applyMentionedToOtherCharacter } = await import('./cross-character')
const { loadEmotionalState } = await import('./store')
const { createCharacter, charactersRoot, listCharacters } = await import('../character-store')
const { existsSync, rmSync } = await import('node:fs')

afterAll(() => ctx.cleanup())

function mkChar(id: string, name: string): Character {
  return {
    id,
    name,
    call_master_as: '主人',
    description: '',
    template: 'custom',
    live2d_model_dir: 'x',
    live2d_model_file: 'x.model3.json',
    emotion_baseline: 'neutral',
    intimacy_level: 0,
    total_chats: 0,
    last_chat_at: 0,
    created_at: 0,
  }
}

beforeEach(() => {
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
})

describe('detectOtherCharactersMentioned', () => {
  const chars = [
    mkChar('a', 'Aria'),
    mkChar('b', '雨'), // 1 字 CJK — 应被跳过 (< 2)
    mkChar('c', 'LUVU'),
    mkChar('d', '小樱'),
  ]

  it('排除 active character', () => {
    const out = detectOtherCharactersMentioned('我喜欢 Aria', chars, 'a')
    expect(out).toEqual([])
  })

  it('拉丁名命中 word boundary 保护', () => {
    const out = detectOtherCharactersMentioned('我喜欢 Aria', chars, null)
    expect(out.map((c) => c.id)).toEqual(['a'])
  })

  it('拉丁名子串不误匹配 (AriaLynn 不算 Aria)', () => {
    const out = detectOtherCharactersMentioned('AriaLynn 是个好名字', chars, null)
    expect(out.map((c) => c.id)).not.toContain('a')
  })

  it('CJK 名 substring 匹配', () => {
    const out = detectOtherCharactersMentioned('小樱今天怎么样', chars, null)
    expect(out.map((c) => c.id)).toContain('d')
  })

  it('单字 CJK 名跳过 (避免 "雨" 被 "下雨" 触发)', () => {
    const out = detectOtherCharactersMentioned('下雨了', chars, null)
    expect(out.map((c) => c.id)).not.toContain('b')
  })

  it('多个角色同时命中', () => {
    const out = detectOtherCharactersMentioned('Aria 和 小樱 都很好', chars, null)
    const ids = out.map((c) => c.id)
    expect(ids).toContain('a')
    expect(ids).toContain('d')
  })

  it('大小写不敏感 (拉丁)', () => {
    const out = detectOtherCharactersMentioned('我说的是 ARIA', chars, null)
    expect(out.map((c) => c.id)).toContain('a')
  })

  it('空 text → 空', () => {
    expect(detectOtherCharactersMentioned('', chars, null)).toEqual([])
  })

  it('特殊字符在名字中正确转义 (无 regex 注入)', () => {
    const c = mkChar('e', 'A.*B') // 含 regex 特殊字符
    const out = detectOtherCharactersMentioned('我说 A.*B', [c], null)
    // CJK substring 路径会匹配（含 . *）
    expect(out.map((c) => c.id)).toContain('e')
    // A.B (regex 含义但不在 text 中) 不应匹配
    const out2 = detectOtherCharactersMentioned('AXB', [c], null)
    expect(out2).toEqual([])
  })
})

describe('applyMentionedToOtherCharacter (集成 fs)', () => {
  it('给指定 character 写 topic_imprint', () => {
    const c = createCharacter({
      name: 'TargetChar',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    applyMentionedToOtherCharacter(c.id, -0.5)
    const s = loadEmotionalState(c.id)
    expect(s.topic_imprints[CROSS_CHARACTER_TOPIC]).toBeDefined()
    expect(s.topic_imprints[CROSS_CHARACTER_TOPIC]!.sentiment).toBe(-0.5)
    expect(s.topic_imprints[CROSS_CHARACTER_TOPIC]!.count).toBe(1)
  })

  it('多次提及加权累积', () => {
    const c = createCharacter({
      name: 'AccumulateChar',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    applyMentionedToOtherCharacter(c.id, -1.0)
    applyMentionedToOtherCharacter(c.id, 0.0)
    const s = loadEmotionalState(c.id)
    // 0.7 * -1.0 + 0.3 * 0.0 = -0.7
    expect(s.topic_imprints[CROSS_CHARACTER_TOPIC]!.sentiment).toBeCloseTo(-0.7, 2)
    expect(s.topic_imprints[CROSS_CHARACTER_TOPIC]!.count).toBe(2)
  })

  it('未被提到的角色 topic_imprints 不动', () => {
    const a = createCharacter({
      name: 'A',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    const b = createCharacter({
      name: 'B',
      call_master_as: '主人',
      live2d_model_dir: 'y',
      live2d_model_file: 'y.model3.json',
      template: 'custom',
    })
    applyMentionedToOtherCharacter(a.id, 0.5)
    const sB = loadEmotionalState(b.id)
    expect(Object.keys(sB.topic_imprints).length).toBe(0)
  })

  it('集成 listCharacters → 端到端跨角色场景', () => {
    const aria = createCharacter({
      name: 'Aria',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    const tia = createCharacter({
      name: 'LUVU',
      call_master_as: '主人',
      live2d_model_dir: 'y',
      live2d_model_file: 'y.model3.json',
      template: 'custom',
    })
    // 模拟 user 跟 Aria 聊时说 "我想 LUVU"
    const detected = detectOtherCharactersMentioned(
      '我想 LUVU 了',
      listCharacters(),
      aria.id,
    )
    expect(detected.length).toBe(1)
    expect(detected[0]!.id).toBe(tia.id)
    // 给 tia 应用 sentiment*0.7 (这里取 -0.6 模拟想念)
    applyMentionedToOtherCharacter(detected[0]!.id, -0.6 * 0.7)
    // 切换到 tia → emotional state 已有印记
    const sTia = loadEmotionalState(tia.id)
    expect(sTia.topic_imprints[CROSS_CHARACTER_TOPIC]).toBeDefined()
  })
})
