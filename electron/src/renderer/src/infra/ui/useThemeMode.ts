/**
 * useThemeMode (R33) — 主题模式控制。
 *
 * 三态:
 *   - 'auto'  → 跟随系统 prefers-color-scheme（默认）
 *   - 'light' → 强制 light
 *   - 'dark'  → 强制 dark
 *
 * 实现: 写 :root[data-theme=...]，global.css 选择器配套切换。
 * 持久化: localStorage 'luvu-theme-mode'（不入 cfg.json，避免主进程读写延迟）。
 */
import { ref, watch, type Ref } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'
const STORAGE_KEY = 'luvu-theme-mode'

/** R39 fix: 单一 source of truth — UI 展示也用这个 map */
export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
}

function readPersisted(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'auto'
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'auto' || v === 'light' || v === 'dark') return v
  return 'auto'
}

/** 应用到 DOM — auto 时移除属性让 @media 接管 */
function apply(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }
}

// 单例 — 整个 app 共享一份 ref，所有组件 watch 同一 source
const mode: Ref<ThemeMode> = ref(readPersisted())
let initialized = false

function ensureInit(): void {
  if (initialized) return
  initialized = true
  apply(mode.value)
  watch(mode, (now) => {
    apply(now)
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, now)
    } catch {
      // localStorage 满 / 隐私模式 — 静默忽略，运行期主题仍然生效
    }
  })
}

export function useThemeMode(): {
  mode: Ref<ThemeMode>
  setMode: (m: ThemeMode) => void
  cycle: () => void
} {
  ensureInit()
  return {
    mode,
    setMode: (m) => {
      mode.value = m
    },
    cycle: () => {
      const next: ThemeMode =
        mode.value === 'auto' ? 'light' : mode.value === 'light' ? 'dark' : 'auto'
      mode.value = next
    },
  }
}
