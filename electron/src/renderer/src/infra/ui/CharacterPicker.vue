<script setup lang="ts">
/**
 * v0.14: CharacterPicker — 卡片网格切换角色。
 *
 * 点击卡片 → 1 秒切换（立绘+音色+灵魂+对话历史同步切）
 * 底部「+ 创建新的她」入口 → CharacterCreator (T4)
 * 卡片右下角「删除」按钮（builtin 不可删 + 不能删 active）
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCharacterStore } from '../stores/character'
import { bus } from '../eventbus'
import { highlightMatch } from './highlight-match'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-creator'): void
}>()

const character = useCharacterStore()

// Round R:picker 每次打开都刷一次 mounted event counts(用户上次开 picker
// 后,其他 mounted character 可能在后台听到了新事件,徽标需要更新)。
// 不阻塞渲染,fire-and-forget。
//
// reviewer R-MEDIUM-3:picker 打开期间订阅 attention:plan,active 说话产生
// 新 event 时实时刷计数。off-picker 时不订阅(避免后台 IPC chatter)。
let offAttentionPlan: (() => void) | null = null
onMounted(() => {
  void character.refreshMountedEventCounts()
  offAttentionPlan = window.api.attention.onPlan(() => {
    // 不每帧刷,只在有 speak action 时(passive listening 只对 speak 触发)
    // — 简化:plan 含 speak 与否,backend 写入也是无条件的,renderer 不知道
    // 具体是否写了,统一刷一下。N ≤ 5 个 IPC 几毫秒,可接受。
    void character.refreshMountedEventCounts()
  })
})
onBeforeUnmount(() => {
  if (offAttentionPlan) {
    offAttentionPlan()
    offAttentionPlan = null
  }
})

const filter = ref<'all' | 'recent'>('all')
const switchingId = ref<string | null>(null)
const searchQuery = ref('')

const visible = computed(() => {
  let list = [...character.all]
  if (filter.value === 'recent') {
    list = list.filter((c) => c.last_chat_at > 0).slice(0, 12)
  }
  // R62: 名称 / template / id 模糊搜索
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.template ?? '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      )
    })
  }
  return list
})

/** R70: 搜索框 Enter 直接选首个匹配项 (search 非空时) */
function onSearchEnter(): void {
  if (!searchQuery.value.trim()) return
  const first = visible.value[0]
  if (first && first.id !== character.active?.id) {
    void pick(first.id)
  }
}

async function pick(id: string): Promise<void> {
  if (id === character.active?.id) {
    emit('close')
    return
  }
  switchingId.value = id
  const r = await character.switchTo(id)
  switchingId.value = null
  if (r.ok) {
    emit('close')
  } else {
    bus.emit('ui:toast', { kind: 'error', message: `切换失败: ${r.reason ?? ''}`, ttl_ms: 4000 })
  }
}

async function clone(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  const src = character.all.find((c) => c.id === id)
  if (!src) return
  const r = await character.clone(id)
  if (r.ok && r.character) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已克隆 ${src.name} → ${r.character.name}（亲密度重置）`,
      ttl_ms: 4000,
    })
  } else {
    bus.emit('ui:toast', { kind: 'error', message: `克隆失败: ${r.reason}`, ttl_ms: 4000 })
  }
}

async function remove(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  const target = character.all.find((c) => c.id === id)
  if (!target) return
  if (!confirm(`确定删除 ${target.name}？\n这个角色的所有对话历史也会被删除（不可恢复）。`)) return
  const r = await character.remove(id)
  if (!r.ok) {
    const reasons: Record<string, string> = {
      builtin_protected: '内置角色不能删',
      cannot_delete_active: '不能删除当前正在用的角色，先切到别的',
      not_found: '没找到这个角色',
    }
    bus.emit('ui:toast', {
      kind: 'error',
      message: reasons[r.reason ?? ''] ?? r.reason ?? '删除失败',
      ttl_ms: 5000,
    })
  } else {
    bus.emit('ui:toast', { kind: 'success', message: `已删除 ${target.name}`, ttl_ms: 3000 })
  }
}

/**
 * Round M:切换 mount(M8 灵魂社会)。
 * mounted = 代码层并行存活的 character(独立 planner / memory),跟 active 区分。
 * active 永远 mounted(自己 + 自动补),所以不显示 toggle。
 */
async function toggleMount(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  const target = character.all.find((c) => c.id === id)
  if (!target) return
  const wasMounted = character.isMounted(id)
  const r = await character.toggleMount(id)
  if (!r.ok) {
    const reasons: Record<string, string> = {
      cannot_unmount_active: '当前正在用的角色不能取消并行',
      too_many_ids: '并行运行的角色不能超过 16 个',
      not_found: '角色不存在',
      empty: '至少要保留一个角色',
      busy: '正在切换中,稍等一下',
    }
    bus.emit('ui:toast', {
      kind: 'error',
      message: reasons[r.reason ?? ''] ?? r.reason ?? '操作失败',
      ttl_ms: 4000,
    })
    return
  }
  bus.emit('ui:toast', {
    kind: 'success',
    message: wasMounted
      ? `已取消 ${target.name} 的并行运行`
      : `已让 ${target.name} 并行运行(独立 planner / 记忆)`,
    ttl_ms: 3500,
  })
}

function relativeTime(ts: number): string {
  if (!ts) return '从未对话'
  const dt = Date.now() - ts
  const min = dt / 60_000
  if (min < 1) return '刚刚'
  if (min < 60) return `${Math.round(min)} 分钟前`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} 小时前`
  const d = h / 24
  if (d < 30) return `${Math.round(d)} 天前`
  return new Date(ts).toLocaleDateString()
}

function intimacyColor(lv: number): string {
  if (lv >= 80) return 'oklch(70% 0.2 25)'
  if (lv >= 60) return 'oklch(72% 0.18 18)'
  if (lv >= 40) return 'oklch(72% 0.16 50)'
  if (lv >= 20) return 'oklch(72% 0.12 145)'
  return 'oklch(72% 0.08 250)'
}

function initials(name: string): string {
  return name.slice(0, 2)
}
</script>

<template>
  <transition name="picker" appear>
    <div class="overlay" @click.self="emit('close')">
      <div class="card">
        <header>
          <div class="header-left">
            <h2>选个她</h2>
            <span class="count">{{ visible.length }} 个</span>
            <span
              v-if="character.mountedIds.length > 1"
              class="mount-count"
              :title="`${character.mountedIds.length} 个角色并行运行(独立 planner / 记忆)。点单卡的 📌 切换。`"
            >📌 {{ character.mountedIds.length }} 并行</span>
          </div>
          <div class="filter-tabs">
            <button :class="['filter-tab', { active: filter === 'all' }]" @click="filter = 'all'">
              全部
            </button>
            <button :class="['filter-tab', { active: filter === 'recent' }]" @click="filter = 'recent'">
              最近
            </button>
          </div>
          <button class="x-btn" @click="emit('close')">✕</button>
        </header>

        <div class="search-row">
          <input
            v-model="searchQuery"
            class="search-input"
            type="text"
            placeholder="🔍 搜角色名 / template / id..."
            spellcheck="false"
            autocomplete="off"
            aria-label="搜索角色"
            @keydown.enter="onSearchEnter"
            @keydown.esc.stop="searchQuery ? (searchQuery = '') : emit('close')"
          />
          <span class="search-hint">↵ 选首项 · Esc 关</span>
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear"
            title="清除"
            aria-label="清除搜索"
            @click="searchQuery = ''"
          >✕</button>
        </div>

        <div class="grid" v-if="visible.length > 0">
          <button
            v-for="c in visible"
            :key="c.id"
            class="char-card"
            :class="{
              active: c.id === character.active?.id,
              switching: c.id === switchingId,
            }"
            :disabled="!!switchingId"
            @click="pick(c.id)"
          >
            <div class="card-top">
              <span class="card-avatar" :style="{ borderColor: intimacyColor(c.intimacy_level) }">
                <img v-if="c.avatar_thumb_url" :src="c.avatar_thumb_url" :alt="c.name" />
                <span v-else class="card-initials">{{ initials(c.name) }}</span>
              </span>
              <span v-if="c.id === character.active?.id" class="active-dot" title="当前角色"></span>
              <span
                v-else-if="character.isMounted(c.id)"
                class="mount-badge"
                title="并行运行(独立 planner / 记忆)"
              >📌</span>
            </div>
            <div class="card-name">
              <template v-for="(seg, si) in highlightMatch(c.name, searchQuery)" :key="si">
                <mark v-if="seg.matched" class="match-hl">{{ seg.text }}</mark>
                <template v-else>{{ seg.text }}</template>
              </template>
            </div>
            <div class="card-desc" v-if="c.description">{{ c.description }}</div>
            <div class="card-meta">
              <span class="meta-intimacy" :style="{ color: intimacyColor(c.intimacy_level) }">
                ♡ {{ Math.round(c.intimacy_level) }}
              </span>
              <span class="meta-time">{{ relativeTime(c.last_chat_at) }}</span>
              <!-- Round R:听到事件计数 — 只在 mounted 且 > 0 时显示
                   reviewer R-MEDIUM-2:extract heardCount 局部 const 避免 3 次同函数调用 -->
              <template v-if="character.isMounted(c.id)">
                <span
                  v-for="heardCount in [character.getEventCount(c.id)]"
                  :key="`heard-${c.id}`"
                  v-show="heardCount > 0"
                  class="meta-heard"
                  :title="`作为 mounted 时听到 master 跟其他灵魂的 ${heardCount} 句话 — 切到这个灵魂时她的 LLM 会带上 context`"
                >👂 {{ heardCount > 99 ? '99+' : heardCount }}</span>
              </template>
            </div>
            <div class="card-actions">
              <button
                v-if="c.id !== character.active?.id"
                class="action-btn mount-btn"
                :class="{
                  mounted: character.isMounted(c.id),
                  toggling: character.toggleMounting === c.id,
                }"
                :disabled="!!character.toggleMounting"
                :title="
                  character.isMounted(c.id)
                    ? '取消并行运行 (停用独立 planner / 记忆)'
                    : '让她并行运行 (独立 planner / 记忆,后续可同时被感知触发)'
                "
                @click="toggleMount(c.id, $event)"
              >
                📌
              </button>
              <button
                class="action-btn clone-btn"
                title="克隆 (复制灵魂 + 偏好，重置亲密度)"
                @click="clone(c.id, $event)"
              >
                ⎘
              </button>
              <button
                v-if="!c.builtin && c.id !== character.active?.id"
                class="action-btn remove-btn"
                title="删除"
                @click="remove(c.id, $event)"
              >
                ✕
              </button>
            </div>
          </button>
        </div>

        <div class="empty" v-else>
          <div class="empty-icon">👤</div>
          <div class="empty-text">还没有任何角色</div>
          <div class="empty-sub">点下面创建第一个她</div>
        </div>

        <footer>
          <button class="create-btn" @click="emit('open-creator')">
            <span class="create-icon">＋</span>
            <span>创建新的她</span>
          </button>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1950;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 680px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-divider);
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.count {
  font-size: var(--text-xs);
  color: var(--color-muted);
  font-feature-settings: 'tnum';
}
/* Round M:并行运行数 chip(只在 > 1 时显示) */
.mount-count {
  font-size: var(--text-xs);
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-feature-settings: 'tnum';
  font-weight: 600;
  margin-left: 4px;
}
.filter-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.filter-tab {
  padding: 5px 12px;
  font-size: var(--text-xs);
  border-radius: var(--radius-pill);
  color: var(--color-muted);
  background: transparent;
  transition: color var(--duration-fast), background var(--duration-fast);
}
.filter-tab:hover {
  color: var(--color-bubble-text);
  background: var(--color-bubble-surface);
}
.filter-tab.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  font-weight: 600;
}
.x-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: var(--color-muted);
}
.x-btn:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}

/* R62: 角色搜索框 */
.search-row {
  display: flex;
  gap: 6px;
  padding: 12px 20px 0;
  align-items: center;
}
.search-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.search-input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus);
}
.search-hint {
  font-size: 10px;
  color: var(--color-muted);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  white-space: nowrap;
}
.search-clear {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--color-bubble-surface);
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.search-clear:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding: 18px 20px;
  overflow-y: auto;
}

.char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 12px 12px;
  background: var(--color-bubble-surface);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast), background var(--duration-fast),
    transform var(--duration-fast);
  text-align: center;
  gap: 4px;
  min-height: 160px;
}
.char-card:hover:not(:disabled) {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent-soft);
  transform: translateY(-2px);
}
.char-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.char-card.switching {
  animation: card-pulse 0.6s var(--ease-in-out) infinite;
}
.char-card:disabled {
  cursor: wait;
}
.char-card:not(.switching):disabled {
  opacity: 0.5;
}
@keyframes card-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.card-top {
  position: relative;
}
.card-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-bubble);
  border: 2px solid var(--color-accent);
  overflow: hidden;
  font-weight: 700;
  font-size: 18px;
  color: var(--color-accent);
}
.card-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-initials {
  letter-spacing: -1px;
}
.active-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-success);
  border: 2px solid var(--color-bubble);
}
/* Round M:mounted(并行运行)徽标 — active 排他互斥(active 永远 mounted 不重复挂) */
.mount-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-bubble);
  border: 1.5px solid var(--color-accent);
  font-size: 10px;
  line-height: 1;
}

.card-name {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-top: 6px;
}
/* R82+R86: 复用 R81 highlight-match - scoped 内本地颜色, font-weight 与 Spotlight 对齐 */
.match-hl {
  background: oklch(85% 0.15 90 / 0.55);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  .match-hl {
    background: oklch(60% 0.18 80 / 0.5);
  }
}
.card-desc {
  font-size: 10px;
  color: var(--color-muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 10px;
  width: 100%;
  justify-content: center;
}
.meta-intimacy {
  font-weight: 600;
  font-feature-settings: 'tnum';
}
.meta-time {
  color: var(--color-muted);
}
/* Round R:M8 听到事件计数(👂 X) — 用 accent-soft 跟 mount-count chip 视觉对齐 */
.meta-heard {
  color: var(--color-accent);
  font-weight: 600;
  font-feature-settings: 'tnum';
  background: var(--color-accent-soft);
  padding: 0 5px;
  border-radius: var(--radius-pill);
  font-size: 10px;
}

.card-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.char-card:hover .card-actions {
  opacity: 1;
}
.action-btn {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: oklch(0% 0 0 / 0.06);
  color: var(--color-muted);
  font-size: 11px;
  transition: color var(--duration-fast), background var(--duration-fast);
}
.clone-btn:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.remove-btn:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
/* Round M:mount toggle 按钮 — mounted 时高亮表示状态可视 */
.mount-btn {
  font-size: 10px;
  filter: grayscale(1);
  opacity: 0.65;
}
.mount-btn:hover {
  background: var(--color-accent-soft);
  filter: none;
  opacity: 1;
}
.mount-btn.mounted {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  filter: none;
  opacity: 1;
}
.mount-btn.toggling {
  animation: card-pulse 0.6s var(--ease-in-out) infinite;
}
.mount-btn:disabled {
  cursor: wait;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}
.empty-icon {
  font-size: 48px;
  opacity: 0.4;
  margin-bottom: 12px;
}
.empty-text {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-sub {
  font-size: var(--text-sm);
  color: var(--color-muted);
}

footer {
  padding: 14px 20px;
  border-top: 1px solid var(--color-divider);
  display: flex;
  justify-content: center;
}
.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 22px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
  font-size: var(--text-sm);
  box-shadow: var(--shadow-sm);
  transition: background var(--duration-fast), transform var(--duration-fast),
    box-shadow var(--duration-fast);
}
.create-btn:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.create-icon {
  font-size: 16px;
  line-height: 1;
}

.picker-enter-active,
.picker-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
}
.picker-enter-active .card,
.picker-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.picker-enter-from .card,
.picker-leave-to .card {
  transform: scale(0.92) translateY(20px);
}
</style>
