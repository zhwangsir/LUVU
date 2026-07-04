/**
 * Live2D 参数语义标准化层。
 *
 * 让 MotionLibrary 模板用「语义」表达动作（如 head_pitch -8），
 * 通过 ParameterIntrospector 映射到任意模型的真实 param id。
 */

/** 标准化语义标签 — 覆盖 Cubism 4 主流场景 */
export type Semantic =
  // 头部
  | 'head_yaw' // 头水平 (ParamAngleX)
  | 'head_pitch' // 头俯仰 (ParamAngleY)
  | 'head_roll' // 头倾斜 (ParamAngleZ)
  // 身体
  | 'body_yaw'
  | 'body_pitch'
  | 'body_roll'
  // 眼睛位置（瞳孔）
  | 'eye_left_x'
  | 'eye_left_y'
  | 'eye_right_x'
  | 'eye_right_y'
  | 'eye_ball_x'
  | 'eye_ball_y'
  // 眼睛开闭
  | 'eye_left_open'
  | 'eye_right_open'
  | 'eye_smile'
  // 眉毛
  | 'brow_left_y'
  | 'brow_right_y'
  | 'brow_form'
  // 嘴部
  | 'mouth_open'
  | 'mouth_form'
  | 'mouth_smile'
  // 呼吸 / 脸颊
  | 'breath'
  | 'cheek'
  // 头发物理
  | 'hair_front'
  | 'hair_side'
  | 'hair_back'
  // 手臂
  | 'arm_left'
  | 'arm_right'
  // 未识别
  | 'unknown'

export interface ParameterSemantics {
  /** 实际参数 id（如 ParamAngleX 或 P00） */
  param_id: string
  /** 推断出的语义 */
  semantic: Semantic
  /** 置信度 0~1 */
  confidence: number
  /** 推断依据 */
  evidence: 'cdi3_metadata' | 'name_match' | 'range_pattern' | 'cooccurrence_analysis'
  /** 观察值域 */
  range: { min: number; max: number }
  /** 在已有 motion 中协同变化的其它 param id */
  cooccurs_with: string[]
}

/** 完整的模型语义图 */
export interface SemanticsMap {
  model_dir: string
  /** 全部参数推断结果（按置信度降序） */
  params: ParameterSemantics[]
  /** semantic → ParameterSemantics[]（同一语义可能有多个 param 候选；按 confidence 排） */
  by_semantic: Partial<Record<Semantic, ParameterSemantics[]>>
  /** 整体置信度（均值） */
  confidence: number
}
