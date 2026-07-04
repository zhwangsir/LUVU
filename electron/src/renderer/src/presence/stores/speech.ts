/**
 * 在场域：流式分句 TTS（v0.10）。
 *
 * 老版本等 'brain:reply-end' 才合成整段，体感很长（思考 + 生成 + TTS = 5-10s）。
 * 新版本：监听 'brain:reply-token' 增量 → 累积 buffer → 用 parser 抽 clean text →
 *        遇到句末标点立刻切一句送 TTS → 串行队列接龙播放。
 * 用户体感：LLM 第一句话生成完立刻有声音，后续句子无缝接龙。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { bus } from '../../infra/eventbus'
import { useConfigStore } from '../../infra/stores/config'
import { playWithLipsync, type LipsyncSession } from '../speech/lipsync'
import { parsePartialText } from '../../brain/parser'
import type { EmotionId } from '@shared/types'

/** 至少多少字才切一句（避免「啊。」「嗯。」这种碎句也单独合成） */
const MIN_SENTENCE_LEN = 6
/** 句末标点：中英文常见结尾符 */
const SENTENCE_END = /[。！？!?；;]/u

export const useSpeechStore = defineStore('speech', () => {
  const speaking = ref(false)
  const lastError = ref<string | null>(null)
  let current: LipsyncSession | null = null
  /** 新 speak 来时旧的合成结果 / 播放都失效 — 在「重启 stream」时 bump */
  let speakToken = 0

  // 流式状态
  let activeStream: string | null = null
  let buffer = ''
  let spokenUpTo = 0
  /** 上一次 emotion-changed 缓存（流式中段 emotion 未知，用缓存的） */
  let lastKnownEmotion: EmotionId = 'neutral'
  /** P5: 同步 intensity 让 TTS prosody 调节 */
  let lastKnownIntensity = 0.5
  /**
   * v0.11: 双队列 — 合成并行 fire（不等播完），播放串行 chain。
   * 老版本: enqueue → 等播完 → 才合成下一句 → 听感「s1.播完 → 1-3s 静音合成 s2 → s2.开始」
   * 新版本: enqueue 立即 fire 合成 promise，播放队列拿这些已 fire 的 promise 等 resolve 后顺序播。
   * 当 s1 还在播时 s2 已经在后台合成，s1 播完瞬间就接上 s2 — 句间 gap 接近 0。
   */
  let playChain: Promise<void> = Promise.resolve()
  /** 当前 stream 是否已经流式播过任何一句（reply-end 决定是 flush 残余还是走 fallback 整段） */
  let streamHadSentence = false

  function bootstrap(): void {
    bus.on('brain:emotion-changed', ({ emotion, intensity }) => {
      lastKnownEmotion = emotion
      if (typeof intensity === 'number' && Number.isFinite(intensity)) {
        lastKnownIntensity = intensity
      }
    })

    bus.on('brain:reply-token', ({ stream_id, delta }) => {
      const cfg = useConfigStore()
      if (!cfg.config || cfg.config.tts_provider === 'none') return

      // 新 stream → 重置流式状态 + 中止当前播放（新一轮对话来了）
      if (stream_id !== activeStream) {
        activeStream = stream_id
        buffer = ''
        spokenUpTo = 0
        streamHadSentence = false
        // 新 stream bump token — 旧未完成的合成全部失效
        speakToken++
        if (current) {
          try {
            current.stop()
          } catch {
            /* skip */
          }
          current = null
        }
        playChain = Promise.resolve()
      }
      buffer += delta

      // 抽 clean text（去 thinking / JSON 包装）
      const cleanText = parsePartialText(buffer) || ''
      // 看 spokenUpTo 之后有没有完整一句
      while (true) {
        const newPart = cleanText.slice(spokenUpTo)
        const m = SENTENCE_END.exec(newPart)
        if (!m) break
        const sentence = newPart.slice(0, m.index + 1)
        if (sentence.trim().length < MIN_SENTENCE_LEN) {
          // 太短跳过（往下找下一个标点）— 简化：等下一个 token 再算
          break
        }
        spokenUpTo += sentence.length
        enqueueTTS(sentence.trim(), lastKnownEmotion, speakToken)
        streamHadSentence = true
      }
    })

    bus.on('brain:reply-end', async ({ stream_id, full_text, emotion }) => {
      const cfg = useConfigStore()
      if (!cfg.config || cfg.config.tts_provider === 'none') return
      const finalEmotion = emotion ?? lastKnownEmotion

      // 路径 A:流式回复结束(用户打字 → LLM 流式 → reply-end,stream_id 已注册)
      if (stream_id === activeStream) {
        if (streamHadSentence) {
          // 流式已经播过 — 把残余 flush
          const cleanText = parsePartialText(buffer) || full_text
          const remaining = cleanText.slice(spokenUpTo).trim()
          if (remaining.length > 0) {
            enqueueTTS(remaining, finalEmotion, speakToken)
          }
        } else {
          // 流式没切出任何句子（极短回复 / 无标点） — 整段一次性播
          if (full_text.trim()) {
            enqueueTTS(full_text.trim(), finalEmotion, speakToken)
          }
        }
        // reset 本 stream
        activeStream = null
        buffer = ''
        spokenUpTo = 0
        streamHadSentence = false
        return
      }

      // 路径 B:非流式直接 emit —— 主动说话(plan-executor doSpeak)/ agent_task 汇报 /
      // brain:inject-utterance。这类 reply-end 带 `proactive-*` / `agent-*` 等全新 stream_id,
      // 从未经过流式前奏,所以 stream_id 永远 !== activeStream。
      // 【修复】之前在此被 `stream_id !== activeStream` 直接 return → 主动说话永远没声音。
      // 仅在「当前没有活跃流式播放」时一次性合成,避免打断正在播的对话流。
      if (activeStream === null && full_text.trim()) {
        enqueueTTS(full_text.trim(), finalEmotion, speakToken)
      } else if (activeStream !== null && full_text.trim()) {
        // reviewer-MEDIUM:主动说话撞上正在播的流式对话 → 故意忽略(不打断)。
        // 留 warn 以便未来"主动说话又没声音"时能定位到是被这条吞了,而非 line-100 类 bug 复发。
        console.warn(`[speech] proactive speak dropped (stream active): "${full_text.slice(0, 30)}…"`)
      }
    })
  }

  /**
   * enqueueTTS — 立即 fire 合成 promise（并行），把 (promise + meta) 排到播放队列尾部。
   * 播放队列拿到时大概率已经 resolve，无需等。
   */
  function enqueueTTS(text: string, emotion: EmotionId, myToken: number): void {
    const cfg = useConfigStore()
    const voice = cfg.config?.emotion_voice_map[emotion]
    // 立刻 fire 合成 — 不等任何东西
    // P5: 传 intensity 让 main 端 adjustProsody 调节 rate/pitch
    const synthPromise: Promise<Awaited<ReturnType<typeof window.api.tts.speak>>> = window.api.tts
      .speak({
        text,
        emotion,
        intensity: lastKnownIntensity,
        ...(voice !== undefined ? { voice } : {}),
      })
      .catch((e) => {
        console.warn('[speech] synth failed:', e)
        return { ok: false, reason: String(e) }
      })
    // 播放排队 — 等前一段播完才轮到这段播
    playChain = playChain
      .then(() => playSegment(synthPromise, emotion, myToken))
      .catch((e) => {
        console.warn('[speech] play queue item failed:', e)
      })
  }

  /** 拿一个已 fire 的合成 promise，等它 resolve 然后播 */
  async function playSegment(
    synthPromise: Promise<Awaited<ReturnType<typeof window.api.tts.speak>>>,
    emotion: string,
    myToken: number,
  ): Promise<void> {
    if (myToken !== speakToken) return
    speaking.value = true
    let result: Awaited<ReturnType<typeof window.api.tts.speak>>
    try {
      result = await synthPromise
    } catch (e) {
      lastError.value = String(e)
      // UX R21 fix: 真实 emit service:status, 替代 ServiceStatusPill toast 文本推断
      bus.emit('service:status', {
        service: 'tts',
        status: 'down',
        reason: String(e).slice(0, 100),
      })
      return
    }
    if (myToken !== speakToken) return
    if (!result.ok || !result.audio_b64) {
      lastError.value = result.reason ?? 'tts-failed'
      bus.emit('service:status', {
        service: 'tts',
        status: 'down',
        reason: (result.reason ?? 'tts-failed').slice(0, 100),
      })
      return
    }
    bus.emit('service:status', { service: 'tts', status: 'ok' })
    try {
      // 防御 race：旧 audio 在 await 期间被 new speak 启的（理论不应有，串行 chain）
      const c = current as LipsyncSession | null
      if (c) {
        c.stop()
        current = null
      }
      bus.emit('presence:tts-start', { audio_url: '', emotion: emotion as never })
      const session = await playWithLipsync(result.audio_b64, result.mime ?? 'audio/wav')
      if (myToken !== speakToken) {
        session.stop()
        return
      }
      current = session
      await session.ended
    } catch (e) {
      lastError.value = String(e)
    } finally {
      if (myToken === speakToken) {
        speaking.value = false
        current = null
      }
    }
  }

  /** speakOne — 完整文本一次性合成 + 播放（给 speak() 非流式入口用） */
  async function speakOne(text: string, emotion: string, myToken: number): Promise<void> {
    if (myToken !== speakToken) return
    const cfg = useConfigStore()
    const voice = cfg.config?.emotion_voice_map[emotion]
    const synthP = window.api.tts.speak({ text, emotion, ...(voice !== undefined ? { voice } : {}) }).catch((e) => ({
      ok: false as const,
      reason: String(e),
    }))
    await playSegment(synthP, emotion, myToken)
  }

  /** 直接接受完整文本 TTS — 给非流式调用用（比如 system toast、proactive plan） */
  async function speak(text: string, emotion: string): Promise<void> {
    speakToken++
    if (current) {
      try {
        current.stop()
      } catch {
        /* skip */
      }
      current = null
    }
    playChain = Promise.resolve()
    await speakOne(text, emotion, speakToken)
  }

  function stop(): void {
    speakToken++ // 任何待播都失效
    current?.stop()
    current = null
    playChain = Promise.resolve()
    speaking.value = false
  }

  return { speaking, lastError, bootstrap, speak, stop }
})
