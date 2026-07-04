<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'
import { parseInlineMarkdown } from '../../brain/inline-markdown'
import { useThemeMode } from './useThemeMode'
import { bus } from '../eventbus'

/** R73 收尾: 抽具名常量, 风格与 InputBar TOKEN_WARN 一致 */
const LONG_REPLY_THRESHOLD = 500
const HIDE_MIN_MS = 5_000
const HIDE_MAX_MS = 18_000
const HIDE_PER_CHAR_MS = 250
/**
 * R65: 按文字长度动态隐藏:
 *   - 保底 5 秒
 *   - 每字 +250ms
 *   - 上限 18 秒
 *   - 超长 (> 500 字) → 0 即不自动隐藏 (用户在读, 自动消失会丢内容, 需主动 ✕ 关)
 */
function hideMsFor(text: string | undefined): number {
  const len = text?.length ?? 0
  if (len > LONG_REPLY_THRESHOLD) return 0
  return Math.min(HIDE_MAX_MS, Math.max(HIDE_MIN_MS, HIDE_MIN_MS + len * HIDE_PER_CHAR_MS))
}

const dialog = useDialogStore()

const latest = computed(() => {
  const list = dialog.turns
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.role === 'assistant') return list[i]!
  }
  return null
})

const visible = ref(true)
const bubbleEl = ref<HTMLDivElement | null>(null)
/** v0.21：立绘头部锚点（画布 CSS px）——气泡跟随头顶定位；null 时回退顶部居中 */
const headPos = ref<{ x: number; y: number } | null>(null)
const onHeadPos = (p: { x: number; y: number }): void => {
  headPos.value = p
}
/** 位置 + 背景合并成 inline style（位置随头部走，transform 在 CSS 里管居中/缩放） */
const bubbleStyle = computed(() => {
  const background = bubbleBg(latest.value?.emotion)
  if (headPos.value) {
    // 边缘 clamp：立绘拖到屏幕边时气泡不飞出可视区
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
    const x = Math.max(170, Math.min(vw - 170, headPos.value.x))
    const y = Math.max(150, headPos.value.y)
    return { background, left: `${x}px`, top: `${y}px` }
  }
  return { background, left: '50%', top: '22%' }
})
/** R106: 长 text > 800 chars 时支持手动展开 (取消 max-height 限制) */
const expanded = ref(false)
const isLong = computed<boolean>(() => (latest.value?.text?.length ?? 0) > 800)
/** R54: 用户主动关闭后的 turn id, 同 id 不重显, 下一条 turn 时清空 */
const dismissedTurnId = ref<string | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null
/** R57-fix (HIGH): 保留 rAF handle 以便卸载时取消, 避免 leak + 重复 schedule */
let scrollRaf: number | null = null

/**
 * UX:thinking 模型(本地 qwen3.6 等)首 token 前要 20-50s 推理,期间只有三点
 * 像卡死。计时显示「正在认真想 Ns」让用户知道她在想、没死机。
 * 仅在 streaming 且还没吐出任何 text 的阶段计时;有 token / 结束即清零。
 */
const thinkingSec = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | null = null
/** 是否处于"思考中(streaming 但无 text)"阶段 */
const isThinking = computed<boolean>(
  () => !!latest.value?.streaming && !latest.value?.text && !latest.value?.error,
)
watch(
  isThinking,
  (thinking) => {
    if (thinkingTimer) {
      clearInterval(thinkingTimer)
      thinkingTimer = null
    }
    if (thinking) {
      thinkingSec.value = 0
      thinkingTimer = setInterval(() => {
        thinkingSec.value += 1
      }, 1000)
    } else {
      thinkingSec.value = 0
    }
  },
  { immediate: true },
)

/**
 * R52+R56: 流式回复时自动滚到底部, 但尊重用户手动向上滚 — 行业标准聊天 UI 做法。
 * 若用户已经向上滚 > 20px (即不在底部), 不强制滚 → 让用户阅读不被打断。
 */
const SCROLL_BOTTOM_THRESHOLD = 20
function scrollToBottom(): void {
  const el = bubbleEl.value
  if (!el) return
  // 检查滚动前是否已在底部 (允许 20px 抖动)
  const wasAtBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
  if (!wasAtBottom) return // 用户在阅读上文, 不打扰
  if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null
    if (bubbleEl.value) bubbleEl.value.scrollTop = bubbleEl.value.scrollHeight
  })
}

function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  const ms = hideMsFor(latest.value?.text)
  if (ms <= 0) return // R65: 超长回复不自动隐藏, 等用户主动 ✕
  hideTimer = setTimeout(() => {
    visible.value = false
  }, ms)
}

watch(
  // R43 fix (MED): 追踪 error 字段, 否则 LLM 失败 (id 已存在 + text 空) watch 不触发,
  // error bubble 满足 v-if 却被 visible=false 隐藏, 用户看不到重试按钮
  () => [latest.value?.id, latest.value?.text, latest.value?.error],
  ([newId]) => {
    if (!latest.value) return
    // R57-fix (HIGH): 显式收窄 string | undefined → string | null, 避免 undefined ≠ null 类型空洞
    const id: string | null = typeof newId === 'string' ? newId : null
    // R54: 用户已主动关掉当前 turn → 不重显
    if (dismissedTurnId.value !== null && dismissedTurnId.value === id) return
    // 新 turn → 清掉旧 dismiss + 重置 R106 expanded
    if (id !== dismissedTurnId.value) {
      dismissedTurnId.value = null
      expanded.value = false
    }
    visible.value = true
    // R52: streaming 中 / 文本变化时 auto-scroll 到底部
    if (latest.value.streaming || latest.value.text) scrollToBottom()
    // error 状态常驻不自动隐藏, 用户需主动关或重试
    if (!latest.value.streaming && !latest.value.error) scheduleHide()
  },
  { immediate: true },
)

/** R54: 主动关闭当前 bubble */
function dismiss(): void {
  if (hideTimer) clearTimeout(hideTimer)
  visible.value = false
  // R57-fix: 删无意义的 `as string | null` 断言 — ?? null 已经是该类型
  dismissedTurnId.value = latest.value?.id ?? null
}

function onMouseEnter(): void {
  if (hideTimer) clearTimeout(hideTimer)
}
function onMouseLeave(): void {
  if (latest.value && !latest.value.streaming) scheduleHide()
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
  if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
  if (copiedFlashTimer) clearTimeout(copiedFlashTimer)
  if (thinkingTimer) clearInterval(thinkingTimer)
  bus.off('avatar:head-pos', onHeadPos)
  mql?.removeEventListener('change', systemListener)
})

/* v0.17：不透明度从 0.94 降到 0.82 — 桌面颜色能透一点过来，强化"飘在桌面"而非"实色 panel" */
const emotionTint: Record<string, string> = {
  neutral: 'oklch(97% 0.012 25 / 0.82)',
  happy: 'oklch(97% 0.06 80 / 0.82)',
  sad: 'oklch(96% 0.04 230 / 0.82)',
  angry: 'oklch(95% 0.08 25 / 0.82)',
  surprise: 'oklch(97% 0.07 65 / 0.82)',
  shy: 'oklch(97% 0.08 18 / 0.82)',
  tease: 'oklch(97% 0.08 320 / 0.82)',
  sleepy: 'oklch(95% 0.03 250 / 0.82)',
}

const emotionTintDark: Record<string, string> = {
  neutral: 'oklch(28% 0.012 25 / 0.82)',
  happy: 'oklch(32% 0.08 80 / 0.82)',
  sad: 'oklch(28% 0.05 230 / 0.82)',
  angry: 'oklch(30% 0.1 25 / 0.82)',
  surprise: 'oklch(32% 0.09 65 / 0.82)',
  shy: 'oklch(32% 0.1 18 / 0.82)',
  tease: 'oklch(32% 0.1 320 / 0.82)',
  sleepy: 'oklch(28% 0.04 250 / 0.82)',
}

// R38 fix: 联动 R33 主题切换 — 用户强制 light/dark 时尊重设定，auto 时跟系统
const theme = useThemeMode()
const systemDark = ref(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
)
let mql: MediaQueryList | null = null
const systemListener = (e: MediaQueryListEvent): void => {
  systemDark.value = e.matches
}
onMounted(() => {
  bus.on('avatar:head-pos', onHeadPos)
  if (typeof window === 'undefined') return
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', systemListener)
})
const isDark = computed(() => {
  if (theme.mode.value === 'light') return false
  if (theme.mode.value === 'dark') return true
  return systemDark.value
})

function bubbleBg(emotion: string | undefined): string {
  const e = emotion ?? 'neutral'
  return isDark.value
    ? emotionTintDark[e] ?? emotionTintDark.neutral!
    : emotionTint[e] ?? emotionTint.neutral!
}

const emotionLabel: Record<string, { icon: string; label: string }> = {
  happy: { icon: '😊', label: '开心' },
  sad: { icon: '😢', label: '难过' },
  angry: { icon: '😠', label: '生气' },
  surprise: { icon: '😲', label: '惊讶' },
  shy: { icon: '😳', label: '害羞' },
  tease: { icon: '😈', label: '撒娇' },
  sleepy: { icon: '😴', label: '困' },
}

// R51: 把 latest.text 解析为 markdown segments (仅 **bold** / `code`)
const segments = computed(() =>
  latest.value?.text ? parseInlineMarkdown(latest.value.text) : [],
)

// R117: bubble timestamp tooltip
const bubbleTimestamp = computed<string>(() => {
  const ts = latest.value?.ts
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

// R76: emotion tooltip 含 intensity 百分比
const emotionTooltip = computed<string>(() => {
  const e = latest.value?.emotion
  if (!e) return ''
  const i = latest.value?.intensity
  // R79-fix (LOW): 未知 emotion 用 [bracket] 标记, 防 EmotionId 扩展时原始 key 直接暴露给用户
  const label = emotionLabel[e]?.label ?? `[${e}]`
  if (typeof i === 'number' && Number.isFinite(i)) {
    return `${label} · 强度 ${Math.round(Math.max(0, Math.min(1, i)) * 100)}%`
  }
  return label
})

// R38: 复制 LLM reply — hover 时显示按钮
// R85: 复制成功按钮变 ✓ 1.2s 即时视觉反馈
const copiedFlash = ref(false)
let copiedFlashTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(): Promise<void> {
  const t = latest.value?.text
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    copiedFlash.value = true
    if (copiedFlashTimer) clearTimeout(copiedFlashTimer)
    copiedFlashTimer = setTimeout(() => {
      copiedFlash.value = false
    }, 1200)
    bus.emit('ui:toast', { kind: 'success', message: '✓ 已复制', ttl_ms: 1500 })
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'warn',
      message: `复制失败：${String(e).slice(0, 60)}`,
      ttl_ms: 3000,
    })
  }
}
</script>

<template>
  <transition name="bubble">
    <div
      v-if="latest && (latest.text || latest.streaming || latest.error) && visible"
      ref="bubbleEl"
      :class="['bubble', { expanded }]"
      :style="bubbleStyle"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <span v-if="latest.text" class="text" :title="bubbleTimestamp">
        <template v-for="(seg, i) in segments" :key="i">
          <strong v-if="seg.type === 'bold'" class="md-bold">{{ seg.text }}</strong>
          <code v-else-if="seg.type === 'code'" class="md-code">{{ seg.text }}</code>
          <template v-else>{{ seg.text }}</template>
        </template>
        <!-- R69: streaming 中 text 末尾闪 caret, 让用户知道还在输出 -->
        <span v-if="latest.streaming" class="stream-caret" aria-hidden="true"></span>
      </span>
      <span v-else-if="latest.error" class="text error-text">
        <span class="error-line">没收到回复 — 试试重试或检查 LLM 设置</span>
        <details class="error-detail">
          <summary>查看错误详情</summary>
          <code class="error-raw">{{ latest.error.slice(0, 500) }}</code>
        </details>
      </span>
      <span
        v-if="latest.streaming && !latest.text"
        class="typing-indicator"
        :aria-label="thinkingSec >= 2 ? `正在认真想，已 ${thinkingSec} 秒` : '正在输入'"
      >
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <!-- UX:thinking 模型推理久(20-50s),超 2s 显示「正在认真想 Ns」让用户安心 -->
        <span v-if="thinkingSec >= 2" class="thinking-hint">正在认真想… {{ thinkingSec }}s</span>
      </span>
      <span
        v-if="latest.emotion && latest.emotion !== 'neutral' && emotionLabel[latest.emotion]"
        class="emo-tag"
        :title="emotionTooltip"
        :aria-label="emotionTooltip"
      >
        <span class="emo-icon">{{ emotionLabel[latest.emotion]!.icon }}</span>
        <span class="emo-text">{{ emotionLabel[latest.emotion]!.label }}</span>
      </span>
      <div v-if="!latest.streaming" class="bubble-actions">
        <button
          v-if="isLong"
          class="action-btn"
          :title="expanded ? '收起 (限高)' : '展开全文'"
          :aria-label="expanded ? '收起气泡' : '展开气泡全文'"
          :aria-pressed="expanded ? 'true' : 'false'"
          @click.stop="expanded = !expanded"
        >{{ expanded ? '⇡' : '⇣' }}</button>
        <button
          v-if="latest.text"
          class="action-btn"
          :class="{ flash: copiedFlash }"
          :title="copiedFlash ? '已复制' : '复制这条'"
          aria-label="复制对话"
          @click.stop="copyText"
        >{{ copiedFlash ? '✓' : '📋' }}</button>
        <button
          class="action-btn"
          title="关闭气泡"
          aria-label="关闭对话气泡"
          @click.stop="dismiss"
        >✕</button>
      </div>
      <button
        v-if="latest.error && !dialog.replying"
        class="retry-btn"
        title="重试这条 (上次失败 — 移除并重新生成)"
        aria-label="重试上次对话"
        @click.stop="dialog.retryLast"
      >🔄 重试</button>
    </div>
  </transition>
</template>

<style scoped>
/* v0.17：气泡漂浮在立绘头顶 — 漫画气泡风（不像 toast 通知） */
.bubble {
  position: absolute;
  /* v0.21：left/top 由 :style 动态给（跟随立绘头部）；这里只管锚定方式。
     bottom-center 锚在锚点上方 14px → 气泡浮在头顶、尾巴朝下指向头。 */
  right: auto;
  bottom: auto;
  /* translate + scale 必须同 transform 内合写，否则 global ui-scale 会单独覆盖 translate */
  transform: translate(-50%, calc(-100% - 14px)) scale(var(--ui-scale, 1));
  transform-origin: bottom center;
  max-width: min(320px, 86%);
  padding: 9px 16px;
  /* 漫画风：圆滑大圆角 + 不规则 border-radius 让形状更"软" */
  border-radius: 22px 22px 22px 8px;
  border: 1.5px solid var(--color-bubble-border);
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  line-height: 1.45;
  /* drop-shadow 跟随气泡形状（不规则 border-radius）显得更自然 */
  filter: drop-shadow(0 4px 10px oklch(0% 0 0 / 0.18))
          drop-shadow(0 1px 3px oklch(0% 0 0 / 0.12));
  /* 去掉 box-shadow（drop-shadow 已经管） + 去掉 backdrop-filter（panel-like glass 感破坏融入）*/
  box-shadow: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  pointer-events: auto;
  max-height: min(28vh, 220px);
  overflow-y: auto;
  /* v0.21：left/top 平滑过渡 → 拖动/缩放立绘时气泡跟着头顶滑动 */
  transition: max-height var(--duration-normal) var(--ease-out-expo),
    left var(--duration-normal) var(--ease-out-expo),
    top var(--duration-normal) var(--ease-out-expo);
}
/* R106+R109-fix: expanded 时放大高度上限; 继承 base transition 让 collapse 也有动画 */
.bubble.expanded {
  max-height: min(70vh, 600px);
  z-index: 1500;
}

@media (max-height: 360px) {
  .bubble { padding: 6px 10px; font-size: var(--text-sm); max-height: 24vh; }
  .bubble::after { display: none; }
}

/* 箭头朝下指向立绘头顶 */
.bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 14px;
  height: 14px;
  background: inherit;
  border-right: 1px solid var(--color-bubble-border);
  border-bottom: 1px solid var(--color-bubble-border);
  transform: translateX(-50%) rotate(45deg);
}

.text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}

/* v0.13 UX polish: 3 点 typing 指示器（取代单点 pulse）— 更经典的 IM 视觉 */
.typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  flex-shrink: 0;
}
.typing-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--color-accent);
  border-radius: 999px;
  opacity: 0.6;
  animation: typing-bounce 1.2s var(--ease-in-out) infinite;
}
.typing-indicator .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-indicator .dot:nth-child(3) {
  animation-delay: 0.3s;
}
/* UX:thinking 模型久等时的"正在认真想 Ns"提示 — 柔和淡入,不抢戏 */
.thinking-hint {
  margin-left: 6px;
  font-size: var(--text-xs, 12px);
  color: var(--color-muted);
  font-feature-settings: 'tnum';
  white-space: nowrap;
  animation: thinking-hint-in 0.3s var(--ease-out-expo, ease-out);
}
@keyframes thinking-hint-in {
  from { opacity: 0; }
  to { opacity: 0.85; }
}

.emo-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding: 3px 8px 3px 6px;
  background: oklch(100% 0 0 / 0.5);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  align-self: center;
}
@media (prefers-color-scheme: dark) {
  .emo-tag {
    background: oklch(0% 0 0 / 0.25);
  }
}
.emo-icon {
  font-size: 13px;
  line-height: 1;
}
.emo-text {
  font-weight: 500;
}
/* R58: 气泡 actions flex 容器, 替代 R38/R54 各自绝对定位的魔法数字 */
.bubble-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  align-items: center;
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.bubble:hover .bubble-actions,
.bubble-actions:focus-within {
  opacity: 1;
}
.action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: oklch(100% 0 0 / 0.6);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.action-btn:hover {
  background: oklch(100% 0 0 / 0.85);
}
/* R85: 复制成功瞬时绿色反馈 */
.action-btn.flash {
  background: oklch(70% 0.18 145 / 0.7);
  color: oklch(25% 0.15 145);
  font-weight: 700;
  opacity: 1 !important;
}
@media (prefers-color-scheme: dark) {
  .action-btn {
    background: oklch(0% 0 0 / 0.4);
  }
  .action-btn:hover {
    background: oklch(0% 0 0 / 0.6);
  }
}
/* R41: 重试按钮 — error 时常显（不靠 hover, 错误已经够吸引注意） */
.retry-btn {
  align-self: center;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast);
  flex-shrink: 0;
}
.retry-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.retry-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
/* R69: streaming 末尾闪烁 caret */
.stream-caret {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  opacity: 0.65;
  animation: caret-blink 1.06s steps(2, end) infinite;
}
@keyframes caret-blink {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .stream-caret {
    animation: none;
    opacity: 0.4;
  }
}
/* R51: inline markdown 渲染 */
.md-bold {
  font-weight: 700;
  color: inherit;
}
.md-code {
  display: inline;
  padding: 1px 6px;
  margin: 0 1px;
  border-radius: var(--radius-sm);
  background: oklch(0% 0 0 / 0.08);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.92em;
  color: inherit;
}
@media (prefers-color-scheme: dark) {
  .md-code {
    background: oklch(100% 0 0 / 0.08);
  }
}
.error-text {
  color: var(--color-danger);
  font-style: italic;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.error-detail {
  font-style: normal;
}
.error-detail summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-muted);
  user-select: none;
}
.error-detail summary:hover {
  color: var(--color-bubble-text);
}
.error-raw {
  display: block;
  margin-top: 6px;
  padding: 6px 8px;
  background: oklch(0% 0 0 / 0.08);
  border-radius: var(--radius-sm);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-bubble-text);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 8em;
  overflow-y: auto;
  user-select: text;
}
@media (prefers-color-scheme: dark) {
  .error-raw {
    background: oklch(100% 0 0 / 0.05);
  }
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.bubble-enter-from {
  opacity: 0;
  transform: translate(-50%, calc(-100% - 6px)) scale(calc(var(--ui-scale, 1) * 0.92));
}
.bubble-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% - 8px)) scale(calc(var(--ui-scale, 1) * 0.96));
}

@keyframes typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
