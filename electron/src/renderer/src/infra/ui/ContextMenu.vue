<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'

export interface MenuItem {
  id: string
  label: string
  /** ⚠ MUST be trusted static SVG only — 通过 v-html 渲染，永远不要传用户输入或外部数据 */
  icon?: string
  shortcut?: string
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'close'): void
}>()

const menuRef = ref<HTMLDivElement | null>(null)

// 把菜单位置限制在窗口内（避免菜单出界）
const position = computed(() => {
  const w = menuRef.value?.offsetWidth ?? 200
  const h = menuRef.value?.offsetHeight ?? 240
  const winW = window.innerWidth
  const winH = window.innerHeight
  const x = Math.min(Math.max(props.x, 4), winW - w - 4)
  const y = Math.min(Math.max(props.y, 4), winH - h - 4)
  return { left: `${x}px`, top: `${y}px` }
})

function pick(item: MenuItem): void {
  if (item.disabled || item.separator) return
  emit('select', item.id)
  emit('close')
}

function onOutside(e: MouseEvent): void {
  if (!menuRef.value) return
  if (!props.open) return
  if (!menuRef.value.contains(e.target as Node)) emit('close')
}

// R29 a11y: ↑↓ Enter 键盘导航 — focused index 状态
const focusedIdx = ref(-1)

/** 选中可聚焦项（跳过 separator/disabled） */
function selectableIndices(): number[] {
  return props.items
    .map((it, i) => (it.separator || it.disabled ? -1 : i))
    .filter((i) => i >= 0)
}

function moveFocus(dir: 1 | -1): void {
  const idxs = selectableIndices()
  if (idxs.length === 0) return
  const cur = idxs.indexOf(focusedIdx.value)
  const next = cur < 0 ? (dir > 0 ? 0 : idxs.length - 1) : (cur + dir + idxs.length) % idxs.length
  focusedIdx.value = idxs[next]!
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveFocus(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveFocus(-1)
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (focusedIdx.value >= 0) {
      e.preventDefault()
      const item = props.items[focusedIdx.value]
      if (item) pick(item)
    }
  }
}

// 打开时重置焦点到第 1 个可选项
watch(
  () => props.open,
  (now) => {
    if (now) {
      const idxs = selectableIndices()
      focusedIdx.value = idxs[0] ?? -1
      void nextTick(() => menuRef.value?.focus())
    } else {
      focusedIdx.value = -1
    }
  },
)

onMounted(() => {
  window.addEventListener('mousedown', onOutside, true)
  // R32 fix (code-rev): capture phase 与 onOutside 一致，确保菜单按键优先级
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onOutside, true)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <transition name="menu">
    <div
      v-if="open"
      ref="menuRef"
      class="ctx-menu"
      role="menu"
      tabindex="-1"
      :style="position"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="item.id + i">
        <div v-if="item.separator" class="sep" :data-label="item.label || null" />
        <button
          v-else
          class="item"
          :class="{ danger: item.danger, disabled: item.disabled, focused: focusedIdx === i }"
          :disabled="item.disabled"
          role="menuitem"
          :tabindex="focusedIdx === i ? 0 : -1"
          @click="pick(item)"
          @mouseenter="focusedIdx = i"
        >
          <span class="icon" v-html="item.icon ?? ''" />
          <span class="label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  min-width: 180px;
  padding: 6px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  user-select: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--color-bubble-text);
  text-align: left;
  background: transparent;
  transition: background var(--duration-fast), color var(--duration-fast),
    padding var(--duration-fast) var(--ease-out-expo);
}
.item.focused:not(.disabled),
.item:hover:not(.disabled) {
  background: var(--color-bubble-surface-hover);
  /* hover 时图标轻微右滑 — 微反馈 */
  padding-left: 12px;
  padding-right: 8px;
}
.item.danger {
  color: var(--color-danger);
}
.item.danger:hover:not(.disabled) {
  background: var(--color-danger-soft);
}
.item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--color-muted);
  transition: color var(--duration-fast);
}
.item:hover:not(.disabled) .icon {
  color: var(--color-accent);
}
.item.danger:hover:not(.disabled) .icon {
  color: var(--color-danger);
}
.icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.label {
  flex: 1;
  font-weight: 500;
}
.shortcut {
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding: 1px 6px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-divider);
  border-radius: 4px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-divider);
}
/* R101: separator 可带 label 作为 group 标题 */
.sep[data-label] {
  height: auto;
  margin: 8px 6px 4px;
  background: transparent;
  display: flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
}
.sep[data-label]::before {
  content: attr(data-label);
  padding-right: 6px;
}
.sep[data-label]::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-divider);
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-expo),
    transform var(--duration-fast) var(--ease-out-expo);
  transform-origin: top left;
}
.menu-enter-from {
  opacity: 0;
  transform: scale(0.92) translateY(-4px);
}
.menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
