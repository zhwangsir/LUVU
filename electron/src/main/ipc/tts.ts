/**
 * TTS IPC handlers — 从 ipc/system.ts 剥离 (v0.13 audit architecture HIGH)。
 *
 * 包含：
 *   - tts:speak — 主 IPC：先试 sidecar (含 RVC + 节奏参数透传)，fallback macOS say
 *   - tts:list-rvc-voices — 列 workstation RVC 已训练音色
 *   - tts:probe — sidecar 健康检查
 *   - stripEmotionPrefix — LLM 输出「（害羞）」类前缀剥离
 *   - macSayToWav — macOS `say` 兜底合成
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../services/config-store'
import { validateSidecarUrl } from '../services/url-guard'
import { adjustProsody } from '../services/tts/prosody'
import { ttsListRvcVoices, ttsProbe, ttsSpeak } from '@shared/channels/tts'
import { handleInvoke } from './channel-helpers'

const execFileAsync = promisify(execFile)

/**
 * 去掉 LLM 输出常见的「情感括号前缀」— 这些应当用 emotion 字段+语气表达，
 * 不应被 TTS 念出来。
 *   匹配：（害羞）、(shy)、【撒娇地】、[note]、*tease*、~小声~
 *   保守：只删开头连续的标注块，正文里的括号不动
 */
function stripEmotionPrefix(text: string): string {
  let s = text.trim()
  // 循环最多 3 次去掉嵌套/多重前缀（如「（撒娇地）（小声）主人...」）
  for (let i = 0; i < 3; i++) {
    const m = s.match(
      /^(?:[（(【\[][^）)】\]\n]{1,30}[）)】\]]|[*~_][^*~_\n]{1,30}[*~_])\s*[，,、。\.\s]*/,
    )
    if (!m || m[0].length === 0) break
    s = s.slice(m[0].length)
  }
  return s.trim()
}

async function macSayToWav(text: string): Promise<
  { ok: true; audio_b64: string; mime: string } | { ok: false; reason: string }
> {
  if (!text.trim()) return { ok: false, reason: 'empty-text' }
  const voice = 'Tingting'
  const outFile = join(tmpdir(), `luvu-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
  const t0 = Date.now()
  try {
    await execFileAsync(
      'say',
      ['-v', voice, '-o', outFile, '--data-format=LEI16@22050', text],
      { timeout: 30_000 },
    )
    const buf = await readFile(outFile)
    console.log(
      `[tts] macSay ok len=${text.length} wav=${(buf.length / 1024).toFixed(1)}KB dt=${Date.now() - t0}ms`,
    )
    return { ok: true, audio_b64: buf.toString('base64'), mime: 'audio/wav' }
  } catch (e) {
    console.error(`[tts] macSay FAILED: ${String(e).slice(0, 200)}`)
    return { ok: false, reason: `macSay: ${String(e).slice(0, 120)}` }
  } finally {
    await unlink(outFile).catch(() => {})
  }
}

export function registerTtsIpc(): void {
  handleInvoke(ttsSpeak, async (payload) => {
      const cfg = loadConfig()
      const emotion = payload.emotion ?? 'neutral'
      const voiceId = payload.voice ?? cfg.emotion_voice_map[emotion] ?? 'clone_base'
      const cleanText = stripEmotionPrefix(payload.text)
      if (!cleanText) return { ok: false, reason: 'empty-text-after-strip' }
      const ttsPayloadText = cleanText
      if (cfg.tts_provider === 'sidecar' && cfg.tts_sidecar_url) {
        const urls = Array.isArray(cfg.tts_sidecar_url)
          ? cfg.tts_sidecar_url.filter((u) => u && u.trim())
          : cfg.tts_sidecar_url
            ? [cfg.tts_sidecar_url]
            : []
        for (let i = 0; i < urls.length; i++) {
          const baseUrl = urls[i]!
          const guard = validateSidecarUrl(baseUrl)
          if (!guard.ok) {
            console.warn(`[tts] URL guard blocked ${baseUrl}: ${guard.reason}`)
            continue
          }
          const tryVoice = voiceId
          try {
            const url = `${baseUrl.replace(/\/+$/, '')}/v1/audio/speech`
            const t0 = Date.now()
            const body: Record<string, unknown> = {
              text: ttsPayloadText,
              voice: tryVoice,
              emotion,
            }
            if (cfg.rvc_voice && cfg.rvc_voice.trim()) {
              body.rvc_voice = cfg.rvc_voice.trim()
              body.rvc_f0_up_key = cfg.rvc_f0_up_key ?? 0
              body.rvc_index_rate = cfg.rvc_index_rate ?? 0.75
              body.rvc_f0_method = cfg.rvc_f0_method ?? 'rmvpe'
              body.rvc_protect = cfg.rvc_protect ?? 0.33
              body.rvc_filter_radius = cfg.rvc_filter_radius ?? 3
              body.rvc_rms_mix_rate = cfg.rvc_rms_mix_rate ?? 1.0
              body.rvc_resample_sr = cfg.rvc_resample_sr ?? 0
            }
            // P5: mood-aware prosody — emotion + intensity 叠加 rate/pitch 调整
            const prosody = adjustProsody(
              { rate: cfg.tts_rate ?? '+0%', pitch: cfg.tts_pitch ?? '+0Hz' },
              payload.emotion,
              payload.intensity,
            )
            body.rate = prosody.rate
            body.pitch = prosody.pitch
            if (cfg.tts_volume) body.volume = cfg.tts_volume
            if (prosody.applied) {
              console.log(
                `[tts] prosody mood-aware: ${prosody.applied.emotion}/${prosody.applied.intensity.toFixed(2)} ` +
                  `→ rate ${prosody.rate} pitch ${prosody.pitch}`,
              )
            }
            // v0.17：从 120s 改 15s — 远程 sidecar 挂了别让用户每次等 2 分钟
            // 合理的 RVC 合成 < 8s（含 RVC 转音色），15s 留余量
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15_000),
            })
            if (r.ok) {
              const buf = await r.arrayBuffer()
              const mime = r.headers.get('content-type') || 'audio/wav'
              console.log(
                `[tts] sidecar ok ${baseUrl} voice=${tryVoice} emotion=${emotion} bytes=${(buf.byteLength / 1024).toFixed(1)}KB dt=${Date.now() - t0}ms`,
              )
              return { ok: true, audio_b64: Buffer.from(buf).toString('base64'), mime }
            }
            const errText = await r.text().catch(() => '')
            console.warn(`[tts] sidecar ${baseUrl} HTTP ${r.status} ${errText.slice(0, 100)}，try next`)
          } catch (e) {
            console.warn(`[tts] sidecar ${baseUrl} unreachable，try next:`, String(e).slice(0, 80))
          }
        }
        console.warn('[tts] 所有 sidecar 都失败，fallback macOS say')
      }
      if (process.platform === 'darwin') {
        return await macSayToWav(cleanText)
      }
      return { ok: false, reason: 'no-tts-backend' }
    })

  handleInvoke(ttsListRvcVoices, async () => {
    const cfg = loadConfig()
    if (!cfg.tts_sidecar_url) return { ok: false, voices: [], reason: 'no-sidecar' }
    const urls = Array.isArray(cfg.tts_sidecar_url) ? cfg.tts_sidecar_url : [cfg.tts_sidecar_url]
    for (const u of urls) {
      const guard = validateSidecarUrl(u)
      if (!guard.ok) continue
      try {
        const r = await fetch(`${u.replace(/\/+$/, '')}/v1/rvc/voices`, {
          signal: AbortSignal.timeout(8000),
        })
        if (!r.ok) continue
        const data = (await r.json()) as { available?: boolean; voices?: string[]; reason?: string }
        if (data.available) {
          return { ok: true, voices: data.voices ?? [], sidecar: u }
        }
        return { ok: false, voices: [], reason: data.reason ?? 'rvc-unavailable', sidecar: u }
      } catch {
        /* try next */
      }
    }
    return { ok: false, voices: [], reason: 'all-sidecars-unreachable' }
  })

  handleInvoke(ttsProbe, async () => {
    const cfg = loadConfig()
    if (!cfg.tts_sidecar_url) return { ok: false, reason: 'no-url' }
    const urls = Array.isArray(cfg.tts_sidecar_url) ? cfg.tts_sidecar_url : [cfg.tts_sidecar_url]
    for (const u of urls) {
      const guard = validateSidecarUrl(u)
      if (!guard.ok) continue
      try {
        const r = await fetch(`${u.replace(/\/+$/, '')}/healthz`, {
          signal: AbortSignal.timeout(3000),
        })
        if (r.ok) return { ok: true, status: r.status, url: u }
      } catch {
        /* try next */
      }
    }
    return { ok: false, reason: 'all-backends-unreachable' }
  })
}

