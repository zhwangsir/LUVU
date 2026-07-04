/**
 * 主体性循环主控 — 启动 Scheduler + Planner + 把 Plan 推给 renderer 执行。
 */
import type { BrowserWindow } from 'electron'
import type { AttentionConfig, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import { scheduler } from './scheduler'
// v0.21 Round H:用 getPlanner() factory 替代 module-level singleton。
// 当前不传 characterId 用 default(等价旧 singleton)。
// M8 多灵魂时 onTrigger 接到 decision.target_character_id 后 getPlanner(id) 切换。
// reviewer H-HIGH-1:删除 `planner` 死 reexport(无人消费 + 触发 planner module 顶层副作用)
import { getPlanner } from '../planner'
// v0.21 Round K:M8 后端最后一步 — onTrigger 真用 active character 作 planner target
// v0.21 Round N:M8 灵魂↔灵魂 — 拿 mounted ids + 角色名为跨角色 memory 写入
import {
  getActiveCharacterId,
  getCharacter,
  getMountedCharacterIds,
} from '../character-store'
// v0.21 Round N:active 说话时,把这句话作为 event memory 写入其他 mounted character 的 memory.db
import { addMemory } from '../memory-store'
import { triggerScreenSnapshot } from '../perception'

let getWindow: (() => BrowserWindow | null) | null = null

/**
 * P0-2 修复:planner 决策是否正在进行中。
 * 慢模型(thinking)下一次 plan 要几十秒,而 scheduler 每 10s tick 都可能触发
 * (focus_on_master>0.8 几乎恒满足)→ 不加护栏会并发叠加 N 个 LLM 调用,实测把
 * 单次延迟从 ~22s 堆到 53s。这里串行化:上一个 plan 没算完就跳过新触发。
 */
let planInFlight = false

export function startAttention(
  winGetter: () => BrowserWindow | null,
  initialConfig: Partial<AttentionConfig> = {},
): void {
  getWindow = winGetter
  scheduler.updateConfig(initialConfig)
  scheduler.onTrigger(async (decision: SchedulerDecision) => {
    // P0-2:planner 还在算上一个 plan → 跳过本次触发,避免 LLM 并发堆积
    if (planInFlight) {
      console.log(`[attention] skip "${decision.reason}" — plan still in flight`)
      return
    }
    planInFlight = true
    try {
      console.log(`[attention] trigger: ${decision.reason}`)
      // v0.8.2: proactive trigger 时先抓一张屏给 planner 看
      if (decision.reason.startsWith('proactive_monitor')) {
        await triggerScreenSnapshot('user_request').catch(() => {
          /* vision 失败不阻塞 planner */
        })
      }
      // v0.21 Round H + I + K:getPlanner factory + target_character_id 真接通。
      //
      // Round K:scheduler 不主动设 target_character_id 时,fallback 到当前 active
      // character。意义:character 切换时 planner 实例自动切换(独立 budget / state),
      // 旧 active 的 planner 留 Map cache 等下次再切回时复用(O(N) characters)。
      //
      // M8 GUI 真做时 scheduler 会主动设 target_character_id(从 mounted 中选),
      // 这里 fallback active 自然失效。架构师建议的 5 行版本。
      const targetId =
        decision.target_character_id ?? (getActiveCharacterId() ?? undefined)
      const plan = await getPlanner(targetId).plan(decision)
      console.log(
        `[attention] plan reason="${plan.reasoning ?? ''}" actions=${plan.actions.map((a) => a.type).join(',')}`,
      )
      scheduler.markActionTaken()
      recordPlan(plan)
      const win = getWindow?.()
      if (win && !win.isDestroyed()) {
        win.webContents.send('attention:plan', plan)
      }
      // v0.21 Round N:M8 灵魂↔灵魂 — active 说话时把这句话喂给其他 mounted character
      // 的 memory.db。passive listening:不触发 other planner LLM 调用(避免 ping-pong +
      // LLM API 流量爆),只在 memory 层记录,下次 character 切到 other 时通过 RAG 自然浮现。
      notifyOtherMountedCharacters(targetId, plan)
    } catch (e) {
      console.warn('[attention] planner failed:', e)
    } finally {
      planInFlight = false
    }
  })
  scheduler.start()
}

export function stopAttention(): void {
  scheduler.stop()
}

export function updateAttentionConfig(patch: Partial<AttentionConfig>): AttentionConfig {
  return scheduler.updateConfig(patch)
}

export function getAttentionConfig(): AttentionConfig {
  return scheduler.getConfig()
}

export function attentionSnapshot(): import('@shared/attention').AttentionSnapshot {
  return scheduler.snapshot()
}

/** Renderer 主动获取/订阅时用 */
// reviewer H-HIGH-1:planner reexport 死链(grep 确认无外部消费者),移除
export { scheduler }

/** 用于诊断：拿最近 N 个 plan（主进程内存） */
const planHistory: BehaviorPlan[] = []
const PLAN_HISTORY_LIMIT = 30

export function recordPlan(plan: BehaviorPlan): void {
  planHistory.push(plan)
  if (planHistory.length > PLAN_HISTORY_LIMIT) planHistory.splice(0, planHistory.length - PLAN_HISTORY_LIMIT)
}

export function recentPlans(limit = 10): BehaviorPlan[] {
  return planHistory.slice(-limit).reverse()
}

/**
 * v0.21 Round N(M8 灵魂↔灵魂):把 source character 说的话作为 event memory
 * 写入其他 mounted character 的 memory.db。
 *
 * 设计选择(架构师建议):
 *   - passive listening,不触发 other planner LLM(避免 ping-pong + 流量爆炸)
 *   - 写 kind='event' + importance=0.45(略低于普通 event,避免淹没 RAG top-k)
 *   - embedding 留空数组:Round N 不做 embedding(没现成 sidecar 调用面),
 *     RAG cosine 检索得 0,但 kind/text 列出可见。Round O+ 接 embedding sidecar 时填。
 *   - 单条文本截 200 字 + 加 source meta(让 character 知道这是"听到的"不是"她自己说的")
 *
 * 失败静默:source 找不到 / addMemory 抛 → 仅 console.warn,不阻塞主流程。
 *
 * Export 为可测函数(unit test 可单独验证多 mounted character 时的写入路径)。
 */
export function notifyOtherMountedCharacters(
  sourceCharId: string | undefined,
  plan: BehaviorPlan,
): { written: number; skipped: string } | null {
  if (!sourceCharId) return { written: 0, skipped: 'no_source' }
  const speak = plan.actions.find((a) => a.type === 'speak')
  if (!speak || speak.type !== 'speak' || !speak.text) {
    return { written: 0, skipped: 'no_speak_action' }
  }
  try {
    const mounted = getMountedCharacterIds()
    if (mounted.length <= 1) {
      return { written: 0, skipped: 'no_other_mounted' }
    }
    const sourceCharacter = getCharacter(sourceCharId)
    const sourceName = sourceCharacter?.name ?? sourceCharId
    // 截 200 字防止单条 memory 过大(history retention 期内累积 N 个 character 都讲很多
    // 可能撑爆 db),又保留语义。
    const textSnippet = speak.text.slice(0, 200)
    let written = 0
    // reviewer N-MEDIUM-5:收集失败 id,return value 给可观测性
    const failedIds: string[] = []
    for (const otherId of mounted) {
      if (otherId === sourceCharId) continue
      try {
        addMemory(otherId, {
          kind: 'event',
          text: `${sourceName} 对 master 说: ${textSnippet}`,
          // TODO Round O+:embedding sidecar 接通后填(当前 RAG 检索 cosine=0
          // 不会浮现,但 listMemories(kind: 'event') 可见,符合 passive listening
          // 的设计意图)
          embedding: [],
          importance: 0.45,
          source: `cross_character:${sourceCharId}`,
        })
        written += 1
      } catch (e) {
        console.warn(
          `[attention] cross-character memory write failed for ${otherId}:`,
          e,
        )
        failedIds.push(otherId)
      }
    }
    return { written, skipped: failedIds.join(',') }
  } catch (e) {
    console.warn('[attention] notifyOtherMountedCharacters failed:', e)
    return null
  }
}
