/**
 * Lipsync —— wlipsync AudioWorklet (MFCC + AEIOU) → 总线 'avatar:lipsync' + 'avatar:vowel-weights'。
 *
 * Phase 1: wlipsync 集成（替代之前的 RMS）。质变点：
 *   - 旧 RMS: 音量大才张嘴，元音音量小不张 → 机械张合感
 *   - wlipsync: MFCC + 元音分类 → 元音清晰就张嘴，音量低也能开口 → 真说话感
 *
 * 接口向后兼容: bus.emit('avatar:lipsync', { value: number }) 保留 — Live2DStage 无需改动
 * 新增: bus.emit('avatar:vowel-weights', { A, E, I, O, U }) 未来驱动多参数嘴型用
 *
 * Profile: public/wlipsync/profile.json (来自 wlipsync example，AEIOU MFCC 训练数据)
 */
import { createWLipSyncNode, type Profile } from 'wlipsync'
import { bus } from '../../infra/eventbus'

export interface LipsyncSession {
  stop(): void
  ended: Promise<void>
}

// AEIOUS → AEIOU 重映射（S = silence → 闭嘴）
const RAW_KEYS = ['A', 'E', 'I', 'O', 'U', 'S'] as const
type RawKey = typeof RAW_KEYS[number]
export type VowelKey = 'A' | 'E' | 'I' | 'O' | 'U'
const VOWEL_KEYS: VowelKey[] = ['A', 'E', 'I', 'O', 'U']

/** 缓存 profile — 首次加载后全局复用 */
let profilePromise: Promise<Profile> | null = null
async function loadProfile(): Promise<Profile> {
  if (profilePromise) return profilePromise
  profilePromise = fetch('./wlipsync/profile.json')
    .then((r) => {
      if (!r.ok) throw new Error(`profile.json HTTP ${r.status}`)
      return r.json() as Promise<Profile>
    })
    .catch((e) => {
      profilePromise = null  // 失败时清掉让下次重试
      throw e
    })
  return profilePromise
}

/** 从 raw weights (含 S) 重映射 + 取最响元音作为 mouthOpen */
function computeMouthOpen(rawWeights: Record<RawKey, number>, volume: number): {
  mouthOpen: number
  vowels: Record<VowelKey, number>
} {
  const vowels: Record<VowelKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 }
  for (const k of VOWEL_KEYS) {
    vowels[k] = rawWeights[k] ?? 0
  }
  // S (silence) 不计入 — 反而 dampen 嘴开度
  const silence = rawWeights.S ?? 0
  let maxVowel = 0
  for (const k of VOWEL_KEYS) if (vowels[k] > maxVowel) maxVowel = vowels[k]
  // mouthOpen = max vowel × volume × (1 - silence/2) — 元音强 + 音量大 + 非静默 才张大嘴
  const raw = maxVowel * Math.min(1, volume * 2) * (1 - silence * 0.5)
  // clamp 到 0~0.85 保留 Live2D 边界余量
  const mouthOpen = Math.max(0, Math.min(0.85, raw))
  return { mouthOpen, vowels }
}

export async function playWithLipsync(b64: string, mime: string): Promise<LipsyncSession> {
  const blob = b64ToBlob(b64, mime || 'audio/wav')
  const url = URL.createObjectURL(blob)

  const audio = new Audio(url)
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'

  const AC = window.AudioContext ?? window.webkitAudioContext
  const ctx: AudioContext = new AC()

  // 加载 profile + 创 wlipsync AudioWorklet node
  let lipsyncNode: Awaited<ReturnType<typeof createWLipSyncNode>> | null = null
  try {
    const profile = await loadProfile()
    lipsyncNode = await createWLipSyncNode(ctx, profile)
  } catch (e) {
    // wlipsync 失败（profile 加载失败 / AudioWorklet 不支持 / WASM 错）
    // fallback: 仍播音频，只是没嘴型
    console.warn('[lipsync] wlipsync init failed, audio plays without mouth sync:', e)
  }

  const src = ctx.createMediaElementSource(audio)
  if (lipsyncNode) src.connect(lipsyncNode)
  src.connect(ctx.destination)

  let stopped = false
  let raf = 0

  function loop(): void {
    if (stopped) return
    if (lipsyncNode) {
      const weights = lipsyncNode.weights as Record<RawKey, number>
      const volume = lipsyncNode.volume
      const { mouthOpen, vowels } = computeMouthOpen(weights, volume)
      bus.emit('avatar:lipsync', { value: mouthOpen })
      bus.emit('avatar:vowel-weights', vowels)
    }
    raf = requestAnimationFrame(loop)
  }

  const cleanup = (): void => {
    stopped = true
    cancelAnimationFrame(raf)
    bus.emit('avatar:lipsync', { value: 0 })
    bus.emit('presence:tts-end')
    URL.revokeObjectURL(url)
    ctx.close().catch(() => undefined)
  }

  const ended = new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => {
      cleanup()
      resolve()
    })
    audio.addEventListener('error', () => {
      cleanup()
      resolve()
    })
  })

  await audio.play()
  raf = requestAnimationFrame(loop)

  return {
    stop(): void {
      cleanup()
      audio.pause()
    },
    ended,
  }
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const len = bin.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
  return new Blob([u8], { type: mime })
}
