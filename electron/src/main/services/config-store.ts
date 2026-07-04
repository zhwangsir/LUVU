/**
 * 持久化运行时配置（~/.luvu/config.json）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeConfig } from '@shared/types'
import { getPaths } from './paths'

const DEFAULT: RuntimeConfig = {
  llm_provider: 'openai_compat',
  // 默认留空 — 首次启动时引导用户填本地 ollama / LM Studio / vLLM endpoint
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  // v0.21：thinking 模型需要大空间生成（推理+答案）；本地部署给大默认，可在设置调
  llm_max_tokens: 16000,
  tts_provider: 'sidecar',
  // 默认留空 — 用户在 Settings 里配（或留空使用 macOS `say` fallback）
  tts_sidecar_url: '',
  // v0.9: RVC 默认不启用（空 voice）。训练好后在设置里选
  rvc_voice: '',
  rvc_f0_up_key: 0,
  rvc_index_rate: 0.75,
  rvc_f0_method: 'rmvpe' as const,
  // v0.11: 底座 TTS 语速/音量/音调（edge_tts SSML 格式）
  tts_rate: '+0%',
  tts_volume: '+0%',
  tts_pitch: '+0Hz',
  // v0.11: RVC 高级参数
  rvc_protect: 0.33,
  rvc_filter_radius: 3,
  rvc_rms_mix_rate: 1.0,
  rvc_resample_sr: 0,
  idle_min_sec: 60,
  idle_max_sec: 180,
  autocomment_interval_sec: 600,
  emotion_decay_per_minute: 0.1,
  flip_probability: 0.15,
  // v0.17：8 情绪分别映射到不同 Edge TTS 女声，让 TTS 真的有「感情差异」
  //   - Xiaoyi: 温柔甜美少女（默认/害羞）
  //   - Xiaoxiao: 活泼开朗（开心/惊喜）
  //   - Xiaomeng: 温暖治愈（悲伤/中性）
  //   - Xiaohan: 沉稳成熟（生气）
  //   - Xiaoshuang: 俏皮可爱（撒娇/调侃）
  //   - Xiaomo: 慢节奏柔和（困倦）
  // sidecar 不仅 voice 区别音色，还可能用 SSML prosody style 二次润色（emotion 字段也传给 sidecar）
  emotion_voice_map: {
    neutral: 'edge:zh-CN-XiaoyiNeural',
    happy: 'edge:zh-CN-XiaoxiaoNeural',
    sad: 'edge:zh-CN-liaoning-XiaobeiNeural',
    angry: 'edge:zh-CN-XiaohanNeural',
    shy: 'edge:zh-CN-XiaoyiNeural',
    tease: 'edge:zh-CN-XiaoshuangNeural',
    sleepy: 'edge:zh-CN-XiaomoNeural',
    surprise: 'edge:zh-CN-XiaoxiaoNeural',
  },
  embedding_endpoint: '',
  embedding_model: '',
  openai_compat_merge_system: true, // 兼容 LM Studio Qwen MoE jinja bug
  chinese_llm_enhance: true, // Phase 1 I: 国产模型反 SFT bias 默认开
  history_retention_days: 0, // 0 = 永久保留；用户可改 90/180/365
  // v0.21 真控：信任模式默认开（Master 已授权全放行）。
  // ⚠️ 工具调用不弹审批直接执行；可在 Settings 关闭。Cmd+Shift+Esc 熔断始终有效。
  agent_trust_mode: true,
  // v0.21：眼神跟随鼠标默认关（可选）——尊重主体性架构，用户可在 Settings 开
  gaze_follow_cursor: false,
  // v0.21：不可逆动作（删/移动覆盖/shell）即使信任模式也确认。默认 true 兜底，可在 Settings 关
  agent_confirm_dangerous: true,
  // v0.21：工具按需检索默认开 —— 工具膨胀时每轮只发相关工具给 LLM，选得更准更省 token
  tool_retrieval_enabled: true,
}

function configPath(): string {
  return join(getPaths().userDataDir, 'config.json')
}

export function loadConfig(): RuntimeConfig {
  const p = configPath()
  if (!existsSync(p)) return { ...DEFAULT }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<RuntimeConfig>
    // v0.17 migration：仅在 (a) 旧版默认情况下覆盖：
    //   - parsed.emotion_voice_map 8 字段都存在
    //   - 且全部映射到旧默认 voice (zh-CN-XiaoyiNeural) — 说明从未自定义过
    // 用户故意把所有 emotion 设为同一 voice（如只有一个 RVC 音色）会被尊重。
    let emotionMap = { ...DEFAULT.emotion_voice_map, ...(parsed.emotion_voice_map ?? {}) }
    const isLegacyDefault =
      parsed.emotion_voice_map != null &&
      Object.keys(parsed.emotion_voice_map).length >= 8 &&
      Object.values(parsed.emotion_voice_map).every((v) => v === 'edge:zh-CN-XiaoyiNeural')
    if (isLegacyDefault) {
      console.log('[config] migrate emotion_voice_map: legacy single-Xiaoyi default → v0.17 8-voice')
      emotionMap = { ...DEFAULT.emotion_voice_map }
    }
    return { ...DEFAULT, ...parsed, emotion_voice_map: emotionMap }
  } catch (e) {
    console.warn('[config] parse failed, using defaults:', e)
    return { ...DEFAULT }
  }
}

export function saveConfig(cfg: RuntimeConfig): RuntimeConfig {
  const merged = { ...loadConfig(), ...cfg }
  // v0.13: writeFileSync 失败（磁盘满/权限/路径无效）必须报上去，
  // 不然用户改了 endpoint 重启发现配置丢失却没任何提示
  try {
    writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch (e) {
    console.error('[config] save failed:', configPath(), e)
    throw new Error(
      `保存配置失败 (${configPath()}): ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  return merged
}
