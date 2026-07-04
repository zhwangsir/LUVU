<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import { ThumbGenerator, type ThumbProgress } from '../../avatar/render/thumb-generator'

const cfg = useConfigStore()
const emit = defineEmits<{ (e: 'close'): void }>()
// v0.11: 被资源商店嵌入时，外层不需要 fixed 定位 + close 按钮（store 自己有）
defineProps<{ embedded?: boolean }>()

// v0.10 缩略图：character_id → file:// URL
const thumbUrls = reactive<Record<string, string>>({})
const thumbProgress = ref<ThumbProgress | null>(null)
let thumbGen: ThumbGenerator | null = null

// v0.12 LLM enrichment：character_id → { chinese_name, intro, tags }
const enriched = reactive<Record<string, {
  chinese_name: string
  intro_one_line: string
  tags: string[]
}>>({})
const enrichProgress = ref<import('@shared/api').EnrichProgress | null>(null)
let unbindEnrichProgress: (() => void) | null = null

// v0.12 收藏 + 最近
const favorites = ref<Set<string>>(new Set())
const recentDirs = ref<string[]>([])
const viewMode = ref<'all' | 'favorites' | 'recent'>('all')

async function refreshFavorites(): Promise<void> {
  const r = await window.api.models.favorites()
  favorites.value = new Set(r.favorites)
  recentDirs.value = r.recent.map((x) => x.dir)
}

async function refreshEnriched(): Promise<void> {
  try {
    const r = await window.api.models.enrichCached()
    Object.keys(enriched).forEach((k) => delete enriched[k])
    for (const [cid, v] of Object.entries(r)) {
      enriched[cid] = {
        chinese_name: v.chinese_name,
        intro_one_line: v.intro_one_line,
        tags: v.tags,
      }
    }
  } catch (e) {
    console.warn('[enrich] load cache failed:', e)
  }
}

async function toggleFavorite(dir: string): Promise<void> {
  const r = await window.api.models.toggleFavorite(dir)
  if (r.is_favorite) favorites.value.add(dir)
  else favorites.value.delete(dir)
}

async function startEnrichment(): Promise<void> {
  if (enrichProgress.value && enrichProgress.value.done < enrichProgress.value.total) {
    bus.emit('ui:toast', { kind: 'info', message: '已在生成中', ttl_ms: 2000 })
    return
  }
  unbindEnrichProgress?.()
  unbindEnrichProgress = window.api.models.onEnrichProgress((p) => {
    enrichProgress.value = p
    // 每次进度变化 reload 一次 cache 让 UI 显示新内容
    if (p.done > 0 && p.done % 5 === 0) void refreshEnriched()
    if (p.error) {
      bus.emit('ui:toast', { kind: 'error', message: `补全失败：${p.error}`, ttl_ms: 8000 })
    }
    if (p.done === p.total && p.total > 0) {
      void refreshEnriched() // 最终一次
      bus.emit('ui:toast', { kind: 'success', message: `补全完成 ${p.done} 个角色`, ttl_ms: 5000 })
    }
  })
  await window.api.models.enrichStart()
  bus.emit('ui:toast', { kind: 'info', message: '🤖 LLM 后台补全中…（约 30 分钟）', ttl_ms: 5000 })
}

async function abortEnrichment(): Promise<void> {
  await window.api.models.enrichAbort()
  enrichProgress.value = null
  bus.emit('ui:toast', { kind: 'info', message: '已中止补全', ttl_ms: 2000 })
}

async function loadCachedThumbs(): Promise<void> {
  // v0.13 (audit performance ROI 2): 之前 ~700 个并发 IPC invoke 形成尖峰；
  // 现在改单次 batch 调用，主进程一次 readdir 拿全部缩略图状态
  const ids = [...new Set(cfg.models.map((m) => m.meta?.character_id).filter(Boolean) as string[])]
  if (ids.length === 0) return
  const batch = await window.api.thumbs.getBatch(ids)
  for (const [cid, entry] of Object.entries(batch)) {
    if (entry.exists && entry.url) thumbUrls[cid] = entry.url
  }
}

async function generateMissingThumbs(): Promise<void> {
  // 收集需要生成的 character → 选 grade 最高的那个 view 当代表
  const byChar = new Map<string, (typeof cfg.models)[number]>()
  for (const m of cfg.models) {
    if (m.cubism !== 'cubism4' || !m.meta?.has_core || !m.meta?.character_id) continue
    const cid = m.meta.character_id
    if (!byChar.has(cid) || gradeRank(m) < gradeRank(byChar.get(cid)!)) {
      byChar.set(cid, m)
    }
  }
  const allIds = [...byChar.keys()]
  const missing = await window.api.thumbs.listMissing(allIds)
  if (missing.length === 0) {
    thumbProgress.value = null
    return
  }
  const jobs = missing.map((cid) => ({
    character_id: cid,
    file_url: byChar.get(cid)!.file_url,
  }))
  thumbGen = new ThumbGenerator()
  await thumbGen.run(jobs, async (p) => {
    thumbProgress.value = p
    // 每完成一个，重新拉它的 URL（让卡片立刻刷新）
    if (p.current) {
      const r = await window.api.thumbs.get(p.current)
      if (r.exists && r.url) thumbUrls[p.current] = r.url
    }
  })
  thumbProgress.value = null
}

async function regenerateAllThumbs(): Promise<void> {
  if (thumbGen) thumbGen.cancel()
  await window.api.thumbs.clearAll()
  Object.keys(thumbUrls).forEach((k) => delete thumbUrls[k])
  void generateMissingThumbs()
}

/** 加载中的 model dir — 用于卡片显示 spinner */
const loadingDir = ref<string | null>(null)
const loadError = ref<string | null>(null)

function onModelLoaded(): void {
  loadingDir.value = null
  loadError.value = null
}
function onModelError(payload: { reason: string }): void {
  loadingDir.value = null
  loadError.value = payload.reason
}
// v0.17：bus 监听 + 清理（注册在下方主 onMounted 内防止 listener 累积泄漏）
onBeforeUnmount(() => {
  bus.off('avatar:model-loaded', onModelLoaded)
  bus.off('avatar:model-error', onModelError)
  if (thumbGen) thumbGen.cancel()
  unbindEnrichProgress?.()
})

const search = ref('')
const gradeFilter = ref<'all' | 'A' | 'B' | 'C' | 'D'>('all')
const hideUnusable = ref(true)
const sortBy = ref<'motion' | 'expression' | 'name' | 'grade'>('motion')
const focused = ref<typeof cfg.models[number] | null>(null)
const filterOpen = ref(false)
const repairingDir = ref<Set<string>>(new Set())

/** v0.17：一键 AI 修复立绘（缺动作 / 缺表情 / 缺物理 全部补齐） */
async function repairAvatar(m: (typeof cfg.models)[number]): Promise<void> {
  if (repairingDir.value.has(m.dir)) return
  repairingDir.value.add(m.dir)
  bus.emit('ui:toast', { kind: 'info', message: `🔧 开始修复 ${m.display}…`, ttl_ms: 2500 })
  try {
    const tasks: Array<Promise<{ ok: boolean; reason?: string }>> = [
      window.api.models.autoFill({ model_json_path: m.absolute_path }),
    ]
    if (!m.meta?.has_physics) {
      tasks.push(
        window.api.models.applyPhysicsPreset({
          model_json_path: m.absolute_path,
          preset_id: 'mid-length-hair',
        }) as Promise<{ ok: boolean; reason?: string }>,
      )
    }
    if ((m.meta?.expression_count ?? 0) < 4) {
      tasks.push(
        window.api.models.applyExpressionPack({ model_json_path: m.absolute_path }) as Promise<{ ok: boolean; reason?: string }>,
      )
    }
    const results = await Promise.allSettled(tasks)
    const fails = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok))
    if (fails.length === 0) {
      bus.emit('ui:toast', { kind: 'success', message: `✨ ${m.display} 修复完成`, ttl_ms: 4000 })
      void cfg.rescanModels()
    } else {
      bus.emit('ui:toast', { kind: 'warn', message: `部分修复失败 (${fails.length}/${results.length})`, ttl_ms: 5000 })
    }
  } catch (e) {
    bus.emit('ui:toast', { kind: 'error', message: `修复异常：${String(e)}`, ttl_ms: 5000 })
  } finally {
    repairingDir.value.delete(m.dir)
  }
}

/** 缺什么 — 卡片角标判定 */
function repairNeeded(m: (typeof cfg.models)[number]): boolean {
  const motions = m.meta?.motion_count ?? 0
  const expressions = m.meta?.expression_count ?? 0
  return motions < 3 || expressions < 4 || !m.meta?.has_physics
}

/** dir → AI 生成的介绍，跟 main 进程 cache 同步 */
const descriptions = ref<Record<string, string>>({})
const describing = ref<Set<string>>(new Set())

/** 哪些 IP section 是展开的 */
const expandedIps = ref<Set<string>>(new Set())

function extractIp(absPath: string): string {
  const parts = absPath.split(/[\\/]/).filter(Boolean)
  // v0.9: 模型库迁到 electron/models-library/，旧路径 Live2d-model-master 仍兼容
  const ix = parts.findIndex(
    (p) => p === 'models-library' || p.includes('Live2d-model-master'),
  )
  return ix >= 0 && ix + 1 < parts.length ? parts[ix + 1]! : parts[0] ?? '(root)'
}

// v0.9: IP info 知识库（关键词 → 介绍/类型/出品方）— 与 main/services/ip-knowledge.ts 同步
// 这里维护轻量副本仅供 UI 显示，主进程那份是单一真相源
const IP_INFO: Array<{ keywords: string[]; intro: string; kind: string }> = [
  { keywords: ['bang dream', 'bandori'], intro: '少女乐队跨媒体企划，Live2D 多取自手游 Girls Band Party!', kind: 'BushiRoad 手游' },
  { keywords: ['destiny_child', '天命之子'], intro: 'Shift Up 出品的韩系角色养成手游，原 Nikke 团队', kind: '韩系手游' },
  { keywords: ['galgame'], intro: '日系视觉小说 Live2D 立绘合集', kind: 'PC galgame' },
  { keywords: ['hutao'], intro: '《原神》璃月七星之一，往生堂第七十七代堂主', kind: 'miHoYo 二创' },
  { keywords: ['live2d', 'cubism'], intro: 'Cubism SDK 官方示例（Haru / Hiyori / Mark / Wanko）', kind: 'Live2D 官方' },
  { keywords: ['sacred sword'], intro: '韩系奇幻女武神 RPG', kind: '韩系手游' },
  { keywords: ['七大罪', 'sin '], intro: '基于《七大罪》小说改编，魔王拟人化', kind: '日系 galgame' },
  { keywords: ['アンノウン', 'unknown bride'], intro: '日本 ユニフィニ 婚姻 + 战斗策略手游', kind: '日系手游' },
  { keywords: ['venusscramble', 'venus scramble'], intro: 'Cybird 神话女神拟人化 RPG', kind: '日系手游' },
  { keywords: ['宝石研'], intro: '宝石拟人化的国创 RPG 手游', kind: '中文手游' },
  { keywords: ['崩坏学园'], intro: 'miHoYo 崩坏系列起点作品，校园+末世横版动作', kind: 'miHoYo 手游' },
  { keywords: ['碧蓝航线', 'azur', 'azue lane'], intro: '中日合作舰娘射击养成手游，画师阵容豪华', kind: 'Yostar 手游' },
  { keywords: ['凍京', 'toukyo nerco'], intro: 'Nitro+ 赛博朋克视觉小说', kind: 'Nitro+ 游戏' },
  { keywords: ['方舟指令', 'ark order'], intro: 'GREE 神魔大乱斗卡牌 RPG', kind: '日系卡牌' },
  { keywords: ['魂器学院', '炼铜'], intro: '国创魂器拟人化校园战斗手游', kind: '中文手游' },
  { keywords: ['机动战队'], intro: '机娘战术编队手游', kind: '机娘手游' },
  { keywords: ['イモコネ', 'imocone'], intro: '日系纯爱视觉小说，妹系校园题材', kind: '日系 galgame' },
  { keywords: ['诺亚幻想'], intro: '幻想风国创卡牌养成手游', kind: '中文卡牌' },
  { keywords: ['少女次元'], intro: '校园放置养成手游', kind: '中文手游' },
  { keywords: ['少女咖啡枪', 'cafe gun'], intro: '咖啡店 + 枪娘 + 校园题材国创二次元', kind: '中文手游' },
  { keywords: ['少女前线', '少女前線', 'girls frontline'], intro: '武器拟人化策略 RPG，国创军武娘代表', kind: '云母组手游' },
  { keywords: ['食物语'], intro: '中华美食拟人化国创卡牌 RPG', kind: '心动手游' },
  { keywords: ['konosuba', 'fantastic days', '为美好的世界'], intro: '《为美好的世界献上祝福》官方手游', kind: '动画改编手游' },
  { keywords: ['战舰少女'], intro: '早期国创舰娘养成手游', kind: '幻萌手游' },
]

function matchIpInfo(ipName: string): { intro: string; kind: string } | null {
  const norm = ipName.toLowerCase()
  for (const { keywords, intro, kind } of IP_INFO) {
    for (const kw of keywords) if (norm.includes(kw.toLowerCase())) return { intro, kind }
  }
  return null
}

/** Character cluster：character_id → views[] */
interface CharacterCluster {
  character_id: string
  primary: (typeof cfg.models)[number] // 显示用主 view（grade 最高 / motion 最多）
  views: (typeof cfg.models)
}

function clusterByCharacter(models: typeof cfg.models): CharacterCluster[] {
  const byCharId = new Map<string, typeof cfg.models>()
  for (const m of models) {
    const cid = m.meta?.character_id || m.dir // 没 character_id 时把自己当独立 character
    if (!byCharId.has(cid)) byCharId.set(cid, [])
    byCharId.get(cid)!.push(m)
  }
  const clusters: CharacterCluster[] = []
  for (const [character_id, views] of byCharId) {
    const sorted = [...views].sort(
      (a, b) =>
        gradeRank(a) - gradeRank(b) ||
        (b.meta?.motion_count ?? 0) - (a.meta?.motion_count ?? 0),
    )
    clusters.push({ character_id, primary: sorted[0]!, views: sorted })
  }
  return clusters
}

/** 按 IP 分组 → 每 IP 内按 character cluster + filter + sort
 * v0.12: 未在 IP_INFO 知识库的 IP 合并到「📦 其他」，默认折叠减少视觉噪音
 */
const UNKNOWN_IP_BUCKET = '📦 其他（未识别的小众 IP）'

const groupedByIp = computed(() => {
  const q = search.value.trim().toLowerCase()
  const groupsRaw = new Map<string, typeof cfg.models>()
  // v0.12 viewMode：只看收藏/最近时先 filter
  const allowDir = new Set<string>()
  if (viewMode.value === 'favorites') {
    favorites.value.forEach((d) => allowDir.add(d))
  } else if (viewMode.value === 'recent') {
    recentDirs.value.forEach((d) => allowDir.add(d))
  }
  for (const m of cfg.models) {
    if (viewMode.value !== 'all' && !allowDir.has(m.dir)) continue
    if (hideUnusable.value && m.cubism !== 'cubism4') continue
    if (hideUnusable.value && !m.meta?.has_core) continue
    if (gradeFilter.value !== 'all' && m.meta?.grade !== gradeFilter.value) continue
    if (q) {
      // v0.12: 搜索范围扩到 enriched 中文名 + tags
      const cid = m.meta?.character_id ?? ''
      const en = enriched[cid]
      const hit =
        m.display.toLowerCase().includes(q) ||
        m.dir.toLowerCase().includes(q) ||
        (descriptions.value[m.dir] ?? '').toLowerCase().includes(q) ||
        (en?.chinese_name ?? '').toLowerCase().includes(q) ||
        (en?.intro_one_line ?? '').toLowerCase().includes(q) ||
        (en?.tags ?? []).some((t) => t.toLowerCase().includes(q))
      if (!hit) continue
    }
    // v0.17: 用 absolute_path 提 IP（之前用 m.dir 只是 basename，提不出真 IP）
    // 所有 IP 都单独分组（即使不在 IP_INFO 知识库），不再合并到「📦 其他」
    const ip = extractIp(m.absolute_path)
    if (!groupsRaw.has(ip)) groupsRaw.set(ip, [])
    groupsRaw.get(ip)!.push(m)
  }
  const out: Array<{
    ip: string
    clusters: CharacterCluster[]
    count: number
    char_count: number
    aSum: number
  }> = []
  for (const [ip, models] of groupsRaw) {
    const clusters = clusterByCharacter(models)
    // cluster 内排序
    clusters.sort((a, b) => {
      switch (sortBy.value) {
        case 'motion':
          return (
            (b.primary.meta?.motion_count ?? 0) - (a.primary.meta?.motion_count ?? 0)
          )
        case 'expression':
          return (
            (b.primary.meta?.expression_count ?? 0) - (a.primary.meta?.expression_count ?? 0)
          )
        case 'grade':
          return gradeRank(a.primary) - gradeRank(b.primary)
        case 'name':
          return a.primary.display.localeCompare(b.primary.display)
      }
    })
    out.push({
      ip,
      clusters,
      count: models.length,
      char_count: clusters.length,
      aSum: models.filter((m) => m.meta?.grade === 'A' || m.meta?.grade === 'B').length,
    })
  }
  out.sort((a, b) => b.aSum - a.aSum || b.count - a.count || a.ip.localeCompare(b.ip))
  return out
})

function gradeRank(m: (typeof cfg.models)[number]): number {
  const g = m.meta?.grade
  return g === 'A' ? 0 : g === 'B' ? 1 : g === 'C' ? 2 : 3
}

const stats = computed(() => {
  const total = cfg.models.length
  const c4 = cfg.models.filter((m) => m.cubism === 'cubism4').length
  const a = cfg.models.filter((m) => m.meta?.grade === 'A').length
  const b = cfg.models.filter((m) => m.meta?.grade === 'B').length
  const c = cfg.models.filter((m) => m.meta?.grade === 'C').length
  const d = cfg.models.filter((m) => m.meta?.grade === 'D').length
  return { total, c4, a, b, c, d }
})

function toggleIp(ip: string): void {
  if (expandedIps.value.has(ip)) expandedIps.value.delete(ip)
  else expandedIps.value.add(ip)
}

async function applyModel(m: (typeof cfg.models)[number]): Promise<void> {
  if (m.cubism !== 'cubism4' || !m.meta?.has_core) {
    bus.emit('ui:toast', { kind: 'warn', message: '该模型不可用', ttl_ms: 3000 })
    return
  }
  // 立刻反馈 — 不等 IPC 往返就把卡片置 loading 态
  loadingDir.value = m.dir
  loadError.value = null
  // 8 秒兜底超时：renderer 没回事件就清掉，避免卡死
  const timer = window.setTimeout(() => {
    if (loadingDir.value === m.dir) loadingDir.value = null
  }, 8000)
  try {
    await cfg.saveAvatar({ model_dir: m.dir, model_file: m.model_file })
    bus.emit('avatar:reload-model')
    // v0.12: 标记最近使用
    void window.api.models.markRecent(m.dir).then(() => refreshFavorites()).catch(() => {})
  } catch (e) {
    loadingDir.value = null
    bus.emit('ui:toast', { kind: 'error', message: `切换失败：${String(e)}`, ttl_ms: 5000 })
  } finally {
    // 清掉 timeout 由事件接管（model-loaded 或 model-error）
    void timer
  }
}

async function describe(m: (typeof cfg.models)[number]): Promise<void> {
  if (descriptions.value[m.dir]) return
  if (describing.value.has(m.dir)) return
  describing.value.add(m.dir)
  try {
    const r = await window.api.models.describe({
      model_dir: m.dir,
      model_json_path: m.absolute_path,
      display: m.display,
      ip: extractIp(m.dir),
      motion_count: m.meta?.motion_count ?? 0,
      expression_count: m.meta?.expression_count ?? 0,
    })
    if (r.ok && r.text) {
      descriptions.value[m.dir] = r.text
    } else {
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '生成失败', ttl_ms: 5000 })
    }
  } finally {
    describing.value.delete(m.dir)
  }
}

async function describeBatch(models: (typeof cfg.models)): Promise<void> {
  // 并发限制 4，避免一次发太多 LLM 请求
  const queue = models.filter((m) => !descriptions.value[m.dir]).slice(0, 30)
  const concurrency = 4
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < queue.length) {
      const i = idx++
      await describe(queue[i]!)
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker))
  bus.emit('ui:toast', { kind: 'success', message: `批量生成完成`, ttl_ms: 3000 })
}

const rescanning = ref(false)
async function rescan(): Promise<void> {
  rescanning.value = true
  try {
    await cfg.rescanModels()
    bus.emit('ui:toast', { kind: 'info', message: `扫到 ${cfg.models.length} 个模型`, ttl_ms: 3000 })
  } finally {
    rescanning.value = false
  }
}

onMounted(async () => {
  bus.on('avatar:model-loaded', onModelLoaded)
  bus.on('avatar:model-error', onModelError)
  // 加载所有 cached 描述
  try {
    descriptions.value = await window.api.models.cachedDescriptions()
  } catch {
    /* skip */
  }
  // v0.10: 拉已缓存的缩略图 → 后台开始生成缺失的（不阻塞 UI）
  if (cfg.models.length > 0) {
    await loadCachedThumbs()
    void generateMissingThumbs()
  }
  // v0.12: 拉已 enriched + favorites
  void refreshEnriched()
  void refreshFavorites()
})

// 模型列表变化时（首次 rescan 或新加模型）触发拉缓存 + 补生成
watch(
  () => cfg.models.length,
  async (n) => {
    if (n > 0) {
      await loadCachedThumbs()
      void generateMissingThumbs()
    }
  },
)

// v0.14 P2-T7: 只默认展开「前 3 个有最多角色的 IP」+ 包含当前 active 模型的 IP
// 之前全部展开 = 30+ IP × 60 卡片 = 1800 DOM 节点，scroll 卡。
// 现在 ≤ 4 IP × 60 = 240 DOM 节点，大幅降低渲染开销。
watch(groupedByIp, (groups) => {
  if (!focused.value && groups.length > 0) {
    const firstGroup = groups[0]!
    const firstCluster = firstGroup.clusters[0]
    if (firstCluster && firstCluster.views.length > 0) {
      focused.value = firstCluster.views[0] ?? null
      expandedIps.value.add(firstGroup.ip)
    }
  }
  // 只展开角色数最多的前 3 个 IP（按 char_count 降序）
  const top3 = [...groups]
    .filter((g) => g.ip !== UNKNOWN_IP_BUCKET)
    .sort((a, b) => b.char_count - a.char_count)
    .slice(0, 3)
  for (const g of top3) {
    expandedIps.value.add(g.ip)
  }
  // 包含当前 active 模型的 IP 也展开
  const activeDir = cfg.soul?.avatar.model_dir
  if (activeDir) {
    for (const g of groups) {
      const has = g.clusters.some((c) => c.views.some((v) => v.dir === activeDir))
      if (has) expandedIps.value.add(g.ip)
    }
  }
})
</script>

<template>
  <div class="library-panel" :class="{ 'library-embedded': embedded }" @click.stop>
    <header class="lib-header">
      <!-- 第一行：搜索 + viewmode segmented + 紧凑工具菜单 -->
      <div class="control-bar">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input v-model="search" placeholder="搜索 角色 / IP / 标签…" class="search-input" />
          <button v-if="search" class="search-clear" @click="search = ''" title="清空">✕</button>
        </div>
        <div class="vm-segmented">
          <button :class="['vm', { active: viewMode === 'all' }]" @click="viewMode = 'all'" title="全部">
            <span class="vm-emoji">📚</span><span class="vm-text">全部</span>
            <span class="vm-count">{{ cfg.models.length }}</span>
          </button>
          <button :class="['vm', { active: viewMode === 'favorites' }]" @click="viewMode = 'favorites'" title="收藏">
            <span class="vm-emoji">⭐</span><span class="vm-text">收藏</span>
            <span class="vm-count">{{ favorites.size }}</span>
          </button>
          <button :class="['vm', { active: viewMode === 'recent' }]" @click="viewMode = 'recent'" title="最近">
            <span class="vm-emoji">🕐</span><span class="vm-text">最近</span>
            <span class="vm-count">{{ recentDirs.length }}</span>
          </button>
        </div>
        <button
          class="filter-toggle"
          :class="{ active: filterOpen || gradeFilter !== 'all' || !hideUnusable }"
          @click="filterOpen = !filterOpen"
          title="筛选与排序"
        >
          ⚙ <span class="ft-text">筛选</span>
          <span v-if="gradeFilter !== 'all'" class="ft-dot" />
        </button>
      </div>

      <!-- 第二行：折叠的高级筛选（默认隐藏）-->
      <Transition name="slide-fade">
        <div v-if="filterOpen" class="filter-popover">
          <label class="fp-field">
            <span class="fp-label">等级</span>
            <select v-model="gradeFilter" class="select">
              <option value="all">全部</option>
              <option value="A">A · ≥15 动作</option>
              <option value="B">B · ≥8</option>
              <option value="C">C · ≥3</option>
              <option value="D">D · 静态</option>
            </select>
          </label>
          <label class="fp-field">
            <span class="fp-label">排序</span>
            <select v-model="sortBy" class="select">
              <option value="motion">动作数 ↓</option>
              <option value="expression">表情数 ↓</option>
              <option value="grade">等级 ↓</option>
              <option value="name">名字 A→Z</option>
            </select>
          </label>
          <label class="fp-toggle">
            <input type="checkbox" v-model="hideUnusable" />
            <span>只显示可用</span>
          </label>
          <div class="fp-spacer" />
          <button class="ghost" @click="rescan" :disabled="rescanning">
            {{ rescanning ? '扫描中…' : '🔄 重扫' }}
          </button>
          <button class="ghost" @click="regenerateAllThumbs" title="清空缩略图缓存并重建">
            🖼 重建缩略图
          </button>
          <button
            class="ghost"
            @click="enrichProgress && enrichProgress.done < enrichProgress.total ? abortEnrichment() : startEnrichment()"
            :title="enrichProgress && enrichProgress.done < enrichProgress.total ? '点击中止' : 'LLM 补全 1389 个角色中文名+介绍（约 30 分钟）'"
          >
            {{ enrichProgress && enrichProgress.done < enrichProgress.total ? '⏹ 中止补全' : '🤖 LLM 补全' }}
          </button>
        </div>
      </Transition>

      <!-- 第三行：进度条（仅运行时显示）-->
      <div v-if="thumbProgress && thumbProgress.done < thumbProgress.total" class="thumb-progress">
        <div class="thumb-bar" :style="{ width: ((thumbProgress.done / thumbProgress.total) * 100).toFixed(1) + '%' }" />
        <span class="thumb-text">
          🖼 缩略图 {{ thumbProgress.done }} / {{ thumbProgress.total }}
          <span v-if="thumbProgress.failed > 0" class="thumb-fail">（{{ thumbProgress.failed }} 失败）</span>
        </span>
      </div>
      <div v-if="enrichProgress && enrichProgress.done < enrichProgress.total" class="thumb-progress enrich">
        <div class="thumb-bar enrich-bar" :style="{ width: ((enrichProgress.done / enrichProgress.total) * 100).toFixed(1) + '%' }" />
        <span class="thumb-text">
          🤖 LLM 补全 {{ enrichProgress.done }} / {{ enrichProgress.total }}
          <span v-if="enrichProgress.failed > 0" class="thumb-fail">（{{ enrichProgress.failed }} 失败）</span>
        </span>
      </div>

      <!-- 顶部小字 stats（不占焦点）-->
      <div class="embedded-stats">
        共 {{ stats.total }} model · Cubism4 {{ stats.c4 }} ·
        <span class="g-a">A {{ stats.a }}</span> ·
        <span class="g-b">B {{ stats.b }}</span> ·
        <span class="g-c">C {{ stats.c }}</span> ·
        <span class="g-d">D {{ stats.d }}</span>
      </div>
    </header>

    <div class="body">
      <section v-for="g in groupedByIp" :key="g.ip" class="ip-section">
        <div class="ip-head" @click="toggleIp(g.ip)">
          <span class="ip-arrow">{{ expandedIps.has(g.ip) ? '▼' : '▶' }}</span>
          <div class="ip-title">
            <span class="ip-name">{{ g.ip }}</span>
            <span v-if="matchIpInfo(g.ip)" class="ip-kind">{{ matchIpInfo(g.ip)!.kind }}</span>
          </div>
          <span class="ip-count">
            {{ g.char_count }} 角色 · {{ g.count }} model
          </span>
          <button
            v-if="expandedIps.has(g.ip)"
            class="ip-btn"
            @click.stop="describeBatch(g.clusters.slice(0, 30).map((c) => c.primary))"
            title="批量生成 AI 介绍"
          >
            ✨
          </button>
        </div>
        <div v-if="expandedIps.has(g.ip) && matchIpInfo(g.ip)" class="ip-banner">
          {{ matchIpInfo(g.ip)!.intro }}
        </div>
        <div v-if="expandedIps.has(g.ip)" class="grid">
          <div
            v-for="c in g.clusters.slice(0, 60)"
            :key="c.character_id"
            class="card"
            :class="{
              'card-current': c.views.some((v) => cfg.soul?.avatar.model_dir === v.dir),
              'card-loading': c.views.some((v) => loadingDir === v.dir),
              [`card-grade-${(c.primary.meta?.grade ?? 'd').toLowerCase()}`]: true,
            }"
            @click="focused = c.primary"
            @dblclick="applyModel(c.primary)"
          >
            <div v-if="c.views.some((v) => loadingDir === v.dir)" class="card-spinner">
              <div class="spinner-ring" />
              <span>加载中…</span>
            </div>
            <!-- 缩略图 + 浮层 chip overlay -->
            <div class="card-thumb">
              <img
                v-if="c.character_id && thumbUrls[c.character_id]"
                :src="thumbUrls[c.character_id]"
                :alt="c.primary.display"
                class="thumb-img"
                loading="lazy"
              />
              <div v-else class="thumb-placeholder">
                <span class="thumb-icon">🎭</span>
              </div>
              <!-- 缩略图右上角 chip 浮层（grade + 收藏）-->
              <span class="thumb-grade-chip">{{ c.primary.meta?.grade ?? '?' }}</span>
              <button
                class="thumb-fav"
                :class="{ on: favorites.has(c.primary.dir) }"
                @click.stop="toggleFavorite(c.primary.dir)"
                :title="favorites.has(c.primary.dir) ? '取消收藏' : '收藏'"
              >
                {{ favorites.has(c.primary.dir) ? '⭐' : '☆' }}
              </button>
              <!-- 缺资源时显示「需修复」徽章 -->
              <span v-if="repairNeeded(c.primary)" class="thumb-warn" title="缺动作/表情/物理">⚠</span>
            </div>
            <!-- 元信息行 -->
            <div class="card-head">
              <span class="stat" :title="`${c.primary.meta?.motion_count ?? 0} 动作`">🎬{{ c.primary.meta?.motion_count ?? 0 }}</span>
              <span class="stat" :title="`${c.primary.meta?.expression_count ?? 0} 表情`">😊{{ c.primary.meta?.expression_count ?? 0 }}</span>
              <span v-if="c.primary.meta?.has_physics" class="stat" title="含物理">⚡</span>
              <span v-if="c.views.length > 1" class="views-tag">{{ c.views.length }} views</span>
            </div>
            <!-- 名字 -->
            <div class="card-name" :title="c.primary.display">
              {{ enriched[c.character_id]?.chinese_name || c.primary.display }}
            </div>
            <div
              v-if="enriched[c.character_id]?.chinese_name !== c.primary.display && enriched[c.character_id]"
              class="card-pinyin"
              :title="c.primary.display"
            >
              {{ c.primary.display }}
            </div>
            <!-- enriched 一句话 -->
            <div v-if="enriched[c.character_id]" class="card-desc enriched">
              {{ enriched[c.character_id]?.intro_one_line }}
            </div>
            <div v-else-if="descriptions[c.primary.dir]" class="card-desc">
              {{ descriptions[c.primary.dir] }}
            </div>
            <div v-else-if="describing.has(c.primary.dir)" class="card-desc dim">生成中…</div>
            <!-- 多 view chips -->
            <div v-if="c.views.length > 1" class="views-row">
              <button
                v-for="v in c.views"
                :key="v.dir"
                class="view-chip"
                :class="{
                  active: cfg.soul?.avatar.model_dir === v.dir,
                  loading: loadingDir === v.dir,
                }"
                @click.stop="applyModel(v)"
                :disabled="loadingDir === v.dir"
                :title="v.meta?.view_label || v.display"
              >
                <span v-if="loadingDir === v.dir" class="chip-dot" />
                {{ v.meta?.view_label || '主' }}
              </button>
            </div>
          </div>
          <div v-if="g.clusters.length > 60" class="more-hint">
            共 {{ g.char_count }} 角色 · 显示前 60
          </div>
        </div>
      </section>
    </div>

    <!-- 详情 Drawer — 点卡片才出现的右侧抽屉 -->
    <Transition name="drawer-slide">
      <div v-if="focused" class="drawer" @click.stop>
        <div class="drawer-header">
          <div class="drawer-title">
            <div class="drawer-name">{{ enriched[focused.meta?.character_id || '']?.chinese_name || focused.display }}</div>
            <div class="drawer-sub">{{ extractIp(focused.dir) }}</div>
          </div>
          <button class="drawer-close" @click="focused = null" title="关闭">✕</button>
        </div>

        <div class="drawer-body">
          <!-- 大缩略图 -->
          <div class="drawer-thumb">
            <img
              v-if="focused.meta?.character_id && thumbUrls[focused.meta.character_id]"
              :src="thumbUrls[focused.meta.character_id]"
              :alt="focused.display"
            />
            <div v-else class="thumb-placeholder big">
              <span class="thumb-icon">🎭</span>
            </div>
          </div>

          <!-- AI 介绍 -->
          <div v-if="descriptions[focused.dir]" class="ai-desc">
            <div class="ai-desc-label">✨ AI 介绍</div>
            <div class="ai-desc-text">{{ descriptions[focused.dir] }}</div>
          </div>
          <button
            v-else
            class="ghost-action"
            @click="describe(focused)"
            :disabled="describing.has(focused.dir)"
          >
            {{ describing.has(focused.dir) ? '生成中…' : '✨ 生成 AI 介绍' }}
          </button>

          <!-- 元数据 -->
          <div class="detail-meta">
            <div><span class="dm-k">等级</span><span class="dm-v">{{ focused.meta?.grade ?? '?' }}</span></div>
            <div><span class="dm-k">动作</span><span class="dm-v">{{ focused.meta?.motion_count ?? 0 }}</span></div>
            <div><span class="dm-k">表情</span><span class="dm-v">{{ focused.meta?.expression_count ?? 0 }}</span></div>
            <div><span class="dm-k">物理</span><span class="dm-v">{{ focused.meta?.has_physics ? '✓' : '✗' }}</span></div>
            <div><span class="dm-k">moc3</span><span class="dm-v">{{ Math.round((focused.meta?.moc_kb ?? 0) / 1024 * 10) / 10 }}MB</span></div>
            <div><span class="dm-k">贴图</span><span class="dm-v">{{ Math.round((focused.meta?.texture_kb ?? 0) / 1024) }}MB</span></div>
          </div>

          <!-- 操作按钮 -->
          <div class="detail-actions">
            <button class="primary" @click="applyModel(focused)" :disabled="loadingDir === focused.dir">
              {{ loadingDir === focused.dir ? '加载中…' : '🎭 切到此模型' }}
            </button>
            <button
              v-if="repairNeeded(focused)"
              class="repair-btn"
              :disabled="repairingDir.has(focused.dir)"
              @click="repairAvatar(focused)"
              :title="`补齐 ${(focused.meta?.motion_count ?? 0) < 3 ? '动作 ' : ''}${(focused.meta?.expression_count ?? 0) < 4 ? '表情 ' : ''}${!focused.meta?.has_physics ? '物理' : ''}`"
            >
              {{ repairingDir.has(focused.dir) ? '修复中…' : '🔧 AI 修复立绘' }}
            </button>
          </div>

          <!-- 同角色多 view 切换 -->
          <div
            v-if="(() => {
              const cluster = groupedByIp.flatMap(g => g.clusters).find(c => c.views.some(v => v.dir === focused?.dir));
              return cluster && cluster.views.length > 1;
            })()"
            class="drawer-views"
          >
            <div class="dv-label">其他 view</div>
            <div class="dv-list">
              <template v-for="cluster in groupedByIp.flatMap(g => g.clusters).filter(c => c.views.some(v => v.dir === focused?.dir))" :key="cluster.character_id">
                <button
                  v-for="v in cluster.views"
                  :key="v.dir"
                  class="view-chip"
                  :class="{ active: cfg.soul?.avatar.model_dir === v.dir }"
                  @click="applyModel(v)"
                >
                  {{ v.meta?.view_label || '主' }}
                </button>
              </template>
            </div>
          </div>

          <!-- 路径 -->
          <div class="dir-path" :title="focused.absolute_path">{{ focused.absolute_path }}</div>
        </div>
      </div>
    </Transition>
    <!-- Drawer 背景遮罩（点击关闭）-->
    <Transition name="fade">
      <div v-if="focused" class="drawer-scrim" @click="focused = null" />
    </Transition>
  </div>
</template>

<style scoped>
/* v0.17 — 单列布局 + drawer 详情，告别 fixed 340px 列 */
.library-panel {
  position: fixed;
  inset: 4%;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: oklch(98% 0.005 25 / 0.96);
  border: 1px solid oklch(85% 0.02 25 / 0.6);
  border-radius: 16px;
  box-shadow: 0 24px 60px oklch(0% 0 0 / 0.3);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  pointer-events: auto;
  overflow: hidden;
  color: oklch(20% 0.01 25);
  container-type: inline-size;
}
.library-panel.library-embedded {
  position: relative;
  inset: auto;
  flex: 1;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* ===== Header ===== */
.lib-header {
  flex-shrink: 0;
  padding: 12px 16px 8px;
  border-bottom: 1px solid oklch(88% 0.01 250 / 0.45);
  background: oklch(99% 0.002 250 / 0.6);
}
.control-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.search-wrap {
  flex: 1 1 240px;
  min-width: 180px;
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  font-size: 12px;
  opacity: 0.55;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 8px 32px 8px 30px;
  border: 1px solid oklch(85% 0.015 250 / 0.7);
  border-radius: 10px;
  background: oklch(100% 0 0 / 0.7);
  font-size: 13px;
  transition: border-color 150ms, box-shadow 150ms;
}
.search-input:focus {
  outline: none;
  border-color: oklch(65% 0.18 250);
  box-shadow: 0 0 0 3px oklch(75% 0.15 250 / 0.2);
}
.search-clear {
  position: absolute;
  right: 8px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: oklch(88% 0.01 250 / 0.6);
  color: oklch(40% 0.04 250);
  font-size: 9px;
}
.search-clear:hover { background: oklch(82% 0.02 250 / 0.8); }

/* viewmode segmented control */
.vm-segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: oklch(94% 0.01 250 / 0.6);
  border-radius: 12px;
}
.vm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 9px;
  font-size: 12px;
  color: oklch(45% 0.05 250);
  background: transparent;
  font-weight: 500;
  transition: all 150ms;
  white-space: nowrap;
}
.vm:hover { background: oklch(97% 0.01 250 / 0.7); color: oklch(30% 0.08 250); }
.vm.active {
  background: linear-gradient(135deg, oklch(60% 0.22 250), oklch(55% 0.24 270));
  color: white;
  box-shadow: 0 1px 4px oklch(60% 0.22 250 / 0.35);
}
.vm-emoji { font-size: 13px; line-height: 1; }
.vm-text { font-size: 12px; }
.vm-count {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: oklch(100% 0 0 / 0.35);
}
.vm:not(.active) .vm-count { background: oklch(100% 0 0 / 0.7); color: oklch(45% 0.05 250); }

/* filter toggle */
.filter-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: oklch(100% 0 0 / 0.55);
  border: 1px solid oklch(85% 0.015 250 / 0.7);
  color: oklch(40% 0.04 250);
  font-weight: 500;
  transition: all 150ms;
}
.filter-toggle:hover { background: oklch(97% 0.012 250); border-color: oklch(70% 0.12 250 / 0.6); }
.filter-toggle.active {
  background: oklch(94% 0.04 250 / 0.7);
  border-color: oklch(60% 0.22 250 / 0.5);
  color: oklch(30% 0.18 250);
}
.ft-text { font-weight: 500; }
.ft-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: oklch(60% 0.22 30);
  box-shadow: 0 0 0 2px oklch(60% 0.22 30 / 0.25);
}

/* filter popover */
.filter-popover {
  margin-top: 10px;
  padding: 12px;
  background: oklch(96% 0.012 250 / 0.85);
  border: 1px solid oklch(88% 0.01 250 / 0.5);
  border-radius: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.fp-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fp-label { font-size: 11px; color: oklch(45% 0.04 250); font-weight: 600; }
.fp-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: oklch(35% 0.04 250);
  cursor: pointer;
}
.fp-spacer { flex: 1; min-width: 0; }
.select {
  padding: 5px 8px;
  border: 1px solid oklch(85% 0.015 250 / 0.7);
  border-radius: 7px;
  background: oklch(100% 0 0 / 0.8);
  font-size: 12px;
  color: oklch(30% 0.04 250);
}
.ghost {
  padding: 6px 12px;
  border: 1px solid oklch(85% 0.015 250 / 0.7);
  background: oklch(100% 0 0 / 0.5);
  border-radius: 8px;
  font-size: 12px;
  color: oklch(35% 0.04 250);
  transition: all 150ms;
}
.ghost:hover { background: oklch(97% 0.012 250); }
.ghost:disabled { opacity: 0.5; cursor: wait; }

/* embedded stats — 极小字号灰色一行 */
.embedded-stats {
  margin-top: 8px;
  font-size: 10.5px;
  color: oklch(55% 0.03 250);
  font-family: ui-monospace, monospace;
  letter-spacing: 0.3px;
}
.g-a { color: oklch(50% 0.18 145); font-weight: 600; }
.g-b { color: oklch(58% 0.16 70); font-weight: 600; }
.g-c { color: oklch(60% 0.14 50); }
.g-d { color: oklch(60% 0.05 30); opacity: 0.7; }

/* ===== Body ===== */
.body {
  flex: 1;
  padding: 8px 14px 14px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ===== 容器查询：窄面板时收缩控件 ===== */
@container (max-width: 640px) {
  .vm-text { display: none; }
  .ft-text { display: none; }
  .vm { padding: 5px 8px; }
  .embedded-stats { font-size: 10px; }
  .lib-header { padding: 10px 12px 6px; }
  .body { padding: 6px 10px 12px; }
}
@container (max-width: 480px) {
  .search-wrap { flex: 1 1 100%; order: -1; }
  .vm-segmented { flex: 1; justify-content: space-around; }
  .vm-count { display: none; }
}

.ip-section {
  margin-top: 12px; border: 1px solid oklch(90% 0.015 25 / 0.5);
  border-radius: 12px; overflow: hidden;
  background: oklch(99% 0.002 25 / 0.5);
}
.ip-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer;
  background: oklch(96% 0.01 250 / 0.5);
  border-bottom: 1px solid oklch(90% 0.015 25 / 0.5);
  user-select: none;
}
.ip-head:hover { background: oklch(94% 0.02 250 / 0.6); }
.ip-arrow { font-size: 10px; color: oklch(45% 0.05 250); }
.ip-title { flex: 1; display: flex; align-items: baseline; gap: 8px; }
.ip-name { font-weight: 600; font-size: 14px; }
.ip-kind {
  font-size: 11px;
  color: oklch(55% 0.12 250);
  background: oklch(92% 0.03 250 / 0.7);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.ip-count { font-size: 12px; color: oklch(50% 0.01 25); }
.ip-banner {
  margin: -4px 8px 12px 32px;
  padding: 10px 14px;
  background: linear-gradient(135deg, oklch(96% 0.025 250 / 0.6), oklch(94% 0.04 280 / 0.4));
  border-left: 3px solid oklch(60% 0.18 250);
  border-radius: 0 8px 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: oklch(40% 0.04 250);
}
.ip-btn {
  padding: 4px 10px; border: 1px solid oklch(70% 0.18 280 / 0.5);
  background: oklch(96% 0.04 280); border-radius: 6px; cursor: pointer; font-size: 11px;
  color: oklch(35% 0.18 280);
}
.ip-btn:hover { background: oklch(92% 0.06 280); }

/* v0.17 视觉升级 — Pinterest + App Store 风（响应式紧凑版）*/
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
  padding: 14px 14px 18px;
}
@container (min-width: 700px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
}
@container (min-width: 900px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; padding: 16px 18px 20px; }
}
.card {
  position: relative;
  padding: 8px;
  background: linear-gradient(180deg, oklch(99% 0.003 250 / 0.88), oklch(96% 0.008 250 / 0.75));
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  border: 1px solid oklch(88% 0.01 250 / 0.5);
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.22s, border-color 0.2s;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.04),
              0 2px 8px oklch(0% 0 0 / 0.05);
}
.card:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 6px 18px oklch(60% 0.18 250 / 0.18),
              0 12px 28px oklch(0% 0 0 / 0.12);
  border-color: oklch(75% 0.12 250 / 0.5);
}

/* 当前使用中 — glow ring + 顶部 chip */
.card-current {
  border-color: oklch(60% 0.22 250);
  box-shadow: 0 0 0 3px oklch(70% 0.18 250 / 0.35),
              0 6px 20px oklch(60% 0.22 250 / 0.3);
  background: linear-gradient(180deg, oklch(98% 0.02 250 / 0.95), oklch(94% 0.04 250 / 0.85));
}
.card-current::before {
  content: '✨ 使用中';
  position: absolute;
  top: -8px;
  right: 10px;
  z-index: 3;
  background: linear-gradient(135deg, oklch(60% 0.22 250), oklch(55% 0.25 280));
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 8px oklch(60% 0.22 250 / 0.4);
}

/* Grade — 取消 left border，全用 chip */
.card-grade-d { opacity: 0.62; }

/* head 改为右上角浮 chip */
.card-head {
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 10.5px;
  flex-wrap: wrap;
  padding: 1px 0;
}
.grade-tag {
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 9.5px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: white;
  box-shadow: 0 1px 3px oklch(0% 0 0 / 0.15);
}
.card-grade-a .grade-tag { background: linear-gradient(135deg, oklch(60% 0.18 145), oklch(50% 0.2 155)); }
.card-grade-b .grade-tag { background: linear-gradient(135deg, oklch(68% 0.16 80), oklch(60% 0.18 70)); }
.card-grade-c .grade-tag { background: linear-gradient(135deg, oklch(68% 0.15 50), oklch(60% 0.17 35)); }
.card-grade-d .grade-tag { background: oklch(60% 0.02 250); }

.stat {
  color: oklch(45% 0.02 250);
  padding: 1px 5px;
  border-radius: 5px;
  background: oklch(94% 0.005 250 / 0.6);
}
.views-tag {
  margin-left: auto;
  font-size: 9.5px;
  font-weight: 600;
  padding: 2px 7px;
  background: linear-gradient(135deg, oklch(94% 0.06 280 / 0.7), oklch(90% 0.08 290 / 0.6));
  color: oklch(35% 0.18 280);
  border-radius: 999px;
}

.views-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.view-chip {
  padding: 3px 9px;
  border: 1px solid oklch(85% 0.02 250 / 0.5);
  background: oklch(99% 0.002 250 / 0.7);
  border-radius: 999px;
  cursor: pointer;
  font-size: 10px;
  color: oklch(40% 0.02 250);
  transition: all 0.15s;
}
.view-chip:hover {
  background: oklch(96% 0.04 250);
  border-color: oklch(70% 0.1 250 / 0.6);
}
.view-chip.active {
  background: linear-gradient(135deg, oklch(60% 0.22 250), oklch(55% 0.24 270));
  color: white;
  border-color: transparent;
  box-shadow: 0 2px 6px oklch(60% 0.22 250 / 0.4);
}

.card-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  color: oklch(22% 0.04 250);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  letter-spacing: 0.2px;
}
.card-desc {
  font-size: 11px;
  color: oklch(40% 0.02 250);
  line-height: 1.5;
}
.card-desc.dim { color: oklch(60% 0.01 25); font-style: italic; }
.card-desc.enriched {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ai-btn {
  align-self: flex-start; padding: 2px 8px;
  border: 1px solid oklch(75% 0.12 280 / 0.5); background: oklch(97% 0.03 280);
  border-radius: 5px; cursor: pointer; font-size: 10px; color: oklch(40% 0.15 280);
}
.ai-btn:hover { background: oklch(94% 0.05 280); }

.more-hint { grid-column: 1/-1; text-align: center; font-size: 11px; color: oklch(50% 0.01 25); font-style: italic; padding: 8px; }

/* ===== Drawer 详情面板 — 右侧 overlay ===== */
.drawer-scrim {
  position: absolute;
  inset: 0;
  background: oklch(0% 0 0 / 0.25);
  backdrop-filter: blur(2px);
  z-index: 100;
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 95%);
  z-index: 110;
  background: oklch(99% 0.003 250 / 0.97);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border-left: 1px solid oklch(85% 0.015 250 / 0.6);
  box-shadow: -8px 0 32px oklch(0% 0 0 / 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.drawer-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid oklch(90% 0.012 250 / 0.5);
}
.drawer-title { flex: 1; min-width: 0; }
.drawer-name {
  font-size: 16px;
  font-weight: 700;
  color: oklch(22% 0.04 250);
  line-height: 1.3;
  word-break: break-word;
}
.drawer-sub {
  font-size: 11px;
  color: oklch(50% 0.04 250);
  margin-top: 2px;
}
.drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: oklch(94% 0.01 250 / 0.7);
  font-size: 12px;
  color: oklch(40% 0.04 250);
  flex-shrink: 0;
  transition: all 150ms;
}
.drawer-close:hover { background: oklch(88% 0.025 25 / 0.8); color: oklch(35% 0.18 25); transform: scale(1.05); }

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drawer-thumb {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(135deg, oklch(96% 0.012 250 / 0.5), oklch(94% 0.025 280 / 0.4));
}
.drawer-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-placeholder.big { width: 100%; height: 100%; }
.thumb-placeholder.big .thumb-icon { font-size: 56px; }

.ai-desc {
  padding: 10px 12px;
  background: linear-gradient(135deg, oklch(96% 0.03 280 / 0.6), oklch(94% 0.04 250 / 0.5));
  border-left: 3px solid oklch(65% 0.18 280);
  border-radius: 0 10px 10px 0;
}
.ai-desc-label { font-size: 10.5px; color: oklch(40% 0.15 280); font-weight: 700; letter-spacing: 0.4px; margin-bottom: 4px; }
.ai-desc-text { font-size: 12.5px; line-height: 1.55; color: oklch(25% 0.04 280); }
.ghost-action {
  padding: 8px 12px;
  border: 1px dashed oklch(70% 0.12 280 / 0.6);
  background: oklch(98% 0.02 280 / 0.5);
  border-radius: 10px;
  font-size: 12px;
  color: oklch(40% 0.15 280);
  font-weight: 500;
  transition: all 150ms;
}
.ghost-action:hover { background: oklch(94% 0.04 280 / 0.7); }

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.detail-meta > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: oklch(96% 0.008 250 / 0.6);
}
.dm-k { font-size: 10px; color: oklch(50% 0.04 250); letter-spacing: 0.3px; }
.dm-v { font-size: 13px; font-weight: 700; color: oklch(28% 0.05 250); }

.detail-actions { display: flex; flex-direction: column; gap: 8px; }
.primary {
  width: 100%;
  padding: 10px 14px;
  background: linear-gradient(135deg, oklch(60% 0.22 250), oklch(55% 0.24 270));
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 8px oklch(60% 0.22 250 / 0.3);
  transition: all 150ms;
}
.primary:hover { transform: translateY(-1px); box-shadow: 0 4px 14px oklch(60% 0.22 250 / 0.4); }
.primary:disabled { opacity: 0.5; cursor: wait; transform: none; }

.repair-btn {
  width: 100%;
  padding: 10px 14px;
  background: linear-gradient(135deg, oklch(68% 0.2 50), oklch(62% 0.22 35));
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 8px oklch(65% 0.2 45 / 0.3);
  transition: all 150ms;
}
.repair-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px oklch(65% 0.2 45 / 0.45); }
.repair-btn:disabled { opacity: 0.6; cursor: wait; }

.drawer-views { display: flex; flex-direction: column; gap: 6px; }
.dv-label { font-size: 11px; color: oklch(50% 0.04 250); font-weight: 600; }
.dv-list { display: flex; flex-wrap: wrap; gap: 5px; }

.dir-path {
  margin-top: auto;
  font-size: 10px;
  color: oklch(55% 0.02 250);
  word-break: break-all;
  font-family: ui-monospace, monospace;
  padding-top: 8px;
  border-top: 1px dashed oklch(88% 0.01 250 / 0.5);
  opacity: 0.7;
}

/* drawer 进出动画 */
.drawer-slide-enter-active, .drawer-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.drawer-slide-enter-from, .drawer-slide-leave-to { transform: translateX(105%); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.22s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-fade-enter-active { transition: all 0.22s cubic-bezier(0.32, 0.72, 0.24, 1); }
.slide-fade-leave-active { transition: all 0.18s ease; }
.slide-fade-enter-from { opacity: 0; transform: translateY(-6px); }
.slide-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* v0.9: 切模型 spinner — 立刻反馈避免「点了没反应」感 */
.card { position: relative; }

/* v0.17 缩略图 — 顶撑大块视觉 + chip overlay */
.card-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  background: linear-gradient(135deg, oklch(96% 0.012 250 / 0.5), oklch(94% 0.025 280 / 0.4));
  border-radius: 10px;
  margin-bottom: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-grade-chip {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.6px;
  padding: 2px 7px;
  border-radius: 999px;
  color: white;
  box-shadow: 0 1px 4px oklch(0% 0 0 / 0.25);
  backdrop-filter: blur(8px);
}
.card-grade-a .thumb-grade-chip { background: linear-gradient(135deg, oklch(60% 0.18 145 / 0.95), oklch(50% 0.2 155 / 0.95)); }
.card-grade-b .thumb-grade-chip { background: linear-gradient(135deg, oklch(68% 0.16 80 / 0.95), oklch(60% 0.18 70 / 0.95)); }
.card-grade-c .thumb-grade-chip { background: linear-gradient(135deg, oklch(68% 0.15 50 / 0.95), oklch(60% 0.17 35 / 0.95)); }
.card-grade-d .thumb-grade-chip { background: oklch(50% 0.02 250 / 0.85); }

.thumb-fav {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: oklch(100% 0 0 / 0.6);
  backdrop-filter: blur(8px);
  font-size: 13px;
  color: oklch(55% 0.05 70);
  box-shadow: 0 1px 4px oklch(0% 0 0 / 0.18);
  transition: all 150ms;
}
.thumb-fav:hover { background: oklch(100% 0 0 / 0.85); transform: scale(1.1); }
.thumb-fav.on { color: oklch(65% 0.2 70); background: oklch(98% 0.03 70 / 0.85); }

.thumb-warn {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: linear-gradient(135deg, oklch(75% 0.18 65), oklch(68% 0.2 50));
  color: white;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 1px 4px oklch(0% 0 0 / 0.25);
  animation: warn-pulse 2.4s ease-in-out infinite;
}
@keyframes warn-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; transform: scale(1.05); }
}
.thumb-img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-placeholder {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 4px;
  color: oklch(60% 0.05 250);
}
.thumb-icon { font-size: 32px; opacity: 0.6; }
.thumb-hint { font-size: 10px; opacity: 0.7; }

/* 进度条 */
.thumb-progress {
  position: relative;
  margin-top: 10px;
  height: 22px;
  background: oklch(94% 0.02 250 / 0.6);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  color: oklch(35% 0.05 250);
}
.thumb-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, oklch(70% 0.15 250 / 0.4), oklch(65% 0.18 280 / 0.5));
  transition: width 300ms ease;
}
.thumb-text {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thumb-fail { color: oklch(55% 0.2 25); }
.thumb-cur { opacity: 0.7; font-family: monospace; font-size: 10px; }
.card-loading { opacity: 0.7; }
.card-spinner {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  background: oklch(98% 0.005 250 / 0.85);
  backdrop-filter: blur(4px);
  border-radius: 12px;
  font-size: 11px; color: oklch(45% 0.05 250);
  pointer-events: none;
}
.spinner-ring {
  width: 24px; height: 24px;
  border: 2.5px solid oklch(85% 0.02 250);
  border-top-color: oklch(55% 0.2 250);
  border-radius: 50%;
  animation: spinner-rotate 0.7s linear infinite;
}
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
.view-chip.loading {
  background: oklch(92% 0.04 250);
  color: oklch(50% 0.1 250);
  cursor: wait;
}
.chip-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%;
  background: oklch(55% 0.2 250);
  margin-right: 4px;
  animation: chip-pulse 0.8s ease-in-out infinite;
}
@keyframes chip-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

/* v0.12: enrich 进度条颜色区分 */
.thumb-progress.enrich {
  margin-top: 6px;
  background: oklch(94% 0.04 280 / 0.5);
}
.thumb-bar.enrich-bar {
  background: linear-gradient(90deg, oklch(70% 0.18 280 / 0.5), oklch(65% 0.2 320 / 0.55));
}

.card-pinyin {
  font-size: 10px;
  color: oklch(58% 0.04 250);
  font-family: monospace;
  margin-top: -3px;
  margin-bottom: 4px;
  opacity: 0.75;
}
.card-desc.enriched {
  background: linear-gradient(135deg, oklch(96% 0.03 280 / 0.5), oklch(94% 0.04 250 / 0.4));
  border-left: 2.5px solid oklch(65% 0.18 280);
  padding: 6px 10px;
  border-radius: 0 6px 6px 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: oklch(30% 0.06 250);
  margin-top: 4px;
}
.card-tags {
  display: flex; gap: 4px; flex-wrap: wrap;
  margin-top: 6px;
}
.tag {
  font-size: 9px;
  padding: 1px 6px;
  background: oklch(92% 0.05 250 / 0.6);
  color: oklch(40% 0.12 250);
  border-radius: 999px;
  font-weight: 500;
}
</style>
