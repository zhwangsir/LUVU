/**
 * AttentionScheduler — 主体性 AI 的「关注度场」。
 *
 * 接收 PerceptionBus 事件 → 更新关注度状态。
 * 定时 tick → 综合判断「该不该行动 + 为什么」→ 触发 BehaviorPlanner。
 *
 * 不直接驱动立绘 — 只产生 SchedulerDecision，由外部接 Planner。
 *
 * 设计思路 (rule-based for stability)：
 *   focus_on_master: 主人活跃 + 鼠标在窗口 → 升；主人 idle / 离开 → 降
 *   focus_on_screen: 看到 vision_description → 升；切应用 → 升
 *   concern_level: idle 越久 → 升；vision 检测 frustrated → 升
 *
 * 触发条件（任一）：
 *   - 主人 idle > 5min + concern > 0.7 → "关怀触发"
 *   - vision_description 新到 + 上次行动 > min_interval → "看到啥反应一下"
 *   - app 切换到新 app → "好奇这是什么"
 *   - mouse_stayed (鼠标停留) + 上次没看过这位置 → "瞥一眼"
 */
import type {
  AttentionConfig,
  AttentionSnapshot,
  SchedulerDecision,
} from '@shared/attention'
import { DEFAULT_ATTENTION_CONFIG } from '@shared/attention'
import type { EmotionId } from '@shared/types'
import type { PerceptionEvent } from '@shared/perception'
import { perception } from '../perception/bus'

export class AttentionScheduler {
  private state: AttentionSnapshot = {
    focus_on_master: 0.3,
    focus_on_screen: 0.1,
    concern_level: 0,
    mood: 'neutral' as EmotionId,
    last_action_at: 0,
    idle_ms: 0,
    time_period: 'morning',
    session_active_ms: 0,
  }
  private lastProactiveAt = 0
  /** v0.17: 上次 reactive 触发时间（键鼠 burst 即时反应节流） */
  private lastReactiveAt = 0
  /** 35 秒内最多一次 reactive 反应。提到 35s 是为了：reactive (1.7/min) + proactive (45s 间隔 = 1.3/min)
   *  合计 ≈ 3/min，给默认 llm_planner_max_per_minute=4 留余量，避免反向把 proactive 挤掉 fallback */
  private readonly REACTIVE_COOLDOWN_MS = 35_000
  /** v0.14: 本次启动时间，用于计算 session_active_ms */
  private sessionStartedAt = Date.now()
  private config: AttentionConfig = { ...DEFAULT_ATTENTION_CONFIG }
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubscribers: Array<() => void> = []
  /** 触发回调 */
  private onTriggerCb: ((d: SchedulerDecision) => void) | null = null

  constructor(initial: Partial<AttentionConfig> = {}) {
    this.config = { ...DEFAULT_ATTENTION_CONFIG, ...initial }
  }

  start(): void {
    if (this.timer) return
    this.attachSensors()
    // 初始化 lastProactiveAt = now，避免启动后第一个 tick 立即触发（应当等满 proactive_interval）
    this.lastProactiveAt = Date.now()
    this.timer = setInterval(() => this.tick(), this.config.tick_ms)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const u of this.unsubscribers) u()
    this.unsubscribers.length = 0
  }

  /**
   * v0.21 Round C:agent_task 跑期间临时暂停 trigger 生成,避免 nut-js
   * 跑步操作时 attention 仍然每 45s 触发 "glance_at_screen" plan 撕裂 UX。
   * paused 状态保留 sensors + timer,只在 tick / reactive 入口 short-circuit。
   * 调用方 try/finally 保证 resume(防 agent loop 异常退出忘记 resume)。
   *
   * 收 reviewer HIGH-2:改用 pauseDepth 引用计数,而非 boolean。
   * 嵌套调用场景:outer agent 触发 inner agent 时,inner finally resume()
   * 不能提前清掉 outer 的 pause。pauseDepth 0→1 才真 log "paused",
   * pauseDepth →0 才真 log "resumed",中间嵌套不打扰 attention。
   */
  private pauseDepth = 0

  pause(reason: string): void {
    this.pauseDepth++
    if (this.pauseDepth === 1) {
      console.log(`[scheduler] paused: ${reason}`)
    }
  }

  resume(): void {
    if (this.pauseDepth <= 0) {
      console.warn('[scheduler] resume() 调多了 — pauseDepth 已经 0')
      return
    }
    this.pauseDepth--
    if (this.pauseDepth === 0) {
      console.log(`[scheduler] resumed`)
    }
  }

  isPaused(): boolean {
    return this.pauseDepth > 0
  }

  updateConfig(patch: Partial<AttentionConfig>): AttentionConfig {
    this.config = { ...this.config, ...patch }
    if (this.timer) {
      this.stop()
      this.start()
    }
    return this.config
  }

  getConfig(): AttentionConfig {
    return { ...this.config }
  }

  onTrigger(cb: (d: SchedulerDecision) => void): void {
    this.onTriggerCb = cb
  }

  /** 给 BehaviorPlanner 看的快照 */
  snapshot(): AttentionSnapshot {
    return { ...this.state }
  }

  /** 外部告诉 scheduler "我刚行动了" — 用于冷却 */
  markActionTaken(): void {
    this.state.last_action_at = Date.now()
  }

  // ============ 感知接入 ============

  private attachSensors(): void {
    this.unsubscribers.push(
      perception.onType('mouse_moved', (ev) => {
        if (ev.in_window) this.bump('focus_on_master', 0.05)
      }),
    )
    this.unsubscribers.push(
      perception.onType('mouse_stayed', () => {
        // 主人在专心看某处 — 我也想看看
        this.bump('focus_on_screen', 0.15)
        // v0.17: 即时反应 — 瞥一眼主人在看的位置
        this.tryReactiveTrigger('mouse_stayed: 主人凝视屏幕某处')
      }),
    )
    this.unsubscribers.push(
      perception.onType('user_idle', (ev) => {
        this.state.idle_ms = ev.idle_ms
        // idle 越久 concern 越高（衰减 + 加分）
        const concernAdd = Math.min(0.3, ev.idle_ms / 600_000) // 10min 满
        this.bump('concern_level', concernAdd)
        this.decay('focus_on_master', 0.1)
      }),
    )
    this.unsubscribers.push(
      perception.onType('user_active', (ev) => {
        this.state.idle_ms = 0
        if (ev.was_idle_ms > 60_000) {
          // 主人回来了 — 焦点拉满
          this.bump('focus_on_master', 0.4)
          this.decay('concern_level', 0.5)
        }
      }),
    )
    this.unsubscribers.push(
      perception.onType('typing_burst', () => {
        // 主人在快速打字 — 不要打扰，但偶尔耳语级一句"主人加油"
        this.decay('focus_on_screen', 0.2)
        this.tryReactiveTrigger('typing_burst: 主人在专注打字（短耳语级鼓励，不打扰）')
      }),
    )
    this.unsubscribers.push(
      perception.onType('app_focus_changed', (ev) => {
        this.state.current_app = ev.app_name
        // 切应用 = 上下文变化 → 好奇度提升
        this.bump('focus_on_screen', 0.25)
        // v0.17: 立刻好奇反应一下
        this.tryReactiveTrigger(`app_focus_changed: 主人切到 ${ev.app_name}`)
      }),
    )
    this.unsubscribers.push(
      perception.onType('vision_description', (ev) => {
        this.state.last_vision_activity = ev.activity
        if (ev.user_state_hint !== undefined) this.state.last_vision_state = ev.user_state_hint
        // 看到 frustrated → concern 升
        if (ev.user_state_hint === 'frustrated') {
          this.bump('concern_level', 0.3)
        }
      }),
    )
    this.unsubscribers.push(
      perception.onType('time_changed', (ev) => {
        this.state.time_period = ev.period
      }),
    )
    this.unsubscribers.push(
      perception.onType('dialog_user_input', () => {
        // 主人主动说话 → 完全关注
        this.state.focus_on_master = 1.0
        this.decay('concern_level', 0.3)
      }),
    )
  }

  // ============ 关注度场更新 ============

  private bump(key: 'focus_on_master' | 'focus_on_screen' | 'concern_level', amount: number): void {
    this.state[key] = Math.min(1, this.state[key] + amount)
  }

  private decay(key: 'focus_on_master' | 'focus_on_screen' | 'concern_level', amount: number): void {
    this.state[key] = Math.max(0, this.state[key] - amount)
  }

  /**
   * v0.17 — 键鼠等高频事件即时触发一次行为反应（不等 tick 定时器）。
   * 双重节流：(1) REACTIVE_COOLDOWN_MS 25 秒，(2) min_action_interval_ms。
   * Planner 收到 reason 后会按 system prompt 输出协同的 speak + play_group。
   */
  private tryReactiveTrigger(reason: string): void {
    if (!this.config.enabled || !this.onTriggerCb || this.pauseDepth > 0) return
    const now = Date.now()
    if (now - this.lastReactiveAt < this.REACTIVE_COOLDOWN_MS) return
    if (now - this.state.last_action_at < this.config.min_action_interval_ms) return
    this.lastReactiveAt = now
    console.log(`[scheduler] reactive: ${reason}`)
    this.onTriggerCb({
      should_act: true,
      reason: `reactive(${reason})`,
      snapshot: this.snapshot(),
    })
  }

  // ============ Tick 决策 ============

  private tick(): void {
    if (!this.config.enabled || !this.onTriggerCb || this.pauseDepth > 0) return
    // 自然衰减
    this.decay('focus_on_screen', 0.05)
    this.decay('focus_on_master', 0.02)
    // v0.14: session_active_ms 实时更新
    this.state.session_active_ms = Date.now() - this.sessionStartedAt

    const now = Date.now()
    const sinceAction = now - this.state.last_action_at
    if (sinceAction < this.config.min_action_interval_ms) return

    // v0.8.2: 主动巡视 — 即使 evaluateTriggers 没出条件也定期触发一次
    const sinceProactive = now - this.lastProactiveAt
    if (sinceProactive >= this.config.proactive_monitor_interval_ms) {
      this.lastProactiveAt = now
      console.log(
        `[scheduler] proactive trigger (${Math.round(sinceProactive / 1000)}s since last)`,
      )
      this.onTriggerCb({
        should_act: true,
        reason: `proactive_monitor (${Math.round(this.config.proactive_monitor_interval_ms / 1000)}s tick)`,
        snapshot: this.snapshot(),
      })
      return
    }

    const decision = this.evaluateTriggers()
    if (decision.should_act) {
      this.onTriggerCb(decision)
    }
  }

  private evaluateTriggers(): SchedulerDecision {
    const snap = this.snapshot()
    const reasons: string[] = []

    // 1. 关怀触发：主人 idle 很久 + concern 高
    if (snap.idle_ms > 300_000 && snap.concern_level > 0.5) {
      reasons.push(
        `concern_trigger(idle=${Math.round(snap.idle_ms / 1000)}s, concern=${snap.concern_level.toFixed(2)})`,
      )
    }
    // 2. 视觉好奇：focus_on_screen 高
    if (snap.focus_on_screen > 0.6) {
      reasons.push(`screen_focus(${snap.focus_on_screen.toFixed(2)})`)
    }
    // 3. 主人活跃 + focus 高 → 互动
    if (snap.focus_on_master > 0.8) {
      reasons.push(`master_focus(${snap.focus_on_master.toFixed(2)})`)
    }
    // 4. 检测到 frustrated → 关怀
    if (snap.last_vision_state === 'frustrated') {
      reasons.push('detected_frustration')
    }

    // v0.14 P4-T12: 时间事件触发
    const timeEventReason = this.evaluateTimeEvents()
    if (timeEventReason) {
      reasons.push(timeEventReason)
    }

    // v0.14 P4-T12: 疲劳曲线 — 连续工作 > 90 分钟
    if (snap.idle_ms < 60_000 && snap.session_active_ms > 90 * 60_000) {
      reasons.push(`fatigue(work=${Math.round(snap.session_active_ms / 60_000)}min)`)
    }

    if (reasons.length === 0) {
      return { should_act: false, reason: 'no trigger', snapshot: snap }
    }
    return {
      should_act: true,
      reason: reasons.join(' + '),
      snapshot: snap,
    }
  }

  /**
   * v0.14 P4-T12: 时间事件 — 早安/午饭/晚安/整点等。
   * 每个时间窗口内只触发一次（用 lastTimeEventKey 防重复）。
   */
  private lastTimeEventKey: string = ''
  private evaluateTimeEvents(): string | null {
    const d = new Date()
    const h = d.getHours()
    const m = d.getMinutes()
    const day = d.toDateString()

    // 早安窗口 6:00-9:00（每天第一次）
    if (h >= 6 && h < 9) {
      const k = `morning-${day}`
      if (this.lastTimeEventKey !== k) {
        this.lastTimeEventKey = k
        return 'time_event:good_morning'
      }
    }
    // 午饭提醒 12:00-13:00
    if (h === 12 && m < 30) {
      const k = `lunch-${day}`
      if (this.lastTimeEventKey !== k) {
        this.lastTimeEventKey = k
        return 'time_event:lunch_reminder'
      }
    }
    // 下午休息 15:30-16:00
    if (h === 15 && m >= 30) {
      const k = `afternoon_break-${day}`
      if (this.lastTimeEventKey !== k) {
        this.lastTimeEventKey = k
        return 'time_event:afternoon_break'
      }
    }
    // 晚安 22:30 之后
    if (h >= 22 && m >= 30) {
      const k = `goodnight-${day}`
      if (this.lastTimeEventKey !== k) {
        this.lastTimeEventKey = k
        return 'time_event:goodnight'
      }
    }
    // 深夜关心 1:00-3:00（如果你还在）
    if (h >= 1 && h < 3) {
      const k = `late_night-${day}`
      if (this.lastTimeEventKey !== k) {
        this.lastTimeEventKey = k
        return 'time_event:late_night_concern'
      }
    }
    return null
  }
}

// Singleton
export const scheduler = new AttentionScheduler()

/** 当 PerceptionEvent 通用接入用（保留用例） */
export function _typeAssertPerceptionEvent(_: PerceptionEvent): void {
  void _
}
