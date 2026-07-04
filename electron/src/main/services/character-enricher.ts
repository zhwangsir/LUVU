/**
 * Character Enricher（v0.12）— 给所有 1389 个模型生成「中文名 + 1 句介绍」。
 *
 * 流程：
 *   1. 遍历所有 model（按 character_id 去重，4 个 outfit 只生成 1 次）
 *   2. 对每个 character 用 LLM 推：
 *      - 输入：IP 名 + IP 介绍（来自 ip-knowledge）+ 角色目录拼音/英文 + 路径上下文
 *      - 输出：JSON {chinese_name, intro_one_line, tags}
 *   3. 缓存到 ~/.luvu/character-enriched.json，key = character_id
 *   4. UI 卡片直接 lookup 显示
 *
 * 速率：本地 LM Studio 一次 1-2s × 1400 ≈ 30-50 分钟，可后台跑
 * 失败的 character 标 .failed，跳过避免重试浪费
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import type { ChatMessage } from '@shared/types'
import { getPaths } from './paths'
import { loadConfig } from './config-store'
import { buildProvider } from './llm'
import { matchIp } from './ip-knowledge'
import { scanModels } from './model-scanner'

export interface CharacterEnrichment {
  character_id: string
  chinese_name: string
  intro_one_line: string
  tags: string[]
  /** 给前端显示的 source dir（取 cluster 第一个 model 的 dir） */
  source_dir: string
  enriched_at: number
}

interface EnrichedFile {
  version: 1
  entries: Record<string, CharacterEnrichment>
  failed: Record<string, string>
}

function filePath(): string {
  return join(getPaths().userDataDir, 'character-enriched.json')
}

export function load(): EnrichedFile {
  const p = filePath()
  if (!existsSync(p)) return { version: 1, entries: {}, failed: {} }
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as EnrichedFile
    if (!data.entries) data.entries = {}
    if (!data.failed) data.failed = {}
    return data
  } catch {
    return { version: 1, entries: {}, failed: {} }
  }
}

function save(f: EnrichedFile): void {
  try {
    writeFileSync(filePath(), JSON.stringify(f, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[char-enricher] save failed', e)
  }
}

export function getAll(): Record<string, CharacterEnrichment> {
  return load().entries
}

export function getOne(characterId: string): CharacterEnrichment | null {
  return load().entries[characterId] ?? null
}

export function clearAll(): void {
  save({ version: 1, entries: {}, failed: {} })
}

interface EnrichProgress {
  total: number
  done: number
  failed: number
  current?: string
}

export type ProgressCallback = (p: EnrichProgress) => void

/**
 * 跑全量 enrichment。已 enriched / failed 的 character 跳过。
 * 失败 5 次连续跳出（避免 LLM 完全挂时白跑 1400 次）。
 */
export async function enrichAll(onProgress: ProgressCallback, abortSignal?: AbortSignal): Promise<void> {
  const cfg = loadConfig()
  if (!cfg.llm_model || !cfg.llm_provider || !cfg.llm_endpoint) {
    throw new Error('LLM 未配置 — 在设置面板配 llm_provider/endpoint/model')
  }

  // 收集 unique character_id（每个 cluster 取代表 model）
  const models = scanModels()
  const byChar = new Map<string, (typeof models)[number]>()
  for (const m of models) {
    if (m.cubism !== 'cubism4' || !m.meta?.has_core) continue
    const cid = m.meta?.character_id
    if (!cid) continue
    if (!byChar.has(cid)) byChar.set(cid, m)
  }

  const enriched = load()
  const allIds = [...byChar.keys()]
  // 跳过已 enriched / 已 failed
  const todo = allIds.filter((cid) => !(cid in enriched.entries) && !(cid in enriched.failed))
  const state: EnrichProgress = { total: todo.length, done: 0, failed: 0 }
  onProgress({ ...state })

  if (todo.length === 0) {
    console.log('[char-enricher] nothing to do — all enriched or failed')
    return
  }

  const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)
  let consecutiveFails = 0

  for (const cid of todo) {
    if (abortSignal?.aborted) {
      console.log('[char-enricher] aborted by user')
      break
    }
    const m = byChar.get(cid)!
    state.current = m.dir
    onProgress({ ...state })

    const ip = matchIp(m.dir)
    const dirName = basename(m.dir)
    const parentDirName = basename(dirname(m.dir))
    const ipName = ip ? ip.name : '未知 IP'
    const ipIntro = ip ? ip.intro : ''
    const motionCount = m.meta?.motion_count ?? 0

    const userPrompt = [
      `你是 Live2D 模型档案专员。给一个 character 取「中文名 + 1 句介绍」。`,
      ``,
      `# 输入`,
      `IP 名: ${ipName}`,
      `IP 介绍: ${ipIntro}`,
      `角色目录名（拼音/英文/罗马音）: ${dirName}`,
      `父目录名: ${parentDirName}`,
      `动作数: ${motionCount}`,
      ``,
      `# 任务`,
      `推测这个 character 在该 IP 里是哪个角色，给出：`,
      `- chinese_name: 中文常见叫法（如果拼音是「fubuki」→「白上吹雪」）`,
      `- intro_one_line: 25-50 字一句话介绍角色身份+定位+性格`,
      `- tags: 1-3 个标签（如 ["萝莉", "治愈", "草元素"]）`,
      ``,
      `如果实在推不出来（IP 不认识 / 拼音太晦涩），chinese_name 直接用拼音转中文音译，intro 写「来自 \${ipName} 的角色」即可。`,
      ``,
      `严格 JSON 输出（无 markdown 围栏）：`,
      `{"chinese_name":"...","intro_one_line":"...","tags":["...","..."]}`,
    ].join('\n')

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是 Live2D 模型档案专员，简洁推测角色身份。' },
        { role: 'user', content: userPrompt },
      ]
      let buf = ''
      let done = false
      let err: string | null = null
      await provider.chatStream(
        messages,
        { model: cfg.llm_model, temperature: 0.4, max_tokens: 400 },
        (evt) => {
          if (evt.delta) buf += evt.delta
          if (evt.error) err = evt.error
          if (evt.done) done = true
        },
      )
      if (err) throw new Error(err)
      if (!done || !buf) throw new Error('LLM 无响应')

      const cleaned = buf.replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim()
      const first = cleaned.indexOf('{')
      const last = cleaned.lastIndexOf('}')
      if (first === -1 || last <= first) throw new Error(`非 JSON: ${cleaned.slice(0, 100)}`)
      const parsed = JSON.parse(cleaned.slice(first, last + 1)) as {
        chinese_name?: string
        intro_one_line?: string
        tags?: string[]
      }
      const entry: CharacterEnrichment = {
        character_id: cid,
        chinese_name: String(parsed.chinese_name ?? dirName).slice(0, 30),
        intro_one_line: String(parsed.intro_one_line ?? '').slice(0, 120),
        tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map((t) => String(t).slice(0, 20)).slice(0, 5),
        source_dir: m.dir,
        enriched_at: Date.now(),
      }
      enriched.entries[cid] = entry
      delete enriched.failed[cid]
      consecutiveFails = 0
    } catch (e) {
      enriched.failed[cid] = String(e).slice(0, 200)
      state.failed++
      consecutiveFails++
      console.warn(`[char-enricher] ${cid} (${m.dir}) failed:`, e)
      if (consecutiveFails >= 5) {
        console.error('[char-enricher] 5 连续失败 — 中止（LLM 可能挂了）')
        break
      }
    }
    state.done++
    onProgress({ ...state })

    // 每 10 个保存一次（防中途崩了丢失进度）
    if (state.done % 10 === 0) save(enriched)
  }

  delete state.current
  save(enriched)
  onProgress({ ...state })
  console.log(`[char-enricher] DONE: ${state.done}/${state.total} enriched, ${state.failed} failed`)
}
