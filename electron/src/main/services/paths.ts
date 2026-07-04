/**
 * 路径解析 —— LUVU 数据目录、soul 目录、模型目录。
 *
 * 用户数据目录优先级（仿 src-tauri/src/infra/config.rs）：
 *   1. ~/.luvu/
 *   2. Electron 默认 app.getPath('userData')
 *
 * Soul 目录优先级：
 *   1. ~/.luvu/soul/
 *   2. <projectRoot>/soul/
 *   3. 兜底默认（内置 default soul）
 */
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface LuvuPaths {
  /** 项目根（开发期为 git 仓库根；生产期为 resources/） */
  projectRoot: string
  /** 用户数据目录（~/.luvu 优先） */
  userDataDir: string
  /** soul 配置目录 */
  soulDir: string
  /** 项目内置策展模型库（最优质模型的唯一归属地，标 builtin/recommended） */
  modelsLibraryDir: string
  /** 模型搜索路径列表（带优先级） */
  modelSearchPaths: string[]
  /** 历史与记忆 SQLite 文件 */
  historyDbPath: string
}

let cached: LuvuPaths | null = null

export function getPaths(): LuvuPaths {
  if (cached) return cached

  const home = homedir()
  const homeData = join(home, '.luvu')
  const userDataDir = ensureDir(existsSync(homeData) ? homeData : app.getPath('userData'))

  // 项目根：开发期为 cwd，生产期 process.resourcesPath
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : resolve(__dirname, '..', '..', '..')

  // soul 目录：~/.luvu/soul → projectRoot/soul → projectRoot/../soul（仓库根）
  const candidateSoul = [
    join(userDataDir, 'soul'),
    join(projectRoot, 'soul'),
    join(projectRoot, '..', 'soul'),
  ]
  const soulDir = candidateSoul.find((p) => existsSync(p)) ?? candidateSoul[0]!

  // 模型搜索路径优先级（v0.22：策展后收敛到「项目内部唯一源」）：
  //   1. 项目内 models-library —— 已从 17GB 外部源精挑 765 个最优质模型复制进来，
  //      作为内置资源（标 builtin → complete 即 recommended）。
  //   2. 项目根、仓库根 —— 兜底 demo（SKIP_DIRS 含 'electron'，不会重扫 models-library）。
  // 不再扫描 ~/.luvu/models（外部全量库软链）与旧的 Live2d-model-master：
  //   立绘路径现在指向项目内部，外部源文件夹保持原样、只是不再被扫描。
  // models-library 作为独立 root → IP 在 depth=1, character_dir 在 depth=2，恰好符合 MAX_DEPTH=3
  const modelsLibraryDir = app.isPackaged
    ? join(projectRoot, 'models-library') // 打包后跟 resources 同级
    : resolve(projectRoot, 'electron', 'models-library') // dev: electron/models-library
  const modelSearchPaths = uniq([
    modelsLibraryDir,
    projectRoot,
    resolve(projectRoot, '..'),
  ])

  cached = {
    projectRoot,
    userDataDir,
    soulDir,
    modelsLibraryDir,
    modelSearchPaths,
    historyDbPath: join(userDataDir, 'history.sqlite'),
  }
  return cached!
}

/**
 * 确保目录存在(不存在则递归创建),返回绝对路径。
 * v0.21:export 后供 ipc/comfyui.ts / tools/builtin.ts 共用,消重 3 处副本。
 */
export function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr))
}
