/**
 * character-pack export/import integration tests (P5).
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

const NOW = 1_700_000_000_000
const { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } = await import('node:fs')
const { join } = await import('node:path')
const {
  createCharacter,
  charactersRoot,
  characterDir,
  characterSoulDir,
  getMountedCharacterIds,
  listCharacters,
  setActiveCharacterId,
  setMountedCharacterIds,
  deleteCharacter,
} = await import('./character-store')
const {
  exportCharacterPack,
  importCharacterPack,
  CHARACTER_PACK_VERSION,
} = await import('./character-pack')

afterAll(() => ctx.cleanup())

beforeEach(() => {
  // 清干净
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
  const activeIdPath = join(ctx.userDataDir, 'active-character.json')
  if (existsSync(activeIdPath)) rmSync(activeIdPath)
  const thumbsDir = join(ctx.userDataDir, 'thumbs')
  if (existsSync(thumbsDir)) rmSync(thumbsDir, { recursive: true, force: true })
})

function makeFixture(): { id: string; name: string } {
  const c = createCharacter({
    name: 'Source',
    call_master_as: '大人',
    live2d_model_dir: 'Hu Tao',
    live2d_model_file: 'hutao.model3.json',
    template: 'custom',
  })
  // 写一些真实数据 (soul / preferences / emotional / thumb)
  writeFileSync(
    join(characterSoulDir(c.id), 'identity.yaml'),
    `name: Source
master: M
call_master_as: 大人
avatar:
  model_dir: 'Hu Tao'
  model_file: 'hutao.model3.json'`,
  )
  writeFileSync(
    join(characterDir(c.id), 'emotional-state.json'),
    JSON.stringify({
      character_id: c.id,
      baseline_mood: 'calm',
      current_mood: 'happy',
      mood_intensity: 0.7,
      missing_intensity: 0.1,
      last_chat_at: NOW,
      updated_at: NOW,
      topic_imprints: { 工作: { topic: '工作', sentiment: -0.4, count: 3, last_at: NOW } },
      mood_history: [{ ts: NOW, mood: 'happy', trigger: 'init' }],
    }),
  )
  // 缩略图
  const thumbsDir = join(charactersRoot(), '..', 'thumbs')
  mkdirSync(thumbsDir, { recursive: true })
  // P0 SEC H1: 用合法 WebP magic (RIFF + 4 bytes size + WEBP)
  writeFileSync(
    join(thumbsDir, `${c.id}.webp`),
    Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(20),
    ]),
  )
  return { id: c.id, name: c.name }
}

describe('exportCharacterPack', () => {
  it('打包真实 character → 返回 Buffer + 完整 meta', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id)
    expect(r.ok).toBe(true)
    expect(r.buffer).toBeInstanceOf(Buffer)
    expect(r.buffer!.length).toBeGreaterThan(100)
    expect(r.meta).toBeDefined()
    expect(r.meta!.version).toBe(CHARACTER_PACK_VERSION)
    expect(r.meta!.source_id).toBe(fx.id)
    expect(r.meta!.source_name).toBe('Source')
    expect(r.meta!.contents.soul).toBe(true)
    expect(r.meta!.contents.preferences).toBe(true)
    expect(r.meta!.contents.emotional).toBe(true)
    expect(r.meta!.contents.thumb).toBe(true)
  })

  it('不存在的 id → ok=false', () => {
    const r = exportCharacterPack('nope')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('character not found')
  })

  it('opts.includeEmotional=false → 跳过 emotional', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeEmotional: false })
    expect(r.ok).toBe(true)
    expect(r.meta!.contents.emotional).toBe(false)
  })

  it('opts.includeThumb=false → 跳过 thumb', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeThumb: false })
    expect(r.meta!.contents.thumb).toBe(false)
  })

  it('appVersion 写入 meta', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { appVersion: '0.18.0' })
    expect(r.meta!.app_version).toBe('0.18.0')
  })

  it('memory.db 默认 NOT 包含（隐私敏感）', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('FAKE_SQLITE'))
    const r = exportCharacterPack(fx.id)
    expect(r.meta!.contents.memory).toBe(false)
  })

  it('opts.includeMemory=true 显式 opt-in 才包含', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('FAKE_SQLITE_DATA'))
    const r = exportCharacterPack(fx.id, { includeMemory: true })
    expect(r.meta!.contents.memory).toBe(true)
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(r.buffer!)
    expect(zip.getEntry('memory.db')).not.toBeNull()
    expect(zip.getEntry('memory.db')!.getData().toString()).toBe('FAKE_SQLITE_DATA')
  })

  it('memory.db 不存在时 includeMemory=true 也不报错 (meta.memory=false)', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeMemory: true })
    expect(r.ok).toBe(true)
    expect(r.meta!.contents.memory).toBe(false)
  })
})

describe('importCharacterPack', () => {
  it('import 自己刚 export 的 pack → 新 character 创建成功', async () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    // 删原 character 模拟"换机器" scenario
    setActiveCharacterId(fx.id)
    // can't delete active — set someone else first
    const dummy = createCharacter({
      name: 'Dummy',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    setActiveCharacterId(dummy.id)
    await deleteCharacter(fx.id)
    expect(listCharacters().find((c) => c.id === fx.id)).toBeUndefined()

    const imp = importCharacterPack(exp.buffer!)
    if (!imp.ok) console.error('[test] import reason:', imp.reason)
    expect(imp.ok).toBe(true)
    expect(imp.character).toBeDefined()
    expect(imp.character!.name).toBe('Source')
    expect(imp.character!.call_master_as).toBe('大人')
    expect(imp.character!.live2d_model_dir).toBe('Hu Tao')
    // 源已删 → 新 id 可以复用源 id 也可以不（generateId 行为）
  })

  /**
   * v0.21 Round L:M8 灵魂社会 — import 后自动 mount 新角色
   * (architect H-1 提议;user 期望"导入完她活着"对齐 M8 多灵魂语义)
   */
  it('R-L:import 完新 character 自动出现在 mounted 列表', () => {
    const fx = makeFixture()
    // 设 mounted 只有 active fx
    setActiveCharacterId(fx.id)
    setMountedCharacterIds([fx.id])
    const before = getMountedCharacterIds()
    expect(before).toEqual([fx.id])

    // 导入新 character
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    expect(imp.ok).toBe(true)
    expect(imp.character).toBeDefined()
    const newId = imp.character!.id

    // mounted 应该自动含新 id
    const after = getMountedCharacterIds()
    expect(after).toContain(newId)
    expect(after).toContain(fx.id) // 旧的也保留
    expect(after.length).toBe(2)
  })

  it('源 character 还在时 import 同名 → 新 id 自动 dedup', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    // 源不删，直接 import
    const imp = importCharacterPack(exp.buffer!)
    expect(imp.ok).toBe(true)
    // generateId 应 dedup（虽然实际取决于 character-store 实现）— 我们只验证
    // listCharacters 有 2 个名字相同的，且 id 不冲突
    const sources = listCharacters().filter((c) => c.name === 'Source')
    expect(sources.length).toBe(2)
    expect(sources[0]!.id).not.toBe(sources[1]!.id)
  })

  it('import 用 newName 覆盖', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!, { newName: '改名版' })
    expect(imp.ok).toBe(true)
    expect(imp.character!.name).toBe('改名版')
  })

  it('import 复制 soul/*.yaml', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const soulFile = join(characterSoulDir(imp.character!.id), 'identity.yaml')
    expect(existsSync(soulFile)).toBe(true)
    const content = readFileSync(soulFile, 'utf-8')
    expect(content).toContain('Source')
  })

  it('import emotional state + 重写 character_id', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const esFile = join(characterDir(imp.character!.id), 'emotional-state.json')
    expect(existsSync(esFile)).toBe(true)
    const es = JSON.parse(readFileSync(esFile, 'utf-8'))
    // 关键: character_id 应该是新 id 而不是 source id
    expect(es.character_id).toBe(imp.character!.id)
    expect(es.character_id).not.toBe(fx.id)
    // 其他字段保留
    expect(es.current_mood).toBe('happy')
    expect(es.topic_imprints['工作']).toBeDefined()
  })

  it('import includeEmotional=false → 不写 emotional-state.json', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!, { includeEmotional: false })
    expect(
      existsSync(join(characterDir(imp.character!.id), 'emotional-state.json')),
    ).toBe(false)
  })

  it('import thumb → 写到 thumbs/', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const thumbPath = join(charactersRoot(), '..', 'thumbs', `${imp.character!.id}.webp`)
    expect(existsSync(thumbPath)).toBe(true)
  })

  it('损坏 zip → ok=false', () => {
    const imp = importCharacterPack(Buffer.from('not a zip'))
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/zip/i)
  })

  it('P0 SEC C2: 输入 zip > 50 MB → 拒绝', () => {
    const huge = Buffer.alloc(51 * 1024 * 1024)
    const imp = importCharacterPack(huge)
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/过大|超限/)
  })

  it('P0 SEC C2: 空 buffer → 拒绝', () => {
    const imp = importCharacterPack(Buffer.alloc(0))
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/空/)
  })

  it('P0 SEC C1: 非法 filename 在 soul/ 内 → 跳过不写 (filename regex 拦截)', () => {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    zip.addFile(
      'meta.json',
      Buffer.from(
        JSON.stringify({
          version: '1.0',
          source_id: 'x',
          source_name: 'Test',
          exported_at: 0,
          contents: { soul: true, preferences: false, emotional: false, thumb: false },
        }),
      ),
    )
    zip.addFile(
      'soul/identity.yaml',
      Buffer.from(
        `name: T\nmaster: M\ncall_master_as: 主人\navatar:\n  model_dir: x\n  model_file: x.model3.json`,
      ),
    )
    // 恶意 entry: filename 含 ../ 或特殊字符 — 应该被 [a-zA-Z0-9_-]+ regex 拒
    // 注：adm-zip 会 normalize 一些路径，但 'soul/with..dots.yaml' 这种保留 soul/ 前缀
    // 且 filename 含 dots → 命中第二层防御
    zip.addFile('soul/with..attack.yaml', Buffer.from('attacker: payload'))
    zip.addFile('soul/has space.yaml', Buffer.from('also: bad'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const imp = importCharacterPack(zip.toBuffer())
    expect(imp.ok).toBe(true) // 主流程仍 ok (合法 soul/identity 在)
    // 非法 filename 不应被写
    const soulDir = `${charactersRoot()}/${imp.character!.id}/soul`
    expect(existsSync(`${soulDir}/with..attack.yaml`)).toBe(false)
    expect(existsSync(`${soulDir}/has space.yaml`)).toBe(false)
    // identity.yaml 合法应该写了
    expect(existsSync(`${soulDir}/identity.yaml`)).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('P0 SEC H1: 伪 SQLite memory.db → 拒绝写盘', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('FAKE_NOT_SQLITE_XXXX'))
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const imp = importCharacterPack(exp.buffer!)
    expect(imp.ok).toBe(true)
    expect(existsSync(join(characterDir(imp.character!.id), 'memory.db'))).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('P0 SEC H1: 真 SQLite magic header → 接受', () => {
    const fx = makeFixture()
    const realSqliteHeader = Buffer.concat([
      Buffer.from('SQLite format 3\0', 'binary'),
      Buffer.alloc(100),
    ])
    writeFileSync(join(characterDir(fx.id), 'memory.db'), realSqliteHeader)
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const imp = importCharacterPack(exp.buffer!)
    expect(existsSync(join(characterDir(imp.character!.id), 'memory.db'))).toBe(true)
  })

  it('P0 SEC H1: 伪 .webp 头 → 拒绝写', () => {
    const fx = makeFixture()
    // 覆盖 makeFixture 写的合法 webp，用伪 webp (PNG header 改名)
    const thumbsDir = join(charactersRoot(), '..', 'thumbs')
    writeFileSync(
      join(thumbsDir, `${fx.id}.webp`),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
    )
    const exp = exportCharacterPack(fx.id, { includeThumb: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const imp = importCharacterPack(exp.buffer!)
    const thumbPath = join(charactersRoot(), '..', 'thumbs', `${imp.character!.id}.webp`)
    expect(existsSync(thumbPath)).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('P0 SEC H1: 真 WebP RIFF....WEBP → 接受', () => {
    const fx = makeFixture()
    const validWebp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(100),
    ])
    const thumbDir = join(charactersRoot(), '..', 'thumbs')
    if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })
    writeFileSync(join(thumbDir, `${fx.id}.webp`), validWebp)
    const exp = exportCharacterPack(fx.id, { includeThumb: true })
    const imp = importCharacterPack(exp.buffer!)
    expect(
      existsSync(join(charactersRoot(), '..', 'thumbs', `${imp.character!.id}.webp`)),
    ).toBe(true)
  })

  it('P0 SEC M2: 超长 newName 截断到 64 字符', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const longName = 'x'.repeat(500)
    const imp = importCharacterPack(exp.buffer!, { newName: longName })
    expect(imp.ok).toBe(true)
    expect(imp.character!.name.length).toBeLessThanOrEqual(64)
  })

  it('zip 但缺 meta.json → 拒绝', () => {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    zip.addFile('soul/identity.yaml', Buffer.from('name: X'))
    const imp = importCharacterPack(zip.toBuffer())
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/meta\.json/)
  })

  it('zip 缺 identity.yaml → 拒绝（无法确定模型）', () => {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    zip.addFile(
      'meta.json',
      Buffer.from(
        JSON.stringify({
          version: '1.0',
          source_id: 'x',
          source_name: 'X',
          exported_at: 0,
          contents: { soul: false, preferences: false, emotional: false, thumb: false },
        }),
      ),
    )
    const imp = importCharacterPack(zip.toBuffer())
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/identity\.yaml/)
  })

  it('import memory.db 复制到新 characterDir', () => {
    const fx = makeFixture()
    // P0 SEC H1: 用合法 SQLite header
    const sqliteContent = Buffer.concat([
      Buffer.from('SQLite format 3\0', 'binary'),
      Buffer.from('ROUND_TRIP_MEMORY'),
    ])
    writeFileSync(join(characterDir(fx.id), 'memory.db'), sqliteContent)
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const imp = importCharacterPack(exp.buffer!)
    const newMem = join(characterDir(imp.character!.id), 'memory.db')
    expect(existsSync(newMem)).toBe(true)
    // 确认内容含 ROUND_TRIP_MEMORY 标记
    expect(readFileSync(newMem).toString()).toContain('ROUND_TRIP_MEMORY')
  })

  it('import includeMemory=false → 不复制 memory.db', () => {
    const fx = makeFixture()
    const sqliteContent = Buffer.concat([
      Buffer.from('SQLite format 3\0', 'binary'),
      Buffer.from('SKIP_ME'),
    ])
    writeFileSync(join(characterDir(fx.id), 'memory.db'), sqliteContent)
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const imp = importCharacterPack(exp.buffer!, { includeMemory: false })
    expect(existsSync(join(characterDir(imp.character!.id), 'memory.db'))).toBe(false)
  })

  it('round-trip: export → import → export 第二次内容字节一致', () => {
    const fx = makeFixture()
    const exp1 = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp1.buffer!)
    const exp2 = exportCharacterPack(imp.character!.id)
    // soul/identity.yaml + preferences.json + emotional 内容应一致 (除 character_id)
    const AdmZip = require('adm-zip')
    const z1 = new AdmZip(exp1.buffer!)
    const z2 = new AdmZip(exp2.buffer!)
    const id1 = z1.getEntry('soul/identity.yaml')!.getData().toString('utf-8')
    const id2 = z2.getEntry('soul/identity.yaml')!.getData().toString('utf-8')
    expect(id1).toBe(id2)
  })
})
