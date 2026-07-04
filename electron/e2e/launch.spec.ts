/**
 * E2E smoke:Electron app launch + main window 存在 + main process IPC ready
 *
 * 是把"M7 端到端运行证据"从 main process log 升级到 Playwright 可验证的最小 spec。
 * 后续 specs(对话发送 / 模型选择 / 出图触发 / agent_task)在此 file 之外加。
 */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// ESM 下没有 __dirname,从 import.meta.url 推导
const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_ENTRY = resolve(__dirname, '..', 'out', 'main', 'index.js')

/**
 * 每个 test 用独立的 userData 临时目录(reviewer M-4):
 * - 避免跟主人的 ~/.luvu 冲突(读真 config 也读真 history.sqlite)
 * - 避免 single-instance lock 阻塞 future 并行(若 workers 升)
 * - 测试完自动清,留 logs 太多
 */
/** Playwright launch.env 类型是 `{[key: string]: string}`,严格不接 undefined。
 * Node process.env 是 `{[key: string]: string | undefined}`,需过滤。
 */
function filterEnv(env: NodeJS.ProcessEnv): { [key: string]: string } {
  const out: { [key: string]: string } = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function launchOpts(): {
  args: string[]
  env: { [key: string]: string }
  timeout: number
  cleanup: () => void
} {
  const tmpUserData = mkdtempSync(join(tmpdir(), 'luvu-e2e-'))
  return {
    args: [ELECTRON_ENTRY, `--user-data-dir=${tmpUserData}`],
    env: { ...filterEnv(process.env), NODE_ENV: 'production', LUVU_DEBUG: '0' },
    timeout: 30_000,
    cleanup: () => {
      try {
        rmSync(tmpUserData, { recursive: true, force: true })
      } catch {
        /* skip */
      }
    },
  }
}

test.describe('app launch smoke', () => {
  test('Electron main + renderer window 启动成功', async () => {
    const { args, env, timeout, cleanup } = launchOpts()
    let electronApp: ElectronApplication | undefined
    try {
      electronApp = await electron.launch({ args, env, timeout })

      // 1. main process IPC bridge 工作:isPackaged 必须是 false(dev 模式 launch out/)
      //    reviewer M-3:typeof === 'boolean' 是 tautological,改严格值
      const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged)
      expect(isPackaged).toBe(false)

      // 2. firstWindow ready(立绘 BrowserWindow 已挂)
      const window = await electronApp.firstWindow({ timeout: 15_000 })
      expect(window).toBeDefined()

      // 3. 验证 BrowserWindow 至少 1 个 + main process 健康
      //    reviewer H-1:之前用 `.catch(()=>true)` 会让 crash 静默通过,删除该 false-negative
      const winCount = await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().length,
      )
      expect(winCount).toBeGreaterThanOrEqual(1)

      // 4. title 接口可达(透明窗口 title 不重要,只确保 IPC bridge 健康)
      const title = await window.title()
      expect(typeof title).toBe('string')
    } finally {
      // reviewer M-1:try/finally 保证 close 即使 assertion 失败也跑,避免 Electron 进程泄漏
      await electronApp?.close().catch(() => {
        /* skip */
      })
      cleanup()
    }
  })

  test('app metadata reachable + main process IPC up', async () => {
    const { args, env, timeout, cleanup } = launchOpts()
    let electronApp: ElectronApplication | undefined
    try {
      electronApp = await electron.launch({ args, env, timeout })

      // 注意:dev 模式(launch out/main/index.js)下 app.getName()/getVersion()
      // 返回 Electron binary 自带元数据("Electron" / "33.x.x"),只有 packaged .app
      // 才返 productName "LUVU" + package.json version。
      // 因此这里**不**绑死值,只验证 metadata 接口可达 + ready=true。
      // reviewer M-2:locale 之前 collect 但没 assert,删掉。
      const meta = await electronApp.evaluate(({ app }) => ({
        name: app.getName(),
        version: app.getVersion(),
        ready: app.isReady(),
      }))
      expect(meta.name).toBeTruthy()
      // reviewer L-1:加 end anchor 严格 semver(允许 pre-release suffix)
      expect(meta.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
      expect(meta.ready).toBe(true)
    } finally {
      await electronApp?.close().catch(() => {
        /* skip */
      })
      cleanup()
    }
  })
})
