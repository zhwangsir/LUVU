/**
 * 模型相关 IPC handlers — type-safe channels (Phase 1 G).
 *
 * 涵盖 heal / dedup / describe / preferences / favorites / enrich / learnings /
 *      auto-fill / expression-pack / physics-presets / param-analysis
 *
 * 注：models:scan 仍留在 system.ts 因为它是 bootstrap 必经路径，
 *     跟 config / soul 在同一启动时机被调。
 *     models:enrich-progress 推送仍走 evt.sender.send（不在 channel 范围）。
 */
import {
  modelsAnalyzeParams,
  modelsApplyDedup,
  modelsApplyExpressionPack,
  modelsApplyPhysicsPreset,
  modelsAutoFill,
  modelsCachedDescriptions,
  modelsClearRecent,
  modelsComputeLearnings,
  modelsDescribe,
  modelsEnrichAbort,
  modelsEnrichCached,
  modelsEnrichClear,
  modelsEnrichStart,
  modelsEvaluate,
  modelsFavorites,
  modelsFindDuplicates,
  modelsGetLearnings,
  modelsGetPreference,
  modelsHeal,
  modelsListPhysicsPresets,
  modelsMarkRecent,
  modelsMergeGroups,
  modelsSetPreference,
  modelsToggleFavorite,
} from '@shared/channels/models'
import { handleInvoke } from './channel-helpers'

export function registerModelsIpc(): void {
  // v0.15 E1: Live2D 模型行业标准学习数据库
  handleInvoke(modelsComputeLearnings, async (force) => {
    const { computeLearnings } = await import('../services/model-learnings')
    return computeLearnings(!!force)
  })
  handleInvoke(modelsGetLearnings, async () => {
    const { loadLearnings } = await import('../services/model-learnings')
    return loadLearnings()
  })
  handleInvoke(modelsEvaluate, async (payload) => {
    const { evaluateModel, loadLearnings } = await import('../services/model-learnings')
    return evaluateModel(payload.model_json_path, loadLearnings())
  })
  handleInvoke(modelsAutoFill, async (payload) => {
    const { fillMissingForModel } = await import('../services/model-auto-fill')
    return fillMissingForModel(payload.model_json_path, {
      skip_expressions: !!payload.skip_expressions,
    })
  })

  // v0.16 T2: 一键 8 标准 expression
  handleInvoke(modelsApplyExpressionPack, async (payload) => {
    const { applyStandardExpressionPack } = await import('../services/expression-pack')
    const { dirname } = await import('node:path')
    return applyStandardExpressionPack(dirname(payload.model_json_path))
  })

  // v0.16 T4: 参数命名分析
  handleInvoke(modelsAnalyzeParams, async (payload) => {
    const { analyzeModelParams } = await import('../services/param-naming')
    const { dirname } = await import('node:path')
    return analyzeModelParams(dirname(payload.model_json_path))
  })

  // v0.16 T3: 物理预设
  handleInvoke(modelsListPhysicsPresets, async () => {
    const { listPhysicsPresets } = await import('../services/physics-presets')
    return listPhysicsPresets()
  })
  handleInvoke(modelsApplyPhysicsPreset, async (payload) => {
    const { applyPhysicsPreset } = await import('../services/physics-presets')
    const { dirname } = await import('node:path')
    return applyPhysicsPreset(
      dirname(payload.model_json_path),
      payload.preset_id as Parameters<typeof applyPhysicsPreset>[1],
    )
  })

  // v0.8.2: Model Auto-Heal — 给模型补基础 motion/expression + bind orphan
  handleInvoke(modelsHeal, async (payload) => {
    const { healModel } = await import('../services/model-healer')
    try {
      return healModel(payload.model_json_path)
    } catch (e) {
      return {
        ok: false,
        reason: `heal failed: ${String(e)}`,
        added: { motions: [], expressions: [], bound_orphans: { motions: [], expressions: [] } },
      }
    }
  })

  // v0.8.2: Model dedup
  handleInvoke(modelsFindDuplicates, async () => {
    const { findDuplicates } = await import('../services/model-dedup')
    return findDuplicates()
  })
  handleInvoke(modelsApplyDedup, async (payload) => {
    const { applyDedup } = await import('../services/model-dedup')
    return applyDedup(payload ?? {})
  })
  handleInvoke(modelsMergeGroups, async (payload) => {
    const { mergeGroups } = await import('../services/model-dedup')
    return mergeGroups(payload ?? {})
  })

  // v0.8.2: AI 生成模型介绍（缓存）
  handleInvoke(modelsDescribe, async (payload) => {
    const { describeModel } = await import('../services/model-describer')
    return describeModel(payload)
  })
  handleInvoke(modelsCachedDescriptions, async () => {
    const { getCachedDescriptions } = await import('../services/model-describer')
    return getCachedDescriptions()
  })

  // v0.9: 模型个人偏好（scale / offset_y） — 按 character_id 持久化
  handleInvoke(modelsGetPreference, async (characterId) => {
    const { getPreference } = await import('../services/model-preferences')
    return getPreference(characterId)
  })
  handleInvoke(modelsSetPreference, async (payload) => {
    const { setPreference } = await import('../services/model-preferences')
    setPreference(payload.character_id, {
      scale: payload.scale,
      ...(payload.offset_x !== undefined ? { offset_x: payload.offset_x } : {}),
      offset_y: payload.offset_y,
    })
    return { ok: true }
  })

  // v0.12: 收藏 + 最近使用
  handleInvoke(modelsFavorites, async () => {
    const { getAll } = await import('../services/model-favorites')
    return getAll()
  })
  handleInvoke(modelsToggleFavorite, async (dir) => {
    const { toggleFavorite } = await import('../services/model-favorites')
    return toggleFavorite(dir)
  })
  handleInvoke(modelsMarkRecent, async (dir) => {
    const { markRecent } = await import('../services/model-favorites')
    markRecent(dir)
    return { ok: true }
  })
  handleInvoke(modelsClearRecent, async () => {
    const { clearRecent } = await import('../services/model-favorites')
    clearRecent()
    return { ok: true }
  })

  // v0.12: character enrichment（LLM 一次性生成中文名+介绍）
  let enrichAbort: AbortController | null = null
  handleInvoke(modelsEnrichCached, async () => {
    const { getAll } = await import('../services/character-enricher')
    return getAll()
  })
  handleInvoke(modelsEnrichStart, async (_p, evt) => {
    if (enrichAbort) enrichAbort.abort()
    enrichAbort = new AbortController()
    const { enrichAll } = await import('../services/character-enricher')
    void enrichAll(
      (p) => {
        try {
          evt.sender.send('models:enrich-progress', p)
        } catch {
          /* renderer may be gone */
        }
      },
      enrichAbort.signal,
    ).catch((e) => {
      try {
        evt.sender.send('models:enrich-progress', {
          total: 0,
          done: 0,
          failed: 0,
          error: String(e),
        })
      } catch {
        /* skip */
      }
    })
    return { ok: true }
  })
  handleInvoke(modelsEnrichAbort, async () => {
    if (enrichAbort) {
      enrichAbort.abort()
      enrichAbort = null
    }
    return { ok: true }
  })
  handleInvoke(modelsEnrichClear, async () => {
    const { clearAll } = await import('../services/character-enricher')
    clearAll()
    return { ok: true }
  })
}
