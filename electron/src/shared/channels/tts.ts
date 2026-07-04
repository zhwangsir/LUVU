/**
 * TTS IPC channels (Phase 1 W4)。
 */
import { defineChannel } from '../ipc-channel'

export const ttsSpeak = defineChannel<
  {
    text: string
    voice?: string
    emotion?: string
    /** P5: 0..1 emotion intensity，用于 prosody 调整 (越强 rate/pitch delta 越大) */
    intensity?: number
  },
  { ok: boolean; audio_b64?: string; mime?: string; reason?: string }
>('tts:speak')

/** main 用 ok: boolean 不是 literal — channel 跟实际对齐 */
export const ttsListRvcVoices = defineChannel<
  void,
  { ok: boolean; voices: string[]; reason?: string; sidecar?: string }
>('tts:list-rvc-voices')

export const ttsProbe = defineChannel<
  void,
  { ok: boolean; status?: number; url?: string; reason?: string }
>('tts:probe')
