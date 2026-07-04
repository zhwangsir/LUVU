<script setup lang="ts">
/**
 * Vue ErrorBoundary — 域隔离。
 *
 * P4.2 升级:
 *   - 支持 label prop 区分错误来源 ("设置面板" / "资源商店" / ...)
 *   - reset 用 key++ 强制子树重新挂载，丢弃可能损坏的旧状态
 *   - 缩窄默认 UI：scope='panel' 不再占满全屏，只在父容器内显示
 *   - scope='app' 仍用全屏 overlay 兜底
 */
import { computed, onErrorCaptured, ref } from 'vue'
import { bus } from '../eventbus'

const props = withDefaults(
  defineProps<{
    /** 友好标签，错误 UI 显示用 (如 "设置面板") */
    label?: string
    /** 错误 UI 模式: 'app' = 全屏 overlay (兜底), 'panel' = inline 在原容器内 */
    scope?: 'app' | 'panel'
    /** 静默模式 — 不弹 toast (panel 级若太频繁可关) */
    silent?: boolean
  }>(),
  { scope: 'app', silent: false },
)

const error = ref<Error | null>(null)
const detail = ref<string>('')
const renderKey = ref(0)

const labelDisplay = computed(() => props.label ?? '渲染层')

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err))
  detail.value = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`[ErrorBoundary:${labelDisplay.value}]`, err)
  if (!props.silent) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `${labelDisplay.value}出错: ${error.value.message || '未捕获错误'}`,
      ttl_ms: 8000,
    })
  }
  // 返回 false 阻止冒泡，避免 Vue 默认 reporter 重复
  return false
})

function reset(): void {
  error.value = null
  detail.value = ''
  renderKey.value++ // 强制重新挂载子树
}

async function reload(): Promise<void> {
  location.reload()
}

function copyError(): void {
  if (!error.value) return
  const text = `[${labelDisplay.value}] ${error.value.message}\n\n${detail.value}`
  void navigator.clipboard?.writeText(text).catch(() => {
    /* clipboard 可能被禁用 */
  })
  bus.emit('ui:toast', { kind: 'success', message: '错误已复制', ttl_ms: 1500 })
}
</script>

<template>
  <div v-if="!error" :key="renderKey" class="boundary-pass">
    <slot />
  </div>
  <div v-else :class="['boundary', `scope-${scope}`]">
    <div class="card" role="alert">
      <div class="head">
        <span class="dot" />
        <h2>{{ labelDisplay }}出错了</h2>
      </div>
      <p class="msg">{{ error.message || '渲染层抛出未捕获错误' }}</p>
      <details>
        <summary>展开技术细节</summary>
        <pre>{{ detail }}</pre>
      </details>
      <div class="actions">
        <button class="ghost" @click="copyError">📋 复制错误</button>
        <button class="ghost" @click="reset">🔄 重试</button>
        <button v-if="scope === 'app'" class="primary" @click="reload">重启 renderer</button>
      </div>
      <p v-if="scope === 'panel'" class="hint-inline">
        此错误已被隔离 — 其他面板不受影响
      </p>
    </div>
  </div>
</template>

<style scoped>
.boundary-pass {
  display: contents;
}
.boundary.scope-app {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0% 0 0 / 0.4);
  backdrop-filter: blur(4px);
  pointer-events: auto;
  z-index: 2000;
}
.boundary.scope-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: auto;
}
.hint-inline {
  color: var(--color-muted);
  font-size: 11px;
  margin: 6px 0 0 0;
}
.card {
  width: min(420px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
  padding: 18px 22px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--color-bubble-text);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.head h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-danger);
  box-shadow: 0 0 10px var(--color-danger);
}
.msg {
  margin: 6px 0 10px;
  color: oklch(40% 0.12 25);
  line-height: 1.5;
}
details {
  margin: 8px 0 14px;
}
summary {
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-muted);
}
pre {
  margin: 6px 0 0;
  padding: 10px;
  font-size: 11px;
  line-height: 1.5;
  background: oklch(94% 0.012 25 / 0.6);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  max-height: 32vh;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ghost,
.primary {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--duration-fast);
}
.ghost {
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
</style>
