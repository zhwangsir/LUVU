/**
 * useFloatingPanel — 通用浮窗 composable
 *
 * 给任何面板组件提供：
 *   - 浮窗的位置/大小（rect: x, y, w, h）
 *   - 字号缩放（zoom: 0.7 ~ 1.5）
 *   - 紧凑模式（compact: 间距/内边距砍小）
 *   - 8 个 resize handle 的 startDrag 行为
 *   - localStorage 持久化（按 storageKey 区分不同面板）
 *
 * 使用：
 *   const fp = useFloatingPanel('settings', { width: 720, height: 640 })
 *   <FloatingPanel :fp="fp" title="..." @close="...">{...}</FloatingPanel>
 */
import { computed, ref, type CSSProperties, type ComputedRef, type Ref } from 'vue'

export interface FloatingPanelRect {
  x: number
  y: number
  w: number
  h: number
}

export type DragMode =
  | 'move'
  | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r'
  | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br'

export interface FloatingPanelDefaults {
  /** 默认宽度，单位 px。若超出屏幕宽自动缩小。 */
  width?: number
  /** 默认高度 */
  height?: number
  /** 最小宽度 */
  minW?: number
  /** 最小高度 */
  minH?: number
  /** 最大宽度 — 默认 95vw */
  maxW?: number | (() => number)
  /** 最大高度 — 默认 95vh */
  maxH?: number | (() => number)
}

export interface UseFloatingPanelReturn {
  rect: Ref<FloatingPanelRect>
  zoom: Ref<number>
  compact: Ref<boolean>
  dragging: Ref<DragMode | null>
  panelStyle: ComputedRef<CSSProperties>
  startDrag: (mode: DragMode, e: MouseEvent) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  toggleCompact: () => void
  maximize: () => void
  resetRect: () => void
}

const LS_PREFIX = 'luvu.floating-panel.'

function readLS<T>(key: string, fallback: T, parse: (s: string) => T): T {
  try {
    const v = localStorage.getItem(LS_PREFIX + key)
    return v == null ? fallback : parse(v)
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(LS_PREFIX + key, value)
  } catch {
    /* quota / disabled */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function useFloatingPanel(
  storageKey: string,
  defaults: FloatingPanelDefaults = {},
): UseFloatingPanelReturn {
  const minW = defaults.minW ?? 420
  const minH = defaults.minH ?? 360
  const resolveMaxW = (): number =>
    typeof defaults.maxW === 'function'
      ? defaults.maxW()
      : (defaults.maxW ?? Math.max(minW, window.innerWidth - 24))
  const resolveMaxH = (): number =>
    typeof defaults.maxH === 'function'
      ? defaults.maxH()
      : (defaults.maxH ?? Math.max(minH, window.innerHeight - 24))

  function defaultRect(): FloatingPanelRect {
    const w = Math.min(defaults.width ?? 900, window.innerWidth - 48)
    const h = Math.min(defaults.height ?? 720, window.innerHeight - 48)
    return {
      w,
      h,
      x: Math.max(24, (window.innerWidth - w) / 2),
      y: Math.max(24, (window.innerHeight - h) / 2),
    }
  }

  const rect = ref<FloatingPanelRect>(
    readLS(`${storageKey}.rect`, defaultRect(), (s) => {
      try {
        const parsed = JSON.parse(s) as FloatingPanelRect
        // 防御：window 缩小后旧 rect 可能完全在屏外
        if (parsed.x + parsed.w > window.innerWidth || parsed.y + parsed.h > window.innerHeight) {
          return defaultRect()
        }
        return parsed
      } catch {
        return defaultRect()
      }
    }),
  )
  const zoom = ref<number>(readLS(`${storageKey}.zoom`, 1.0, parseFloat))
  const compact = ref<boolean>(readLS(`${storageKey}.compact`, false, (s) => s === '1'))
  const dragging = ref<DragMode | null>(null)

  function persistRect(): void { writeLS(`${storageKey}.rect`, JSON.stringify(rect.value)) }
  function persistZoom(): void { writeLS(`${storageKey}.zoom`, String(zoom.value)) }
  function persistCompact(): void { writeLS(`${storageKey}.compact`, compact.value ? '1' : '0') }

  function zoomIn(): void {
    zoom.value = Math.min(1.5, +(zoom.value + 0.1).toFixed(2))
    persistZoom()
  }
  function zoomOut(): void {
    zoom.value = Math.max(0.7, +(zoom.value - 0.1).toFixed(2))
    persistZoom()
  }
  function zoomReset(): void {
    zoom.value = 1.0
    persistZoom()
  }
  function toggleCompact(): void {
    compact.value = !compact.value
    persistCompact()
  }
  function maximize(): void {
    rect.value = { x: 24, y: 24, w: window.innerWidth - 48, h: window.innerHeight - 48 }
    persistRect()
  }
  function resetRect(): void {
    rect.value = defaultRect()
    persistRect()
  }

  function startDrag(mode: DragMode, e: MouseEvent): void {
    dragging.value = mode
    const startMouse = { x: e.clientX, y: e.clientY }
    const startRect = { ...rect.value }
    const maxW = resolveMaxW()
    const maxH = resolveMaxH()

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startMouse.x
      const dy = ev.clientY - startMouse.y
      const next: FloatingPanelRect = { ...startRect }
      const r = mode
      if (r === 'move') {
        next.x = clamp(startRect.x + dx, 0, window.innerWidth - startRect.w)
        next.y = clamp(startRect.y + dy, 0, window.innerHeight - 40)
      }
      if (r.includes('r')) {
        next.w = clamp(startRect.w + dx, minW, Math.min(maxW, window.innerWidth - startRect.x))
      }
      if (r.includes('b')) {
        next.h = clamp(startRect.h + dy, minH, Math.min(maxH, window.innerHeight - startRect.y))
      }
      if (r.includes('l')) {
        const newW = clamp(startRect.w - dx, minW, maxW)
        next.x = Math.max(0, startRect.x + (startRect.w - newW))
        next.w = newW
      }
      if (r.includes('t')) {
        const newH = clamp(startRect.h - dy, minH, maxH)
        next.y = Math.max(0, startRect.y + (startRect.h - newH))
        next.h = newH
      }
      rect.value = next
    }
    const onUp = (): void => {
      dragging.value = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      persistRect()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
    e.stopPropagation()
  }

  const panelStyle = computed<CSSProperties>(() => ({
    left: `${rect.value.x}px`,
    top: `${rect.value.y}px`,
    width: `${rect.value.w}px`,
    height: `${rect.value.h}px`,
    fontSize: `${13 * zoom.value}px`,
  }))

  return {
    rect,
    zoom,
    compact,
    dragging,
    panelStyle,
    startDrag,
    zoomIn,
    zoomOut,
    zoomReset,
    toggleCompact,
    maximize,
    resetRect,
  }
}
