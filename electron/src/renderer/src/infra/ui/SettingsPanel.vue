<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import { useThemeMode } from './useThemeMode'
import DiskUsageDialog from './DiskUsageDialog.vue'
import FloatingPanel from './FloatingPanel.vue'
import RvcSettingsSection from './settings/RvcSettingsSection.vue'
import SceneSettingsTab from './settings/SceneSettingsTab.vue'
import EvalRunner from './EvalRunner.vue'
import EmotionalDebugPanel from './EmotionalDebugPanel.vue'
import SoulChangeLogPanel from './SoulChangeLogPanel.vue'
import { normalizeLlmEndpoint, normalizeSimpleUrl } from '../../brain/normalize-endpoint'
import type { RuntimeConfig } from '@shared/types'

/** R119: 接 initialTab prop, 让 ServiceStatusPill 等组件能定向跳转
 *  R126-fix (LOW): SettingsTab 类型抽到顶部, defineProps 引用同一 type 避免双 source */
type SettingsTab = 'llm' | 'avatar' | 'scene' | 'tts' | 'rvc' | 'soul' | 'mcp' | 'more'
const props = defineProps<{ initialTab?: SettingsTab }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'action', id: string): void }>()

const cfg = useConfigStore()

/**
 * v0.21 修复对比度：面板底色跟随 app 主题。
 * 之前硬编码 theme="light"（白底），但内容文字用的是随主题翻转的 token
 * （--color-bubble-text 等）；app 处于暗色时 token 变成浅色 → 浅字白底看不见。
 * 让面板底色跟 app 主题一致，token 与底色始终配套。
 */
const themeMode = useThemeMode()
const systemDark = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
)
let themeMql: MediaQueryList | null = null
const onSystemTheme = (e: MediaQueryListEvent): void => {
  systemDark.value = e.matches
}
const panelTheme = computed<'light' | 'dark'>(() => {
  if (themeMode.mode.value === 'light') return 'light'
  if (themeMode.mode.value === 'dark') return 'dark'
  return systemDark.value ? 'dark' : 'light'
})

function blankConfig(): RuntimeConfig {
  return {
    llm_provider: 'openai_compat',
    llm_endpoint: '',
    llm_model: '',
    llm_api_key: '',
    tts_provider: 'sidecar',
    tts_sidecar_url: '',
    rvc_voice: '',
    rvc_f0_up_key: 0,
    rvc_index_rate: 0.75,
    rvc_f0_method: 'rmvpe',
    // v0.11: 底座 TTS 语速/音量/音调
    tts_rate: '+0%',
    tts_volume: '+0%',
    tts_pitch: '+0Hz',
    // v0.11: RVC 高级参数
    rvc_protect: 0.33,
    rvc_filter_radius: 3,
    rvc_rms_mix_rate: 1.0,
    rvc_resample_sr: 0,
    idle_min_sec: 60,
    idle_max_sec: 180,
    autocomment_interval_sec: 600,
    emotion_decay_per_minute: 0.1,
    flip_probability: 0.15,
    emotion_voice_map: {},
    embedding_endpoint: '',
    embedding_model: '',
    openai_compat_merge_system: true,
    chinese_llm_enhance: true,
  }
}

const form = reactive<RuntimeConfig>(blankConfig())
const selectedModel = ref<string>('')
// R74: API Key show/hide 切换 — 默认 password 隐藏, 用户点👁切到 text
const showApiKey = ref(false)
/** 用户是否已在面板上做过编辑（true 后停止从 store 覆盖，避免 IPC 推送把输入回退） */
const userEdited = ref(false)
/** 最近一次保存反馈 */
const saveStatus = ref<{ ok: boolean; message: string } | null>(null)
/** v0.13: 磁盘占用统计 dialog */
const diskUsageOpen = ref(false)
/** v0.13 (M1): 当前 tab, v-show 保 form 状态不丢; SettingsTab 类型在顶部已定义 */
const activeTab = ref<SettingsTab>(props.initialTab ?? 'llm')

/** R107+R109-fix (HIGH): tabs ←→ 键盘导航, 切换后 focus 转移到新 tab (WAI-ARIA roving tabindex 标准) */
async function onTabsKeydown(e: KeyboardEvent): Promise<void> {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const idx = tabs.findIndex((t) => t.id === activeTab.value)
  if (idx < 0) return
  let nextIdx = idx
  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length
  else if (e.key === 'Home') nextIdx = 0
  else if (e.key === 'End') nextIdx = tabs.length - 1
  activeTab.value = tabs[nextIdx]!.id
  // 转移焦点到新 active tab 让屏读器朗读 + 视觉 focus ring 跟随
  await nextTick()
  const nav = (e.currentTarget as HTMLElement | null)
  const next = nav?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIdx]
  next?.focus()
}
/** v0.21：统一线性 SVG 图标（替代 emoji，更高级一致）。均为可信静态 SVG，v-html 渲染。 */
const svgIcon = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
const TAB_ICONS: Record<SettingsTab, string> = {
  llm: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>'),
  avatar: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.6 3.6-5.5 8-5.5s8 1.9 8 5.5"/>'),
  scene: svgIcon('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="m3 16.5 5-4 4 3 3-2.4 6 4.4"/>'),
  tts: svgIcon('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.6 6a9 9 0 0 1 0 12"/>'),
  rvc: svgIcon('<path d="M4 21v-6M4 11V3M12 21v-8M12 9V3M20 21v-4M20 13V3"/><circle cx="4" cy="13" r="1.7"/><circle cx="12" cy="11" r="1.7"/><circle cx="20" cy="15" r="1.7"/>'),
  soul: svgIcon('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.6 15.2l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>'),
  mcp: svgIcon('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>'),
  more: svgIcon('<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>'),
}
const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'llm', label: '大脑', icon: TAB_ICONS.llm },
  { id: 'avatar', label: '立绘', icon: TAB_ICONS.avatar },
  { id: 'scene', label: '场景', icon: TAB_ICONS.scene },
  { id: 'tts', label: '声音', icon: TAB_ICONS.tts },
  { id: 'rvc', label: 'RVC', icon: TAB_ICONS.rvc },
  { id: 'soul', label: '灵魂', icon: TAB_ICONS.soul },
  { id: 'mcp', label: 'MCP', icon: TAB_ICONS.mcp },
  { id: 'more', label: '更多', icon: TAB_ICONS.more },
]

/** v0.17 P：MCP server 管理 — UI 状态 */
interface McpServerRow {
  id: string
  name: string
  command: string
  status: 'running' | 'stopped' | 'error'
  toolCount: number
}
const mcpServers = ref<McpServerRow[]>([])
const mcpForm = ref<{ id: string; name: string; command: string; argsRaw: string }>({
  id: '',
  name: '',
  command: '',
  argsRaw: '',
})
const mcpAdding = ref(false)
const mcpExpanded = ref<Set<string>>(new Set())
const mcpTools = ref<Record<string, Array<{ name: string; description: string }>>>({})

async function loadMcpServers(): Promise<void> {
  try {
    mcpServers.value = await window.api.mcp.listServers()
  } catch (e) {
    console.warn('[mcp ui] list failed', e)
  }
}

async function addMcpServer(): Promise<void> {
  const f = mcpForm.value
  if (!f.id.trim() || !f.command.trim()) return
  mcpAdding.value = true
  try {
    const args = f.argsRaw.trim() ? f.argsRaw.split(/\s+/) : []
    const r = await window.api.mcp.register({
      id: f.id.trim(),
      name: f.name.trim() || f.id.trim(),
      command: f.command.trim(),
      args,
    })
    if (r.ok) {
      mcpForm.value = { id: '', name: '', command: '', argsRaw: '' }
      await loadMcpServers()
    } else {
      alert(`注册失败：${r.reason}`)
    }
  } finally {
    mcpAdding.value = false
  }
}

async function removeMcpServer(id: string): Promise<void> {
  if (!confirm(`关停并移除 MCP server "${id}"？`)) return
  await window.api.mcp.unregister(id)
  mcpExpanded.value.delete(id)
  delete mcpTools.value[id]
  await loadMcpServers()
}

async function toggleMcpTools(id: string): Promise<void> {
  if (mcpExpanded.value.has(id)) {
    mcpExpanded.value.delete(id)
    return
  }
  mcpExpanded.value.add(id)
  if (!mcpTools.value[id]) {
    mcpTools.value[id] = await window.api.mcp.listTools(id)
  }
}

function loadFromStore(): void {
  if (cfg.config) Object.assign(form, JSON.parse(JSON.stringify(cfg.config)))
  if (cfg.soul?.avatar.model_dir) selectedModel.value = cfg.soul.avatar.model_dir
}

// 初始化：拷一份 store 当前值
loadFromStore()

// 打开面板时自动 rescan，确保 model meta 是最新的（v0.6.9 加了 meta 字段）
onMounted(() => {
  void cfg.rescanModels()
  void loadMcpServers()
  if (typeof window !== 'undefined') {
    themeMql = window.matchMedia('(prefers-color-scheme: dark)')
    themeMql.addEventListener('change', onSystemTheme)
  }
})

onBeforeUnmount(() => {
  themeMql?.removeEventListener('change', onSystemTheme)
})

// 用户没动过表单时，store 变化可以镜像回 form（避免显示陈旧值）
watch(
  () => cfg.config,
  () => {
    if (!userEdited.value) loadFromStore()
  },
)
watch(
  () => cfg.soul?.avatar.model_dir,
  (v) => {
    if (!userEdited.value && v) selectedModel.value = v
  },
)

/** 任何字段被改动 → markDirty，停止外部覆盖 */
function markDirty(): void {
  userEdited.value = true
  saveStatus.value = null
}

const dirty = computed<boolean>(() => {
  if (!cfg.config) return false
  const a = JSON.stringify(form)
  const b = JSON.stringify(cfg.config)
  const modelChanged = !!selectedModel.value && selectedModel.value !== cfg.soul?.avatar.model_dir
  return a !== b || modelChanged
})

const ttsHealth = ref<{ ok: boolean; status?: number; reason?: string } | null>(null)

async function probeTts(): Promise<void> {
  ttsHealth.value = await window.api.tts.probe()
}

// v0.9: RVC 训练好的音色列表 + 加载状态
const rvcVoices = ref<string[]>([])
const rvcStatus = ref<string>('')
// v0.11: TTS 节奏参数 — 字符串 "+20%" / "+5Hz" 跟 slider int 互转
function parseTtsRate(s: string | undefined): number {
  if (!s) return 0
  const m = s.match(/(-?\d+)/)
  return m ? parseInt(m[1] ?? '0', 10) : 0
}
function parseTtsPitch(s: string | undefined): number {
  return parseTtsRate(s)
}
function formatPct(e: Event): string {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  return v >= 0 ? `+${v}%` : `${v}%`
}
function formatHz(e: Event): string {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  return v >= 0 ? `+${v}Hz` : `${v}Hz`
}

async function refreshRvcVoices(): Promise<void> {
  rvcStatus.value = '加载中…'
  try {
    const r = await window.api.tts.listRvcVoices()
    if (r.ok) {
      rvcVoices.value = r.voices
      rvcStatus.value = r.voices.length > 0
        ? `✓ ${r.voices.length} 个已训练音色 @ ${r.sidecar ?? ''}`
        : '✓ RVC 可用，但还没训练任何音色（先在 workstation 上跑训练）'
    } else {
      rvcVoices.value = []
      rvcStatus.value = `✗ ${r.reason ?? 'RVC 不可用'}`
    }
  } catch (e) {
    rvcStatus.value = `✗ ${String(e).slice(0, 80)}`
  }
}

const dataDir = ref<string>('')
async function bootstrapMeta(): Promise<void> {
  const paths = await window.api.system.paths()
  dataDir.value = paths.userDataDir
}
bootstrapMeta()
// 打开 Settings 时静默拉一次 RVC voices（不阻塞 UI）
void refreshRvcVoices()

/**
 * 一键保存：先存 RuntimeConfig，再（如需）存 avatar。
 * 任一步失败 → 不关面板 + toast；全成功 → toast + 关面板。
 */
async function save(): Promise<void> {
  const errors: string[] = []
  let configSaved = false
  let avatarSaved = false

  try {
    await cfg.save(form)
    configSaved = true
  } catch (e) {
    errors.push(`运行配置：${e instanceof Error ? e.message : String(e)}`)
  }

  // 模型切换（如果选了一个跟当前不一样的）
  const targetDir = selectedModel.value
  if (cfg.soul && targetDir && targetDir !== cfg.soul.avatar.model_dir) {
    try {
      const target = cfg.models.find((m) => m.dir === targetDir)
      const ok = await cfg.saveAvatar({
        model_dir: targetDir,
        model_file: target?.model_file ?? cfg.soul.avatar.model_file,
      })
      if (ok) avatarSaved = true
      else errors.push('立绘配置写回 identity.yaml 失败（已在前端切换，但磁盘没生效）')
    } catch (e) {
      errors.push(`立绘配置：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (errors.length === 0) {
    saveStatus.value = { ok: true, message: '已保存' }
    const parts: string[] = []
    if (configSaved) parts.push('运行配置')
    if (avatarSaved) parts.push('立绘')
    bus.emit('ui:toast', {
      kind: 'success',
      message: parts.length > 0 ? `已保存：${parts.join(' + ')}` : '已保存',
      ttl_ms: 2500,
    })
    userEdited.value = false
    // 短暂展示「已保存」再关闭，比直接关闭更让人放心
    setTimeout(() => emit('close'), 350)
  } else {
    saveStatus.value = { ok: false, message: errors.join('；') }
    bus.emit('ui:toast', { kind: 'error', message: `保存失败：${errors[0]}`, ttl_ms: 8000 })
  }
}

async function testLlm(): Promise<void> {
  await cfg.testLlm(form)
}

async function rescan(): Promise<void> {
  await cfg.rescanModels()
  bus.emit('ui:toast', { kind: 'info', message: `已扫描，${cfg.models.length} 个模型`, ttl_ms: 2500 })
}

const healing = ref(false)
const dedupChecking = ref(false)
const dedupReport = ref<Awaited<ReturnType<typeof window.api.models.findDuplicates>> | null>(null)

async function checkDuplicates(): Promise<void> {
  dedupChecking.value = true
  try {
    dedupReport.value = await window.api.models.findDuplicates()
    const r = dedupReport.value
    const exact = r.groups.filter((g) => g.confidence === 'exact').length
    const sameMoc = r.groups.filter((g) => g.confidence === 'same_moc').length
    const similar = r.groups.filter((g) => g.confidence === 'similar_dir').length
    const parts = [
      exact > 0 ? `${exact} 组真重复` : '',
      sameMoc > 0 ? `${sameMoc} 组同模型不同形态` : '',
      similar > 0 ? `${similar} 组名字相近` : '',
    ].filter(Boolean)
    bus.emit('ui:toast', {
      kind: parts.length > 0 ? 'info' : 'success',
      message:
        parts.length === 0
          ? `扫描完成：${r.total_models} 个模型，无任何同组关系`
          : `发现：${parts.join('，')}${r.exact_duplicates > 0 ? `（${r.exact_duplicates} 个真冗余可安全删，占 ${Math.round(r.exact_disk_kb / 1024)} MB）` : ''}`,
      ttl_ms: 10000,
    })
  } finally {
    dedupChecking.value = false
  }
}

async function mergeGroups(): Promise<void> {
  if (!dedupReport.value) return
  const exactCount = dedupReport.value.groups.filter((g) => g.confidence === 'exact').length
  if (exactCount === 0) {
    bus.emit('ui:toast', {
      kind: 'info',
      message: '没有可合并的 group（只 exact group 能合并 — same_moc / similar_dir 是不同 texture / 不同 moc 技术上不能合）',
      ttl_ms: 8000,
    })
    return
  }
  const ok = window.confirm(
    `将合并 ${exactCount} 个 exact group：把同组里分散的 motion/expression 引用并入主 model3.json，归档次要 model3.json 为 .merged.bak（不删 motion/exp 文件，可恢复）。继续？`,
  )
  if (!ok) return
  dedupChecking.value = true
  try {
    const r = await window.api.models.mergeGroups({})
    const parts = [
      `合并 ${r.merged_groups} 组`,
      r.added_motions > 0 ? `新增 ${r.added_motions} 动作引用` : '',
      r.added_expressions > 0 ? `新增 ${r.added_expressions} 表情引用` : '',
      r.skipped.length > 0 ? `跳过 ${r.skipped.length} 组（不能合并）` : '',
    ].filter(Boolean)
    bus.emit('ui:toast', {
      kind: r.ok ? 'success' : 'warn',
      message: parts.join('，'),
      ttl_ms: 8000,
    })
    await cfg.rescanModels()
    bus.emit('avatar:reload-model')
    dedupReport.value = null
  } finally {
    dedupChecking.value = false
  }
}

async function applyDedup(): Promise<void> {
  if (!dedupReport.value || dedupReport.value.exact_duplicates === 0) return
  const ok = window.confirm(
    `安全 Archive：把 ${dedupReport.value.exact_duplicates} 个字节级重复的 model3.json 改名为 .dedup.bak。\n\n` +
      `✓ 不删 moc / texture / motion / expression 任何文件\n` +
      `✓ 同目录其他模型完全不动\n` +
      `✓ 可手动把 .dedup.bak 改回 .model3.json 恢复\n\n继续？`,
  )
  if (!ok) return
  dedupChecking.value = true
  try {
    const r = await window.api.models.applyDedup({})
    bus.emit('ui:toast', {
      kind: r.ok ? 'success' : 'warn',
      message: `Archive ${r.deleted.length} 个 model3.json${r.failed.length ? `；${r.failed.length} 个失败` : ''}`,
      ttl_ms: 6000,
    })
    await cfg.rescanModels()
    dedupReport.value = null
  } finally {
    dedupChecking.value = false
  }
}

async function healSelected(): Promise<void> {
  if (!selectedModel.value) {
    bus.emit('ui:toast', { kind: 'warn', message: '先选一个模型', ttl_ms: 3000 })
    return
  }
  const target = cfg.models.find((m) => m.dir === selectedModel.value)
  if (!target) return
  if (!target.meta?.healable) {
    const hints = (target.meta?.heal_hints ?? []).join('；') || '该模型无法 auto-heal'
    bus.emit('ui:toast', { kind: 'warn', message: hints, ttl_ms: 8000 })
    return
  }
  healing.value = true
  try {
    const r = await window.api.models.heal({ model_json_path: target.absolute_path })
    if (!r.ok) {
      bus.emit('ui:toast', { kind: 'error', message: `Heal 失败：${r.reason}`, ttl_ms: 8000 })
      return
    }
    const parts: string[] = []
    if (r.added.motions.length) parts.push(`生成 ${r.added.motions.length} 动作`)
    if (r.added.expressions.length) parts.push(`生成 ${r.added.expressions.length} 表情`)
    if (r.added.bound_orphans.motions.length)
      parts.push(`绑定 ${r.added.bound_orphans.motions.length} 个 orphan motion`)
    if (r.added.bound_orphans.expressions.length)
      parts.push(`绑定 ${r.added.bound_orphans.expressions.length} 个 orphan expression`)
    bus.emit('ui:toast', {
      kind: 'success',
      message: parts.length ? `Heal 完成：${parts.join('，')}（重载模型生效）` : 'Heal 完成（无需补）',
      ttl_ms: 6000,
    })
    await cfg.rescanModels()
    // v0.8.2: heal 完成后强制重载 Live2D 模型让新 motion/expression 立刻生效
    if (parts.length > 0 && cfg.soul?.avatar.model_dir === target.dir) {
      bus.emit('avatar:reload-model')
    }
  } finally {
    healing.value = false
  }
}

const zipUrl = ref('')
const installing = ref(false)

async function installFromZipFile(): Promise<void> {
  // 走主进程 dialog
  installing.value = true
  try {
    const picked = await window.api.soul.pickDirectory()
    // soul.pickDirectory 选目录；这里我们复用，但 user 选错时直接走 directory 安装也 OK
    if (picked) {
      const r = await window.api.market.installPath(picked)
      handleInstallResult(r)
    }
  } finally {
    installing.value = false
  }
}

async function installFromUrl(): Promise<void> {
  if (!zipUrl.value.trim()) return
  installing.value = true
  try {
    const r = await window.api.market.installUrl(zipUrl.value.trim())
    handleInstallResult(r)
    if (r.ok) zipUrl.value = ''
  } finally {
    installing.value = false
  }
}

function handleInstallResult(r: { ok: boolean; detected_name?: string; reason?: string }): void {
  if (r.ok) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已安装：${r.detected_name ?? '模型'}`,
      ttl_ms: 4000,
    })
    void cfg.rescanModels()
  } else {
    bus.emit('ui:toast', { kind: 'error', message: `安装失败：${r.reason ?? '未知'}`, ttl_ms: 8000 })
  }
}

async function reloadSoul(): Promise<void> {
  await cfg.reloadSoul()
  bus.emit('ui:toast', { kind: 'info', message: '灵魂档案已重载', ttl_ms: 2000 })
}

async function openDataDir(): Promise<void> {
  await window.api.system.revealDataDir()
}

// P5: character pack export/import
const packStatus = ref('')
const packIncludeMemory = ref(false) // memory.db 隐私敏感默认关

// P5: soul auto-learner 手动触发
const learnerStatus = ref('')
const learnerSyncing = ref(false)
async function syncLearner(): Promise<void> {
  if (learnerSyncing.value) return
  learnerSyncing.value = true
  learnerStatus.value = ''
  try {
    const r = await window.api.soulLearner.sync({})
    if (r.ok) {
      if (r.applied && r.applied > 0) {
        learnerStatus.value = `✓ 已写入 ${r.applied} 条习得特征到 learned_traits.yaml`
        bus.emit('ui:toast', {
          kind: 'success',
          message: `learned_traits 已更新 (${r.applied} 条)`,
          ttl_ms: 3000,
        })
      } else {
        learnerStatus.value = `✓ 跳过 (${r.reason ?? '未达阈值'})`
      }
    } else {
      learnerStatus.value = `✗ 失败: ${r.reason}`
      bus.emit('ui:toast', { kind: 'error', message: `同步失败: ${r.reason}`, ttl_ms: 5000 })
    }
  } catch (e) {
    learnerStatus.value = `✗ 异常: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    learnerSyncing.value = false
  }
}

async function exportPack(): Promise<void> {
  packStatus.value = '导出中...'
  try {
    const r = await window.api.characterPack.export({
      includeMemory: packIncludeMemory.value,
    })
    if (r.canceled) {
      packStatus.value = '已取消'
      return
    }
    if (r.ok) {
      packStatus.value = `✓ 已导出到 ${r.savedPath} (${((r.size ?? 0) / 1024).toFixed(1)} KB)`
      bus.emit('ui:toast', { kind: 'success', message: '角色 pack 导出成功', ttl_ms: 3000 })
    } else {
      packStatus.value = `✗ 失败: ${r.reason}`
      bus.emit('ui:toast', { kind: 'error', message: `导出失败: ${r.reason}`, ttl_ms: 5000 })
    }
  } catch (e) {
    packStatus.value = `✗ 异常: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function importPack(): Promise<void> {
  packStatus.value = '选择文件...'
  try {
    const r = await window.api.characterPack.import({})
    if (r.canceled) {
      packStatus.value = '已取消'
      return
    }
    if (r.ok && r.character) {
      packStatus.value = `✓ 已导入: ${r.character.name} (id: ${r.character.id})`
      bus.emit('ui:toast', {
        kind: 'success',
        message: `角色"${r.character.name}"已导入`,
        ttl_ms: 4000,
      })
    } else {
      packStatus.value = `✗ 失败: ${r.reason}`
      bus.emit('ui:toast', { kind: 'error', message: `导入失败: ${r.reason}`, ttl_ms: 5000 })
    }
  } catch (e) {
    packStatus.value = `✗ 异常: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function openModelsDir(): Promise<void> {
  await window.api.system.revealModelsDir()
}

function cancel(): void {
  // R44: dirty 时强制确认（避免误操作丢失大量配置改动）
  if (dirty.value) {
    const ok = window.confirm('有未保存的改动，确定放弃吗？')
    if (!ok) return
    bus.emit('ui:toast', { kind: 'warn', message: '已放弃未保存的改动', ttl_ms: 2500 })
  }
  emit('close')
}

/** R127+R131-fix: 从剪贴板读 JSON 并 merge 到 form */
async function importConfig(): Promise<void> {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `读剪贴板失败：${String(e).slice(0, 60)}`,
      ttl_ms: 4000,
    })
    return
  }
  if (!text.trim()) {
    bus.emit('ui:toast', { kind: 'warn', message: '剪贴板为空', ttl_ms: 2500 })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `JSON 解析失败：${String(e).slice(0, 60)}`,
      ttl_ms: 4000,
    })
    return
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    bus.emit('ui:toast', { kind: 'error', message: '不是合法的配置对象', ttl_ms: 3000 })
    return
  }
  const ok = window.confirm('用剪贴板 JSON 覆盖当前 form？(脱敏字段 *** 会跳过, 需点保存才生效)')
  if (!ok) return
  let applied = 0
  let skippedMask = 0
  let skippedType = 0
  // R131-fix (HIGH): 严格 type guard, 拒绝 object/array 进 scalar 字段; null/undefined 字段也要类型 match
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(k in form)) continue
    if (v === '***') {
      skippedMask++
      continue
    }
    // 仅允许 scalar (string/number/boolean) 写入; object/array/function 跳过
    if (v !== null && typeof v === 'object') {
      skippedType++
      continue
    }
    const curr = (form as unknown as Record<string, unknown>)[k]
    // 当前有值时要求类型 match; null/undefined 时仅允许 string/number/boolean
    if (curr !== null && curr !== undefined && typeof curr !== typeof v) {
      skippedType++
      continue
    }
    ;(form as unknown as Record<string, unknown>)[k] = v
    applied++
  }
  markDirty()
  const parts = [`✓ 导入 ${applied} 项`]
  if (skippedMask > 0) parts.push(`跳过 ${skippedMask} 个脱敏`)
  if (skippedType > 0) parts.push(`跳过 ${skippedType} 个类型不符`)
  bus.emit('ui:toast', {
    kind: 'success',
    message: parts.join(' · ') + '（未保存）',
    ttl_ms: 4000,
  })
}

/** R125+R131-fix: 导出当前 form 为 JSON. 集中维护敏感字段 allowlist */
const SENSITIVE_FIELDS: ReadonlyArray<keyof RuntimeConfig> = ['llm_api_key']

async function exportConfig(): Promise<void> {
  const safe = { ...form } as RuntimeConfig & Record<string, unknown>
  for (const k of SENSITIVE_FIELDS) {
    if (safe[k]) (safe as Record<string, unknown>)[k] = '***'
  }
  const json = JSON.stringify(safe, null, 2)
  try {
    await navigator.clipboard.writeText(json)
    bus.emit('ui:toast', {
      kind: 'success',
      message: `✓ 已复制 ${Object.keys(safe).length} 项配置 (API key 已脱敏)`,
      ttl_ms: 3000,
    })
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `复制失败：${String(e).slice(0, 60)}`,
      ttl_ms: 4000,
    })
  }
}

const providerOptions = [
  { v: 'anthropic', label: 'Anthropic Claude' },
  { v: 'openai_compat', label: 'OpenAI 兼容 (LM Studio / SiliconFlow / OpenAI)' },
  { v: 'ollama', label: 'Ollama 本地' },
] as const

/** R103: 不同 provider 的 model placeholder, 避免 ollama 用户照抄 claude-* */
const MODEL_PLACEHOLDER_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6 / claude-opus-4-7',
  openai_compat: 'qwen2.5-7b / gpt-4o-mini / llama-3.1-8b',
  ollama: 'qwen2.5:14b / llama3.1:8b',
}
const modelPlaceholder = computed<string>(() =>
  MODEL_PLACEHOLDER_BY_PROVIDER[form.llm_provider] ?? 'claude-sonnet-4-6 / qwen2.5-7b / gpt-4o-mini',
)
const endpointPlaceholder = computed<string>(() => {
  if (form.llm_provider === 'anthropic') return 'https://api.anthropic.com'
  if (form.llm_provider === 'ollama') return 'http://127.0.0.1:11434/v1'
  return 'http://127.0.0.1:1234/v1 (LM Studio) / 自定义 OpenAI 兼容'
})

const showIncomplete = ref(false)

const modelOptions = computed(() => {
  const list = [...cfg.models]
  list.sort((a, b) => {
    // v0.8.2: 主排序键 = motion_count 降序（动作多 = 质量高）
    // cubism2 永远最后（暂不支持）
    if (a.cubism !== 'cubism4' && b.cubism === 'cubism4') return 1
    if (a.cubism === 'cubism4' && b.cubism !== 'cubism4') return -1
    const am = a.meta?.motion_count ?? 0
    const bm = b.meta?.motion_count ?? 0
    if (am !== bm) return bm - am // 动作多在前
    // 同动作数 → 表情多在前
    const ae = a.meta?.expression_count ?? 0
    const be = b.meta?.expression_count ?? 0
    if (ae !== be) return be - ae
    // 都同 → physics 优先
    if (a.meta?.has_physics !== b.meta?.has_physics) return a.meta?.has_physics ? -1 : 1
    return a.display.localeCompare(b.display)
  })

  return list
    .filter((m) => {
      if (showIncomplete.value) return true
      // 默认只显示「完整 cubism4」
      return m.cubism === 'cubism4' && m.meta?.complete
    })
    .map((m) => {
      const isCubism2 = m.cubism !== 'cubism4'
      const incomplete = !m.meta?.complete
      let prefix = ''
      let suffix = ''
      let disabled = false
      if (m.meta?.recommended) prefix = '⭐ '
      // v0.8.2: 健康评分 grade 显示在最前
      const grade = m.meta?.grade
      if (grade) prefix = `[${grade}] ` + prefix
      if (isCubism2) {
        suffix = '（Cubism 2，暂不支持）'
        disabled = true
      } else if (incomplete) {
        suffix = `（${m.meta?.reason ?? '不完整'}）`
        disabled = !m.meta?.has_core
      } else {
        const parts: string[] = []
        if (m.meta) {
          if (m.meta.motion_count > 0) parts.push(`${m.meta.motion_count} 动作`)
          if (m.meta.expression_count > 0) parts.push(`${m.meta.expression_count} 表情`)
          if (m.meta.has_physics) parts.push('物理')
          if (m.meta.texture_kb > 0) parts.push(`${m.meta.texture_kb}KB 贴图`)
        }
        if (parts.length > 0) suffix = ` · ${parts.join(' · ')}`
      }
      return { value: m.dir, label: `${prefix}${m.display}${suffix}`, disabled }
    })
})

const totalCount = computed(() => cfg.models.length)
const usableCount = computed(
  () => cfg.models.filter((m) => m.cubism === 'cubism4' && m.meta?.complete).length,
)
const recommendedCount = computed(() => cfg.models.filter((m) => m.meta?.recommended).length)
</script>

<template>
  <FloatingPanel
    storage-key="settings"
    :title="`⚙️ 设置 · v${cfg.version || '0.6'}`"
    :theme="panelTheme"
    :defaults="{ width: 880, height: 720 }"
    @close="cancel"
  >
    <template #header-extra>
      <button
        class="header-action-btn"
        title="从剪贴板导入 JSON 配置 (覆盖当前 form, API key 不会被覆盖)"
        @click="importConfig"
      >📥 导入</button>
      <button
        class="header-action-btn"
        title="导出当前配置为 JSON 到剪贴板"
        @click="exportConfig"
      >📤 导出</button>
      <button
        class="header-action-btn"
        title="磁盘占用统计"
        @click="diskUsageOpen = true"
      >📊 占用</button>
    </template>

    <div class="panel-body" :class="{ 'sp-dark': panelTheme === 'dark' }" role="dialog" aria-modal="true">
      <DiskUsageDialog v-if="diskUsageOpen" @close="diskUsageOpen = false" />

      <div class="settings-layout">
      <nav class="tabs" role="tablist" @keydown="onTabsKeydown">
        <button
          v-for="t in tabs"
          :key="t.id"
          role="tab"
          :tabindex="activeTab === t.id ? 0 : -1"
          :aria-selected="activeTab === t.id ? 'true' : 'false'"
          :class="['tab', { active: activeTab === t.id }]"
          @click="activeTab = t.id"
        >
          <span class="tab-icon" v-html="t.icon" />
          <span class="tab-label">{{ t.label }}</span>
          <span v-if="dirty && activeTab !== t.id" class="tab-dirty-dot" aria-label="有未保存"></span>
        </button>
      </nav>

      <div class="settings-content">
      <div v-show="activeTab === 'llm'">
      <section>
        <h3>大脑 (LLM)</h3>
        <label>
          <span>提供商</span>
          <select v-model="form.llm_provider" @change="markDirty">
            <option v-for="o in providerOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
          </select>
        </label>
        <label>
          <span>Endpoint</span>
          <input v-model="form.llm_endpoint" type="text" :placeholder="endpointPlaceholder" @input="markDirty" @blur="form.llm_endpoint = normalizeLlmEndpoint(form.llm_endpoint); markDirty()" />
        </label>
        <label>
          <span>Model</span>
          <input v-model="form.llm_model" type="text" :placeholder="modelPlaceholder" @input="markDirty" />
        </label>
        <label>
          <span>max_tokens</span>
          <input
            :value="form.llm_max_tokens ?? 16000"
            type="number"
            min="1024"
            step="1024"
            placeholder="16000"
            @input="(e) => { form.llm_max_tokens = Number((e.target as HTMLInputElement).value) || 16000; markDirty() }"
          />
        </label>
        <p class="hint">
          单次生成上限。thinking 模型（Qwen3/DeepSeek-R1）推理占空间，太小会「思考占满没答案」。
          本地部署不怕费 → 建议 16000+，思考仍被占满就继续调大。
        </p>
        <label>
          <span>API Key</span>
          <div class="input-with-toggle">
            <input
              v-model="form.llm_api_key"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="（本地服务可留空）"
              @input="markDirty"
            />
            <button
              v-show="form.llm_api_key"
              type="button"
              class="toggle-show-btn"
              :disabled="!form.llm_api_key"
              :title="showApiKey ? '隐藏' : '显示'"
              :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'"
              :aria-pressed="showApiKey ? 'true' : 'false'"
              @click="showApiKey = !showApiKey"
            >{{ showApiKey ? '🙈' : '👁' }}</button>
          </div>
        </label>
        <label v-if="form.llm_provider === 'openai_compat'">
          <span>兼容模式</span>
          <div class="check-row">
            <input
              type="checkbox"
              :checked="form.openai_compat_merge_system !== false"
              @change="(e) => { form.openai_compat_merge_system = (e.target as HTMLInputElement).checked; markDirty() }"
            />
            <span class="check-label">
              合并 system 到 user
              <span class="check-hint">LM Studio / Qwen MoE / 其它 jinja template 兼容性差的模型必开。OpenAI 真版可关。</span>
            </span>
          </div>
        </label>
        <label>
          <span>中文增强</span>
          <div class="check-row">
            <input
              type="checkbox"
              :checked="form.chinese_llm_enhance !== false"
              @change="(e) => { form.chinese_llm_enhance = (e.target as HTMLInputElement).checked; markDirty() }"
            />
            <span class="check-label">
              国产 LLM 反 SFT bias 提示
              <span class="check-hint">
                自动检测 Qwen / DeepSeek / Kimi / GLM / Yi / Hunyuan / Doubao，给 system 注入
                "不要切 AI 助手腔 / 不要 markdown / 维持角色" 提示。50 题角色保真测得分 99/100。
                关闭后用纯 soul prompt 测 baseline。
              </span>
            </span>
          </div>
        </label>
        <div class="row">
          <button class="ghost" @click="testLlm" :disabled="cfg.testing">
            {{ cfg.testing ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="cfg.testResult" :class="['result', cfg.testResult.ok ? 'ok' : 'bad']">
            {{ cfg.testResult.ok ? '✓' : '✗' }} {{ cfg.testResult.message }}
          </span>
        </div>
      </section>

      </div>

      <div v-show="activeTab === 'avatar'">
      <section>
        <h3>立绘 (Avatar)</h3>
        <label>
          <span>模型</span>
          <select v-model="selectedModel" @change="markDirty">
            <option
              v-for="o in modelOptions"
              :key="o.value"
              :value="o.value"
              :disabled="o.disabled"
            >{{ o.label }}</option>
          </select>
        </label>
        <div class="row">
          <button class="ghost" @click="rescan">重扫</button>
          <button class="ghost" @click="openModelsDir">打开模型目录</button>
          <button class="ghost" @click="installFromZipFile" :disabled="installing">
            {{ installing ? '安装中…' : '从目录安装' }}
          </button>
          <button class="ghost" @click="healSelected" :disabled="healing">
            {{ healing ? '修复中…' : '🩹 Heal 当前模型' }}
          </button>
          <!-- v0.8.2 移除：合并/删除/查重按钮（之前误判同角色多 outfit 为重复，造成数据丢失）。
               同角色多 view 是 Live2D 标准做法，在「🎭 模型库」按 character cluster 展示。 -->
          <span class="hint-text">同角色多 outfit 浏览 →「🎭 模型库」（右键人物菜单）</span>
          <label class="inline-toggle" :title="`总共扫到 ${totalCount}，可用 ${usableCount}`">
            <input type="checkbox" v-model="showIncomplete" />
            显示不完整模型
          </label>
        </div>
        <div class="row">
          <input
            v-model="zipUrl"
            type="text"
            class="grow"
            placeholder="或粘贴一个 .zip URL（http/https）..."
          />
          <button class="ghost" @click="installFromUrl" :disabled="installing || !zipUrl.trim()">
            下载安装
          </button>
        </div>
        <p class="hint">
          📦 安装方式：① <b>拖一个 .zip 到 LUVU 窗口</b>（最方便）② 选已解压目录 ③ 粘贴 URL。
          安装到 ~/.luvu/models/，自动 dedup 同名。
        </p>
        <p class="hint">
          ⭐ 推荐 {{ recommendedCount }} · 可用 {{ usableCount }} · 总扫到 {{ totalCount }}（已显示 {{ modelOptions.length }}）
        </p>
        <p class="hint">
          完整判定：cubism4 + moc3 ≥ 50KB + texture ≥ 200KB + 至少 1 动作。
          外部模型可能加载失败（黑屏/无渲染），优先选 ⭐ 推荐项。
        </p>
      </section>

      </div>

      <div v-show="activeTab === 'scene'">
        <SceneSettingsTab />
      </div>

      <div v-show="activeTab === 'tts'">
      <section>
        <h3>声音 (TTS)</h3>
        <label>
          <span>方案</span>
          <select v-model="form.tts_provider" @change="markDirty">
            <option value="sidecar">本地 sidecar（FastAPI）</option>
            <option value="none">关闭语音</option>
          </select>
        </label>
        <label>
          <span>Sidecar URL</span>
          <input v-model="form.tts_sidecar_url" type="text" placeholder="http://localhost:8765" @input="markDirty" @blur="form.tts_sidecar_url = normalizeSimpleUrl(form.tts_sidecar_url as string); markDirty()" />
        </label>
        <div class="row">
          <button class="ghost" @click="probeTts">探测</button>
          <span v-if="ttsHealth" :class="['result', ttsHealth.ok ? 'ok' : 'bad']">
            {{ ttsHealth.ok ? `✓ ${ttsHealth.status}` : `✗ ${ttsHealth.reason ?? ttsHealth.status}` }}
          </span>
        </div>
      </section>

      <section v-show="false"><!-- 节奏 section 已并入 TTS tab，下面那个原 section 也放 TTS tab --></section>
      </div>

      <div v-show="activeTab === 'rvc'">
        <RvcSettingsSection
          :form="form"
          :rvc-voices="rvcVoices"
          :rvc-status="rvcStatus"
          @mark-dirty="markDirty"
          @refresh="refreshRvcVoices"
        />
      </div>

      <div v-show="activeTab === 'tts'">
      <section>
        <h3>语音节奏（底座 TTS）</h3>
        <p class="hint">不论是否启用 RVC，文字都先经 edge_tts 生成，下面参数控制原始语音的语速、音量、音调。</p>
        <label>
          <span>语速</span>
          <div class="row" style="flex: 1; gap: 8px; align-items: center">
            <input type="range" min="-50" max="50" step="5"
              :value="parseTtsRate(form.tts_rate)"
              @input="form.tts_rate = formatPct($event); markDirty()"
              style="flex: 1" />
            <span style="min-width: 60px; text-align: right; font-family: monospace">
              {{ form.tts_rate || '+0%' }}
            </span>
          </div>
        </label>
        <p class="hint">负值变慢、正值变快。±50% 范围效果明显，超出会变奇怪。</p>

        <label>
          <span>音量</span>
          <div class="row" style="flex: 1; gap: 8px; align-items: center">
            <input type="range" min="-50" max="50" step="5"
              :value="parseTtsRate(form.tts_volume)"
              @input="form.tts_volume = formatPct($event); markDirty()"
              style="flex: 1" />
            <span style="min-width: 60px; text-align: right; font-family: monospace">
              {{ form.tts_volume || '+0%' }}
            </span>
          </div>
        </label>
        <p class="hint">底座 TTS 输出音量。RVC 转换后会被 RMS 包络再次影响。</p>

        <label>
          <span>音调 (Hz)</span>
          <div class="row" style="flex: 1; gap: 8px; align-items: center">
            <input type="range" min="-50" max="50" step="5"
              :value="parseTtsPitch(form.tts_pitch)"
              @input="form.tts_pitch = formatHz($event); markDirty()"
              style="flex: 1" />
            <span style="min-width: 60px; text-align: right; font-family: monospace">
              {{ form.tts_pitch || '+0Hz' }}
            </span>
          </div>
        </label>
        <p class="hint">edge_tts 的音调微调。如果启用了 RVC，主要用 RVC 的 ±12 半音；这个微调中和底座女声偏高的问题。</p>
      </section>

      </div>

      <div v-show="activeTab === 'soul'">
      <section>
        <h3>灵魂 (Soul)</h3>
        <p class="hint">{{ cfg.soul?.name }} · 主人「{{ cfg.soul?.master }}」 · 称呼「{{ cfg.soul?.call_master_as }}」</p>
        <p class="hint" v-if="dataDir">数据目录：<code>{{ dataDir }}</code></p>
        <div class="row">
          <button class="ghost" @click="reloadSoul">重载灵魂</button>
          <button class="ghost" @click="openDataDir">打开数据目录</button>
        </div>
      </section>

      <!-- P3 UI: 角色一致性测试 — 50 题 5-25 分钟 -->
      <EvalRunner />

      <!-- P3 UI: 情感状态 debug (J 可视化) -->
      <EmotionalDebugPanel />

      <!-- P5: soul auto-learner — 手动同步 -->
      <section style="margin-top: 18px">
        <h3>灵魂自学习 <span class="beta-tag">auto</span></h3>
        <p class="hint">
          每 24h 自动把 emotional state 累积的高频话题写回 learned_traits.yaml
          (count ≥ 5 + |sentiment| ≥ 0.3)。可手动立即触发：
        </p>
        <div class="row">
          <button class="ghost" @click="syncLearner" :disabled="learnerSyncing">
            {{ learnerSyncing ? '同步中...' : '🧠 立即同步 learned_traits' }}
          </button>
        </div>
        <p v-if="learnerStatus" class="hint" style="margin-top: 6px">{{ learnerStatus }}</p>
      </section>

      <!-- P5: soul yaml 改动审计历史 -->
      <SoulChangeLogPanel />

      <!-- P5: character pack export/import — 分享角色 -->
      <section style="margin-top: 18px">
        <h3>角色 pack（导入/导出）</h3>
        <p class="hint">
          把当前角色打包成 .zip 文件分享给朋友 (含 soul + 情感状态 + 缩略图)；
          或导入别人的 pack 创建新角色。
        </p>
        <div class="check-row" style="margin: 6px 0">
          <input type="checkbox" v-model="packIncludeMemory" id="pack-mem" />
          <label for="pack-mem" class="check-label">
            含长期记忆库 (memory.db)
            <span class="check-hint">
              ⚠ 含主人对话提取的事实/偏好/事件。跨机器自己迁移可开；分享给朋友建议关。
            </span>
          </label>
        </div>
        <div class="row">
          <button class="ghost" @click="exportPack">📤 导出当前角色 pack</button>
          <button class="ghost" @click="importPack">📥 导入 pack</button>
        </div>
        <p v-if="packStatus" class="hint" style="margin-top: 8px">{{ packStatus }}</p>
      </section>

      </div>

      <!-- v0.17 P：外部 MCP server 管理 -->
      <div v-show="activeTab === 'mcp'">
        <section>
          <h3>外部 MCP server <span class="beta-tag">实验</span></h3>
          <p class="hint">
            连接任意实现 Model Context Protocol 的 stdio server，LUVU 可以调用它们暴露的工具。
            示例：<code>npx -y @modelcontextprotocol/server-filesystem /path</code>
          </p>

          <div class="mcp-list">
            <div v-if="mcpServers.length === 0" class="mcp-empty">
              还没注册任何外部 MCP server
            </div>
            <div v-for="s in mcpServers" :key="s.id" class="mcp-row">
              <div class="mcp-row-head" @click="toggleMcpTools(s.id)">
                <span :class="['mcp-dot', s.status]" :title="s.status" />
                <span class="mcp-name">{{ s.name }}</span>
                <span class="mcp-id">({{ s.id }})</span>
                <span class="mcp-tool-count">{{ s.toolCount }} 工具</span>
                <button class="mcp-del" @click.stop="removeMcpServer(s.id)" title="关停并移除">✕</button>
              </div>
              <code class="mcp-cmd">{{ s.command }}</code>
              <div v-if="mcpExpanded.has(s.id)" class="mcp-tools">
                <div v-if="!mcpTools[s.id]?.length" class="mcp-empty">该 server 未暴露工具</div>
                <div v-for="t in mcpTools[s.id]" :key="t.name" class="mcp-tool">
                  <code class="mcp-tool-name">{{ t.name }}</code>
                  <span class="mcp-tool-desc">{{ t.description }}</span>
                </div>
              </div>
            </div>
          </div>

          <h4 class="mcp-add-title">添加 server</h4>
          <div class="mcp-form">
            <input v-model="mcpForm.id" placeholder="ID (kebab-case, 唯一)" />
            <input v-model="mcpForm.name" placeholder="显示名（可选）" />
            <input v-model="mcpForm.command" placeholder="命令 (如 npx / python / uvx)" />
            <input v-model="mcpForm.argsRaw" placeholder="参数（空格分隔，可选）" />
            <button class="primary" :disabled="mcpAdding || !mcpForm.id || !mcpForm.command" @click="addMcpServer">
              {{ mcpAdding ? '启动中…' : '注册并启动' }}
            </button>
          </div>
        </section>
      </div>

      <!-- v0.21：右键菜单精简后，其余功能收纳到这里。按钮 emit('action', id)，
           App.vue 用现成的 onMenuSelect(id) 接住（零重复逻辑）。 -->
      <div v-show="activeTab === 'more'">
      <section>
        <h3>🤖 真控电脑（自动化）</h3>
        <label class="inline-toggle">
          <input
            type="checkbox"
            :checked="form.agent_trust_mode === true"
            @change="(e) => { form.agent_trust_mode = (e.target as HTMLInputElement).checked; markDirty() }"
          />
          信任模式（全放行）：她操控鼠标键盘 / 写 Word·PPT·Excel / 文件与系统工具不弹确认，直接执行
        </label>
        <label class="inline-toggle">
          <input
            type="checkbox"
            :checked="form.agent_confirm_dangerous !== false"
            @change="(e) => { form.agent_confirm_dangerous = (e.target as HTMLInputElement).checked; markDirty() }"
          />
          危险动作仍确认：<b>删文件 / 移动覆盖 / 跑 shell 命令</b> 即使信任模式也弹一次确认（不可逆兜底）
        </label>
        <label class="inline-toggle">
          <input
            type="checkbox"
            :checked="form.tool_retrieval_enabled !== false"
            @change="(e) => { form.tool_retrieval_enabled = (e.target as HTMLInputElement).checked; markDirty() }"
          />
          工具按需检索：工具多时每轮只把相关的发给她（语义检索，选得更准更省）
        </label>
        <p class="hint">
          ⚠️ 高风险：开启信任模式后 LLM 决策会<b>直接操作电脑、写/删文件、跑命令、联网</b>。任何时刻按
          <b>Cmd+Shift+Esc</b> 可全局熔断停止。「危险动作仍确认」关掉则连删除/命令也不再问。
        </p>
        <p class="hint">
          对话里直接说「帮我做个关于X的PPT」「写一篇关于Y的word」「打开计算器算一下」她就会用工具完成。
          macOS 需在「系统设置 → 隐私与安全性 → 辅助功能 / 屏幕录制」授权 LUVU。
        </p>
      </section>
      <section style="margin-top: 18px">
        <h3>快捷入口</h3>
        <div class="row">
          <button class="ghost" @click="emit('action', 'library')">🎁 资源商店</button>
          <button class="ghost" @click="emit('action', 'creator-studio')">🎨 创作工坊</button>
          <button class="ghost" @click="emit('action', 'health-dashboard')">🔬 模型健康仪表盘</button>
          <button class="ghost" @click="emit('action', 'soul-editor')">✏️ 编辑灵魂</button>
        </div>
      </section>
      <section style="margin-top: 18px">
        <h3>立绘</h3>
        <div class="row">
          <button class="ghost" @click="emit('action', 'zoom-reset')">↻ 复位立绘（位置 + 大小）</button>
        </div>
        <label class="inline-toggle">
          <input
            type="checkbox"
            :checked="form.gaze_follow_cursor === true"
            @change="(e) => { form.gaze_follow_cursor = (e.target as HTMLInputElement).checked; markDirty() }"
          />
          👀 眼神跟随鼠标：立绘视线实时看向光标
        </label>
        <p class="hint">
          关闭时视线由她自己决定（主体性 glance）。开启后会持续跟随光标，更像"活的"。
        </p>
        <p class="hint">全屏画板下：<b>拖动立绘</b>移动位置，<b>滚轮</b>放大缩小，按角色自动记忆。</p>
      </section>
      <section style="margin-top: 18px">
        <h3>系统</h3>
        <div class="row">
          <button class="ghost" @click="emit('action', 'theme-cycle')">🎨 切换主题</button>
          <button class="ghost" @click="emit('action', 'keyboard-help')">⌨️ 快捷键帮助</button>
          <button class="ghost" @click="emit('action', 'reload')">🔄 重载模型 / 灵魂</button>
          <button class="ghost" @click="emit('action', 'export-dialog')">📥 复制对话为 markdown</button>
          <button class="ghost" @click="emit('action', 'pin')">📌 置顶切换</button>
        </div>
      </section>
      </div>
      </div>
      </div>

      <footer>
        <span v-if="saveStatus" :class="['save-status', saveStatus.ok ? 'ok' : 'bad']">
          {{ saveStatus.ok ? '✓' : '✗' }} {{ saveStatus.message }}
        </span>
        <span v-else-if="dirty" class="save-status dirty">有未保存的改动</span>
        <span class="spacer" />
        <button
          class="ghost"
          :title="dirty ? '丢弃未保存的改动并关闭' : '关闭设置面板'"
          @click="cancel"
        >取消</button>
        <button
          class="primary"
          :title="!dirty ? '没有需要保存的改动' : cfg.saving ? '正在保存…' : '保存并应用'"
          @click="save"
          :disabled="cfg.saving || !dirty"
        >
          {{ cfg.saving ? '保存中…' : dirty ? '保存' : '已是最新' }}
        </button>
      </footer>
    </div>
  </FloatingPanel>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  background: oklch(0% 0 0 / 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  backdrop-filter: blur(2px);
  animation: fadein var(--duration-fast) var(--ease-out-expo);
}
@keyframes fadein {
  from { opacity: 0; }
  to { opacity: 1; }
}
.panel {
  width: min(420px, 90vw);
  max-height: 92vh;
  overflow-y: auto;
  background: oklch(99% 0.008 25 / 0.98);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-bubble-text);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-bubble-border);
  padding-bottom: 8px;
}
header h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: 0.02em;
}
.close {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 18px;
  line-height: 1;
  color: var(--color-muted);
}
.close:hover {
  background: oklch(95% 0.015 25 / 0.6);
  color: var(--color-bubble-text);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header-action-btn {
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: oklch(96% 0.012 25 / 0.7);
  transition: all var(--duration-fast);
}
.header-action-btn:hover {
  background: oklch(93% 0.015 25 / 0.85);
  color: var(--color-bubble-text);
}
/* ============================================================
   v0.21 设计系统重构 —— 局部 token（浅/深各一套，跟随面板主题），
   统一 surface/border/text/accent/spacing，所有控件引用它，保证
   高级感 + 整洁 + 双主题一致。 */
.panel-body {
  padding: 10px 20px 8px;
  --s-text: oklch(24% 0.02 265);
  --s-text-2: oklch(52% 0.02 265);
  --s-surface: oklch(100% 0 0 / 0.66);
  --s-card: oklch(98% 0.004 265 / 0.55);
  --s-card-border: oklch(84% 0.01 265 / 0.6);
  --s-border: oklch(80% 0.012 265 / 0.75);
  --s-hover: oklch(92% 0.008 265 / 0.7);
  --s-accent: oklch(60% 0.2 22);
  --s-accent-soft: oklch(60% 0.2 22 / 0.12);
  --s-track: oklch(82% 0.01 265 / 0.9);
  --s-r: 10px;
  --s-r-sm: 8px;
}
.panel-body.sp-dark {
  --s-text: oklch(93% 0.01 265);
  --s-text-2: oklch(68% 0.02 265);
  --s-surface: oklch(32% 0.015 265 / 0.55);
  --s-card: oklch(30% 0.012 265 / 0.4);
  --s-card-border: oklch(52% 0.02 265 / 0.35);
  --s-border: oklch(52% 0.02 265 / 0.45);
  --s-hover: oklch(46% 0.02 265 / 0.4);
  --s-accent: oklch(74% 0.16 25);
  --s-accent-soft: oklch(74% 0.16 25 / 0.16);
  --s-track: oklch(45% 0.015 265 / 0.7);
}

.settings-layout {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  min-height: 0;
}
.settings-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* 左侧 tab 竖栏 */
.tabs {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px;
  background: var(--s-card);
  border: 1px solid var(--s-card-border);
  border-radius: 14px;
  position: sticky;
  top: 0;
  z-index: 2;
  width: 144px;
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  border-radius: var(--s-r-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--s-text-2);
  background: transparent;
  transition: color 0.16s, background 0.16s;
  position: relative;
  text-align: left;
}
.tab:hover {
  background: var(--s-hover);
  color: var(--s-text);
}
.tab.active {
  background: var(--s-accent-soft);
  color: var(--s-accent);
  font-weight: 600;
}
/* active 左侧竖条指示 —— 比整块高亮更克制、更高级 */
.tab.active::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 22%;
  bottom: 22%;
  width: 3px;
  border-radius: 3px;
  background: var(--s-accent);
}
.tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  opacity: 0.85;
}
.tab-icon :deep(svg) {
  width: 17px;
  height: 17px;
  display: block;
}
.tab.active .tab-icon {
  opacity: 1;
}
.tab-label {
  font-size: var(--text-sm);
}
/* R111: dirty dot — 非当前 tab 但 form 有未保存 */
.tab-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-warn);
  margin-left: auto;
  flex-shrink: 0;
}
/* 窄面板降级 — 给 layout 自动堆叠 */
@media (max-width: 520px) {
  .settings-layout {
    flex-direction: column;
  }
  .tabs {
    flex-direction: row;
    width: 100%;
    overflow-x: auto;
  }
  .tab {
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    flex-shrink: 0;
  }
  .tab-label {
    font-size: 10px;
  }
}
/* 每个 section = 一张卡片 —— 分组清晰、有层次、对称 */
section {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 15px 17px;
  background: var(--s-card);
  border: 1px solid var(--s-card-border);
  border-radius: 13px;
}
section + section {
  margin-top: 13px;
}
section h3 {
  margin: 0 0 3px 0;
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--s-text);
  display: flex;
  align-items: center;
  gap: 9px;
}
/* 标题前的小竖条 —— 克制的高级感标记 */
section h3::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 3px;
  background: var(--s-accent);
  flex-shrink: 0;
}
label {
  display: grid;
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 12px;
}
label > span {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--s-text-2);
}
input,
select {
  font: inherit;
  font-size: var(--text-sm);
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid var(--s-border);
  border-radius: var(--s-r-sm);
  background: var(--s-surface);
  color: var(--s-text);
  outline: none;
  transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
}
input::placeholder {
  color: var(--s-text-2);
  opacity: 0.7;
}
input:hover,
select:hover {
  border-color: var(--s-accent);
}
input:focus,
select:focus {
  border-color: var(--s-accent);
  box-shadow: 0 0 0 3px var(--s-accent-soft);
}
.row {
  display: flex;
  gap: 9px;
  align-items: center;
  flex-wrap: wrap;
}
.ghost,
.primary {
  padding: 8px 15px;
  border-radius: var(--s-r-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.16s var(--ease-out-expo);
}
.ghost {
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  color: var(--s-text);
}
.ghost:hover {
  border-color: var(--s-accent);
  color: var(--s-accent);
  background: var(--s-accent-soft);
}
.primary {
  background: var(--s-accent);
  border: 1px solid var(--s-accent);
  color: #fff;
  font-weight: 600;
}
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 5px 16px var(--s-accent-soft);
  filter: brightness(1.06);
}
.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 复选框 → iOS 风格开关（更精致统一） */
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 40px;
  height: 23px;
  min-height: 0;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--s-track);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s var(--ease-out-expo);
}
input[type='checkbox']::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px oklch(0% 0 0 / 0.35);
  transition: transform 0.2s var(--ease-out-expo);
}
input[type='checkbox']:checked {
  background: var(--s-accent);
}
input[type='checkbox']:checked::after {
  transform: translateX(17px);
}
input[type='checkbox']:focus-visible {
  box-shadow: 0 0 0 3px var(--s-accent-soft);
}
/* R80: .input-with-toggle 已提到 global.css 共享 */

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.check-row input[type='checkbox'] {
  margin-top: 1px;
}
.check-label {
  display: flex;
  flex-direction: column;
  font-size: var(--text-sm);
  color: var(--s-text);
}
.check-hint {
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--s-text-2);
  margin-top: 3px;
}
.result {
  font-size: var(--text-xs);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
}
.result.ok {
  background: oklch(95% 0.06 145 / 0.6);
  color: oklch(40% 0.1 145);
}
.result.bad {
  background: oklch(95% 0.08 25 / 0.6);
  color: oklch(45% 0.15 25);
}
.hint {
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--s-text-2);
  margin: 2px 0;
}
code {
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  color: var(--s-text);
  padding: 1px 6px;
  border-radius: 5px;
}
footer {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--s-card-border);
  padding-top: 14px;
  margin-top: 2px;
}
.spacer {
  flex: 1;
}
.inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  grid-template-columns: none;
  font-size: var(--text-sm);
  color: var(--s-text);
  cursor: pointer;
}
.inline-toggle input {
  margin: 0;
}
.grow {
  flex: 1;
  min-width: 0;
}
.save-status {
  font-size: var(--text-xs);
  padding: 3px 10px;
  border-radius: var(--radius-pill);
}
.save-status.ok {
  background: oklch(95% 0.06 145 / 0.6);
  color: oklch(40% 0.1 145);
}
.save-status.bad {
  background: oklch(95% 0.08 25 / 0.6);
  color: oklch(45% 0.15 25);
}
.save-status.dirty {
  background: oklch(95% 0.05 80 / 0.6);
  color: oklch(45% 0.12 80);
}

/* v0.11: 高级参数折叠区 */
.advanced {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--s-surface);
  border-radius: var(--s-r);
  border: 1px solid var(--s-border);
}
.advanced summary {
  font-weight: 600;
  font-size: 13px;
  color: var(--s-text);
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}
.advanced[open] summary {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--s-border);
}
.advanced label { margin-top: 8px; }

/* v0.17 P: MCP server tab */
.beta-tag {
  font-size: 10px; padding: 1px 8px;
  background: oklch(70% 0.18 80 / 0.25);
  color: oklch(50% 0.18 80);
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.mcp-list {
  display: flex; flex-direction: column; gap: 6px;
  margin: 12px 0;
}
.mcp-empty {
  padding: 10px 12px;
  color: var(--s-text-2);
  font-size: 12px;
  font-style: italic;
}
.mcp-row {
  padding: 9px 11px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  border-radius: var(--s-r-sm);
}
.mcp-row-head {
  display: flex; align-items: center; gap: 8px;
  cursor: pointer;
}
.mcp-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.mcp-dot.running { background: oklch(60% 0.2 145); box-shadow: 0 0 4px oklch(60% 0.2 145 / 0.5); }
.mcp-dot.stopped { background: oklch(60% 0.05 250); }
.mcp-dot.error { background: oklch(60% 0.22 25); box-shadow: 0 0 4px oklch(60% 0.22 25 / 0.5); }
.mcp-name { font-weight: 600; font-size: 13px; }
.mcp-id { font-size: 11px; color: var(--s-text-2); font-family: ui-monospace, monospace; }
.mcp-tool-count {
  margin-left: auto;
  font-size: 11px;
  padding: 1px 8px;
  background: var(--s-accent-soft);
  color: var(--s-accent);
  border-radius: 999px;
}
.mcp-del {
  width: 22px; height: 22px;
  border-radius: 999px;
  background: oklch(95% 0.04 25);
  color: oklch(50% 0.18 25);
  font-size: 10px;
}
.mcp-del:hover { background: oklch(90% 0.08 25); }
.mcp-cmd {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--s-text-2);
  padding: 4px 8px;
  background: var(--s-surface);
  border-radius: 6px;
  word-break: break-all;
}
.mcp-tools {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--s-border);
  display: flex; flex-direction: column; gap: 4px;
}
.mcp-tool {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 12px;
}
.mcp-tool-name { color: var(--s-accent); flex-shrink: 0; }
.mcp-tool-desc { color: var(--s-text-2); font-size: 11px; }
.mcp-add-title {
  margin: 16px 0 6px;
  font-size: 12px; font-weight: 600;
  color: var(--s-text-2);
}
.mcp-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.mcp-form input {
  padding: 7px 10px;
  font-size: 12px;
}
.mcp-form button { grid-column: 1 / -1; margin-top: 4px; }

/* v0.21：advanced / MCP / code 等次要元素已改用局部 token（--s-*），
   浅/深主题自动适配，不再需要单独的 .sp-dark 覆盖块。 */
</style>
