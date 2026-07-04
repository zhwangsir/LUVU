/**
 * Attention/Behavior 共享类型 — 主体性 AI 的「想什么、做什么」描述。
 */
import type { EmotionId } from './types'

/** 关注度场快照（用于调试 + LLM context） */
export interface AttentionSnapshot {
  /** 关注主人当前活动的程度 0~1 */
  focus_on_master: number
  /** 关注屏幕特定区域的程度 0~1 */
  focus_on_screen: number
  /** 主人需要被关心的程度（idle 越久越高，看到 frustrated 状态加分） */
  concern_level: number
  /** 自己当前的"心情倾向"（受 emotion + soul layer3 反差影响） */
  mood: EmotionId
  /** 最近一次行动时间，用于冷却 */
  last_action_at: number
  /** 最近的视觉描述（如果有） */
  last_vision_activity?: string
  last_vision_state?: string
  /** 当前正在聚焦的应用 */
  current_app?: string
  /** 主人 idle 时长 ms */
  idle_ms: number
  /** 当前时段 */
  time_period: 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night'
  /** v0.14 P4-T12: 本次启动以来连续活跃时长 ms (用于疲劳曲线) */
  session_active_ms: number
}

/** Planner 输出的行为指令 */
export type BehaviorAction =
  | {
      type: 'glance_at_screen'
      /** 看向的屏幕绝对坐标（窗口外也行） */
      screen_x: number
      screen_y: number
      /** 持续时间 ms（看一眼后会自动回中） */
      duration_ms: number
      reason: string
    }
  | {
      type: 'look_back_to_master'
      /** 回到看相机/主人方向 */
      duration_ms: number
    }
  | {
      type: 'speak'
      /** 主动说的话（会作为 assistant turn 注入 dialog） */
      text: string
      emotion: EmotionId
      intensity: number
      /** 是否 TTS */
      tts?: boolean
    }
  | {
      type: 'play_motion'
      /** 通过 TriggerEngine / Library 来源 */
      source: 'library_template' | 'engine_entry'
      template_id?: string
      entry_id?: number
    }
  | {
      type: 'change_emotion'
      emotion: EmotionId
      intensity: number
    }
  | {
      type: 'idle_subtle'
      /** 无目标，纯 idle filler，比如轻微呼吸/眨眼 */
      duration_ms: number
    }
  | {
      /**
       * v0.17 D：直接触发 Live2D 模型自带的 motion group。
       * LLM 可在合适情绪/事件下输出，例如开心 → "Tap"，惊讶 → "FlickUp"。
       * group 在该模型的 model3.json Motions 中存在才会播；不存在静默忽略。
       */
      type: 'play_group'
      /** 模型 motion group 名（Idle/Tap/Flick/FlickUp/FlickDown/FlickLeft/FlickRight/Flick3/Shake 等） */
      group: string
      /** 可选：解释（仅日志，不影响渲染） */
      reason?: string
    }
  | {
      /**
       * v0.17 C：LUVU 主动调 ComfyUI 生成一张贴纸送给主人。
       * LLM 在合适场景（如夜晚关怀、主人开心时分享、想念主人时）输出此 action。
       * 生成后通过 StickerOverlay 自动浮出在桌面。频率不要太高（生成 6-30 秒）。
       */
      type: 'generate_sticker'
      /** 情绪决定贴纸内容主题；映射到 ComfyUI prompt */
      emotion: EmotionId
      /** 可选：附加 prompt 描述。LLM 可以自由发挥（如"晚安月亮"、"加油拳头"） */
      extra_prompt?: string
      /** 可选：解释为什么生成（仅日志） */
      reason?: string
    }
  | {
      /**
       * v0.17 E-4：LUVU 接到主人指令后自己跑桌面自动化任务。
       * planner LLM 在用户对话里识别到 "帮我打开 X / 关掉 X / 帮我点 X / 帮我搜 X" 类指令时输出此 action。
       * plan-executor 调 window.api.agent.runTask 进入 agent loop（截屏 → vision LLM → 操作 → 验证）。
       *
       * 安全：用户随时按 Cmd+Shift+Esc 全局熔断；每步在 console 有 log。
       */
      type: 'agent_task'
      /** 目标描述：自然语言，越具体越好。例："打开微信，搜索老王，发消息'晚饭吃啥'" */
      goal: string
      /** 可选：最大步数（默认 10） */
      max_steps?: number
    }

export interface BehaviorPlan {
  /** plan 创建时间 */
  t: number
  /** Planner 触发原因 */
  trigger: string
  /** 决策出的行动序列（按顺序执行） */
  actions: BehaviorAction[]
  /** Planner 内部思考（调试用） */
  reasoning?: string
  /** 是否由 LLM 生成 */
  llm_generated: boolean
}

/** Scheduler 的输出 — 是否触发 Planner */
export interface SchedulerDecision {
  /** 是否触发 Planner */
  should_act: boolean
  /** 触发原因 */
  reason: string
  /** 当前关注度快照（传给 Planner） */
  snapshot: AttentionSnapshot
  /**
   * v0.21 Round I:M8 前置 — 决策给哪个灵魂。
   * 当前 attention scheduler 不主动设(走 default planner);
   * M8 真做时 scheduler 根据 perception context 选 target,attention/index.ts
   * 收到后 getPlanner(decision.target_character_id) 切对应 planner 实例。
   * undefined = 用 default planner(保留向后兼容)。
   */
  target_character_id?: string
}

export interface AttentionConfig {
  /** 总开关 — 关闭后只走简单 trigger-engine 反射 */
  enabled: boolean
  /** Scheduler tick 间隔 ms */
  tick_ms: number
  /** 默认两次主动行为最小间隔 */
  min_action_interval_ms: number
  /** 主动说话最小间隔（更长） */
  min_speak_interval_ms: number
  /** Planner 是否调 LLM（关掉 = 纯规则） */
  use_llm_planner: boolean
  /** Planner LLM 调用频率上限（每分钟次数） */
  llm_planner_max_per_minute: number
  /** v0.8.2: 主动巡视间隔 — 每隔 N ms 无条件触发一次「看屏 + planner」（即使 attention 没触发） */
  proactive_monitor_interval_ms: number
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  enabled: true,
  tick_ms: 10_000, // v0.17：从 5s 调到 10s — Master 不希望那么频繁感知屏幕
  min_action_interval_ms: 8000,
  min_speak_interval_ms: 30_000,
  use_llm_planner: true,
  llm_planner_max_per_minute: 6, // v0.17：从 4 调到 6，给 reactive trigger 留余量（proactive 1.3/min + reactive 1.7/min ≈ 3/min，留 ≥50% headroom）
  proactive_monitor_interval_ms: 45_000, // v0.17：从 30s 调到 45s，少打扰
}
