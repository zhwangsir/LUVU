<script setup lang="ts">
/**
 * UX R21: 服务健康状态指示灯。
 *
 * 浮在窗口右下角的小 pill，三个 dot：LLM / TTS / Vision。
 * 颜色语义：
 *   - 绿 = 最近调用成功 / cfg 已配且没失败过
 *   - 灰 = cfg 未配置
 *   - 红 = 最近一次调用失败（hover tooltip 显示原因）
 *   - 黄 = 配置了但还没尝试过
 *
 * 不主动 polling — 监听 bus 'service:status' reactive 更新。
 * dialog/TTS handler 在成功/失败时显式 emit service:status，避免从 toast 文本反推。
 *
 * click 任一 dot → 打开设置面板。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useConfigStore } from '../stores/config'
import { useDialogStore } from '../../brain/stores/dialog'
import { bus } from '../eventbus'

type DotStatus = 'ok' | 'down' | 'unconfigured' | 'untested'
interface ServiceState {
  status: DotStatus
  reason?: string
  /** 最近一次状态变化时间戳（用于 5min 自动恢复 untested） */
  ts: number
}

// R119: 支持定向 tab — pill click 时定位到对应 service 的 settings tab
// (vision 配置在 llm tab 内, 所以映射成 'llm')
type SettingsTabHint = 'llm' | 'tts'
const emit = defineEmits<{ (e: 'open-settings', tab?: SettingsTabHint): void }>()
const cfg = useConfigStore()
const dialog = useDialogStore()

const llmState = ref<ServiceState>({ status: 'untested', ts: Date.now() })
const ttsState = ref<ServiceState>({ status: 'untested', ts: Date.now() })
const visionState = ref<ServiceState>({ status: 'untested', ts: Date.now() })

const hovered = ref<'llm' | 'tts' | 'vision' | null>(null)

// 从 cfg 派生初始 unconfigured 状态
function recomputeFromCfg(): void {
  const c = cfg.config
  if (!c) return
  if (!c.llm_endpoint || !c.llm_model) {
    llmState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (llmState.value.status === 'unconfigured') {
    llmState.value = { status: 'untested', ts: Date.now() }
  }
  const ttsUrl = Array.isArray(c.tts_sidecar_url)
    ? c.tts_sidecar_url.find((u) => u && u.trim())
    : c.tts_sidecar_url
  if (!ttsUrl) {
    ttsState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (ttsState.value.status === 'unconfigured') {
    ttsState.value = { status: 'untested', ts: Date.now() }
  }
  if (!c.vision_enabled) {
    visionState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (visionState.value.status === 'unconfigured') {
    visionState.value = { status: 'untested', ts: Date.now() }
  }
}

const cleanupHandlers: Array<() => void> = []
// R32 fix (code-rev MED): unmount race 守卫 — initialProbe 飞行中组件卸载就不再 emit
let mounted = true

onMounted(() => {
  recomputeFromCfg()

  const onConfigChange = (): void => recomputeFromCfg()
  bus.on('infra:config-changed', onConfigChange)
  cleanupHandlers.push(() => bus.off('infra:config-changed', onConfigChange))

  // R21 fix (HIGH): 改听 service:status 显式事件，不再靠 toast 文本反推
  const onServiceStatus = (payload: {
    service: 'llm' | 'tts' | 'vision'
    status: 'ok' | 'down' | 'unconfigured'
    reason?: string
  }): void => {
    const target =
      payload.service === 'llm'
        ? llmState
        : payload.service === 'tts'
          ? ttsState
          : visionState
    // 已 unconfigured 时 ok 信号不覆盖（避免下次 enable 前误显示绿）
    if (target.value.status === 'unconfigured' && payload.status === 'ok') return
    target.value = {
      status: payload.status === 'unconfigured' ? 'unconfigured' : payload.status,
      ...(payload.reason !== undefined && { reason: payload.reason.slice(0, 100) }),
      ts: Date.now(),
    }
  }
  bus.on('service:status', onServiceStatus)
  cleanupHandlers.push(() => bus.off('service:status', onServiceStatus))

  // R30: 启动后主动一次 health probe，让 dot 立即显示真实状态（不用等用户发消息）
  void initialProbe()
})

/** R30: 启动时的一次性轻量 ping — LLM/TTS 并行 (R31-fix ts-rev MEDIUM) */
async function initialProbe(): Promise<void> {
  const c = cfg.config
  if (!c) return
  await Promise.all([probeLlmInitial(c), probeTtsInitial(c)])
}

async function probeLlmInitial(c: typeof cfg.config & object): Promise<void> {
  if (!c.llm_endpoint || !c.llm_model) return
  try {
    const r = await window.api.llm.healthCheck({ test_vision: false })
    if (!mounted) return
    bus.emit('service:status', {
      service: 'llm',
      status: r.overall_ok ? 'ok' : 'down',
      ...(!r.overall_ok && {
        reason: r.results.find((x) => !x.ok)?.detail ?? 'health-check failed',
      }),
    })
  } catch (e) {
    if (!mounted) return
    bus.emit('service:status', {
      service: 'llm',
      status: 'down',
      reason: String(e).slice(0, 100),
    })
  }
}

async function probeTtsInitial(c: typeof cfg.config & object): Promise<void> {
  const ttsUrl = Array.isArray(c.tts_sidecar_url)
    ? c.tts_sidecar_url.find((u) => u && u.trim())
    : c.tts_sidecar_url
  if (!ttsUrl) return
  try {
    const r = await fetch(`${ttsUrl.replace(/\/+$/, '')}/`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!mounted) return
    bus.emit('service:status', {
      service: 'tts',
      status: r.ok ? 'ok' : 'down',
      ...(!r.ok && { reason: `HTTP ${r.status}` }),
    })
  } catch (e) {
    if (!mounted) return
    bus.emit('service:status', {
      service: 'tts',
      status: 'down',
      reason: String(e).slice(0, 100),
    })
  }
}

onBeforeUnmount(() => {
  mounted = false
  cleanupHandlers.forEach((fn) => fn())
})

function colorOf(s: DotStatus): string {
  switch (s) {
    case 'ok':
      return 'oklch(70% 0.18 145)' // 绿
    case 'down':
      return 'oklch(60% 0.22 25)' // 红
    case 'unconfigured':
      return 'oklch(60% 0.01 250 / 0.45)' // 灰
    case 'untested':
      return 'oklch(75% 0.16 90)' // 黄
  }
}

/** R57-fix: pulse ring 颜色匹配真实状态 — down 时不再显绿色 ring */
function pulseColorOf(s: DotStatus): string {
  switch (s) {
    case 'ok':
      return 'oklch(70% 0.18 145 / 0.3)'
    case 'down':
      return 'oklch(60% 0.22 25 / 0.35)'
    case 'unconfigured':
      return 'oklch(60% 0.01 250 / 0.2)'
    case 'untested':
      return 'oklch(75% 0.16 90 / 0.3)'
  }
}

function labelOf(svc: 'llm' | 'tts' | 'vision', s: DotStatus): string {
  const svcName = svc === 'llm' ? 'LLM' : svc === 'tts' ? 'TTS' : 'Vision'
  switch (s) {
    case 'ok':
      return `${svcName}: ✓ 工作正常`
    case 'down':
      return `${svcName}: ✗ 上次调用失败`
    case 'unconfigured':
      return `${svcName}: ◯ 未配置`
    case 'untested':
      return `${svcName}: … 已配置，尚未测试`
  }
}

const tooltip = computed<string>(() => {
  if (!hovered.value) {
    // 默认显示总体摘要
    const downCount = [llmState.value, ttsState.value, visionState.value].filter(
      (s) => s.status === 'down',
    ).length
    if (downCount > 0) return `${downCount} 项服务异常 — 点击查看`
    return '服务健康状态 — 点击打开设置'
  }
  const st =
    hovered.value === 'llm'
      ? llmState.value
      : hovered.value === 'tts'
        ? ttsState.value
        : visionState.value
  const base = labelOf(hovered.value, st.status)
  // R93: hover 时附加当前配置详情 (model 名 / sidecar URL / vision endpoint)
  const detail = currentConfigHint(hovered.value)
  let out = detail ? `${base}\n${detail}` : base
  if (st.reason && st.status === 'down') out += `\n${st.reason}`
  return out
})

/** R93: 根据 hover 的服务返回配置详情 (model 名 / sidecar URL 等) */
function currentConfigHint(svc: 'llm' | 'tts' | 'vision'): string {
  const c = cfg.config
  if (!c) return ''
  if (svc === 'llm') {
    if (!c.llm_model) return ''
    return `模型: ${c.llm_model}`
  }
  if (svc === 'tts') {
    const list = Array.isArray(c.tts_sidecar_url)
      ? c.tts_sidecar_url.filter((s) => s && s.trim())
      : c.tts_sidecar_url
        ? [c.tts_sidecar_url]
        : []
    if (list.length === 0) return ''
    const more = list.length > 1 ? ` (+${list.length - 1} fallback)` : ''
    return `sidecar: ${list[0]}${more}`
  }
  // vision
  if (c.vision_model) return `模型: ${c.vision_model}`
  return ''
}

function openSettings(tab?: SettingsTabHint): void {
  emit('open-settings', tab)
}

/** R47: 有任一 down 时让 pill click 先重 probe (不打扰健康态 → 跳设置) */
const anyDown = computed(() =>
  [llmState.value, ttsState.value, visionState.value].some((s) => s.status === 'down'),
)

/** R119: 找第一个 down 的 service, 用于 click 定向 tab (vision 映射 llm) */
function firstDownService(): SettingsTabHint | undefined {
  if (llmState.value.status === 'down') return 'llm'
  if (ttsState.value.status === 'down') return 'tts'
  if (visionState.value.status === 'down') return 'llm' // vision 设置在 llm tab 内
  return undefined
}

async function onPillClick(): Promise<void> {
  if (!anyDown.value) {
    openSettings()
    return
  }
  // 触发主动重 probe — 给用户一种"刚刚是临时挂掉了"的快速恢复机会
  bus.emit('ui:toast', { kind: 'info', message: '正在重新检查服务…', ttl_ms: 1500 })
  await initialProbe()
  // R49-fix (HIGH): await 后组件可能已卸载, 守卫避免对已死组件 emit/state read
  if (!mounted) return
  if (anyDown.value) {
    // R119: 仍然 down → 跳设置, 定向第一个 down 的 service tab
    openSettings(firstDownService())
  } else {
    bus.emit('ui:toast', { kind: 'success', message: '✓ 服务已恢复', ttl_ms: 2000 })
  }
}
</script>

<template>
  <button class="pill" :title="tooltip" :aria-label="tooltip" @click="onPillClick">
    <span
      class="dot"
      :class="{ pulsing: dialog.replying }"
      :style="{
        background: colorOf(llmState.status),
        '--pulse-color': pulseColorOf(llmState.status),
      }"
      :aria-label="labelOf('llm', llmState.status)"
      role="img"
      @mouseenter="hovered = 'llm'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(ttsState.status) }"
      :aria-label="labelOf('tts', ttsState.status)"
      role="img"
      @mouseenter="hovered = 'tts'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(visionState.status) }"
      :aria-label="labelOf('vision', visionState.status)"
      role="img"
      @mouseenter="hovered = 'vision'"
      @mouseleave="hovered = null"
    ></span>
    <!-- 单一 live region 汇总变化，避免 3 个独立 region 屏读器连读 -->
    <span class="sr-only" aria-live="polite">{{ tooltip }}</span>
  </button>
</template>

<style scoped>
.pill {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 1500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  pointer-events: auto;
  cursor: pointer;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast),
    opacity var(--duration-fast);
  opacity: 0.85;
  animation: pill-in 0.6s var(--ease-out-back) backwards;
}
.pill:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}
.pill:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
@keyframes pill-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.95);
  }
  to {
    opacity: 0.85;
    transform: none;
  }
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background var(--duration-normal), transform var(--duration-fast);
}
.dot:hover {
  transform: scale(1.4);
}
/* R53: LLM streaming 时脉冲动画 — 让用户看到"正在工作"
   R57-fix: ring 颜色用实际 dot 背景 (CSS var --pulse-color) 反映真实状态,
   避免 down 时仍显绿色 ring 给用户错误信号 */
.dot.pulsing {
  animation: dot-pulse 1.2s ease-in-out infinite;
  --pulse-color: oklch(70% 0.18 145 / 0.3); /* 默认绿 fallback */
}
@keyframes dot-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 transparent;
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 4px var(--pulse-color);
    transform: scale(1.15);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot.pulsing {
    animation: none;
    box-shadow: 0 0 0 3px var(--pulse-color);
  }
}
/* 仅屏读器可见的 a11y live region */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
