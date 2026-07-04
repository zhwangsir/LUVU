/**
 * 复用的 main service 测试基础设施 — tmp 目录隔离 + electron mock。
 *
 * 用法 (必须 hoist 在被测 service import 之前):
 *   import { makeTmpUserData, mockElectronModule } from '../test-helpers/electron-mock'
 *   const ctx = makeTmpUserData()
 *   vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
 *   vi.mock('../paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))
 *   const { loadConfig } = await import('../config-store')
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface MockElectronContext {
  /** mock 的 userData 目录绝对路径（每 test suite 自动创建/清理） */
  userDataDir: string
  /** test suite 结束清理 */
  cleanup(): void
}

/** 创建临时 userData 目录，返回 cleanup 函数 */
export function makeTmpUserData(): MockElectronContext {
  const dir = mkdtempSync(join(tmpdir(), 'luvu-test-'))
  return {
    userDataDir: dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* test cleanup best-effort */
      }
    },
  }
}

/** 生成 vi.mock('electron') 用的 module factory */
export function mockElectronModule(userDataDir: string): {
  app: {
    isPackaged: boolean
    getPath: (key: string) => string
    getVersion: () => string
  }
} {
  return {
    app: {
      isPackaged: false,
      getPath: () => userDataDir,
      getVersion: () => '0.0.0-test',
    },
  }
}

/**
 * 生成 vi.mock('../paths' / '../../services/paths') 用的固定 paths
 * 注意：paths.ts cache 单例，必须 mock 整个 module 才能避免污染真实 ~/.luvu。
 */
export function mockPaths(userDataDir: string): {
  projectRoot: string
  userDataDir: string
  soulDir: string
  modelSearchPaths: string[]
  historyDbPath: string
} {
  return {
    projectRoot: userDataDir,
    userDataDir,
    soulDir: join(userDataDir, 'soul'),
    modelSearchPaths: [join(userDataDir, 'models')],
    historyDbPath: join(userDataDir, 'history.sqlite'),
  }
}
