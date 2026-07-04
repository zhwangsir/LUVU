<script setup lang="ts">
/**
 * EmotionalDebugPanel.vue (P3 J UI) — 完整 EmotionalState 可视化 + 手动 mood 覆盖。
 *
 * 嵌入 SettingsPanel 灵魂 tab，跟 EvalRunner 同级。
 * 展示:
 *   - 当前 mood + intensity bar + missing_intensity bar + last_chat 距今
 *   - topic_imprints 表（含 cross-character topic 特殊高亮）
 *   - mood_history 最近 N 条时间线
 *   - 手动 setMood 9 个按钮 (debug / 体验用)
 *   - 手动 tick 按钮 (跳过等待看演化)
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'
import type { EmotionalState, Mood } from '@shared/emotional'

const state = ref<EmotionalState | null>(null)
let cleanups: Array<() => void> = []

const MOOD_OPTIONS: Array<{ id: Mood; label: string; emoji: string }> = [
  { id: 'calm', label: '平静', emoji: '😐' },
  { id: 'happy', label: '开心', emoji: '😊' },
  { id: 'shy', label: '害羞', emoji: '😳' },
  { id: 'tease', label: '俏皮', emoji: '😈' },
  { id: 'sad', label: '低落', emoji: '😢' },
  { id: 'angry', label: '生气', emoji: '😠' },
  { id: 'sleepy', label: '困倦', emoji: '😴' },
  { id: 'anxious', label: '焦躁', emoji: '😰' },
  { id: 'missing', label: '想念', emoji: '🥺' },
]

async function refresh(): Promise<void> {
  try {
    state.value = await window.api.emotional.getState()
  } catch {
    /* ignore */
  }
}

async function manualSetMood(mood: Mood): Promise<void> {
  await window.api.emotional.setMood({ mood, intensity: 0.7, trigger: 'manual_debug' })
  await refresh()
  bus.emit('emotional:state-changed') // 通知 status bar
  bus.emit('ui:toast', { kind: 'info', message: `已切到 ${mood}`, ttl_ms: 1500 })
}

async function manualTick(): Promise<void> {
  await window.api.emotional.tick()
  await refresh()
  bus.emit('emotional:state-changed')
}

function tsLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function durationSince(ts: number): string {
  const ms = Date.now() - ts
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

const sortedTopics = computed(() => {
  if (!state.value) return []
  return Object.values(state.value.topic_imprints).sort((a, b) => b.last_at - a.last_at)
})

const recentHistory = computed(() => {
  if (!state.value) return []
  return [...state.value.mood_history].reverse().slice(0, 15)
})

onMounted(() => {
  void refresh()
  const onChange = (): void => {
    void refresh()
  }
  bus.on('emotional:state-changed', onChange)
  bus.on('character:switched', onChange)
  // 自动 30s poll 一次（debug panel 打开期间）
  const timer = setInterval(refresh, 30_000)
  cleanups = [
    () => bus.off('emotional:state-changed', onChange),
    () => bus.off('character:switched', onChange),
    () => clearInterval(timer),
  ]
})

onBeforeUnmount(() => {
  for (const c of cleanups) c()
  cleanups = []
})
</script>

<template>
  <section class="ed-panel">
    <h3>情感状态 (debug) <span class="beta-tag">J</span></h3>
    <p v-if="!state" class="hint">还没初始化 — 选定 character 后会有数据。</p>

    <template v-else>
      <!-- 当前状态摘要 -->
      <div class="state-summary">
        <div class="row1">
          <span class="mood-emoji">{{ MOOD_OPTIONS.find((o) => o.id === state!.current_mood)?.emoji ?? '😐' }}</span>
          <span class="mood-label">{{ MOOD_OPTIONS.find((o) => o.id === state!.current_mood)?.label ?? state!.current_mood }}</span>
          <!-- P5 多 mood: secondary 残留以 + 小标签显示 -->
          <span
            v-if="state!.secondary_mood && state!.secondary_intensity"
            class="secondary-tag"
            :title="`secondary intensity: ${state!.secondary_intensity.toFixed(2)}`"
          >
            +{{ MOOD_OPTIONS.find((o) => o.id === state!.secondary_mood)?.emoji ?? '?' }}
            {{ MOOD_OPTIONS.find((o) => o.id === state!.secondary_mood)?.label ?? state!.secondary_mood }}
          </span>
          <span class="baseline-tag" :title="`baseline: ${state!.baseline_mood}`">↺ {{ state!.baseline_mood }}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">心情强度</span>
          <div class="bar-track">
            <div class="bar-fill mood-bar" :style="{ width: state!.mood_intensity * 100 + '%' }"></div>
          </div>
          <span class="bar-val">{{ state!.mood_intensity.toFixed(2) }}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">想念主人</span>
          <div class="bar-track">
            <div class="bar-fill missing-bar" :style="{ width: state!.missing_intensity * 100 + '%' }"></div>
          </div>
          <span class="bar-val">{{ state!.missing_intensity.toFixed(2) }}</span>
        </div>
        <div class="meta-row">
          <span>上次聊天: {{ durationSince(state!.last_chat_at) }}</span>
          <span>更新: {{ durationSince(state!.updated_at) }}</span>
        </div>
      </div>

      <!-- 手动控制 -->
      <div class="manual-block">
        <div class="manual-label">手动切换心情 (debug)</div>
        <div class="mood-buttons">
          <button
            v-for="m in MOOD_OPTIONS"
            :key="m.id"
            :class="['mood-btn', { active: state!.current_mood === m.id }]"
            :title="m.label"
            @click="manualSetMood(m.id)"
          >
            <span>{{ m.emoji }}</span>
          </button>
          <button class="tick-btn ghost" @click="manualTick" title="模拟一次 5min 周期 tick">
            ⏰ 手动 tick
          </button>
        </div>
      </div>

      <!-- topic imprints -->
      <div class="section-block">
        <h4>话题印记 ({{ sortedTopics.length }})</h4>
        <p v-if="sortedTopics.length === 0" class="hint">还没累积话题 — 聊天后会自动出现。</p>
        <div v-else class="topic-table">
          <div
            v-for="t in sortedTopics"
            :key="t.topic"
            :class="['topic-row', { cross: t.topic === '被主人提到' }]"
          >
            <span class="topic-name">{{ t.topic }}</span>
            <span class="topic-count">{{ t.count }}x</span>
            <span
              :class="['topic-sent', t.sentiment > 0.2 ? 'pos' : t.sentiment < -0.2 ? 'neg' : 'neutral']"
            >
              {{ t.sentiment > 0 ? '+' : '' }}{{ t.sentiment.toFixed(2) }}
            </span>
            <span class="topic-ts">{{ tsLabel(t.last_at) }}</span>
          </div>
        </div>
      </div>

      <!-- mood history -->
      <div class="section-block">
        <h4>心情变化 (最近 {{ recentHistory.length }})</h4>
        <div class="history-timeline">
          <div v-for="(h, i) in recentHistory" :key="`${h.ts}-${i}`" class="history-item">
            <span class="hist-emoji">{{ MOOD_OPTIONS.find((o) => o.id === h.mood)?.emoji ?? '?' }}</span>
            <span class="hist-mood">{{ h.mood }}</span>
            <span class="hist-trigger">{{ h.trigger }}</span>
            <span class="hist-ts">{{ tsLabel(h.ts) }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ed-panel {
  padding-top: 16px;
}
.ed-panel h3 {
  margin: 0 0 6px;
  font-size: var(--text-md);
  font-weight: 700;
}
.beta-tag {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  background: oklch(72% 0.16 50);
  color: white;
  border-radius: 999px;
}
.hint {
  margin: 4px 0 10px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  line-height: 1.5;
}

.state-summary {
  margin: 8px 0 12px;
  padding: 12px 14px;
  background: oklch(97% 0.005 250);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-bubble-border);
}
.row1 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.mood-emoji {
  font-size: 28px;
}
.mood-label {
  font-size: 16px;
  font-weight: 700;
}
.secondary-tag {
  padding: 2px 8px;
  background: oklch(95% 0.06 250 / 0.5);
  border: 1px dashed oklch(60% 0.18 250 / 0.5);
  border-radius: 999px;
  font-size: 11px;
  color: oklch(45% 0.15 250);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.baseline-tag {
  margin-left: auto;
  padding: 2px 8px;
  background: var(--color-divider);
  border-radius: 999px;
  font-size: 10px;
  color: var(--color-muted);
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 11px;
}
.bar-label {
  width: 60px;
  color: var(--color-muted);
}
.bar-track {
  flex: 1;
  height: 6px;
  background: var(--color-divider);
  border-radius: 999px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  transition: width var(--duration-normal);
}
.mood-bar {
  background: var(--color-accent);
}
.missing-bar {
  background: oklch(60% 0.2 25);
}
.bar-val {
  width: 36px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-align: right;
  font-feature-settings: 'tnum';
  color: var(--color-bubble-text);
}
.meta-row {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 10px;
  color: var(--color-muted);
}

.manual-block {
  margin: 8px 0 14px;
}
.manual-label {
  font-size: 11px;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.mood-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mood-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: 999px;
  cursor: pointer;
  transition: transform var(--duration-fast), background var(--duration-fast);
}
.mood-btn:hover {
  transform: scale(1.1);
  background: var(--color-bubble-surface);
}
.mood-btn.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
  transform: scale(1.15);
}
.tick-btn {
  margin-left: 6px;
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid var(--color-bubble-border);
  color: var(--color-muted);
}
.tick-btn:hover {
  color: var(--color-bubble-text);
}

.section-block {
  margin-top: 14px;
}
.section-block h4 {
  margin: 0 0 6px;
  font-size: var(--text-sm);
  font-weight: 700;
}

.topic-table {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}
.topic-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--color-bubble);
  border-radius: var(--radius-sm);
}
.topic-row.cross {
  background: oklch(95% 0.05 250 / 0.5);
  border: 1px dashed oklch(60% 0.18 250 / 0.4);
}
.topic-name {
  flex: 1;
  font-weight: 600;
}
.topic-count {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: var(--color-muted);
  width: 32px;
  text-align: right;
}
.topic-sent {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 600;
  width: 50px;
  text-align: right;
}
.topic-sent.pos {
  color: oklch(55% 0.18 140);
}
.topic-sent.neg {
  color: oklch(55% 0.2 25);
}
.topic-sent.neutral {
  color: var(--color-muted);
}
.topic-ts {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: var(--color-muted);
  width: 72px;
  text-align: right;
}

.history-timeline {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  font-size: 11px;
  border-bottom: 1px dashed var(--color-divider);
}
.hist-emoji {
  font-size: 14px;
}
.hist-mood {
  width: 60px;
  font-weight: 600;
}
.hist-trigger {
  flex: 1;
  color: var(--color-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hist-ts {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: var(--color-muted);
}
</style>
