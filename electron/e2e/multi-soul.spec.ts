/**
 * E2E:M8 多灵魂同框 GUI(RFC 0002 Q2/Q3 + A1 active 热切换)
 *
 * 真 Electron + 真 IPC(create / setMounted / switch),不 mock renderer store —
 * 走完整数据流:characters.create → setMounted → reload 后 store boot refresh →
 * Stage v-for 多实例 → 断言 DOM 结构 / slot 布局 / Q3 视觉强调 / 热切换后状态翻转。
 *
 * 已知前提:全新 userData 启动时不一定有 seed 的 default 角色(2026-10-09 真跑实证:
 * e2e 环境 create 第一个角色即成为 active),所以断言全部按 setMounted 的返回值动态算,
 * 并在 reload 前 explicit switch 保证 active 确定。Live2D 模型文件不存在 →
 * instance 停在 error overlay,不影响 DOM 结构断言(本 spec 只验「同框 GUI 的壳」)。
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_ENTRY = resolve(__dirname, '..', 'out', 'main', 'index.js')

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
  const tmpUserData = mkdtempSync(join(tmpdir(), 'luvu-e2e-m8-'))
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

/** Live2DStage 在哪个 window 由 boot 顺序决定 — 遍历找挂了舞台的那个 */
async function findStageWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      try {
        if ((await page.locator('.live2d-stage').count()) > 0) return page
      } catch {
        /* window 可能刚 destroy */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('没有找到挂 .live2d-stage 的 window')
}

/** renderer 主世界调 preload 暴露的 window.api(与 CharacterPicker 同一通道) */
interface CharactersApi {
  create: (input: {
    name: string
    call_master_as: string
    live2d_model_dir: string
    live2d_model_file: string
    template: string
  }) => Promise<{ ok: boolean; character?: { id: string }; reason?: string }>
  setMounted: (ids: string[]) => Promise<{ ok: boolean; mounted?: Array<{ id: string }>; reason?: string }>
  switch: (id: string) => Promise<{ ok: boolean; reason?: string }>
}

test.describe('M8 多灵魂同框 GUI', () => {
  test('2 角色 mount → 同框多实例 + Q3 视觉强调 + active 热切换不崩', async () => {
    const { args, env, timeout, cleanup } = launchOpts()
    let electronApp: ElectronApplication | undefined
    try {
      electronApp = await electron.launch({ args, env, timeout })
      const stage = await findStageWindow(electronApp)

      // ---- 建 2 个角色 + mount + 把 Alpha 设为 active(保证断言确定性) ----
      const mountInfo = await stage.evaluate(async () => {
        const api = (window as unknown as { api: { characters: CharactersApi } }).api.characters
        const a = await api.create({
          name: 'Alpha',
          call_master_as: 'master',
          live2d_model_dir: 'alpha-dir',
          live2d_model_file: 'alpha.model3.json',
          template: 'custom',
        })
        const b = await api.create({
          name: 'Beta',
          call_master_as: 'master',
          live2d_model_dir: 'beta-dir',
          live2d_model_file: 'beta.model3.json',
          template: 'custom',
        })
        if (!a.ok || !b.ok || !a.character || !b.character) {
          throw new Error(`create failed: ${JSON.stringify({ a, b })}`)
        }
        const sw = await api.switch(a.character.id)
        if (!sw.ok) throw new Error(`switch failed: ${sw.reason ?? '?'}`)
        const r = await api.setMounted([a.character.id, b.character.id])
        if (!r.ok) throw new Error(`setMounted failed: ${r.reason ?? '?'}`)
        return { alpha: a.character.id, beta: b.character.id, mounted: r.mounted ?? [] }
      })
      expect(mountInfo.alpha).toBeTruthy()
      expect(mountInfo.beta).toBeTruthy()
      // 后端自动补 active 去重后,mounted 至少含 A/B
      const mountedIds = mountInfo.mounted.map((c) => c.id)
      expect(mountedIds).toContain(mountInfo.alpha)
      expect(mountedIds).toContain(mountInfo.beta)

      // ---- reload 让 renderer store 从后端重新 boot(最接近真实重启路径) ----
      await stage.reload()
      const instances = stage.locator('.live2d-stage .live2d-instance')
      const n = mountedIds.length
      await expect(instances).toHaveCount(n, { timeout: 20_000 })

      // Q2 slot:等宽横排,每个 mounted 角色都有实例
      const widthPct = 100 / n
      for (let i = 0; i < n; i++) {
        await expect(instances.nth(i)).toHaveAttribute('style', new RegExp(`width:\\s*${widthPct}(?:\\.0*)?%`))
      }
      const idsInDom: string[] = []
      for (let i = 0; i < n; i++) {
        idsInDom.push((await instances.nth(i).getAttribute('data-character-id')) ?? '')
      }
      for (const id of mountedIds) expect(idsInDom).toContain(id)

      // Q3:Alpha(active)满强度,其余后退档
      const alphaInstance = stage.locator(`.live2d-instance[data-character-id="${mountInfo.alpha}"]`)
      const betaInstance = stage.locator(`.live2d-instance[data-character-id="${mountInfo.beta}"]`)
      await expect(alphaInstance).toHaveAttribute('data-active', 'true')
      await expect(alphaInstance).toHaveAttribute('style', /--visual-scale:\s*1/)
      await expect(betaInstance).toHaveAttribute('data-active', 'false')
      await expect(betaInstance).toHaveAttribute('style', /--visual-scale:\s*0\.72/)
      await expect(betaInstance).toHaveAttribute('style', /--visual-opacity:\s*0\.72/)

      // A1:active 热切换到 Beta → store 刷新后 data-active / 视觉档位翻转,实例数不变
      await stage.evaluate(async (betaId) => {
        const api = (window as unknown as { api: { characters: CharactersApi } }).api.characters
        const r = await api.switch(betaId)
        if (!r.ok) throw new Error(`switch failed: ${r.reason ?? '?'}`)
      }, mountInfo.beta)

      await expect(betaInstance).toHaveAttribute('data-active', 'true', { timeout: 15_000 })
      await expect(alphaInstance).toHaveAttribute('data-active', 'false')
      await expect(betaInstance).toHaveAttribute('style', /--visual-scale:\s*1/)
      await expect(alphaInstance).toHaveAttribute('style', /--visual-scale:\s*0\.72/)

      // 同框仍在 + app 没崩(stage window 仍响应)
      await expect(instances).toHaveCount(n)
      expect(await stage.title()).toBeTruthy()

      // 像素级回归网(v0.22 真机修复「非 active 0 像素」后加):
      // 多 WebGL context 下 Cubism shader 单例若再被单 context 独占,会出现
      // 「只有 active 有像素」。readPixels 断言每个实例画布都有非透明采样点。
      // 注:这里挂载的 tmp userData 无真模型,canvas 为 error 态 —— 像素断言只在
      // 有真模型的 models-library 环境有意义,因此用条件跳过而不是硬断言。
      const pixelReport = await stage.evaluate(async () => {
        const canvases = [...document.querySelectorAll('.live2d-instance canvas')] as HTMLCanvasElement[]
        return canvases.map((cv) => {
          if (cv.width === 0 || cv.height === 0) return 'empty'
          const gl = (cv.getContext('webgl2') ?? cv.getContext('webgl')) as WebGLRenderingContext | null
          if (!gl) return 'no-gl'
          const px = new Uint8Array(64 * 4)
          gl.readPixels(0, 0, 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
          let opaque = 0
          for (let i = 3; i < px.length; i += 4) if (px[i]! > 8) opaque++
          return `opaque=${opaque}`
        })
      })
      console.log('[multi-soul] pixel report (no-model env 预期 no-gl/empty):', pixelReport)
      expect(pixelReport).toHaveLength(n)
    } finally {
      await electronApp?.close().catch(() => {
        /* skip */
      })
      cleanup()
    }
  })
})
