/**
 * soul-loader fs integration tests (P4.1) — 真实 fs 读 yaml + 合并 + system prompt 渲染。
 *
 * 覆盖:
 *   - 空 soul dir → DEFAULT_SOUL fallback
 *   - 4 partial yaml 全在 → 合并到 SoulConfig
 *   - identity 单文件 → 顶层字段覆盖
 *   - !!js/* 注入攻击 → JSON_SCHEMA 阻断（不应 RCE）
 *   - default.yaml 单文件兼容（旧 v0.1 格式）
 *   - 损坏 yaml → 不 crash，console.warn 后跳过
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  makeTmpUserData,
  mockElectronModule,
  mockPaths,
} from './test-helpers/electron-mock'

const ctx = makeTmpUserData()

vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
vi.mock('./paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))
// character-store 用 active character 查找 — 没 active 时 fallback 到 paths.soulDir
vi.mock('./character-store', () => ({
  getActiveCharacter: () => null,
  characterSoulDir: () => '',
}))
// mcp-registry 在 buildSystemPrompt 被 require — mock 掉避免它 import 真实 fs
vi.mock('./mcp-registry', () => ({ buildMCPToolsPrompt: () => '' }))
// emotional-state 在 buildSystemPrompt 也被调 — 这里测 soul 本身，mock 掉
vi.mock('./emotional-state/store', () => ({
  loadEmotionalState: () => null,
}))
vi.mock('./emotional-state/text', () => ({
  emotionalStateToPromptFragment: () => '',
}))

const { loadSoul } = await import('./soul-loader')

const soulDir = join(ctx.userDataDir, 'soul')

afterAll(() => ctx.cleanup())

function resetSoul(): void {
  if (existsSync(soulDir)) rmSync(soulDir, { recursive: true, force: true })
}

function writeSoulYaml(filename: string, content: string): void {
  mkdirSync(soulDir, { recursive: true })
  writeFileSync(join(soulDir, filename), content, 'utf-8')
}

beforeEach(() => {
  resetSoul()
})

describe('loadSoul', () => {
  it('空目录 → DEFAULT_SOUL 全字段 fallback', () => {
    const loaded = loadSoul()
    expect(loaded.sourceFiles).toEqual([])
    expect(loaded.config.name).toBe('LUVU')
    expect(loaded.config.master).toBe('Master')
    expect(loaded.config.layer1_core).toContain('粘人')
    expect(loaded.config.speech_style.catchphrases).toContain('啧')
    expect(loaded.systemPrompt).toContain('# 你的身份')
    expect(loaded.systemPrompt).toContain('LUVU')
  })

  it('identity.yaml 单文件 → 顶层 name/master 覆盖', () => {
    writeSoulYaml(
      'identity.yaml',
      `name: Aria
master: 震宇
call_master_as: 哥哥`,
    )
    const loaded = loadSoul()
    expect(loaded.config.name).toBe('Aria')
    expect(loaded.config.master).toBe('震宇')
    expect(loaded.config.call_master_as).toBe('哥哥')
    expect(loaded.sourceFiles.some((f) => f.endsWith('identity.yaml'))).toBe(true)
    expect(loaded.systemPrompt).toContain('Aria')
    expect(loaded.systemPrompt).toContain('震宇')
  })

  it('4 partial yaml 全在 → 全部合并', () => {
    writeSoulYaml('identity.yaml', 'name: Multi\nmaster: M')
    writeSoulYaml(
      'personality.yaml',
      `layer1_core: 新底色
speech_style:
  catchphrases: ['新口头禅']`,
    )
    writeSoulYaml('learned_traits.yaml', 'flip_probability: 0.42')
    writeSoulYaml(
      'core_memories.yaml',
      `example_dialogues:
  - user: hi
    assistant:
      text: 你好主人
      emotion: happy
      intensity: 0.8`,
    )
    const loaded = loadSoul()
    expect(loaded.sourceFiles.length).toBe(4)
    expect(loaded.config.name).toBe('Multi')
    expect(loaded.config.layer1_core).toBe('新底色')
    expect(loaded.config.speech_style.catchphrases).toEqual(['新口头禅'])
    expect(loaded.config.flip_probability).toBe(0.42)
    expect(loaded.config.example_dialogues?.length).toBe(1)
    expect(loaded.systemPrompt).toContain('新底色')
    expect(loaded.systemPrompt).toContain('hi') // few-shot 注入
  })

  it('损坏 yaml → 不 crash，跳过该文件', () => {
    writeSoulYaml('identity.yaml', 'name: Good')
    writeSoulYaml('personality.yaml', '{ broken yaml [[[')
    // warn 静默掉
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const loaded = loadSoul()
    expect(loaded.config.name).toBe('Good')
    // 不应 throw；personality 损坏 → fallback default
    expect(loaded.config.layer1_core).toContain('粘人')
    warnSpy.mockRestore()
  })

  it('!!js/* 标签注入 → JSON_SCHEMA 阻断（安全测试）', () => {
    // 经典 yaml RCE payload: 用 !!js/function 注入函数
    const malicious = `name: Attack
master: !!js/function "function () { throw new Error('RCE') }"`
    writeSoulYaml('identity.yaml', malicious)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // 应 parse fail (JSON_SCHEMA 不认识 !!js/function tag)
    const loaded = loadSoul()
    // 因 parse fail，identity.yaml 没被采用 — name 不会是 Attack
    expect(loaded.config.name).toBe('LUVU') // fallback default
    warnSpy.mockRestore()
  })

  it('default.yaml 单文件兼容（v2 平铺字段）', () => {
    writeSoulYaml(
      'default.yaml',
      `name: Legacy
master: OldMaster
speech_style:
  catchphrases: ['legacy']`,
    )
    const loaded = loadSoul()
    expect(loaded.config.name).toBe('Legacy')
    expect(loaded.config.speech_style.catchphrases).toContain('legacy')
  })

  it('P5: default.yaml 是 v0.1 schema → 自动迁移', () => {
    writeSoulYaml(
      'default.yaml',
      `identity:
  name: OldChar
  master: OldM
appearance:
  live2d_model_dir: 'Old-Live2D'
  model_file: 'old.model3.json'
  anchor:
    scale: 0.45
    y_offset: 30
personality:
  layer1_core: '迁移底色'
  layer3_volatility:
    flip_probability: 0.3
    flip_modes: ['突然害羞', '突然冷淡']
speech_style:
  signature_lines: ['老口头禅']
  call_master_as: '大人'`,
    )
    const loaded = loadSoul()
    expect(loaded.config.name).toBe('OldChar')
    expect(loaded.config.master).toBe('OldM')
    expect(loaded.config.call_master_as).toBe('大人')
    expect(loaded.config.avatar.model_dir).toBe('Old-Live2D')
    expect(loaded.config.avatar.scale).toBe(0.45)
    expect(loaded.config.avatar.offset_y).toBe(30)
    expect(loaded.config.layer1_core).toBe('迁移底色')
    expect(loaded.config.flip_probability).toBe(0.3)
    expect(loaded.config.layer3_volatility_prompt).toContain('30%')
    expect(loaded.config.layer3_volatility_prompt).toContain('突然害羞')
    expect(loaded.config.speech_style.catchphrases).toEqual(['老口头禅'])
  })

  it('personality 嵌套形式 layer1_core 也能识别', () => {
    writeSoulYaml(
      'personality.yaml',
      `personality:
  layer1_core: 嵌套底色
  layer2_surface: 嵌套表层`,
    )
    const loaded = loadSoul()
    expect(loaded.config.layer1_core).toBe('嵌套底色')
    expect(loaded.config.layer2_surface).toBe('嵌套表层')
  })

  it('systemPrompt 包含三层 + 口头禅 + 输出协议', () => {
    const loaded = loadSoul()
    expect(loaded.systemPrompt).toContain('# 你的身份')
    expect(loaded.systemPrompt).toContain('# 灵魂底色')
    expect(loaded.systemPrompt).toContain('# 表层风格')
    expect(loaded.systemPrompt).toContain('# 反差波动')
    expect(loaded.systemPrompt).toContain('# 口头禅')
    expect(loaded.systemPrompt).toContain('# 输出协议')
    expect(loaded.systemPrompt).toContain('情感括号') // TTS 警告
  })

  it('example_dialogues 注入到 systemPrompt 中', () => {
    writeSoulYaml(
      'personality.yaml',
      `example_dialogues:
  - user: 你好
    assistant:
      text: 主人好~
      emotion: happy
      intensity: 0.5`,
    )
    const loaded = loadSoul()
    expect(loaded.systemPrompt).toContain('学习这些示范')
    expect(loaded.systemPrompt).toContain('你好')
    expect(loaded.systemPrompt).toContain('主人好~')
  })
})
