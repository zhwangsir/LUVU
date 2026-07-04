<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'

interface ToastAction {
  label: string
  do: () => void
}
interface Toast {
  id: number
  kind: 'info' | 'warn' | 'error' | 'success'
  message: string
  ttl: number
  action?: ToastAction
  /** R112: 出现次数, 重复 toast 显示 (×N) 而非堆叠 */
  count: number
}

const toasts = ref<Toast[]>([])
let nextId = 1
const MAX_VISIBLE = 4

let offHandler: (() => void) | null = null

function push(kind: Toast['kind'], message: string, ttl: number, action?: ToastAction): void {
  // R112+R114-fix (LOW): 同 kind + message 已在显示 → 仅 +count (不堆叠重复)
  // count cap 99 防 ttl=0 toast 无限递增
  const existing = toasts.value.find((t) => t.kind === kind && t.message === message)
  if (existing) {
    toasts.value = toasts.value.map((t) =>
      t.id === existing.id ? { ...t, count: Math.min(t.count + 1, 99) } : t,
    )
    return
  }
  const id = nextId++
  const newToast: Toast = { id, kind, message, ttl, count: 1, ...(action && { action }) }
  toasts.value = [...toasts.value, newToast]
  if (toasts.value.length > MAX_VISIBLE) {
    toasts.value = toasts.value.slice(-MAX_VISIBLE)
  }
  // R31: error toast ttl=0 → 用户必须手动 dismiss（重要错误不会被秒消失）
  if (ttl > 0) {
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ttl)
  }
}

/** R98: action click → 执行 + 立即 dismiss toast */
function onAction(t: Toast): void {
  try {
    t.action?.do()
  } catch (e) {
    console.warn('[toast] action threw:', e)
  }
  dismiss(t.id)
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

onMounted(() => {
  const handler = ({
    kind,
    message,
    ttl_ms,
    action,
  }: {
    kind: Toast['kind']
    message: string
    ttl_ms?: number
    action?: ToastAction
  }): void => {
    push(kind, message, ttl_ms ?? 4000, action)
  }
  bus.on('ui:toast', handler)
  offHandler = () => bus.off('ui:toast', handler)
})

onBeforeUnmount(() => {
  offHandler?.()
})

const iconFor: Record<Toast['kind'], string> = {
  info: 'ℹ',
  warn: '!',
  error: '✕',
  success: '✓',
}
</script>

<template>
  <div class="stack" aria-live="polite">
    <transition-group name="toast" tag="div">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.kind"
        role="status"
      >
        <span class="icon" :class="t.kind" aria-hidden="true">{{ iconFor[t.kind] }}</span>
        <span class="msg">{{ t.message }}</span>
        <span v-if="t.count > 1" class="count-badge" :aria-label="`重复 ${t.count} 次`">×{{ t.count }}</span>
        <button
          v-if="t.action"
          class="action-btn"
          :aria-label="t.action.label"
          @click.stop="onAction(t)"
        >{{ t.action.label }}</button>
        <button
          class="dismiss"
          :aria-label="`关闭通知: ${t.message.slice(0, 40)}`"
          title="关闭 (或点击通知)"
          @click.stop="dismiss(t.id)"
        >✕</button>
        <span
          v-if="t.ttl > 0"
          class="progress"
          :style="{ animationDuration: t.ttl + 'ms' }"
        ></span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.stack {
  position: fixed;
  right: 18px;
  bottom: 80px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1500;
  pointer-events: none;
  max-width: 320px;
}
.toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  overflow: hidden;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast);
}
.toast:hover {
  transform: translateX(-3px);
  box-shadow: var(--shadow-lg);
}
.toast.error {
  border-left: 3px solid var(--color-danger);
}
.toast.warn {
  border-left: 3px solid var(--color-warn);
}
.toast.success {
  border-left: 3px solid var(--color-success);
}
.toast.info {
  border-left: 3px solid var(--color-accent);
}

.icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-accent-text);
}
.icon.info { background: var(--color-accent); }
.icon.error { background: var(--color-danger); }
.icon.warn { background: var(--color-warn); }
.icon.success { background: var(--color-success); }

.msg {
  flex: 1;
  line-height: 1.45;
  word-break: break-word;
  padding-top: 2px;
  /* R31: 长 error message 折叠避免遮挡屏幕 */
  max-height: 10em;
  overflow-y: auto;
}
/* R112: 重复计数角标 */
.count-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-bubble-surface);
  color: var(--color-muted);
  font-size: 10px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-weight: 600;
}

/* R98: action 按钮 — toast 内联可点击 */
.action-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast), transform var(--duration-fast);
}
.action-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
}
.action-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.dismiss {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.dismiss:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}
.dismiss:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

/* 倒计时进度条 — 视觉提示「自动消失」 */
.progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: currentColor;
  opacity: 0.15;
  animation-name: toast-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
  transform-origin: left;
}
.toast.info .progress { color: var(--color-accent); }
.toast.error .progress { color: var(--color-danger); }
.toast.warn .progress { color: var(--color-warn); }
.toast.success .progress { color: var(--color-success); }

@keyframes toast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
