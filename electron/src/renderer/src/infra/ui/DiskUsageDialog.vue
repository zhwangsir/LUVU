<script setup lang="ts">
/**
 * v0.13 磁盘占用统计 (audit H1)。
 * 列各数据目录大小 + 可清理项的「释放」按钮。
 */
import { computed, onMounted, ref } from 'vue'
import { bus } from '../eventbus'
import { formatBytes } from '@shared/format-utils'

const emit = defineEmits<{ (e: 'close'): void }>()

interface Entry {
  label: string
  path: string
  bytes: number
  exists: boolean
  hint: string
  cleanable: boolean
}

const entries = ref<Entry[]>([])
const totalBytes = ref(0)
const loading = ref(false)
const cleaning = ref<string | null>(null)

async function refresh(force = false): Promise<void> {
  loading.value = true
  try {
    const r = await window.api.system.diskUsage(force)
    entries.value = r.entries
    totalBytes.value = r.total_bytes
  } catch (e) {
    bus.emit('ui:toast', { kind: 'error', message: `统计失败：${String(e).slice(0, 80)}`, ttl_ms: 4000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => refresh(false))

async function cleanOne(e: Entry): Promise<void> {
  if (!confirm(`确定清理 ${e.label}？（${formatBytes(e.bytes)}）\n\n${e.hint}`)) return
  cleaning.value = e.path
  try {
    const r = await window.api.system.cleanPath(e.path)
    if (r.ok) {
      bus.emit('ui:toast', {
        kind: 'success',
        message: `已释放 ${formatBytes(r.freed_bytes)}`,
        ttl_ms: 3000,
      })
      await refresh(true)
    } else {
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '清理失败', ttl_ms: 4000 })
    }
  } finally {
    cleaning.value = null
  }
}

const totalFmt = computed(() => formatBytes(totalBytes.value))
</script>

<template>
  <transition name="disk" appear>
    <div class="overlay" @click.self="emit('close')">
      <div class="card">
        <header>
          <h2>📊 磁盘占用</h2>
          <button class="x-btn" @click="emit('close')">✕</button>
        </header>

        <div class="body">
          <div class="total">
            <span class="total-label">总计</span>
            <span class="total-value">{{ totalFmt }}</span>
            <button class="refresh-btn" :disabled="loading" @click="refresh(true)">
              {{ loading ? '统计中…' : '🔄 重算' }}
            </button>
          </div>

          <div class="entries">
            <div
              v-for="e in entries"
              :key="e.path"
              :class="['entry', { 'not-exist': !e.exists }]"
            >
              <div class="entry-main">
                <div class="entry-head">
                  <span class="entry-label">{{ e.label }}</span>
                  <span class="entry-size">
                    {{ e.exists ? formatBytes(e.bytes) : '不存在' }}
                  </span>
                </div>
                <div class="entry-hint">{{ e.hint }}</div>
                <div class="entry-path" :title="e.path">{{ e.path }}</div>
              </div>
              <button
                v-if="e.cleanable && e.exists && e.bytes > 0"
                class="clean-btn"
                :disabled="cleaning === e.path"
                @click="cleanOne(e)"
              >
                {{ cleaning === e.path ? '清理中…' : '🗑 释放' }}
              </button>
            </div>
          </div>

          <p class="note">
            统计结果缓存 60 秒。「释放」只对标记为可清理的项启用 — 模型、TTS 等
            「重新下载需要时间」的资产不在此面板里删除。
          </p>
        </div>
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
  backdrop-filter: blur(6px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 560px;
  max-height: 86vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-bubble-border);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.x-btn {
  font-size: var(--text-base);
  color: var(--color-muted);
  background: transparent;
  padding: 4px 8px;
}
.x-btn:hover {
  color: var(--color-bubble-text);
}
.body {
  padding: 16px 20px;
  overflow-y: auto;
}
.total {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  margin-bottom: 14px;
}
.total-label {
  font-size: var(--text-sm);
  color: var(--color-muted);
}
.total-value {
  font-size: var(--text-xl);
  font-weight: 700;
  font-feature-settings: 'tnum';
  flex: 1;
}
.refresh-btn {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  font-size: var(--text-xs);
  color: var(--color-bubble-text);
}
.refresh-btn:hover:not(:disabled) {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.refresh-btn:disabled {
  opacity: 0.5;
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.entry {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  border: 1px solid transparent;
  align-items: flex-start;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}
.entry:hover {
  border-color: var(--color-divider);
  background: var(--color-bubble-surface-hover);
}
.entry.not-exist {
  opacity: 0.45;
}
.entry-main {
  flex: 1;
  min-width: 0;
}
.entry-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}
.entry-label {
  font-weight: 600;
  font-size: var(--text-sm);
}
.entry-size {
  font-size: var(--text-sm);
  font-weight: 600;
  font-feature-settings: 'tnum';
  color: var(--color-accent);
  white-space: nowrap;
}
.entry.not-exist .entry-size {
  color: var(--color-muted);
}
.entry-hint {
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.45;
  margin-bottom: 4px;
}
.entry-path {
  font-size: 10px;
  color: var(--color-muted);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clean-btn {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  background: oklch(94% 0.05 80 / 0.6);
  color: var(--color-warn);
  font-size: var(--text-xs);
  font-weight: 600;
  flex-shrink: 0;
  border: 1px solid oklch(85% 0.08 80 / 0.5);
}
@media (prefers-color-scheme: dark) {
  .clean-btn {
    background: oklch(35% 0.08 80 / 0.4);
    border-color: oklch(50% 0.1 80 / 0.5);
  }
}
.clean-btn:hover:not(:disabled) {
  background: oklch(89% 0.08 80 / 0.85);
  transform: translateY(-1px);
}
.clean-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.note {
  margin: 14px 0 0;
  padding: 11px 14px;
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.55;
  background: var(--color-bubble-surface);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-accent);
}

.disk-enter-active,
.disk-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.disk-enter-from,
.disk-leave-to {
  opacity: 0;
}
.disk-enter-active .card,
.disk-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-expo);
}
.disk-enter-from .card,
.disk-leave-to .card {
  transform: scale(0.96) translateY(8px);
}
</style>
