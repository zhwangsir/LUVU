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
