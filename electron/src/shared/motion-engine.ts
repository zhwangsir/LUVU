/**
 * MotionEngine 共享类型 — motion 元数据库的 row + 查询过滤器。
 */

export type MotionSource =
  | 'imported' // 模型自带的（从 model3.json scan 来的）
  | 'library' // 从 MotionLibrary 模板渲染
  | 'llm' // LLM 生成
  | 'manual' // 用户在 TimelineEditor 手工创作
  | 'recorded' // MotionRecorder 录制

export interface MotionEntry {
  id: number
  model_dir: string
  name: string
  /** 相对 model 根目录的 motion 文件路径 */
  file_path: string
  /** model3.json 里的 Motions group */
  group_name: string
  // === 来源 ===
  source: MotionSource
  /** 生成策略 id (template:nod_gentle / direct_llm / plan_refine 等) */
  strategy: string | null
  prompt: string | null
  llm_provider: string | null
  llm_model: string | null
  // === 元数据 ===
  duration_ms: number
  loop_flag: 0 | 1
  param_count: number
  // === 评分 ===
  validator_score: number | null
  scorer_score: number | null
  user_rating: -1 | 0 | 1
  play_count: number
  // === 关联 ===
  parent_entry_id: number | null
  // === 触发用 ===
  /** JSON array string: ["happy", "shy"] */
  emotion_tags: string
  context_tags: string
  // === 时间戳 ===
  created_at: number
  updated_at: number
}

export interface MotionVersion {
  id: number
  entry_id: number
  version_no: number
  /** 完整 motion3.json 内容（字符串） */
  snapshot_json: string
  edited_by: string
  created_at: number
}

export interface MotionFilter {
  model_dir?: string
  source?: MotionSource | MotionSource[]
  min_score?: number
  emotion?: string
  context?: string
  /** 全文搜索 name + prompt */
  search?: string
  limit?: number
  offset?: number
  order_by?: 'created_at' | 'scorer_score' | 'play_count' | 'user_rating'
  order_dir?: 'asc' | 'desc'
}

export interface SyncReport {
  model_dir: string
  added: number
  removed: number
  updated: number
  total_after: number
  added_files: string[]
  removed_ids: number[]
}
