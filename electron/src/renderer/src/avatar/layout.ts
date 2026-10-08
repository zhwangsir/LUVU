/**
 * 多实例立绘布局算法(RFC 0002 Round Q2)。
 *
 * 纯函数 — 不依赖 DOM / Vue,可单测。
 *
 * Q2 横排等分:N 个 instance 平分舞台宽度,各占一个 slot。
 *   - count <= 1 → 单个填满整舞台(inset:0 等价,N=1 行为不变)
 *   - count > 1  → 等宽横排,index 0 在最左
 *
 * Q3 会在此基础上叠加 active 居中放大 / 非 active 缩小后退的视觉强调
 * (通过 visualScale / visualOpacity,见 RFC §3.5),但 slot 划分仍用本函数。
 */

export interface InstanceLayout {
  /** CSS left,百分比(相对舞台容器) */
  leftPercent: number
  /** CSS width,百分比 */
  widthPercent: number
  /** CSS top,百分比 */
  topPercent: number
  /** CSS height,百分比 */
  heightPercent: number
}

/**
 * 计算第 index 个 instance(共 count 个)的布局 slot。
 *
 * @param count mounted instance 总数(>= 1)
 * @param index 当前 instance 序号(0-based,0 <= index < count)
 */
export function computeInstanceLayout(count: number, index: number): InstanceLayout {
  // 防御:count < 1 或 index 越界 → 退化为填满(等价 N=1)
  if (count <= 1 || index < 0 || index >= count) {
    return { leftPercent: 0, widthPercent: 100, topPercent: 0, heightPercent: 100 }
  }
  const widthPercent = 100 / count
  return {
    leftPercent: index * widthPercent,
    widthPercent,
    topPercent: 0,
    heightPercent: 100,
  }
}

// ============ Q3 视觉强调(RFC 0002 §3.5) ============

export interface InstanceVisualState {
  /** CSS transform scale(呼吸 keyframes 会乘上这个基数) */
  scale: number
  /** CSS opacity(整个 instance 根节点) */
  opacity: number
  /** CSS filter saturate(canvas 上,与 drop-shadow 叠加) */
  saturate: number
}

/** active 满强度 */
export const VISUAL_STATE_ACTIVE: InstanceVisualState = { scale: 1, opacity: 1, saturate: 1 }

/**
 * 非 active 在多灵魂同框时的「后退」档位:缩小 + 变暗 + 降饱和。
 * 数值为经验值(slot 不变,只做视觉降级;RFC §3.5 的居中放大留后续调优)。
 */
export const VISUAL_STATE_IDLE: InstanceVisualState = { scale: 0.72, opacity: 0.72, saturate: 0.7 }

/**
 * Q3:某 instance 的视觉强调状态。
 *
 * 纯函数。规则:
 *   - active → 满强度
 *   - 非 active 且多灵魂同框 → 后退档
 *   - 单灵魂(N=1)→ 一律满强度(与 Q1 单实例行为等价)
 */
export function computeVisualState(isActive: boolean, multiInstance: boolean): InstanceVisualState {
  return isActive || !multiInstance ? VISUAL_STATE_ACTIVE : VISUAL_STATE_IDLE
}
