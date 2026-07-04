<script setup lang="ts">
/**
 * EvalRunner.vue (P3 K UI) — 角色一致性测试触发器 + 进度 + 历史趋势。
 *
 * 嵌入 SettingsPanel 的 "灵魂" tab。
 * 调 window.api.eval.run() (5-25 分钟长任务) + 实时显示当前题号 / score。
 * 历史最近 10 次以列表 + mini avg trend 显示。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'

type CategoryStats = { count: number; avg: number }

interface FailureItem {
  question_id: string
  category: string
  prompt: string
  answer_text: string
  score: number
  breakdown: {
    contains_any_hit: boolean
    contains_all_hit: boolean
    forbidden_violations: string[]
    matches_hit: boolean
    max_chars_violated: boolean
    emotion_matched: boolean
  }
}

interface EvalReport {
  total_questions: number
  total_score: number
  avg_score: number
  by_category: Record<string, CategoryStats>
  failures: FailureItem[]
  ts: number
  model: string
}

interface HistoryEntry {
  ts: number
  model: string
  total_questions: number
  avg_score: number
  by_category: Record<string, CategoryStats>
  failure_count: number
  top_failure_ids: string[]
}

const running = ref(false)
const progress = ref<{ done: number; total: number; current_id?: string; current_score?: number }>(
  { done: 0, total: 0 },
)
const report = ref<EvalReport | null>(null)
const history = ref<HistoryEntry[]>([])
const errorMsg = ref('')
const limitInput = ref<number | null>(null) // null = 全 50 题

const progressPct = computed(() =>
  progress.value.total > 0
    ? Math.round((progress.value.done / progress.value.total) * 100)
    : 0,
)

let unsubscribeProgress: (() => void) | null = null

async function refreshHistory(): Promise<void> {
  try {
    history.value = await window.api.eval.history()
  } catch (e) {
    console.warn('[eval] history failed:', e)
  }
}

async function startRun(): Promise<void> {
  if (running.value) return
  errorMsg.value = ''
  report.value = null
  running.value = true
  progress.value = { done: 0, total: limitInput.value ?? 50 }
  try {
    const r = await window.api.eval.run(
      typeof limitInput.value === 'number' && limitInput.value > 0
        ? { limit: limitInput.value }
        : {},
    )
    if (r.ok && r.report) {
      report.value = r.report
      bus.emit('ui:toast', {
        kind: 'success',
        message: `评测完成 — 平均 ${r.report.avg_score}/100`,
        ttl_ms: 4000,
      })
      await refreshHistory()
    } else {
      errorMsg.value = r.reason ?? '未知错误'
      bus.emit('ui:toast', { kind: 'error', message: `评测失败: ${errorMsg.value}`, ttl_ms: 6000 })
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    bus.emit('ui:toast', { kind: 'error', message: `评测异常: ${errorMsg.value}`, ttl_ms: 6000 })
  } finally {
    running.value = false
  }
}

async function abortRun(): Promise<void> {
  try {
    await window.api.eval.abort()
    bus.emit('ui:toast', { kind: 'info', message: '已请求中止评测', ttl_ms: 2000 })
  } catch {
    /* ignore */
  }
}

async function clearHistory(): Promise<void> {
  if (!confirm('清空所有评测历史？此操作不可撤销')) return
  await window.api.eval.clearHistory()
  await refreshHistory()
}

function tsLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function scoreClass(score: number): string {
  if (score >= 90) return 'score-good'
  if (score >= 70) return 'score-ok'
  return 'score-bad'
}

onMounted(() => {
  void refreshHistory()
  unsubscribeProgress = window.api.eval.onProgress((p) => {
    progress.value = {
      done: p.done,
      total: p.total,
      ...(p.current ? { current_id: p.current.question_id, current_score: p.current.score } : {}),
    }
  })
})

onBeforeUnmount(() => {
  unsubscribeProgress?.()
  unsubscribeProgress = null
})
</script>

<template>
  <section class="eval-runner">
    <h3>角色一致性测试 <span class="beta-tag">P1 K</span></h3>
    <p class="hint">
      50 道分 7 类的角色保真度题（identity / personality / speech / boundary / emotional 等）。
      每次跑约 5-25 分钟（取决于 LLM 速度）— 用来量化 soul yaml 在当前 LLM 下的保真度，
      切换 LLM 模型或修改 soul 后跑可以发现 drift。
    </p>

    <div class="run-controls">
      <label class="limit-row">
        题数限制：
        <input
          v-model.number="limitInput"
          type="number"
          min="1"
          max="50"
          placeholder="全 50"
          class="num-input"
          :disabled="running"
        />
        <span class="hint-tiny">空 = 全 50</span>
      </label>

      <button v-if="!running" class="primary run-btn" @click="startRun">
        ▶ 运行评测
      </button>
      <button v-else class="ghost run-btn" @click="abortRun">⏹ 中止</button>
    </div>

    <!-- 进度 -->
    <div v-if="running" class="progress-block">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
      <div class="progress-row">
        <span class="progress-text">{{ progress.done }} / {{ progress.total }} ({{ progressPct }}%)</span>
        <span v-if="progress.current_id" class="current-q">
          当前: {{ progress.current_id }}
          <span v-if="progress.current_score !== undefined" :class="scoreClass(progress.current_score)">
            ({{ progress.current_score }})
          </span>
        </span>
      </div>
    </div>

    <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

    <!-- 当次完成报告 -->
    <div v-if="report" class="report-card">
      <h4>本次结果</h4>
      <div class="report-headline">
        <span :class="['avg-big', scoreClass(report.avg_score)]">{{ report.avg_score }}</span>
        <span class="avg-unit">/ 100</span>
        <span class="report-model">on {{ report.model }}</span>
      </div>
      <div class="cat-grid">
        <div v-for="(stats, cat) in report.by_category" :key="cat" class="cat-cell">
          <div class="cat-name">{{ cat }}</div>
          <div :class="['cat-score', scoreClass(stats.avg)]">{{ stats.avg }}</div>
          <div class="cat-count">{{ stats.count }} 题</div>
        </div>
      </div>
      <div v-if="report.failures.length > 0" class="failures-block">
        <h5>失败题 ({{ report.failures.length }})</h5>
        <details v-for="f in report.failures.slice(0, 5)" :key="f.question_id">
          <summary>
            <span class="fail-id">{{ f.question_id }}</span>
            <span class="fail-cat">{{ f.category }}</span>
            <span :class="['fail-score', scoreClass(f.score)]">{{ f.score }}</span>
          </summary>
          <div class="fail-detail">
            <div class="fail-q"><strong>Q:</strong> {{ f.prompt }}</div>
            <div class="fail-a"><strong>A:</strong> {{ f.answer_text }}</div>
            <div v-if="f.breakdown.forbidden_violations.length" class="fail-violations">
              <strong>违禁词:</strong>
              <span v-for="v in f.breakdown.forbidden_violations" :key="v" class="violation">{{ v }}</span>
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- 历史 -->
    <div class="history-block">
      <div class="history-head">
        <h4>历史 (最近 {{ history.length }})</h4>
        <button v-if="history.length > 0" class="ghost-tiny" @click="clearHistory">清空</button>
      </div>
      <div v-if="history.length === 0" class="hint">还没跑过评测。</div>
      <div v-else class="history-list">
        <div v-for="(h, i) in history" :key="h.ts" class="history-row">
          <span class="history-ts">{{ tsLabel(h.ts) }}</span>
          <span :class="['history-avg', scoreClass(h.avg_score)]">{{ h.avg_score }}</span>
          <span class="history-model">{{ h.model }}</span>
          <span v-if="h.failure_count > 0" class="history-fail">{{ h.failure_count }} 失败</span>
          <!-- mini trend: 跟前一次比较 -->
          <span
            v-if="i + 1 < history.length"
            :class="['trend', h.avg_score > history[i + 1]!.avg_score ? 'up' : h.avg_score < history[i + 1]!.avg_score ? 'down' : 'flat']"
          >
            {{ h.avg_score > history[i + 1]!.avg_score ? '↑' : h.avg_score < history[i + 1]!.avg_score ? '↓' : '→' }}
            {{ Math.abs(h.avg_score - history[i + 1]!.avg_score) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.eval-runner {
  padding-top: 16px;
}
.eval-runner h3 {
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
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: 999px;
}
.hint {
  margin: 4px 0 10px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  line-height: 1.5;
}
.run-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0 12px;
}
.limit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--color-muted);
}
.num-input {
  width: 60px;
  padding: 4px 8px;
  font-size: var(--text-xs);
}
.hint-tiny {
  font-size: 10px;
  color: var(--color-muted);
}
.run-btn {
  margin-left: auto;
  padding: 6px 18px;
  border-radius: var(--radius-pill);
  font-weight: 600;
  font-size: var(--text-sm);
}
.run-btn.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.progress-block {
  margin: 12px 0;
}
.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--color-divider);
  border-radius: 999px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 999px;
  transition: width var(--duration-fast);
}
.progress-row {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--color-muted);
}
.error-banner {
  margin: 8px 0;
  padding: 8px 12px;
  background: oklch(95% 0.05 25 / 0.4);
  border: 1px solid oklch(60% 0.22 25 / 0.4);
  border-radius: var(--radius-sm);
  color: oklch(40% 0.2 25);
  font-size: var(--text-xs);
}

.report-card {
  margin: 14px 0;
  padding: 12px 14px;
  background: oklch(97% 0.005 250);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
}
.report-card h4,
.report-card h5 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  font-weight: 700;
}
.report-headline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 10px;
}
.avg-big {
  font-size: 32px;
  font-weight: 700;
  font-feature-settings: 'tnum';
}
.avg-unit {
  font-size: 14px;
  color: var(--color-muted);
}
.report-model {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 6px;
  margin: 8px 0;
}
.cat-cell {
  padding: 6px 8px;
  background: var(--color-bubble);
  border-radius: var(--radius-sm);
  text-align: center;
}
.cat-name {
  font-size: 10px;
  color: var(--color-muted);
  text-transform: capitalize;
}
.cat-score {
  font-size: 18px;
  font-weight: 700;
  margin: 2px 0;
}
.cat-count {
  font-size: 10px;
  color: var(--color-muted);
}
.failures-block {
  margin-top: 10px;
}
.failures-block summary {
  cursor: pointer;
  padding: 4px 0;
  font-size: var(--text-xs);
  display: flex;
  align-items: center;
  gap: 8px;
}
.fail-id {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 600;
}
.fail-cat {
  color: var(--color-muted);
  font-size: 11px;
}
.fail-score {
  margin-left: auto;
  font-weight: 600;
}
.fail-detail {
  margin: 4px 0 8px 14px;
  padding: 6px 8px;
  background: var(--color-bubble);
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.5;
}
.fail-q,
.fail-a {
  margin: 2px 0;
}
.fail-violations {
  margin-top: 4px;
  color: oklch(50% 0.2 25);
}
.violation {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 4px;
  background: oklch(95% 0.05 25 / 0.5);
  border-radius: 999px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
}

.score-good {
  color: oklch(55% 0.18 140);
}
.score-ok {
  color: oklch(60% 0.16 80);
}
.score-bad {
  color: oklch(55% 0.2 25);
}

.history-block {
  margin: 14px 0 0;
}
.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.history-head h4 {
  margin: 0;
  font-size: var(--text-sm);
}
.ghost-tiny {
  font-size: 11px;
  color: var(--color-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.ghost-tiny:hover {
  color: oklch(50% 0.2 25);
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--color-bubble);
  border-radius: var(--radius-sm);
  font-size: 11px;
}
.history-ts {
  width: 70px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: var(--color-muted);
}
.history-avg {
  font-size: 16px;
  font-weight: 700;
  font-feature-settings: 'tnum';
  width: 36px;
  text-align: center;
}
.history-model {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-fail {
  color: oklch(55% 0.2 25);
  font-size: 10px;
}
.trend {
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.trend.up {
  color: oklch(55% 0.18 140);
}
.trend.down {
  color: oklch(55% 0.2 25);
}
.trend.flat {
  color: var(--color-muted);
}
</style>
