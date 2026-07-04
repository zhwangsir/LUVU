<script setup lang="ts">
/**
 * 灵动岛 —— 工具链调用的实时状态（与文字答复分离）。
 * 顶部居中的深色胶囊，随工具调用「生长」：spinner → ✓/✗，多工具竖排。
 * 数据来自 dialog.toolActivity（send 时按工具链累积）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'

const dialog = useDialogStore()

const items = computed(() => dialog.toolActivity)
const total = computed(() => items.value.length)
const anyRunning = computed(() => items.value.some((t) => t.status === 'running'))
const anyError = computed(() => items.value.some((t) => t.status === 'error'))
const doneCount = computed(() => items.value.filter((t) => t.status !== 'running').length)

const visible = ref(false)
const hovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

watch(
  [total, anyRunning, () => dialog.replying],
  () => {
    if (total.value === 0) {
      visible.value = false
      return
    }
    visible.value = true
    clearHide()
    // 全部结束且 LLM 不再续写 → 停留一会儿再收起
    if (!anyRunning.value && !dialog.replying) {
      hideTimer = setTimeout(() => {
        visible.value = false
      }, 3000)
    }
  },
  { immediate: true },
)

onBeforeUnmount(clearHide)

/** 工具名 → 友好图标 + 短标签 */
function toolMeta(name: string): { icon: string; label: string } {
  const MAP: Array<[RegExp, { icon: string; label: string }]> = [
    [/^office_create_docx/, { icon: '📄', label: '写 Word' }],
    [/^office_create_pptx/, { icon: '📊', label: '做 PPT' }],
    [/^office_create_xlsx/, { icon: '📈', label: '做 Excel' }],
    [/^computer_agent_task/, { icon: '🤖', label: '自主操作' }],
    [/^computer_find_and_click/, { icon: '🎯', label: '看屏点击' }],
    [/^computer_/, { icon: '🖱️', label: '操控电脑' }],
    [/^fs_delete/, { icon: '🗑️', label: '删除文件' }],
    [/^fs_(write|append|move|copy|mkdir)/, { icon: '📝', label: '写文件' }],
    [/^fs_(zip|unzip)/, { icon: '🗜️', label: '压缩' }],
    [/^fs_/, { icon: '📁', label: '文件' }],
    [/^web_/, { icon: '🌐', label: '联网' }],
    [/^clipboard_/, { icon: '📋', label: '剪贴板' }],
    [/^system_screenshot/, { icon: '📸', label: '截图' }],
    [/^system_run_shell/, { icon: '⌨️', label: '跑命令' }],
    [/^system_open_app/, { icon: '🚀', label: '开应用' }],
    [/^system_/, { icon: '⚙️', label: '系统' }],
    [/^creative_generate_sticker/, { icon: '🎨', label: '画图' }],
    [/^mcp__/, { icon: '🔌', label: name.replace(/^mcp__[^_]+__/, '') }],
  ]
  for (const [re, meta] of MAP) if (re.test(name)) return meta
  return { icon: '🔧', label: name }
}

const showList = computed(() => hovered.value || anyRunning.value || total.value > 1)
</script>

<template>
  <transition name="island">
    <div
      v-if="visible"
      class="island"
      :class="{ done: !anyRunning, error: anyError && !anyRunning }"
      role="status"
      aria-live="polite"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div class="head">
        <span class="glyph">
          <span v-if="anyRunning" class="spinner" aria-hidden="true"></span>
          <span v-else-if="anyError" class="ico-warn">!</span>
          <span v-else class="ico-check">✓</span>
        </span>
        <span class="title">{{ anyRunning ? '调用工具链' : anyError ? '部分失败' : '工具完成' }}</span>
        <span class="count">{{ doneCount }}/{{ total }}</span>
      </div>
      <transition-group v-if="showList" name="row" tag="div" class="list">
        <div v-for="it in items" :key="it.id" class="row" :data-status="it.status">
          <span class="r-icon">{{ toolMeta(it.name).icon }}</span>
          <span class="r-label">{{ toolMeta(it.name).label }}</span>
          <span class="r-status">
            <span v-if="it.status === 'running'" class="spinner sm" aria-hidden="true"></span>
            <span v-else-if="it.status === 'error'" class="s-err">✗</span>
            <span v-else class="s-ok">✓</span>
          </span>
        </div>
      </transition-group>
    </div>
  </transition>
</template>

<style scoped>
.island {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%) scale(var(--ui-scale, 1));
  transform-origin: top center;
  z-index: 1400;
  min-width: 168px;
  max-width: 340px;
  padding: 8px 14px;
  border-radius: 22px;
  /* 深色胶囊（灵动岛不跟主题走，恒黑） */
  background: oklch(16% 0.012 260 / 0.92);
  color: oklch(97% 0 0);
  border: 1px solid oklch(100% 0 0 / 0.08);
  box-shadow:
    0 8px 28px oklch(0% 0 0 / 0.5),
    0 2px 8px oklch(0% 0 0 / 0.35),
    inset 0 1px 0 oklch(100% 0 0 / 0.06);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  pointer-events: auto;
  user-select: none;
  /* 灵动岛「生长」：尺寸/圆角弹性过渡 */
  transition:
    min-width var(--duration-normal) var(--ease-out-expo),
    border-radius var(--duration-normal) var(--ease-out-expo),
    background var(--duration-normal) var(--ease-out-expo);
}
.island.done {
  border-color: oklch(70% 0.16 150 / 0.4);
}
.island.error {
  border-color: oklch(65% 0.2 25 / 0.5);
}

.head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.glyph {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  flex: 1;
  white-space: nowrap;
}
.count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: oklch(75% 0 0);
  padding: 1px 7px;
  background: oklch(100% 0 0 / 0.08);
  border-radius: 999px;
}

.list {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid oklch(100% 0 0 / 0.08);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.3;
}
.r-icon {
  font-size: 13px;
  flex-shrink: 0;
}
.r-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: oklch(90% 0 0);
}
.row[data-status='running'] .r-label {
  color: oklch(97% 0 0);
}
.r-status {
  display: inline-flex;
  width: 14px;
  justify-content: center;
  flex-shrink: 0;
}
.s-ok {
  color: oklch(78% 0.16 150);
  font-weight: 700;
  font-size: 12px;
}
.s-err {
  color: oklch(70% 0.2 25);
  font-weight: 700;
  font-size: 12px;
}
.ico-check {
  color: oklch(80% 0.17 150);
  font-weight: 800;
  font-size: 13px;
}
.ico-warn {
  color: oklch(72% 0.2 25);
  font-weight: 800;
}

/* spinner —— 双环旋转 */
.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid oklch(100% 0 0 / 0.18);
  border-top-color: oklch(78% 0.16 250);
  animation: island-spin 0.7s linear infinite;
}
.spinner.sm {
  width: 11px;
  height: 11px;
  border-width: 1.6px;
}
@keyframes island-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 出现/消失：从上方弹入 */
.island-enter-active {
  transition:
    opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.island-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out-expo),
    transform var(--duration-fast) var(--ease-out-expo);
}
.island-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-14px) scale(calc(var(--ui-scale, 1) * 0.82));
}
.island-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px) scale(calc(var(--ui-scale, 1) * 0.92));
}

/* 行进出场 */
.row-enter-active,
.row-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out-expo),
    transform var(--duration-fast) var(--ease-out-expo);
}
.row-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.row-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 1.4s;
  }
  .island,
  .island-enter-active,
  .island-leave-active {
    transition-duration: 1ms;
  }
}
</style>
