/**
 * 加载 soul/ 配置目录（identity.yaml / personality.yaml / learned_traits.yaml / core_memories.yaml）。
 *
 * fs 读取 + yaml 解析在这里完成；合并 + system prompt 渲染 → @luvu/soul-loader（纯函数包）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { SoulConfig } from '@shared/types'
import {
  buildSystemPrompt as buildSystemPromptPure,
  mergeSoulPartials,
  mergeWithDefaults,
  DEFAULT_SOUL,
  isLegacyV01Schema,
  migrateV01ToV2,
  type LegacySoulV01,
} from '@luvu/soul-loader'
import { getPaths } from './paths'
import { getActiveCharacter, characterSoulDir } from './character-store'
import { loadEmotionalState } from './emotional-state/store'
import { emotionalStateToPromptFragment } from './emotional-state/text'

export interface LoadedSoul {
  config: SoulConfig
  systemPrompt: string
  sourceFiles: string[]
}

/** soul 目录里 4 个 partial yaml 文件名 — 与 SoulEditor.vue 写盘端对齐 */
const SOUL_PARTIAL_FILES = {
  identity: 'identity.yaml',
  personality: 'personality.yaml',
  learnedTraits: 'learned_traits.yaml',
  coreMemories: 'core_memories.yaml',
} as const

/** v0.13 security: 用 JSON_SCHEMA 防 !!js/* 标签注入 */
function safeLoadYaml(filePath: string): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch (e) {
    console.warn(`[soul] failed to parse ${filePath}:`, e)
  }
  return undefined
}

export function loadSoul(): LoadedSoul {
  const paths = getPaths()
  // v0.14: 优先用当前 active character 的 soul 目录；fallback 用全局
  const active = getActiveCharacter()
  const activeSoul = active ? characterSoulDir(active.id) : null
  const dir = activeSoul && existsSync(activeSoul) ? activeSoul : paths.soulDir

  const sourceFiles: string[] = []
  const partials: Parameters<typeof mergeSoulPartials>[0] = {}

  for (const [key, fileName] of Object.entries(SOUL_PARTIAL_FILES) as Array<
    [keyof typeof SOUL_PARTIAL_FILES, string]
  >) {
    const fp = join(dir, fileName)
    if (!existsSync(fp)) continue
    const parsed = safeLoadYaml(fp)
    if (parsed) {
      partials[key] = parsed
      sourceFiles.push(fp)
    }
  }

  let config: SoulConfig

  if (sourceFiles.length === 0) {
    // 若一个 yaml 都没读到，尝试单文件 default.yaml
    let singleFile: Record<string, unknown> | undefined
    for (const candidate of [
      join(dir, 'default.yaml'),
      join(paths.projectRoot, 'default.yaml'),
      join(paths.projectRoot, '..', 'default.yaml'),
    ]) {
      if (existsSync(candidate)) {
        const parsed = safeLoadYaml(candidate)
        if (parsed) {
          singleFile = parsed
          sourceFiles.push(candidate)
          break
        }
      }
    }
    const base: SoulConfig = JSON.parse(JSON.stringify(DEFAULT_SOUL))
    if (singleFile) {
      // P5: 老 v0.1 schema 自动迁移 → v2.0 partials → 合并
      if (isLegacyV01Schema(singleFile)) {
        console.log('[soul] detected legacy v0.1 schema → auto migrating to v2.0')
        const migrated = migrateV01ToV2(singleFile as LegacySoulV01)
        config = mergeSoulPartials(migrated)
      } else {
        config = mergeWithDefaults(base, singleFile)
      }
    } else {
      config = base
    }
  } else {
    config = mergeSoulPartials(partials)
  }

  const systemPrompt = buildSystemPrompt(config)
  return { config, systemPrompt, sourceFiles }
}

/**
 * 在 package 纯函数之上挂 MCP tools 描述 + 情感状态切片
 * （main-process 独有副作用：从 mcp-registry / character-store 拉数据）。
 */
function buildSystemPrompt(soul: SoulConfig): string {
  let toolsDescription = ''
  try {
    // 用 require 延迟加载防循环依赖（mcp-registry → memory-store → 可能反向）
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mcp = require('./mcp-registry') as { buildMCPToolsPrompt: () => string }
    toolsDescription = mcp.buildMCPToolsPrompt() ?? ''
  } catch {
    /* mcp-registry 加载失败不影响主流程 */
  }

  // Phase 1 J: 注入当前情感状态切片 — 让 LLM 在 system 层就感受到"今天什么心情"
  let emotionalFragment = ''
  try {
    const active = getActiveCharacter()
    if (active) {
      const state = loadEmotionalState(active.id)
      emotionalFragment = emotionalStateToPromptFragment(state)
    }
  } catch {
    /* emotional-state 失败不影响主流程 */
  }

  // 把情感切片合到 toolsDescription 同 slot — buildSystemPromptPure 只暴露 toolsDescription
  // 字段，先 emotional 后 tools 顺序拼接（情感优先 — LLM 看到的最近 context）
  const combined = [emotionalFragment, toolsDescription].filter((s) => s.trim()).join('\n\n')
  return buildSystemPromptPure(soul, { toolsDescription: combined })
}
