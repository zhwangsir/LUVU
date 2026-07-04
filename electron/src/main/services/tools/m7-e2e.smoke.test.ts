/**
 * M7 创造能力 — 真实端到端 smoke test
 *
 *   SMOKE_TEST=1 pnpm -F luvu-electron test --run m7-e2e.smoke
 *
 * 默认 skip。开启时:
 *   - 读 ~/.luvu/config.json 真 ComfyUI endpoint
 *   - 真调 buildStickerWorkflow + ComfyClient.generate
 *   - 真出图(6-30s 等待)+ 真下载到 ~/.luvu/stickers/
 *   - 验证文件存在 + size > 0 + 真是 PNG
 *
 * 这是把 12 commits 的 M7 工程承诺 →"运行证据"的关键验证。
 * 不依赖 LLM(LLM 决策路径单测已经覆盖,这里只验证 ComfyUI 出图链路)。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SHOULD_RUN = process.env.SMOKE_TEST === '1'

describe.skipIf(!SHOULD_RUN)('M7 真出图 e2e smoke', () => {
  it('真调 ComfyUI 出一张 happy sticker + 落盘 + PNG 头校验', async () => {
    // 直接读用户真实 config(不 mock loadConfig — 这是 e2e 的本质)
    const configPath = join(homedir(), '.luvu', 'config.json')
    if (!existsSync(configPath)) {
      throw new Error('~/.luvu/config.json 不存在 — 先做 onboarding')
    }
    // reviewer HIGH-1:JSON.parse throw 在 vitest 里报 "uncaught exception" 而非清晰 fail
    let cfg: { comfyui_endpoint?: string }
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { comfyui_endpoint?: string }
    } catch (e) {
      throw new Error(
        `config.json 格式非法: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (!cfg.comfyui_endpoint) {
      throw new Error('comfyui_endpoint 未配置')
    }
    // 探活
    const stat = await fetch(`${cfg.comfyui_endpoint}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    })
    expect(stat.ok).toBe(true)

    // 真 import 项目代码(不 mock ComfyClient)
    const { ComfyClient } = await import('../comfyui/client')
    const { buildStickerWorkflow } = await import('../comfyui/workflows')

    const client = new ComfyClient({ endpoint: cfg.comfyui_endpoint })
    const wf = buildStickerWorkflow({ emotion: 'happy', extraPrompt: 'm7 smoke test' })

    const stickersDir = join(homedir(), '.luvu', 'stickers')
    const before = existsSync(stickersDir)
      ? readdirSync(stickersDir).filter((f) => /\.(png|jpg|webp)$/i.test(f))
      : []

    console.log(`[m7-e2e] 提交 sticker workflow,等 ComfyUI 出图...`)
    const result = await client.generate(wf, {
      maxWaitMs: 5 * 60_000,
      onProgress: (state) => console.log(`[m7-e2e] state=${state}`),
    })
    expect(result.images.length).toBeGreaterThanOrEqual(1)
    const firstImg = result.images[0]!
    expect(firstImg.filename).toMatch(/\.(png|jpg|webp)$/i)
    console.log(`[m7-e2e] ComfyUI 出了 ${result.images.length} 张图 prompt_id=${result.promptId}`)

    // 下载到本地
    const destFile = join(stickersDir, `m7_smoke_${Date.now()}_${firstImg.filename}`)
    // 确保 dir 存在
    if (!existsSync(stickersDir)) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(stickersDir, { recursive: true })
    }
    await client.downloadImage(firstImg.filename, firstImg.subfolder, firstImg.type, destFile)

    // 验证落盘 + PNG 头(89 50 4E 47)
    expect(existsSync(destFile)).toBe(true)
    const fileStat = statSync(destFile)
    expect(fileStat.size).toBeGreaterThan(1024) // 至少 1KB
    const buf = readFileSync(destFile)
    // PNG magic header
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50)
    expect(buf[2]).toBe(0x4e)
    expect(buf[3]).toBe(0x47)

    // 跟之前 stickers 数对比,确认确实新增
    const after = readdirSync(stickersDir).filter((f) => /\.(png|jpg|webp)$/i.test(f))
    expect(after.length).toBeGreaterThan(before.length)

    console.log(
      `[m7-e2e] ✅ 完整通过:${destFile} (${(fileStat.size / 1024).toFixed(1)} KB,真 PNG)`,
    )
    console.log(`[m7-e2e] stickers 目录 ${before.length} → ${after.length} 张图`)
  }, 360_000) // 6 分钟 timeout(出图最长 5 分钟 + 下载 + 校验)
})
