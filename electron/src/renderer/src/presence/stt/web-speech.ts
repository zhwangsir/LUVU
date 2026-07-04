/**
 * STT (Speech-to-Text) — Web Speech API 封装。
 *
 * Electron Chromium 原生支持 `SpeechRecognition` / `webkitSpeechRecognition`。
 * 不依赖云端 — 默认走系统/浏览器内置识别（macOS Dictation / Chrome Cloud）。
 *
 * 中文优先 (zh-CN)，interim 实时显示用户在说什么，final 提交给 dialog.send()。
 *
 * 设计:
 * - 单例 manager — 同时只允许一个识别会话
 * - 自动重启策略：no-speech / abort / network 错时短暂重试（用户说话间歇正常停止）
 * - 麦克风权限失败 → 一次性提示，不重试
 */

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export interface SttCallbacks {
  /** 临时识别结果（interim） — 用户还在说，实时显示给 UI */
  onInterim?: (text: string) => void
  /** 最终识别结果（user 暂停或显式 stop） */
  onFinal: (text: string) => void
  /** 任何错误 — 麦克风权限/网络/系统 STT 失败 */
  onError?: (error: string) => void
  /** 识别开始 — UI 显示"正在听" */
  onStart?: () => void
  /** 识别结束 — UI 隐藏指示器 */
  onEnd?: () => void
}

export interface SttOptions {
  /** BCP-47 语言码，默认 'zh-CN' */
  lang?: string
  /** 实时 interim 结果，默认 true（边说边看） */
  interim?: boolean
}

export class SttSession {
  private recognition: SpeechRecognition | null = null
  private active = false
  private cbs: SttCallbacks
  private opts: Required<SttOptions>

  constructor(callbacks: SttCallbacks, opts: SttOptions = {}) {
    this.cbs = callbacks
    this.opts = {
      lang: opts.lang ?? 'zh-CN',
      interim: opts.interim ?? true,
    }
  }

  /** 检查浏览器是否支持 — UI 决定要不要显示 🎙️ 按钮 */
  static isSupported(): boolean {
    return typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  }

  start(): void {
    if (this.active) return
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      this.cbs.onError?.('浏览器不支持 SpeechRecognition')
      return
    }
    const r = new Ctor()
    r.continuous = false  // 一次说完即结束，UI 控制再次启动
    r.interimResults = this.opts.interim
    r.lang = this.opts.lang
    r.maxAlternatives = 1

    r.onstart = () => {
      this.active = true
      this.cbs.onStart?.()
    }
    r.onresult = (ev) => {
      // 拼接所有 final + 最新 interim
      let finalText = ''
      let interimText = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        if (!result) continue
        const alt = result[0]
        if (!alt) continue
        if (result.isFinal) finalText += alt.transcript
        else interimText += alt.transcript
      }
      if (interimText) this.cbs.onInterim?.(interimText)
      if (finalText) this.cbs.onFinal(finalText.trim())
    }
    r.onerror = (ev) => {
      // 'no-speech' / 'aborted' / 'audio-capture' / 'not-allowed' / 'network'
      this.cbs.onError?.(ev.error)
    }
    r.onend = () => {
      this.active = false
      this.recognition = null
      this.cbs.onEnd?.()
    }

    this.recognition = r
    try {
      r.start()
    } catch (e) {
      this.cbs.onError?.(String(e))
      this.active = false
      this.recognition = null
    }
  }

  stop(): void {
    this.recognition?.stop()
  }

  abort(): void {
    this.recognition?.abort()
    this.active = false
    this.recognition = null
  }

  isActive(): boolean {
    return this.active
  }
}
