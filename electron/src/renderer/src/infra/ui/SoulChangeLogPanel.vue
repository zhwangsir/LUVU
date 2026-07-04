<script setup lang="ts">
/**
 * SoulChangeLogPanel.vue (P5 落地) — soul yaml 改动审计列表。
 *
 * 显示 ~/.luvu/chars/<id>/soul-changes.log 内容:
 *   每条 entry: timestamp + filename + summary + N 条 changes (path / kind / before → after)
 * 折叠展示，点开看明细。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'

interface LogEntry {
  ts: number
  character_id: string
  filename: string
  summary: string
  changes: Array<{
    path: string
    kind: 'added' | 'removed' | 'changed'
    before?: unknown
    after?: unknown
  }>
}

const entries = ref<LogEntry[]>([])
const loading = ref(false)
const expanded = ref<Set<number>>(new Set())
let cleanups: Array<() => void> = []

async function refresh(): Promise<void> {
  loading.value = true
  try {
    // code-reviewer L1: 无参 (默认 active character)
    entries.value = await window.api.soulChangeLog.list()
  } catch {
    /* ignore */
  } finally {
    loading.value = false
  }
}

// ts-reviewer M3: 避免 Electron renderer 的 window.confirm 同步阻塞 / Electron 拦截
// 用 inline 二次确认 — 第一次点显示警告，3 秒内再点才执行
const confirmClear = ref(false)
let confirmTimeout: ReturnType<typeof setTimeout> | null = null
async function clearAll(): Promise<void> {
  if (!confirmClear.value) {
    confirmClear.value = true
    if (confirmTimeout) clearTimeout(confirmTimeout)
    confirmTimeout = setTimeout(() => {
      confirmClear.value = false
    }, 3000)
    return
  }
  if (confirmTimeout) {
    clearTimeout(confirmTimeout)
    confirmTimeout = null
  }
  confirmClear.value = false
  await window.api.soulChangeLog.clear()
  await refresh()
  bus.emit('ui:toast', { kind: 'info', message: '改动历史已清空', ttl_ms: 2000 })
}

function toggle(ts: number): void {
  if (expanded.value.has(ts)) expanded.value.delete(ts)
  else expanded.value.add(ts)
  // trigger reactivity
  expanded.value = new Set(expanded.value)
}

function tsLabel(ts: number): string {
  const d = new Date(ts)
  return (
    `${d.getMonth() + 1}/${d.getDate()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  )
}

function shortVal(v: unknown, maxLen = 40): string {
  if (v === null) return 'null'
  if (v === undefined) return '(无)'
  if (typeof v === 'string') {
    return v.length > maxLen ? `"${v.slice(0, maxLen)}..."` : `"${v}"`
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.length} 项]`
  if (typeof v === 'object') return `{${Object.keys(v).length} 字段}`
  return String(v)
}

function kindSymbol(kind: 'added' | 'removed' | 'changed'): string {
  if (kind === 'added') return '+'
  if (kind === 'removed') return '-'
  return '~'
}

const hasEntries = computed(() => entries.value.length > 0)

onMounted(() => {
  void refresh()
  // 跟随 character 切换刷新
  const onChange = (): void => {
    void refresh()
  }
  bus.on('character:switched', onChange)
  bus.on('infra:soul-reloaded', onChange)
  cleanups = [
    () => bus.off('character:switched', onChange),
    () => bus.off('infra:soul-reloaded', onChange),
  ]
})
onBeforeUnmount(() => {
  for (const c of cleanups) c()
})
</script>

<template>
  <section class="scl-panel">
    <div class="head">
      <h3>Soul 改动历史 <span class="beta-tag">audit</span></h3>
      <div class="head-actions">
        <button class="ghost-tiny" @click="refresh" :disabled="loading">
          {{ loading ? '...' : '🔄' }}
        </button>
        <button
          v-if="hasEntries"
          :class="['ghost-tiny', { 'confirm-pending': confirmClear }]"
          @click="clearAll"
        >
          {{ confirmClear ? '再点确认' : '清空' }}
        </button>
      </div>
    </div>
    <p class="hint">
      每次 SoulEditor 保存 yaml 自动记录字段级 diff (NDJSON 最多 200 条 LRU)。
      跟 K 评测对照能量化"改完哪些字段引起 LLM 行为变化"。
    </p>

    <p v-if="!hasEntries && !loading" class="empty-hint">
      还没改过 soul 文件。打开"灵魂编辑器"修改后这里会出现历史。
    </p>

    <div v-else class="entries">
      <div
        v-for="e in entries"
        :key="e.ts"
        :class="['entry', { expanded: expanded.has(e.ts) }]"
      >
        <div class="entry-head" @click="toggle(e.ts)">
          <span class="expand-icon">{{ expanded.has(e.ts) ? '▼' : '▶' }}</span>
          <span class="entry-ts">{{ tsLabel(e.ts) }}</span>
          <span class="entry-file">{{ e.filename }}</span>
          <span class="entry-summary">{{ e.summary }}</span>
        </div>
        <div v-if="expanded.has(e.ts)" class="entry-changes">
          <div v-for="(c, i) in e.changes" :key="i" :class="['change-row', c.kind]">
            <span class="change-sym">{{ kindSymbol(c.kind) }}</span>
            <span class="change-path">{{ c.path }}</span>
            <span v-if="c.kind === 'changed'" class="change-diff">
              {{ shortVal(c.before) }} → {{ shortVal(c.after) }}
            </span>
            <span v-else-if="c.kind === 'added'" class="change-val">
              {{ shortVal(c.after) }}
            </span>
            <span v-else class="change-val">
              {{ shortVal(c.before) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scl-panel {
  padding-top: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 700;
}
.beta-tag {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  background: oklch(72% 0.12 145);
  color: white;
  border-radius: 999px;
}
.head-actions {
  display: flex;
  gap: 6px;
}
.ghost-tiny {
  background: transparent;
  border: 0;
  color: var(--color-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 8px;
}
.ghost-tiny:hover {
  color: var(--color-bubble-text);
}
.ghost-tiny.confirm-pending {
  color: oklch(55% 0.22 25);
  background: oklch(95% 0.05 25 / 0.3);
  border-radius: 999px;
  animation: confirm-pulse 1.2s ease-in-out infinite;
}
@keyframes confirm-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.hint {
  margin: 4px 0 10px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  line-height: 1.5;
}
.empty-hint {
  padding: 14px;
  text-align: center;
  background: var(--color-bubble);
  border-radius: var(--radius-md);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.entries {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 280px;
  overflow-y: auto;
}
.entry {
  background: var(--color-bubble);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-bubble-border);
  overflow: hidden;
}
.entry.expanded {
  border-color: var(--color-accent);
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 11px;
  user-select: none;
}
.entry-head:hover {
  background: var(--color-bubble-surface);
}
.expand-icon {
  width: 10px;
  color: var(--color-muted);
  font-size: 9px;
}
.entry-ts {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: var(--color-muted);
  width: 70px;
}
.entry-file {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: var(--color-accent);
  width: 110px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-summary {
  flex: 1;
  color: var(--color-bubble-text);
  font-weight: 500;
}

.entry-changes {
  padding: 6px 10px 8px 28px;
  border-top: 1px dashed var(--color-divider);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.change-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
}
.change-sym {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 700;
  width: 12px;
  text-align: center;
}
.change-row.added .change-sym {
  color: oklch(55% 0.18 140);
}
.change-row.removed .change-sym {
  color: oklch(55% 0.2 25);
}
.change-row.changed .change-sym {
  color: oklch(60% 0.16 80);
}
.change-path {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: var(--color-bubble-text);
  font-weight: 500;
}
.change-diff,
.change-val {
  color: var(--color-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}
</style>
