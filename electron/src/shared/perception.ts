/**
 * Perception 共享类型 — 所有「环境/用户事件」的统一描述。
 *
 * 设计原则：
 * - 事件只描述「发生了什么」，绝不直接驱动立绘动作
 * - 由 AttentionScheduler 接收、聚合、判断「该不该做点什么」
 * - 由 BehaviorPlanner 决定「做什么」
 *
 * v0.8 主体性架构核心。
 */

/** 所有感知事件的基类字段 */
interface PerceptionBase {
  /** Unix ms */
  t: number
}

// ============ 鼠标 ============

export interface MouseMovedEvent extends PerceptionBase {
  type: 'mouse_moved'
  /** 屏幕绝对坐标 */
  screen_x: number
  screen_y: number
  /** 相对 LUVU 窗口坐标（可能 < 0 或 > w/h 表示在窗外） */
  window_x: number
  window_y: number
  /** 鼠标是否在 LUVU 窗口内 */
  in_window: boolean
}

export interface MouseStayedEvent extends PerceptionBase {
  type: 'mouse_stayed'
  /** 停留位置 */
  screen_x: number
  screen_y: number
  /** 已停留毫秒 */
  duration_ms: number
}

export interface MouseLeftWindowEvent extends PerceptionBase {
  type: 'mouse_left_window'
}

// ============ 用户活动 ============

export interface UserIdleEvent extends PerceptionBase {
  type: 'user_idle'
  /** 距上次键盘/鼠标操作的毫秒数 */
  idle_ms: number
}

export interface UserActiveEvent extends PerceptionBase {
  type: 'user_active'
  /** 距离上次操作的 idle 时长（多少秒前刚活跃过来） */
  was_idle_ms: number
}

export interface TypingBurstEvent extends PerceptionBase {
  type: 'typing_burst'
  /** 突发的"打字感"强度 0~1（从 idle_ms 变化率推断） */
  intensity: number
}

// ============ 应用焦点 ============

export interface AppFocusChangedEvent extends PerceptionBase {
  type: 'app_focus_changed'
  /** 应用名（macOS: 'Code', 'Google Chrome'; Windows: 类似 process name） */
  app_name: string
  /** 窗口标题 */
  window_title: string
  /** 是否是黑名单应用（隐私）— 黑名单内 vision 不会截屏 */
  is_blacklisted: boolean
}

// ============ 视觉感知 ============

export interface ScreenSnapshotEvent extends PerceptionBase {
  type: 'screen_snapshot'
  /** 触发原因 */
  reason: 'periodic_glance' | 'mouse_focus' | 'app_changed' | 'user_request' | 'idle_concern'
  /** 是 base64 PNG/JPEG (data URL prefix 已去掉)，仅在 vision-analyzer 内部传，不放总线 */
  image_b64?: string
  /** v0.13: sanitize for IPC 时把 image_b64 替换成 image_b64_size，receiver 知道图字节数 */
  image_b64_size?: number
  image_mime?: 'image/png' | 'image/jpeg'
  /** 图像尺寸 */
  width?: number
  height?: number
  /** 黑名单应用拦截 → 截屏未发生 */
  blocked_by_blacklist?: boolean
  blocked_app?: string
}

export interface VisionDescriptionEvent extends PerceptionBase {
  type: 'vision_description'
  /** 对应的 snapshot event 时间戳 */
  snapshot_t: number
  /** 主活动（一句话）："写 Python / 浏览 Bilibili / 看 PDF" */
  activity: string
  /** 详细描述（2-3 句） */
  description: string
  /** 识别出的关键元素 */
  notable_elements: string[]
  /** 检测到的情绪/状态信号（如果有） */
  user_state_hint?: 'focused' | 'frustrated' | 'idle' | 'switching' | 'reading' | 'unknown'
  /** Vision LLM 调用耗时 ms */
  latency_ms?: number
}

// ============ 对话 / 系统 ============

export interface DialogUserInputEvent extends PerceptionBase {
  type: 'dialog_user_input'
  text: string
}

export interface DialogAssistantRepliedEvent extends PerceptionBase {
  type: 'dialog_assistant_replied'
  text: string
  emotion?: string
  intensity?: number
}

export interface TimeChangedEvent extends PerceptionBase {
  type: 'time_changed'
  /** 0-23 */
  hour: number
  /** morning / afternoon / evening / night */
  period: 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night'
}

export interface SystemEvent extends PerceptionBase {
  type: 'system_event'
  /** 'power_unplugged' / 'wake_from_sleep' / 'sleep' / 'lock' / 'unlock' */
  kind: string
  detail?: string
}

// ============ Union ============

export type PerceptionEvent =
  | MouseMovedEvent
  | MouseStayedEvent
  | MouseLeftWindowEvent
  | UserIdleEvent
  | UserActiveEvent
  | TypingBurstEvent
  | AppFocusChangedEvent
  | ScreenSnapshotEvent
  | VisionDescriptionEvent
  | DialogUserInputEvent
  | DialogAssistantRepliedEvent
  | TimeChangedEvent
  | SystemEvent

export type PerceptionEventType = PerceptionEvent['type']

/** 配置 */
export interface PerceptionConfig {
  /** 全局视觉感知开关 */
  vision_enabled: boolean
  /** 视觉感知 LM Studio endpoint (可不同于 LLM chat endpoint) */
  vision_endpoint: string
  /** 视觉感知 model 名 */
  vision_model: string
  /** 截屏频率（毫秒；最小 30000 = 30s） */
  vision_periodic_interval_ms: number
  /** 黑名单应用名（不截屏） */
  vision_blacklist_apps: string[]
  /** Idle 检测频率 ms */
  idle_check_interval_ms: number
  /** 鼠标 stayed 触发阈值 ms */
  mouse_stayed_threshold_ms: number
}

export const DEFAULT_PERCEPTION_CONFIG: PerceptionConfig = {
  vision_enabled: false, // 默认 OFF 保护隐私
  vision_endpoint: '',
  vision_model: '',
  vision_periodic_interval_ms: 60_000, // 60s
  vision_blacklist_apps: [
    '1Password',
    '1Password 7',
    'KeePassXC',
    'Bitwarden',
    'LastPass',
    'Banking',
    'Steam',
  ],
  idle_check_interval_ms: 2000,
  mouse_stayed_threshold_ms: 3000,
}
