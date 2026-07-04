/**
 * 主进程 ↔ 渲染进程共享类型。
 */

export type LlmProvider = 'anthropic' | 'openai_compat' | 'ollama'

export interface RuntimeConfig {
  llm_provider: LlmProvider
  llm_endpoint: string
  llm_model: string
  llm_api_key: string
  /**
   * v0.21：LLM 单次生成的 max_tokens。thinking 模型（Qwen3/DeepSeek-R1）推理占空间，
   * 太小会「思考占满没答案」。本地部署不怕费 token → 默认给大。0/未设 = 用默认。
   */
  llm_max_tokens?: number
  tts_provider: 'edge' | 'sidecar' | 'none'
  /** v0.8.2: 支持 string（单 sidecar）或 string[]（按顺序 fallback：primary → backup → ...） */
  tts_sidecar_url: string | string[]
  /**
   * v0.9: RVC voice conversion — 训练好的音色 id，对应 workstation 上 assets/weights/<id>.pth。
   * 非空时，sidecar 会先用底座 TTS 生成 wav 再交给 RVC 转音色。空 = 不启用 RVC。
   */
  rvc_voice?: string
  /** RVC 音调偏移半音；男→女 +12，女→男 -12，同性 0 */
  rvc_f0_up_key?: number
  /** RVC 索引检索权重 0~1，越高越像目标音色（也越多伪影） */
  rvc_index_rate?: number
  /** RVC F0 提取算法：rmvpe 推荐 / harvest 慢 / pm 快但抖 */
  rvc_f0_method?: 'rmvpe' | 'harvest' | 'pm'
  /**
   * v0.11: 底座 TTS (edge_tts) 语速/音量/音调 — Microsoft Edge TTS SSML 格式
   * 例：rate="+20%" 加快 20%，volume="-10%" 降低 10%，pitch="+5Hz"
   */
  tts_rate?: string
  tts_volume?: string
  tts_pitch?: string
  /** RVC protect: 清音/呼吸保护 0~0.5，越高越保留辅音清晰度 */
  rvc_protect?: number
  /** RVC filter_radius: F0 中值滤波半径 0~7，越大越去抖 */
  rvc_filter_radius?: number
  /** RVC rms_mix_rate: 音量包络混合 0~1，1=完全用源音量曲线，0=用目标音色固有 */
  rvc_rms_mix_rate?: number
  /** RVC resample_sr: 输出采样率，0=保持源采样率 */
  rvc_resample_sr?: number
  idle_min_sec: number
  idle_max_sec: number
  autocomment_interval_sec: number
  emotion_decay_per_minute: number
  flip_probability: number
  emotion_voice_map: Record<string, string>
  embedding_endpoint: string
  embedding_model: string
  /**
   * v0.7.5: OpenAI-compat 兼容模式 — 把 system message 合并到第一个 user message 前。
   * 默认 true，兼容 LM Studio 上的 Qwen/Llama 量化模型（jinja template bug）。
   * 真 OpenAI / SiliconFlow 可关掉（它们对 system 支持完美）。
   */
  openai_compat_merge_system?: boolean
  /**
   * Phase 1 I: 国产 LLM 中文场景增强（Qwen/DeepSeek/Kimi/GLM/Yi/Hunyuan/Doubao）。
   * 默认 true — 检测到国产模型时自动注入反 SFT bias 提示。
   * 用户若想完全控制 system prompt 可关。
   */
  chinese_llm_enhance?: boolean
  /** v0.8.2: 视觉感知 — 启动时透传给 PerceptionConfig，可独立配 endpoint/model */
  vision_enabled?: boolean
  vision_endpoint?: string
  vision_model?: string
  /**
   * v0.13 (audit M4): 对话历史保留天数。0 或负数 = 永久保留。
   * 启动时调用 pruneOlderThan(days)，删除老于 N 天的回合并 VACUUM。
   * 默认 0（不裁剪），用户可在 Settings 改成 90 / 180 / 365 等。
   */
  history_retention_days?: number
  /**
   * v0.17 (ComfyUI Phase 1)：图像生成后端 endpoint。
   * 例 http://192.168.71.100:8188 。空 = 未启用。
   * 与 LLM endpoint 独立配置（ComfyUI 走 8188，LLM 走 1234）。
   */
  comfyui_endpoint?: string
  /**
   * v0.21 真控：信任模式。true = 工具调用（含 computer_* 鼠键操控 / office_* 写文件 / agent_task）
   * 不弹审批直接执行；false = 未设 policy 的工具每次弹窗确认。
   * ⚠️ 高风险：开启后 LLM 决策会直接操作电脑/写文件。Cmd+Shift+Esc 全局熔断始终有效。
   */
  agent_trust_mode?: boolean
  /**
   * v0.21：可选「眼神跟随鼠标」。true = 立绘视线实时投向光标（反射式）。
   * 默认 false —— 主体性架构下视线由 BehaviorPlanner 决策（glance/look_back）；
   * 开启后光标跟随会持续覆盖 planner 的视线（用户显式选择的直观桌宠行为）。
   */
  gaze_follow_cursor?: boolean
  /**
   * v0.21：即使信任模式全放行，删文件 / 移动覆盖 / 跑 shell 命令这类**不可逆**动作
   * 仍弹一次确认。默认 true（安全兜底）。设 false = 连这些也不确认（彻底全放行）。
   */
  agent_confirm_dangerous?: boolean
  /**
   * v0.21：工具按需检索。true（默认）= 每轮只把与你这句话相关的工具发给 LLM
   * （语义 embedding + 常驻核心 + 关键词兜底），工具多时选得更准更省 token。
   * false = 每轮发全部工具（老行为）。
   */
  tool_retrieval_enabled?: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  temperature: number
  max_tokens?: number
}

export interface ModelInfo {
  dir: string
  model_file: string
  absolute_path: string
  source: 'builtin' | 'user' | string
  cubism: 'cubism2' | 'cubism4'
  display: string
  root_id: string
  /** 解析 .model3.json 后得到的元数据；用于过滤"完整可用"模型 */
  meta?: {
    /** moc3 文件存在 + 至少一张 texture */
    has_core: boolean
    /** 至少有 1 个动作 (motion3.json) */
    has_motions: boolean
    /** 有 expressions 表情 */
    has_expressions: boolean
    /** 有 physics 物理 */
    has_physics: boolean
    /** 动作总数 */
    motion_count: number
    /** 表情总数 */
    expression_count: number
    /** moc3 文件 size (KB) - 占位模型通常 < 50KB */
    moc_kb: number
    /** 全部 texture 总大小 (KB) - 占位/小色块通常 < 200KB */
    texture_kb: number
    /** 综合判定：has_core && has_motions && 大小达标 */
    complete: boolean
    /** 强烈推荐（builtin + 通过严格阈值） */
    recommended: boolean
    /** 不完整时给出原因（多个用 ; 连接） */
    reason?: string
    /** v0.8.2: 健康评分 0-100（base 60 + motion/expression/physics 各加分 + 大小达标加分） */
    health_score?: number
    /** A>=85, B>=70, C>=50, D<50 */
    grade?: 'A' | 'B' | 'C' | 'D'
    /** 是否可 auto-heal（必须有 moc + 至少 1 texture） */
    healable?: boolean
    /** 主动 healing 后给的建议（缺什么、能补什么） */
    heal_hints?: string[]
    /** v0.8.2: 内容指纹（moc3_bytes + texture_size_sum），相同 = 同一模型 */
    dedup_key?: string
    /**
     * v0.8.2: 同角色聚类 ID。
     * 信号：moc3 字节数 + 角色基础名（去掉 _v2/_skin/_normal 等 view 后缀）。
     * 同 character_id 的多个 model = 同角色不同 outfit/view（Live2D 标准做法）。
     */
    character_id?: string
    /** view label（从 dir 名抽出，如 "normal" / "skin1" / "battle"） */
    view_label?: string
  }
}

export interface SoulConfig {
  schema_version: string
  name: string
  master: string
  call_master_as: string
  layer1_core: string
  layer2_surface: string
  layer3_volatility_prompt: string
  flip_probability: number
  speech_style: {
    catchphrases: string[]
    speech_tics: string[]
    forbidden_words: string[]
  }
  output_protocol: {
    format: string
    example: string
  }
  avatar: {
    model_dir: string
    model_file: string
    scale: number
    offset_y: number
    search_paths: string[]
  }
  /** v0.15 B1: few-shot 示范对话，LLM 学习角色语气的最高 ROI 手段 */
  example_dialogues?: Array<{
    user: string
    assistant: {
      text: string
      emotion: string
      intensity: number
    }
  }>
}

export interface IpcStreamChunk {
  streamId: string
  delta?: string
  done?: boolean
  error?: string
  full_text?: string
  emotion?: string
  intensity?: number
  /** LLM 发起的工具调用（流式期间，可能多个） */
  tool_use?: {
    id: string
    name: string
    input: Record<string, unknown>
  }
  /** 该轮 stop_reason 是 tool_use，提示 renderer 需要执行工具并续轮 */
  needs_tools?: boolean
}

export type EmotionId =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprise'
  | 'shy'
  | 'tease'
  | 'sleepy'
