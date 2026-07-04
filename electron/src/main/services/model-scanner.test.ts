/**
 * model-scanner unit tests — tmpdir-based, no real model library required.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'luvu-model-scan-'))

vi.mock('./paths', () => ({
  getPaths: () => ({
    projectRoot: TEST_ROOT,
    userDataDir: join(TEST_ROOT, 'userData'),
    soulDir: join(TEST_ROOT, 'soul'),
    modelSearchPaths: [join(TEST_ROOT, 'models')],
    historyDbPath: join(TEST_ROOT, 'history.sqlite'),
  }),
}))

const { scanModels, toFileUrl } = await import('./model-scanner')

afterAll(() => {
  try { rmSync(TEST_ROOT, { recursive: true, force: true }) } catch { /* skip */ }
})

beforeEach(() => {
  // Clean up models dir between tests
  const modelsDir = join(TEST_ROOT, 'models')
  try { rmSync(modelsDir, { recursive: true, force: true }) } catch { /* skip */ }
})

function writeModel3(dir: string, name: string, refs: {
  moc?: string
  textures?: string[]
  motions?: Record<string, Array<{ File?: string }>>
  expressions?: Array<{ File: string }>
  physics?: string
} = {}): string {
  mkdirSync(dir, { recursive: true })
  const modelPath = join(dir, name)
  const json: Record<string, unknown> = {
    Version: 3,
    FileReferences: {
      Moc: refs.moc ?? 'model.moc3',
      Textures: refs.textures ?? ['texture.png'],
      // 默认含 Idle motion 引用 — probeModel3 的 complete 判定要求 motionCount >= 1
      // (默认 idle.motion3.json 文件已在下方 line 70 写入,这里只需声明 ref)
      Motions: refs.motions ?? { Idle: [{ File: 'idle.motion3.json' }] },
      Expressions: refs.expressions ?? [],
      Physics: refs.physics ?? '',
    },
    Groups: [],
    HitAreas: [],
  }
  writeFileSync(modelPath, JSON.stringify(json), 'utf-8')

  // Write dummy files so probeModel3 sees them
  if (refs.moc) {
    writeFileSync(join(dir, refs.moc), Buffer.alloc(100 * 1024)) // 100KB
  } else {
    writeFileSync(join(dir, 'model.moc3'), Buffer.alloc(100 * 1024))
  }
  if (refs.textures) {
    for (const t of refs.textures) {
      writeFileSync(join(dir, t), Buffer.alloc(300 * 1024)) // 300KB
    }
  } else {
    writeFileSync(join(dir, 'texture.png'), Buffer.alloc(300 * 1024))
  }
  // default motion file
  writeFileSync(join(dir, 'idle.motion3.json'), Buffer.alloc(1024))
  if (refs.motions) {
    for (const arr of Object.values(refs.motions)) {
      for (const m of arr) {
        if (m.File) writeFileSync(join(dir, m.File), Buffer.alloc(1024))
      }
    }
  }
  if (refs.expressions) {
    for (const e of refs.expressions) {
      if (e.File) writeFileSync(join(dir, e.File), Buffer.alloc(512))
    }
  }
  if (refs.physics) {
    writeFileSync(join(dir, refs.physics), Buffer.alloc(512))
  }

  return modelPath
}

describe('scanModels', () => {
  it('空目录 → 返回空数组', () => {
    const modelsDir = join(TEST_ROOT, 'models')
    mkdirSync(modelsDir, { recursive: true })
    const results = scanModels()
    expect(results).toEqual([])
  })

  it('发现单个有效 model3.json', () => {
    const dir = join(TEST_ROOT, 'models', 'HuTao')
    writeModel3(dir, 'Hu Tao.model3.json', {
      motions: { Idle: [{ File: 'idle.motion3.json' }] },
    })
    const results = scanModels()
    expect(results.length).toBe(1)
    expect(results[0]!.model_file).toBe('Hu Tao.model3.json')
    expect(results[0]!.cubism).toBe('cubism4')
    expect(results[0]!.meta?.complete).toBe(true)
  })

  it('cache hit: 再次扫描不重新 probe（mtime 不变）', () => {
    const dir = join(TEST_ROOT, 'models', 'Cached')
    writeModel3(dir, 'cached.model3.json')
    const r1 = scanModels()
    expect(r1.length).toBe(1)
    // 第二次扫描应走缓存
    const r2 = scanModels()
    expect(r2.length).toBe(1)
    expect(r2[0]!.model_file).toBe('cached.model3.json')
  })

  it('cache miss: 修改 model3.json 后重新 probe', () => {
    const dir = join(TEST_ROOT, 'models', 'Mutated')
    const path = writeModel3(dir, 'mutated.model3.json')
    const r1 = scanModels()
    expect(r1[0]!.meta?.complete).toBe(true)

    // 破坏模型（删 moc）
    writeFileSync(path, JSON.stringify({ Version: 3, FileReferences: {} }), 'utf-8')
    const r2 = scanModels()
    expect(r2[0]!.meta?.complete).toBe(false)
  })

  it('损坏的 model3.json → probeModel3 返回不完整 meta', () => {
    const dir = join(TEST_ROOT, 'models', 'Broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.model3.json'), 'not json at all')
    const results = scanModels()
    expect(results.length).toBe(1)
    expect(results[0]!.meta?.has_core).toBe(false)
    expect(results[0]!.meta?.complete).toBe(false)
    expect(results[0]!.meta?.reason).toMatch(/解析失败/)
  })

  it('跳过 . 开头的隐藏目录', () => {
    const dir = join(TEST_ROOT, 'models', '.hidden')
    mkdirSync(dir, { recursive: true })
    writeModel3(dir, 'hidden.model3.json')
    const results = scanModels()
    expect(results.length).toBe(0)
  })

  it('toFileUrl 生成 luvu-asset://localhost/ URL', () => {
    // 实现用 localhost 占位 host:Chromium 把 `luvu-asset:///Users/...` 的
    // 首 segment 当 host 丢失大小写,加 localhost 让 pathname 保留全路径
    const url = toFileUrl('/Users/test/models/Hu Tao/Hu Tao.model3.json')
    expect(url.startsWith('luvu-asset://localhost/')).toBe(true)
    expect(url).toContain('Hu%20Tao')
  })
})
