/**
 * AI 动作工坊共享类型。
 *
 * 设计：让 LLM 输出"高层 KeyframeTrack"，由我们的代码转成 motion3.json 的
 * Segments 编码。这样 LLM 不需要懂 bezier 控制点数学，出错率低。
 */

/** 单条参数轨道 */
export interface KeyframeTrack {
  /** 目标参数 id，如 ParamAngleX */
  param: string
  /** [time, value] 对，time 是秒，value 是参数值 */
  keyframes: Array<[number, number]>
}

/** LLM 输出的高层动作描述 */
export interface MotionDraft {
  /** 文件名（不含 .motion3.json） */
  name: string
  /** 动作总时长（秒） */
  duration: number
  /** 是否循环 */
  loop: boolean
  /** 帧率，默认 30 */
  fps?: number
  /** 轨道集合 */
  tracks: KeyframeTrack[]
  /** 人类描述（写入 UserData） */
  description?: string
}

/** 模型的可调参数（从 model3.json + moc3 解析；这里简化为 motion3.json 里出现过的） */
export interface ParamInfo {
  id: string
  /** 在已有 motion 中出现的次数（用作"重要程度"提示） */
  usage_count: number
  /** 在已有 motion 中观察到的值范围 */
  min: number
  max: number
}

/** 一个模型的可用动作摘要 */
export interface ModelMotionSummary {
  model_dir: string
  motions: Array<{
    name: string
    file: string
    duration: number
    loop: boolean
    /** 这个 motion 用了哪些 param */
    params: string[]
  }>
  /** 模型中所有用过的 parameter */
  params: ParamInfo[]
}
