<script setup lang="ts">
import { ref } from 'vue'
import { bus } from '../eventbus'

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'open-picker'): void
  (e: 'open-soul-editor'): void
  (e: 'open-health-dashboard'): void
  (e: 'reload-model'): void
}>()

const pinned = ref(true)

async function togglePin(): Promise<void> {
  pinned.value = !pinned.value
  await window.api.window.togglePin(pinned.value)
}

async function close(): Promise<void> {
  await window.api.window.close()
}

async function minimize(): Promise<void> {
  await window.api.window.minimize()
}

// v0.9: 立绘缩放控制 — Live2DStage 监听这两个事件应用并持久化
function zoomIn(): void {
  bus.emit('avatar:zoom', { delta: 0.15 })
}
function zoomOut(): void {
  bus.emit('avatar:zoom', { delta: -0.15 })
}
function zoomReset(): void {
  bus.emit('avatar:zoom', { delta: 0, reset: true })
}
</script>

<template>
  <div class="dock">
    <!-- 主操作组 -->
    <button class="dock-btn primary" title="切换角色" @click="emit('open-picker')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="8" r="3" />
        <path d="M5 21a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4" />
        <path d="m17 4 3 3-3 3" />
        <path d="M14 7h6" />
      </svg>
    </button>
    <button class="dock-btn" title="🔬 模型健康仪表盘" @click="emit('open-health-dashboard')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    </button>
    <button class="dock-btn" title="编辑灵魂" @click="emit('open-soul-editor')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12l4 6-10 12L2 9z" />
        <path d="M11 3 8 9l4 12 4-12-3-6" />
        <path d="M2 9h20" />
      </svg>
    </button>
    <button class="dock-btn" title="设置" @click="emit('open-settings')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>

    <span class="divider"></span>

    <!-- 缩放组 -->
    <button class="dock-btn" title="放大立绘 (+)" @click="zoomIn">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M11 8v6M8 11h6" />
        <path d="m20 20-4-4" />
      </svg>
    </button>
    <button class="dock-btn" title="缩小立绘 (-)" @click="zoomOut">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M8 11h6" />
        <path d="m20 20-4-4" />
      </svg>
    </button>
    <button class="dock-btn" title="复原大小（auto-fit）" @click="zoomReset">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6v6H9z" />
      </svg>
    </button>

    <span class="divider"></span>

    <!-- 状态组 -->
    <button class="dock-btn" title="重载模型 / 灵魂" @click="emit('reload-model')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
    <button
      class="dock-btn"
      :class="{ 'on': pinned }"
      :title="pinned ? '取消置顶' : '置顶'"
      @click="togglePin"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v6" />
        <path d="m6 8 6-6 6 6" />
        <path d="M9 12h6" />
        <path d="M12 8v14" />
      </svg>
    </button>

    <span class="divider"></span>

    <!-- 窗口组 -->
    <button class="dock-btn" title="收起" @click="minimize">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round">
        <path d="M5 12h14" />
      </svg>
    </button>
    <button class="dock-btn danger" title="关闭" @click="close">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.dock {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  /* 出现动画 */
  animation: dock-in 0.5s var(--ease-out-back) backwards;
}
@keyframes dock-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.95); }
  to { opacity: 1; transform: none; }
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--color-divider);
  margin: 0 2px;
  flex-shrink: 0;
}

.dock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: var(--color-bubble-text);
  position: relative;
}
.dock-btn:hover {
  background: var(--color-bubble-surface-hover);
  transform: scale(1.08);
}
.dock-btn.primary:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.dock-btn.on {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}
.dock-btn.danger:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

/* 焦点 ring 用 box-shadow 不挤布局 */
.dock-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
