/**
 * useFocusTrap — overlay dialog 的 a11y composable (R29, R32-fix)。
 *
 * 功能:
 *   1. 打开时 focus 容器内第一个可聚焦元素
 *   2. Tab / Shift+Tab 循环困在容器内（焦点跑出去也强行拉回首项）
 *   3. 关闭时把 focus 还给打开前激活的元素
 *
 * 使用 (推荐 — Ref):
 *   const containerRef = ref<HTMLElement | null>(null)
 *   const isOpen = computed(() => props.open)
 *   useFocusTrap(containerRef, isOpen)
 *
 * 也可传普通 getter（必须内部读 reactive 数据，否则 watch 不重跑）:
 *   useFocusTrap(containerRef, () => props.open)
 *
 * 不监听 Escape — 各组件已有自己的 Esc 处理逻辑（避免冲突）。
 */
import { onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 接受 Ref/ComputedRef（推荐）或 getter 函数（getter 内部必须访问响应式数据） */
type ActiveSource = Ref<boolean> | ComputedRef<boolean> | (() => boolean)

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  active: ActiveSource,
): void {
  const previouslyFocused = ref<HTMLElement | null>(null)

  function readActive(): boolean {
    return typeof active === 'function' ? active() : active.value
  }

  function isVisible(el: HTMLElement): boolean {
    // checkVisibility 优先（Chromium 105+ / Electron 25+，覆盖 visibility/opacity/display:none）
    if (typeof (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility === 'function') {
      return (el as HTMLElement & { checkVisibility: () => boolean }).checkVisibility()
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0
  }

  function getFocusable(): HTMLElement[] {
    const root = containerRef.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      isVisible,
    )
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!readActive() || e.key !== 'Tab') return
    const root = containerRef.value
    if (!root) return
    const focusable = getFocusable()
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement as HTMLElement | null
    // HIGH-fix (R32): 焦点跑出容器后再按 Tab 也强行拉回，防焦点逃逸
    if (!root.contains(active)) {
      e.preventDefault()
      first.focus()
      return
    }
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // 用 Ref 时改 watch ref；用 getter 时用 getter — Vue watch 两种都支持
  watch(
    typeof active === 'function' ? active : (() => active.value),
    (now: boolean) => {
      if (now) {
        previouslyFocused.value = document.activeElement as HTMLElement | null
        void Promise.resolve().then(() => {
          const focusable = getFocusable()
          focusable[0]?.focus()
        })
        window.addEventListener('keydown', onKeydown, true)
      } else {
        window.removeEventListener('keydown', onKeydown, true)
        previouslyFocused.value?.focus?.()
        previouslyFocused.value = null
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
    previouslyFocused.value?.focus?.()
  })
}
