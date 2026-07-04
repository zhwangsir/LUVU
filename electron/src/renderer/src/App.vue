<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Live2DStage from './avatar/components/Live2DStage.vue'
import DialogBubble from './infra/ui/DialogBubble.vue'
import DynamicIsland from './infra/ui/DynamicIsland.vue'
import InputBar from './infra/ui/InputBar.vue'
import ContextMenu, { type MenuItem } from './infra/ui/ContextMenu.vue'
import SettingsPanel from './infra/ui/SettingsPanel.vue'
// v0.17: ControlDock 已移除 — 功能迁到右键菜单
import ResourceStorePanel from './infra/ui/ResourceStorePanel.vue'
import ErrorBoundary from './infra/ui/ErrorBoundary.vue'
import ToastStack from './infra/ui/ToastStack.vue'
import ApprovalDialog from './infra/ui/ApprovalDialog.vue'
import CreatorStudioPanel from './infra/ui/CreatorStudioPanel.vue'
import OnboardingDialog from './infra/ui/OnboardingDialog.vue'
import ServiceStatusPill from './infra/ui/ServiceStatusPill.vue'
import KeyboardHelpCard from './infra/ui/KeyboardHelpCard.vue'
import SpotlightSearch from './infra/ui/SpotlightSearch.vue'
import BootSplash from './infra/ui/BootSplash.vue'
import { THEME_LABEL, useThemeMode } from './infra/ui/useThemeMode'
import { CMD_KEY } from './infra/ui/useCmdKey'
// v0.17: CharacterStatusBar 已移除 — 角色信息收到右键菜单 "切换角色" 项
import CharacterPicker from './infra/ui/CharacterPicker.vue'
import CharacterCreator from './infra/ui/CharacterCreator.vue'
import SoulEditor from './infra/ui/SoulEditor.vue'
import ModelHealthDashboard from './infra/ui/ModelHealthDashboard.vue'
import SceneBackground from './infra/ui/SceneBackground.vue'
// v0.21：EmotionParticles（情绪浮动 emoji 粒子）已移除 —— 时不时冒出、无实际用途、干扰屏幕
import StickerOverlay from './avatar/components/StickerOverlay.vue'
import { useCharacterStore } from './infra/stores/character'
import { iconChat, iconGear, iconMinus, iconUser, iconX } from './infra/ui/icons'
import { useConfigStore } from './infra/stores/config'
import { useDialogStore } from './brain/stores/dialog'
import { exportTurnsToMarkdown } from './brain/dialog-export'
import { useSpeechStore } from './presence/stores/speech'
import { useApprovalStore } from './hands/approval-store'
import { bus } from './infra/eventbus'

const cfg = useConfigStore()
const dialog = useDialogStore()
// R33: 主题模式初始化 (auto/light/dark) — composable 自管 DOM 写入
const theme = useThemeMode()
const speech = useSpeechStore()
const approval = useApprovalStore()
const character = useCharacterStore()

const ready = ref(false)
const settingsOpen = ref(false)
const settingsInitialTab = ref<'llm' | 'avatar' | 'scene' | 'tts' | 'rvc' | 'soul' | 'mcp' | undefined>(undefined)
const keyboardHelpOpen = ref(false)
const spotlightOpen = ref(false)
const creatorStudioOpen = ref(false)
const libraryOpen = ref(false)
const inputOpen = ref(false)
const pinned = ref(true)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const onboardingOpen = ref(false)
const characterPickerOpen = ref(false)
const characterCreatorOpen = ref(false)
const soulEditorOpen = ref(false)
const healthDashboardOpen = ref(false)

// 全屏模态打开时关闭穿透判定（整块都是 UI，避免点击被穿透到下层）。
// v0.21：输入框(inputOpen)不再全局关穿透 —— 它只是底部一个小浮条，本身会被
// isOverUiElement 命中而可点；对话时屏幕其余区域仍应保持鼠标穿透到桌面。
const passthroughEnabled = computed(
  () =>
    !settingsOpen.value &&
    !creatorStudioOpen.value &&
    !menuOpen.value &&
    !libraryOpen.value &&
    !onboardingOpen.value &&
    !characterPickerOpen.value &&
    !characterCreatorOpen.value &&
    !soulEditorOpen.value &&
    !healthDashboardOpen.value,
)

// v0.21：右键菜单极简 5 项 —— 其余功能收进「设置 → 更多」。
// onMenuSelect 的分支全部保留（tray 菜单 + Settings 更多 tab 复用同一套 id）。
const menuItems = computed<MenuItem[]>(() => [
  { id: 'chat', label: inputOpen.value ? '隐藏输入框' : '打开对话', icon: iconChat, shortcut: 'Space' },
  { id: 'pick-character', label: `切换角色${character.active ? ` · ${character.active.name}` : ''}`, icon: iconUser },
  { id: 'settings', label: '设置', icon: iconGear },
  { id: 'sep-end', label: '', separator: true },
  { id: 'minimize', label: '收起', icon: iconMinus },
  { id: 'close', label: '关闭', danger: true, icon: iconX },
])

function openMenu(x: number, y: number): void {
  menuX.value = x
  menuY.value = y
  menuOpen.value = true
}
function closeMenu(): void {
  menuOpen.value = false
}

/** R87: 把当前对话历史复制为 markdown 到剪贴板 */
async function exportDialogToClipboard(): Promise<void> {
  const turns = dialog.turns.map((t) => ({
    role: t.role,
    text: t.text,
    ts: t.ts,
    ...(t.emotion !== undefined && { emotion: t.emotion }),
    ...(t.intensity !== undefined && { intensity: t.intensity }),
    ...(t.error !== undefined && { error: t.error }),
  }))
  const name = character.active?.name ?? '助手'
  const md = exportTurnsToMarkdown(turns, name)
  try {
    await navigator.clipboard.writeText(md)
    bus.emit('ui:toast', {
      kind: 'success',
      message: `✓ 已复制 ${turns.filter((t) => t.role !== 'system').length} 条对话`,
      ttl_ms: 2500,
    })
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `复制失败：${String(e).slice(0, 60)}`,
      ttl_ms: 4000,
    })
  }
}

/** R131-fix (LOW): 提取 abort handler 替代模板内短路求值 */
function handleAbortLlm(): void {
  if (dialog.replying) dialog.abort()
}

async function onMenuSelect(id: string): Promise<void> {
  switch (id) {
    case 'chat':
      inputOpen.value = !inputOpen.value
      break
    case 'settings':
      settingsOpen.value = true
      break
    case 'keyboard-help':
      keyboardHelpOpen.value = true
      break
    case 'theme-cycle':
      theme.cycle()
      bus.emit('ui:toast', {
        kind: 'info',
        message: `主题：${THEME_LABEL[theme.mode.value]}`,
        ttl_ms: 2500,
      })
      break
    case 'creator-studio':
      creatorStudioOpen.value = true
      break
    case 'library':
      libraryOpen.value = true
      break
    case 'pick-character':
      characterPickerOpen.value = true
      break
    case 'soul-editor':
      soulEditorOpen.value = true
      break
    case 'health-dashboard':
      healthDashboardOpen.value = true
      break
    case 'zoom-in':
      bus.emit('avatar:zoom', { delta: 0.15 })
      break
    case 'zoom-out':
      bus.emit('avatar:zoom', { delta: -0.15 })
      break
    case 'zoom-reset':
      bus.emit('avatar:zoom', { delta: 0, reset: true })
      break
    case 'ui-zoom-in':
      applyUIScale(Math.min(1.6, Math.round((uiScale.value + 0.1) * 10) / 10))
      break
    case 'ui-zoom-out':
      applyUIScale(Math.max(0.7, Math.round((uiScale.value - 0.1) * 10) / 10))
      break
    case 'ui-zoom-reset':
      applyUIScale(1)
      break
    case 'reload':
      await cfg.rescanModels()
      await cfg.reloadSoul()
      break
    case 'export-dialog':
      await exportDialogToClipboard()
      break
    case 'pin':
      pinned.value = !pinned.value
      await window.api.window.togglePin(pinned.value)
      break
    case 'minimize':
      await window.api.window.minimize()
      break
    case 'close':
      await window.api.window.close()
      break
  }
}

function closeSettings(): void {
  settingsOpen.value = false
  // R126-fix (MED): 重置 settingsInitialTab 防下次开 settings 串到 pill 定向的 tab
  settingsInitialTab.value = undefined
}

/**
 * v0.21：设置面板「更多」tab 里的功能入口 → 复用 onMenuSelect 现成分支（零重复逻辑）。
 * 会打开独立面板的入口先关设置面板，避免叠层遮挡。
 */
async function onSettingsAction(id: string): Promise<void> {
  const panelLaunchers = ['library', 'creator-studio', 'health-dashboard', 'soul-editor']
  if (panelLaunchers.includes(id)) settingsOpen.value = false
  await onMenuSelect(id)
}

function closeInput(): void {
  inputOpen.value = false
}

let offCtxMenuFn: (() => void) | null = null
let offSoulFn: (() => void) | null = null
let offInstalledFn: (() => void) | null = null
let offAttentionPlanFn: (() => void) | null = null
let offTrayFn: (() => void) | null = null
let offCharSwitchedFn: (() => void) | null = null
let offOpenOnboardingFn: (() => void) | null = null
const dragOver = ref(false)

/** Plan 执行入口：从 Live2DStage 拿 renderer + container 引用 */
async function executePlanForCurrentStage(
  plan: import('@shared/attention').BehaviorPlan,
): Promise<void> {
  // 通过 bus 让 Live2DStage 接管（它持有 renderer + container）
  bus.emit('attention:execute-plan', { plan })
}

async function onReloadModelClick(): Promise<void> {
  await cfg.rescanModels()
  bus.emit('avatar:reload-model')
  bus.emit('ui:toast', { kind: 'success', message: '模型已重载', ttl_ms: 2000 })
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
function onDragLeave(e: DragEvent): void {
  // 仅当离开整个 root 时清除（避免子元素 leave 误触）
  if ((e.relatedTarget as Node | null)?.nodeType) return
  dragOver.value = false
}
async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  // Electron renderer: File.path 在 contextIsolation 下不可用
  // 用 webUtils.getPathForFile (Electron 32+) 或 fallback File.name
  const paths: string[] = []
  for (const f of files) {
    const p = f.path
    if (p) paths.push(p)
  }
  if (paths.length === 0) {
    bus.emit('ui:toast', {
      kind: 'warn',
      message: '拖入的文件没有路径信息；请用「设置 → 从目录安装」或「下载安装」按钮',
      ttl_ms: 6000,
    })
    return
  }
  // R34: 按扩展名分流 — yaml/png 给针对性引导，其他走默认 Live2D 安装
  const ymls = paths.filter((p) => /\.(ya?ml)$/i.test(p))
  const imgs = paths.filter((p) => /\.(png|jpe?g|webp|gif)$/i.test(p))
  if (ymls.length > 0 && ymls.length === paths.length) {
    bus.emit('ui:toast', {
      kind: 'info',
      message: `检测到 ${ymls.length} 个 yaml 文件 — 灵魂编辑用「右键 → ✏️ 编辑灵魂」直接粘贴内容会更安全`,
      ttl_ms: 8000,
    })
    soulEditorOpen.value = true
    return
  }
  if (imgs.length > 0 && imgs.length === paths.length) {
    bus.emit('ui:toast', {
      kind: 'info',
      message: `检测到 ${imgs.length} 张图片 — 头像 / 场景背景请在「角色管理」或「场景」设置里上传`,
      ttl_ms: 7000,
    })
    return
  }
  // R39 fix (MED): 混合 (yaml + 图片 + 其他) → 提示分开拖, 避免 Live2D 安装器吞错文件
  if ((ymls.length > 0 || imgs.length > 0) && ymls.length + imgs.length < paths.length) {
    bus.emit('ui:toast', {
      kind: 'warn',
      message: '混合文件拖入 — 请分别拖 yaml / 图片 / Live2D 模型',
      ttl_ms: 5000,
    })
    return
  }
  // 走默认 Live2D 模型 zip / 目录安装
  const results = await window.api.market.installPaths(paths)
  const ok = results.filter((r) => r.ok)
  const fail = results.filter((r) => !r.ok)
  if (ok.length > 0) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已安装 ${ok.length} 个模型：${ok.map((r) => r.detected_name).filter(Boolean).join('，')}`,
      ttl_ms: 5000,
    })
  }
  if (fail.length > 0) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `${fail.length} 个安装失败：${fail.map((r) => r.reason).slice(0, 2).join('；')}`,
      ttl_ms: 8000,
    })
  }
  if (ok.length > 0) await cfg.rescanModels()
}

onMounted(async () => {
  await cfg.bootstrap()
  await character.bootstrap()           // v0.14: 先 load character
  await dialog.bootstrap()
  speech.bootstrap()
  approval.bootstrap()
  dialog.injectGreeting()
  ready.value = true

  // R37: 首启 35s 后浮一次性发现提示 — localStorage 标记已显示
  scheduleDiscoveryHint()

  // v0.14: 切角色时清空对话历史 + 重新 inject greeting
  const charSwitchedHandler = async (): Promise<void> => {
    await dialog.bootstrap()  // reload per-character history
    await cfg.reloadSoul()    // 新角色的灵魂
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已切换到 ${character.active?.name ?? '?'}`,
      ttl_ms: 2500,
    })
  }
  bus.on('character:switched', charSwitchedHandler)
  offCharSwitchedFn = () => bus.off('character:switched', charSwitchedHandler)

  // UX:任意处(如 dialog 检测 LLM 未配置)请求打开引导
  const openOnboardingHandler = (): void => { onboardingOpen.value = true }
  bus.on('ui:open-onboarding', openOnboardingHandler)
  offOpenOnboardingFn = () => bus.off('ui:open-onboarding', openOnboardingHandler)

  // v0.13 首次启动引导：LLM 未配置就弹出
  if (!cfg.config?.llm_endpoint || !cfg.config?.llm_model) {
    onboardingOpen.value = true
  }

  const handler = ({ x, y }: { x: number; y: number }): void => openMenu(x, y)
  bus.on('avatar:contextmenu', handler)
  offCtxMenuFn = () => bus.off('avatar:contextmenu', handler)

  // 主进程把 yaml 改了 → 自动重载 soul（保持 store 与磁盘一致）
  offSoulFn = window.api.soul.onChanged(() => {
    void cfg.reloadSoul()
  })

  // 模型安装完成 → 刷新模型列表
  offInstalledFn = window.api.market.onInstalled(() => {
    void cfg.rescanModels()
  })

  // v0.8 主体性架构：监听主进程 BehaviorPlan → 执行
  offAttentionPlanFn = window.api.attention.onPlan((plan) => {
    void executePlanForCurrentStage(plan)
  })

  // v0.8.2: dialog LLM 的 reply 也可能带 actions（同 BehaviorAction shape），让 plan-executor 跑
  const onReplyActions = (
    payload: { actions: import('@shared/attention').BehaviorAction[] },
  ): void => {
    void executePlanForCurrentStage({
      t: Date.now(),
      trigger: 'reply-actions',
      actions: payload.actions,
      reasoning: 'inline from dialog reply',
      llm_generated: true,
    })
  }
  bus.on('brain:reply-actions', onReplyActions)
  // v0.17 P3: tray 菜单点击 → 走 renderer 同一套 onMenuSelect 分支
  offTrayFn = window.api.system.onTrayAction((id) => { void onMenuSelect(id) })

  // v0.17 (二次)：全局 UI 缩放快捷键 Cmd/Ctrl + = / - / 0
  //   用 transform: scale 通过 :root --ui-scale，应用在 global.css 的 panel selector 上。
  //   不像之前 .ui-overlay-layer + zoom 那样会破坏 fixed children 事件路径。
  const persisted = Number(localStorage.getItem('ui-scale') ?? '1') || 1
  applyUIScale(Math.min(1.6, Math.max(0.7, persisted)))
  window.addEventListener('keydown', onScaleKey)
})

const uiScale = ref(1)

function applyUIScale(s: number): void {
  uiScale.value = s
  document.documentElement.style.setProperty('--ui-scale', String(s))
  localStorage.setItem('ui-scale', String(s))
}

/** R37: 首启 35s 后浮一次性引导 toast，已显示过的不再弹 */
const DISCOVERY_STORAGE_KEY = 'luvu-discovery-shown'
let discoveryTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDiscoveryHint(): void {
  if (localStorage.getItem(DISCOVERY_STORAGE_KEY) === '1') return
  discoveryTimer = setTimeout(() => {
    // 用户 35s 内已经用过 spotlight / help / settings → 不打扰
    if (spotlightOpen.value || keyboardHelpOpen.value || settingsOpen.value) return
    bus.emit('ui:toast', {
      kind: 'info',
      message:
        '💡 试试 Cmd/Ctrl + K 全局搜索 · 按 ? 看所有快捷键 · 右键人物找设置（本提示只出现一次）',
      ttl_ms: 12000,
    })
    try {
      localStorage.setItem(DISCOVERY_STORAGE_KEY, '1')
    } catch {
      // localStorage 满 / 隐私模式 — 静默
    }
  }, 35_000)
}

function onScaleKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  const tag = t?.tagName
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable === true
  // UX R23: ? 唤起快捷键卡（不需要修饰键 — 但要避免在 input/textarea 内触发）
  if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping) {
    e.preventDefault()
    keyboardHelpOpen.value = !keyboardHelpOpen.value
    return
  }
  // R36: Space 打开 / 关闭对话输入框（避开输入态 + 修饰键组合）
  if (
    e.key === ' ' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !isTyping &&
    !keyboardHelpOpen.value &&
    !spotlightOpen.value &&
    !onboardingOpen.value
  ) {
    e.preventDefault()
    inputOpen.value = !inputOpen.value
    return
  }
  // R23: Esc 关闭帮助卡
  if (e.key === 'Escape' && keyboardHelpOpen.value) {
    e.preventDefault()
    keyboardHelpOpen.value = false
    return
  }
  if (!e.metaKey && !e.ctrlKey) return
  // R40: Cmd/Ctrl + . 中止正在生成的 LLM 回复 (macOS 标准 "cancel")
  // R43 fix (MED): isTyping 时不劫持, 避免 IME 组合键误中止
  if (e.key === '.' && dialog.replying && !isTyping) {
    e.preventDefault()
    dialog.abort()
    bus.emit('ui:toast', {
      kind: 'info',
      message: '已中止当前回复',
      ttl_ms: 2000,
    })
    return
  }
  // UX R24: Cmd/Ctrl + K 唤起全局 Spotlight 搜索
  if (e.key === 'k' || e.key === 'K') {
    e.preventDefault()
    spotlightOpen.value = !spotlightOpen.value
    return
  }
  // R33: Cmd/Ctrl + Shift + T 循环切主题 (auto → light → dark)
  if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault()
    theme.cycle()
    bus.emit('ui:toast', {
      kind: 'info',
      message: `主题：${THEME_LABEL[theme.mode.value]}`,
      ttl_ms: 2000,
    })
    return
  }
  const cur = uiScale.value
  if (e.key === '=' || e.key === '+') {
    e.preventDefault()
    applyUIScale(Math.min(1.6, Math.round((cur + 0.1) * 10) / 10))
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    applyUIScale(Math.max(0.7, Math.round((cur - 0.1) * 10) / 10))
  } else if (e.key === '0') {
    e.preventDefault()
    applyUIScale(1)
  }
}

onBeforeUnmount(() => {
  offCtxMenuFn?.()
  offSoulFn?.()
  offInstalledFn?.()
  offAttentionPlanFn?.()
  offTrayFn?.()
  offCharSwitchedFn?.()
  offOpenOnboardingFn?.()
  window.removeEventListener('keydown', onScaleKey)
  if (discoveryTimer) {
    clearTimeout(discoveryTimer)
    discoveryTimer = null
  }
})
</script>

<template>
  <ErrorBoundary>
    <div
      class="root"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <SceneBackground v-if="ready" />
      <Live2DStage v-if="ready" :passthrough-enabled="passthroughEnabled" />
      <!-- v0.17：桌面减法 — 移除 CharacterStatusBar 和 ControlDock
           功能全部迁到右键菜单（menuItems）+ 系统状态栏 Tray (P3)。
           桌面只保留：背景 / Live2D 立绘 / 情绪粒子 / 对话气泡 / 贴纸 / 输入框 -->
      <DialogBubble v-if="ready" />
      <DynamicIsland v-if="ready" />
      <StickerOverlay v-if="ready" />
      <InputBar v-if="ready && inputOpen" @close="closeInput" />
      <ContextMenu
        :open="menuOpen"
        :x="menuX"
        :y="menuY"
        :items="menuItems"
        @select="onMenuSelect"
        @close="closeMenu"
      />
      <ErrorBoundary scope="panel" label="设置面板">
        <SettingsPanel
          v-if="settingsOpen"
          v-bind="settingsInitialTab !== undefined ? { initialTab: settingsInitialTab } : {}"
          @close="closeSettings"
          @action="onSettingsAction"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="创作工坊">
        <CreatorStudioPanel v-if="creatorStudioOpen" @close="creatorStudioOpen = false" />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="资源商店">
        <ResourceStorePanel v-if="libraryOpen" @close="libraryOpen = false" />
      </ErrorBoundary>
      <OnboardingDialog v-if="onboardingOpen" @close="onboardingOpen = false" />
      <ServiceStatusPill
        v-if="ready"
        @open-settings="(tab) => { settingsInitialTab = tab; settingsOpen = true }"
      />
      <KeyboardHelpCard :open="keyboardHelpOpen" @close="keyboardHelpOpen = false" />
      <SpotlightSearch
        :open="spotlightOpen"
        @close="spotlightOpen = false"
        @open-settings="settingsOpen = true"
        @open-character-picker="characterPickerOpen = true"
        @open-soul-editor="soulEditorOpen = true"
        @open-input="inputOpen = true"
        @open-onboarding="onboardingOpen = true"
        @reload-model="bus.emit('avatar:reload-model')"
        @clear-dialog="dialog.clear()"
        @export-dialog="exportDialogToClipboard()"
        @open-help="keyboardHelpOpen = true"
        @reset-ui-scale="applyUIScale(1)"
        @abort-llm="handleAbortLlm"
      />
      <ErrorBoundary scope="panel" label="角色选择器">
        <CharacterPicker
          v-if="characterPickerOpen"
          @close="characterPickerOpen = false"
          @open-creator="() => { characterPickerOpen = false; characterCreatorOpen = true }"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="角色创建">
        <CharacterCreator
          v-if="characterCreatorOpen"
          @close="characterCreatorOpen = false"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="灵魂编辑器">
        <SoulEditor
          v-if="soulEditorOpen"
          @close="soulEditorOpen = false"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="模型健康仪表">
        <ModelHealthDashboard
          v-if="healthDashboardOpen"
          @close="healthDashboardOpen = false"
        />
      </ErrorBoundary>
      <ApprovalDialog />
      <ToastStack />
      <BootSplash :ready="ready" />
      <div v-if="ready" class="hint" key="ready-hint">右键人物可以打开菜单 · 按 ? 看快捷键</div>
      <transition name="drop">
        <div v-if="dragOver" class="drop-overlay">
          <div class="drop-card">
            <div class="drop-icon">📦</div>
            <div class="drop-title">松开安装 Live2D 模型</div>
            <div class="drop-sub">支持 .zip 或解压后的模型目录</div>
          </div>
        </div>
      </transition>
    </div>
  </ErrorBoundary>
</template>

<style scoped>
.root {
  position: relative;
  width: 100%;
  height: 100%;
  background: transparent;
  pointer-events: auto;
}
.hint {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  opacity: 0;
  animation: hint-show 6s var(--ease-out-expo) forwards;
}
@keyframes hint-show {
  0% { opacity: 0; transform: translate(-50%, 10px); }
  10% { opacity: 0.95; transform: translateX(-50%); }
  85% { opacity: 0.85; transform: translateX(-50%); }
  100% { opacity: 0; transform: translate(-50%, 10px); }
}

.drop-overlay {
  position: absolute;
  inset: 0;
  background: oklch(0% 0 0 / 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1900;
  pointer-events: none;
  backdrop-filter: blur(8px) saturate(1.2);
  -webkit-backdrop-filter: blur(8px) saturate(1.2);
}
.drop-card {
  background: var(--color-bubble);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-lg);
  padding: 32px 40px;
  text-align: center;
  box-shadow: var(--shadow-lg);
  color: var(--color-bubble-text);
  max-width: 80%;
  animation: drop-pulse 1.8s var(--ease-in-out) infinite;
}
@keyframes drop-pulse {
  0%, 100% { transform: scale(1); border-color: var(--color-accent); }
  50% { transform: scale(1.02); border-color: var(--color-accent-hover); }
}
.drop-icon {
  font-size: 52px;
  margin-bottom: 10px;
  animation: drop-bounce 1.5s var(--ease-in-out) infinite;
}
@keyframes drop-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.drop-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin-bottom: 4px;
}
.drop-sub {
  font-size: var(--text-sm);
  color: var(--color-muted);
}
.drop-enter-active,
.drop-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-expo);
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
}
</style>
