/**
 * Character (v0.14) — 「角色」是 LUVU 的核心新概念。
 *
 * 一个 Character = (Live2D 模型 + RVC 音色 + 灵魂档案 + 可选 LLM 覆盖) 的原子绑定。
 * 切换 character 时立绘 / 音色 / 灵魂 / 对话历史 全部同步切换。
 *
 * 每个 character 独立目录：~/.luvu/chars/<id>/
 *   ├── character.json     # 这份 Character 元数据
 *   ├── soul/              # 这个角色的灵魂目录（identity/personality/learned_traits）
 *   ├── history.sqlite     # 这个角色的对话历史（隔离）
 *   ├── preferences.json   # scale / offset / 其他个性化
 *   └── memory.db          # v0.14+: sqlite-vec 长期向量记忆
 */
import type { EmotionId, LlmProvider } from './types'

/** 灵魂模板类型 — 创建角色向导用 */
export type SoulTemplate =
  | 'yandere'       // 病娇占有欲（LUVU 风）
  | 'gentle'        // 温柔治愈
  | 'tsundere'      // 冷淡毒舌
  | 'genki'         // 元气活泼
  | 'cool'          // 御姐冷淡
  | 'custom'        // 用户自填

export interface CharacterLlmOverride {
  provider?: LlmProvider
  endpoint?: string
  model?: string
  api_key?: string
  /** 这个角色独立的 temperature（替代全局默认） */
  temperature?: number
}

export interface CharacterScene {
  /** 'transparent' | 'bedroom' | 'starry' | 'study' | 'sakura' | 自定义 */
  background_id: string
  /** 是否启用时间光照（早暖晚冷） */
  time_lighting: boolean
}

export interface Character {
  /** 唯一 id（kebab-case，做文件夹名） */
  id: string
  /** 显示名 */
  name: string
  /** 称呼 master 的方式 */
  call_master_as: string
  /** 简短描述（character picker 用） */
  description?: string
  /** 灵魂模板（仅元信息，实际灵魂在 soul/ 目录） */
  template?: SoulTemplate
  /** 头像缩略图（file:// URL，picker 卡片显示） */
  avatar_thumb_url?: string

  /** Live2D 模型 — 相对路径或绝对 */
  live2d_model_dir: string
  live2d_model_file: string

  /** RVC 音色 id（空 = 用纯 TTS 不走 RVC） */
  rvc_voice?: string

  /** 这个角色的 LLM 配置覆盖（空字段 = 用全局默认） */
  llm_override?: CharacterLlmOverride

  /** 场景视觉 */
  scene?: CharacterScene

  /** 默认情绪（character 启动时基准） */
  emotion_baseline?: EmotionId

  /** 亲密度 (0-100，慢慢成长) */
  intimacy_level: number

  /** 累计对话次数 */
  total_chats: number

  /** 上次互动时间戳 (ms) */
  last_chat_at: number

  /** 创建时间 */
  created_at: number

  /** 是否内置预设（不可删除） */
  builtin?: boolean
}

/** Character 创建向导输入 */
export interface CreateCharacterInput {
  id?: string                    // 自动生成 if 空
  name: string
  call_master_as: string
  description?: string
  template: SoulTemplate
  live2d_model_dir: string
  live2d_model_file: string
  rvc_voice?: string
  llm_override?: CharacterLlmOverride
  scene?: CharacterScene
  /** 自定义灵魂关键词（template != 'custom' 时填了会覆盖模板） */
  custom_personality_keywords?: string[]
  /** 自定义 signature 句子 */
  custom_signature_lines?: string[]
}
