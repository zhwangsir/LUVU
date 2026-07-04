<script setup lang="ts">
/**
 * FloatingPanel — 通用浮窗壳子
 *
 * 用法：
 *   <FloatingPanel storage-key="settings" title="⚙️ 设置" @close="...">
 *     <template #header-extra>  <!-- 可选：放刷新按钮等 -->
 *       <button>刷新</button>
 *     </template>
 *     <!-- 默认 slot 是 body 内容 -->
 *     <YourFormHere />
 *     <template #footer>  <!-- 可选 -->
 *       <button>保存</button>
 *     </template>
 *   </FloatingPanel>
 *
 * 提供：拖拽移动、8 方向 resize、字号缩放、紧凑模式、最大化、重置、持久化。
 */
import { computed } from 'vue'
import { useFloatingPanel, type FloatingPanelDefaults } from './useFloatingPanel'

interface Props {
  /** localStorage 持久化 key 前缀。每个面板必须不同。 */
  storageKey: string
  title: string
  defaults?: FloatingPanelDefaults
  /** 主题色变量：light（资源商店白） / dark（创作工坊暗） */
  theme?: 'light' | 'dark'
}
const props = withDefaults(defineProps<Props>(), { theme: 'dark' })

const emit = defineEmits<{ (e: 'close'): void }>()

const fp = useFloatingPanel(props.storageKey, props.defaults)
const panelClass = computed(() => [
  'fp-panel',
  `fp-theme-${props.theme}`,
  { 'fp-compact': fp.compact.value, 'fp-dragging': fp.dragging.value !== null },
])
</script>

<template>
  <div :class="panelClass" :style="fp.panelStyle.value">
    <!-- 8 个 resize handle —— 上下左右 + 4 角 -->
    <div class="fp-rh fp-rh-t" @mousedown="fp.startDrag('resize-t', $event)" />
    <div class="fp-rh fp-rh-b" @mousedown="fp.startDrag('resize-b', $event)" />
    <div class="fp-rh fp-rh-l" @mousedown="fp.startDrag('resize-l', $event)" />
    <div class="fp-rh fp-rh-r" @mousedown="fp.startDrag('resize-r', $event)" />
    <div class="fp-rh fp-rh-tl" @mousedown="fp.startDrag('resize-tl', $event)" />
    <div class="fp-rh fp-rh-tr" @mousedown="fp.startDrag('resize-tr', $event)" />
    <div class="fp-rh fp-rh-bl" @mousedown="fp.startDrag('resize-bl', $event)" />
    <div class="fp-rh fp-rh-br" @mousedown="fp.startDrag('resize-br', $event)" />

    <!-- 头部：可拖动定位 -->
    <div class="fp-header" @mousedown="fp.startDrag('move', $event)">
      <div class="fp-title-row">
        <h2 class="fp-title">
          <slot name="title">{{ title }}</slot>
        </h2>
        <div class="fp-controls" @mousedown.stop>
          <slot name="header-extra" />
          <div class="fp-zoom-ctrl" title="字号缩放">
            <button class="fp-z-btn" @click="fp.zoomOut" :disabled="fp.zoom.value <= 0.7">A−</button>
            <button class="fp-z-btn fp-z-label" @click="fp.zoomReset">
              {{ Math.round(fp.zoom.value * 100) }}%
            </button>
            <button class="fp-z-btn" @click="fp.zoomIn" :disabled="fp.zoom.value >= 1.5">A+</button>
            <button
              class="fp-z-btn"
              :class="{ on: fp.compact.value }"
              @click="fp.toggleCompact"
              title="紧凑模式"
            >⇲</button>
            <button class="fp-z-btn" @click="fp.maximize" title="最大化">⛶</button>
            <button class="fp-z-btn" @click="fp.resetRect" title="重置大小与位置">↺</button>
          </div>
          <span class="fp-size-tag">{{ Math.round(fp.rect.value.w) }}×{{ Math.round(fp.rect.value.h) }}</span>
          <button class="fp-close" @click="emit('close')" title="关闭 (Esc)">✕</button>
        </div>
      </div>
      <div v-if="$slots['sub-header']" class="fp-subheader" @mousedown.stop>
        <slot name="sub-header" />
      </div>
    </div>

    <!-- body 内容 -->
    <div class="fp-body">
      <slot />
    </div>

    <!-- 可选 footer -->
    <div v-if="$slots.footer" class="fp-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
/* === 容器 === */
.fp-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  z-index: 999;
  border-radius: 16px;
  overflow: hidden;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --radius: 6px;
  transition: box-shadow 0.2s;
  /* UI 修复(P0-3):panel 此前裸 v-if 硬切闪现 —— 加入场动画跟 bubble/dock/toast 一致。
     transform 动画只在挂载 0.26s 内,结束后无残留 transform(默认 fill: none),
     不干扰拖拽(拖拽用 top/left 不用 transform)。 */
  animation: fp-enter 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fp-enter {
  from { opacity: 0; transform: scale(0.97) translateY(8px); }
  to { opacity: 1; transform: none; }
}
/* 尊重系统「减少动态效果」无障碍设置 */
@media (prefers-reduced-motion: reduce) {
  .fp-panel { animation: none; }
}
/* 拖拽 / resize 进行中不重播入场动画(避免 panelStyle 变化触发重渲染时闪) */
.fp-panel.fp-dragging {
  animation: none;
}
.fp-panel.fp-compact {
  --sp-1: 3px;
  --sp-2: 5px;
  --sp-3: 8px;
  --sp-4: 10px;
  --sp-5: 14px;
}

/* 主题：暗色（默认） */
.fp-panel.fp-theme-dark {
  background: rgba(15, 17, 23, 0.97);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  color: #e5e7eb;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);
}
.fp-panel.fp-theme-dark .fp-header {
  border-bottom: 1px solid #2a2e3a;
  background: linear-gradient(180deg, oklch(72% 0.18 18 /0.06), transparent);
}

/* 主题：浅色（资源商店风） */
.fp-panel.fp-theme-light {
  background: oklch(99% 0.003 250 / 0.97);
  backdrop-filter: blur(28px) saturate(1.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  color: oklch(25% 0.05 250);
  box-shadow: 0 20px 80px oklch(0% 0 0 / 0.3);
  border: 1px solid oklch(85% 0.02 250 / 0.5);
}
.fp-panel.fp-theme-light .fp-header {
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
  background: linear-gradient(180deg, oklch(95% 0.02 250 / 0.6), transparent);
}

.fp-panel.fp-dragging {
  user-select: none;
}
.fp-panel.fp-theme-dark.fp-dragging {
  box-shadow: 0 28px 100px oklch(72% 0.18 18 /0.25), 0 0 0 1px oklch(72% 0.18 18 /0.4);
}

/* === 8 个 resize handle === */
.fp-rh {
  position: absolute;
  z-index: 1000;
  background: transparent;
  transition: background 0.1s;
}
.fp-rh:hover { background: oklch(72% 0.18 18 /0.35); }
.fp-rh-t { top: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.fp-rh-b { bottom: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.fp-rh-l { top: 8px; bottom: 8px; left: 0; width: 6px; cursor: ew-resize; }
.fp-rh-r { top: 8px; bottom: 8px; right: 0; width: 6px; cursor: ew-resize; }
.fp-rh-tl, .fp-rh-tr, .fp-rh-bl, .fp-rh-br {
  width: 14px;
  height: 14px;
  z-index: 1001;
}
.fp-rh-tl { top: 0; left: 0; cursor: nwse-resize; border-radius: 16px 0 0 0; }
.fp-rh-tr { top: 0; right: 0; cursor: nesw-resize; border-radius: 0 16px 0 0; }
.fp-rh-bl { bottom: 0; left: 0; cursor: nesw-resize; border-radius: 0 0 0 16px; }
.fp-rh-br {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
  border-radius: 0 0 16px 0;
  background: linear-gradient(135deg, transparent 50%, oklch(72% 0.18 18 /0.4) 50%);
}
.fp-rh-br:hover {
  background: linear-gradient(135deg, transparent 50%, oklch(72% 0.18 18 /0.85) 50%);
}

/* === Header === */
.fp-header {
  padding: var(--sp-4) var(--sp-5) var(--sp-2);
  cursor: move;
  user-select: none;
  flex-shrink: 0;
  /* 给右上角的绝对定位 close 按钮留位置（避免被覆盖到 size-tag 上） */
  padding-right: 48px;
  position: relative;
}
.fp-header * { user-select: text; }
.fp-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.fp-title {
  margin: 0;
  font-size: 1.25em;
  font-weight: 600;
  letter-spacing: 0.3px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fp-controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 1;
  flex-wrap: wrap;
  justify-content: flex-end;
  cursor: default;
  min-width: 0;
}

/* zoom 控件 —— 分段控制器风格 */
.fp-zoom-ctrl {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.12);
  border-radius: 9px;
  padding: 3px;
}
.fp-panel.fp-theme-light .fp-zoom-ctrl { background: rgba(0, 0, 0, 0.045); }
.fp-z-btn {
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.68;
  padding: 4px 8px;
  font-size: 0.82em;
  font-family: ui-monospace, monospace;
  border-radius: 6px;
  cursor: pointer;
  min-width: 24px;
  transition: background 0.15s, opacity 0.15s;
}
.fp-z-btn:hover { background: oklch(72% 0.18 18 /0.15); opacity: 1; }
.fp-z-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.fp-z-btn.on { background: oklch(72% 0.18 18 /0.2); color: var(--color-accent); opacity: 1; }
.fp-z-label { min-width: 44px; }

.fp-size-tag {
  font-size: 0.75em;
  font-family: ui-monospace, monospace;
  color: inherit;
  opacity: 0.45;
  white-space: nowrap;
}
/* 窄宽度时（< 540px）隐藏 size-tag 给控件让位 */
@container (max-width: 540px) {
  .fp-size-tag { display: none; }
}

.fp-close {
  /* v0.17 修复：close 用绝对定位，永远在右上角 — 不被 zoom 控件 / size-tag 挤掉
     即使 panel 缩小到 minW=420，close 也总在视野内 */
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  z-index: 5;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid transparent;
  color: inherit;
  opacity: 0.65;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 0.95em;
  font-weight: 700;
}
.fp-panel.fp-theme-light .fp-close {
  background: rgba(255, 255, 255, 0.6);
}
.fp-close:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #ef4444;
}

.fp-subheader {
  margin-top: var(--sp-2);
  cursor: default;
}

/* === Body === */
.fp-body {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* === Footer === */
.fp-footer {
  border-top: 1px solid #2a2e3a;
  padding: var(--sp-3) var(--sp-5);
  background: rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}
.fp-panel.fp-theme-light .fp-footer {
  border-top-color: oklch(90% 0.01 250 / 0.4);
  background: oklch(96% 0.01 250 / 0.6);
}

/* 滚动条 */
.fp-body::-webkit-scrollbar { width: 8px; height: 8px; }
.fp-body::-webkit-scrollbar-track { background: transparent; }
.fp-body::-webkit-scrollbar-thumb {
  background: rgba(127, 127, 127, 0.3);
  border-radius: 4px;
}
.fp-body::-webkit-scrollbar-thumb:hover { background: rgba(127, 127, 127, 0.5); }
</style>
