<script setup lang="ts">
/**
 * v0.16 T5: Live2D 模型完整度仪表盘。
 *
 * - 全库统计 + grade A/B/C/D 分布
 * - 每模型评分 + 缺失项
 * - 批量补全：一键给所有 < B 级模型补 motion + expression + physics
 * - 单模型详情面板
 */
import { computed, onMounted, ref } from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'

const emit = defineEmits<{ (e: 'close'): void }>()

const cfg = useConfigStore()

interface ModelReport {
  dir: string
  display: string
  model_path: string
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  missing_motion_groups: string[]
  missing_expression_names: string[]
  missing_physics: boolean
  missing_eye_blink: boolean
  missing_lip_sync: boolean
  hints: string[]
}

const loading = ref(true)
const reports = ref<ModelReport[]>([])
const learningsLoading = ref(false)
const selected = ref<ModelReport | null>(null)
const filter = ref<'all' | 'A' | 'B' | 'C' | 'D' | 'missing_motion' | 'missing_exp' | 'missing_physics'>('all')
const bulkRunning = ref(false)
const bulkProgress = ref({ done: 0, total: 0, current: '' })

async function loadLearnings(): Promise<void> {
  learningsLoading.value = true
  try {
    let l = await window.api.models.getLearnings()
    if (!l) {
      bus.emit('ui:toast', { kind: 'info', message: '首次扫描全库学习数据（约 30 秒）...', ttl_ms: 5000 })
      l = await window.api.models.computeLearnings(false)
    }
    bus.emit('ui:toast', {
      kind: 'success',
      message: `学习库 ready: ${l.total_models} 模型, ${l.standard_motion_groups.length} 标准 motion`,
      ttl_ms: 4000,
    })
  } finally {
    learningsLoading.value = false
  }
}

async function evaluateAll(): Promise<void> {
  loading.value = true
  try {
    const models = cfg.models.filter((m) => m.cubism === 'cubism4' && m.meta?.has_core)
    const out: ModelReport[] = []
    // 分批：每 10 个 await yield 一次防止 UI 阻塞
    for (let i = 0; i < models.length; i++) {
      const m = models[i]!
      try {
        const r = await window.api.models.evaluate({ model_json_path: m.absolute_path })
        if (r) {
          out.push({
            dir: m.dir,
            display: m.display,
            model_path: m.absolute_path,
            score: r.score,
            grade: r.grade,
            missing_motion_groups: r.missing_motion_groups,
            missing_expression_names: r.missing_expression_names,
            missing_physics: r.missing_physics,
            missing_eye_blink: r.missing_eye_blink,
            missing_lip_sync: r.missing_lip_sync,
            hints: r.hints,
          })
        }
      } catch {
        /* skip 单模型错误 */
      }
      if (i % 10 === 0) await new Promise((res) => setTimeout(res, 0))
    }
    reports.value = out.sort((a, b) => a.score - b.score)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (cfg.models.length === 0) await cfg.rescanModels()
  await loadLearnings()
  await evaluateAll()
})

const filtered = computed(() => {
  if (filter.value === 'all') return reports.value
  if (filter.value === 'A' || filter.value === 'B' || filter.value === 'C' || filter.value === 'D') {
    return reports.value.filter((r) => r.grade === filter.value)
  }
  if (filter.value === 'missing_motion') return reports.value.filter((r) => r.missing_motion_groups.length > 0)
  if (filter.value === 'missing_exp') return reports.value.filter((r) => r.missing_expression_names.length > 0)
  if (filter.value === 'missing_physics') return reports.value.filter((r) => r.missing_physics)
  return reports.value
})

const stats = computed(() => {
  const total = reports.value.length
  const byGrade = { A: 0, B: 0, C: 0, D: 0 } as Record<'A' | 'B' | 'C' | 'D', number>
  let missingMotion = 0
  let missingExp = 0
  let missingPhysics = 0
  for (const r of reports.value) {
    byGrade[r.grade]++
    if (r.missing_motion_groups.length > 0) missingMotion++
    if (r.missing_expression_names.length > 0) missingExp++
    if (r.missing_physics) missingPhysics++
  }
  return {
    total,
    byGrade,
    avgScore: total > 0 ? Math.round(reports.value.reduce((s, r) => s + r.score, 0) / total) : 0,
    missingMotion,
    missingExp,
    missingPhysics,
  }
})

const gradeColor: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'oklch(58% 0.18 145)',
  B: 'oklch(70% 0.15 100)',
  C: 'oklch(72% 0.16 50)',
  D: 'oklch(60% 0.22 25)',
}

async function bulkFillBelow(grade: 'C' | 'D'): Promise<void> {
  const targets = reports.value.filter((r) => (grade === 'D' ? r.grade === 'D' : r.grade === 'C' || r.grade === 'D'))
  if (targets.length === 0) {
    bus.emit('ui:toast', { kind: 'info', message: `没有 ${grade} 级模型可补`, ttl_ms: 2500 })
    return
  }
  if (!confirm(`即将批量补全 ${targets.length} 个模型（每个 30-90 秒 LLM 调用）。继续？`)) return
  bulkRunning.value = true
  bulkProgress.value = { done: 0, total: targets.length, current: '' }
  let succ = 0
  let fail = 0
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!
    bulkProgress.value = { done: i, total: targets.length, current: t.display }
    try {
      const r = await window.api.models.autoFill({ model_json_path: t.model_path })
      if (r.ok) succ++
      else fail++
    } catch {
      fail++
    }
  }
  bulkRunning.value = false
  bus.emit('ui:toast', {
    kind: 'success',
    message: `批量补全完成：${succ} 成功 / ${fail} 失败。建议刷新模型库`,
    ttl_ms: 6000,
  })
  await evaluateAll()
}

async function applyExpressions(report: ModelReport): Promise<void> {
  const r = await window.api.models.applyExpressionPack({ model_json_path: report.model_path })
  if (r.ok) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `${report.display}: 加了 ${r.added.length} expression${r.skipped.length > 0 ? `（${r.skipped.length} 已存在跳过）` : ''}`,
      ttl_ms: 4000,
    })
    await evaluateAll()
  }
}

async function applyPhysics(report: ModelReport, presetId: string): Promise<void> {
  const r = await window.api.models.applyPhysicsPreset({ model_json_path: report.model_path, preset_id: presetId })
  if (r.ok) {
    bus.emit('ui:toast', { kind: 'success', message: `${report.display}: 应用物理预设 ${presetId}`, ttl_ms: 3000 })
    await evaluateAll()
  }
}
</script>

<template>
  <FloatingPanel
    storage-key="model-health-dashboard"
    title="🔬 Live2D 模型健康仪表盘"
    theme="dark"
    :defaults="{ width: 1100, height: 800 }"
    @close="emit('close')"
  >
    <div class="dash-body">
      <div v-if="loading || learningsLoading" class="loading">
          {{ learningsLoading ? '加载行业标准学习库...' : `评估中... (${reports.length}/${cfg.models.length})` }}
        </div>

        <template v-else>
          <!-- 全库统计 -->
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-num">{{ stats.total }}</div>
              <div class="stat-label">总模型数</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.avgScore }}</div>
              <div class="stat-label">平均评分</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.missingMotion }}</div>
              <div class="stat-label">缺 motion</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.missingExp }}</div>
              <div class="stat-label">缺 expression</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.missingPhysics }}</div>
              <div class="stat-label">缺 physics</div>
            </div>
          </div>

          <!-- Grade 分布 -->
          <div class="grade-row">
            <button
              v-for="g in (['A', 'B', 'C', 'D'] as const)"
              :key="g"
              :class="['grade-pill', { active: filter === g }]"
              :style="{ '--gc': gradeColor[g] }"
              @click="filter = filter === g ? 'all' : g"
            >
              <span class="grade-letter">{{ g }}</span>
              <span class="grade-count">{{ stats.byGrade[g] }}</span>
            </button>
            <span class="spacer"></span>
            <button class="bulk-btn" :disabled="bulkRunning" @click="bulkFillBelow('D')">
              {{ bulkRunning ? `补全中 ${bulkProgress.done}/${bulkProgress.total}` : '🪄 批量补全所有 D 级' }}
            </button>
          </div>
          <div v-if="bulkRunning" class="bulk-progress">
            当前: {{ bulkProgress.current }}
          </div>

          <!-- Filter tabs -->
          <div class="filter-tabs">
            <button :class="['filter-tab', { active: filter === 'all' }]" @click="filter = 'all'">
              全部 ({{ stats.total }})
            </button>
            <button :class="['filter-tab', { active: filter === 'missing_motion' }]" @click="filter = 'missing_motion'">
              缺 motion ({{ stats.missingMotion }})
            </button>
            <button :class="['filter-tab', { active: filter === 'missing_exp' }]" @click="filter = 'missing_exp'">
              缺 exp ({{ stats.missingExp }})
            </button>
            <button :class="['filter-tab', { active: filter === 'missing_physics' }]" @click="filter = 'missing_physics'">
              缺 physics ({{ stats.missingPhysics }})
            </button>
          </div>

          <!-- 模型列表 -->
          <div class="model-list">
            <div
              v-for="r in filtered.slice(0, 100)"
              :key="r.model_path"
              :class="['model-row', { selected: selected === r }]"
              @click="selected = selected === r ? null : r"
            >
              <span class="row-grade" :style="{ background: gradeColor[r.grade], color: 'white' }">
                {{ r.grade }}
              </span>
              <span class="row-name">{{ r.display }}</span>
              <span class="row-score">{{ r.score }}</span>
              <span class="row-hints">{{ r.hints.length > 0 ? r.hints[0] : '✓ 完整' }}</span>
            </div>
            <div v-if="filtered.length > 100" class="more-hint">
              ... 还有 {{ filtered.length - 100 }} 个，请用 filter 缩小
            </div>
          </div>

          <!-- 选中详情 + 一键操作 -->
          <div v-if="selected" class="detail-panel">
            <h3>{{ selected.display }} — {{ selected.score }} 分 ({{ selected.grade }})</h3>
            <div class="hints-list">
              <div v-for="h in selected.hints" :key="h" class="hint-item">• {{ h }}</div>
            </div>
            <div class="actions">
              <button v-if="selected.missing_expression_names.length > 0" class="action-btn" @click="applyExpressions(selected)">
                🎭 加 8 标准 expression
              </button>
              <button v-if="selected.missing_physics" class="action-btn" @click="applyPhysics(selected, 'long_hair')">
                💨 应用长发物理
              </button>
              <button v-if="selected.missing_physics" class="action-btn" @click="applyPhysics(selected, 'short_hair')">
                💨 应用短发物理
              </button>
            </div>
          </div>
        </template>
      </div>
  </FloatingPanel>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: oklch(0% 0 0 / 0.55); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
}
.card {
  width: 92%; max-width: 900px; max-height: 90vh;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column;
  backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid var(--color-divider);
}
h2 { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.x-btn { width: 28px; height: 28px; border-radius: 999px; color: var(--color-muted); }
.x-btn:hover { background: var(--color-bubble-surface-hover); color: var(--color-bubble-text); }

.loading {
  padding: 60px 20px; text-align: center; color: var(--color-muted);
  font-size: var(--text-sm);
}

.stats-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
  padding: 14px 20px 8px;
}
.stat-card {
  padding: 10px 12px; background: var(--color-bubble-surface);
  border-radius: var(--radius-md); text-align: center;
}
.stat-num {
  font-size: 20px; font-weight: 700; color: var(--color-accent);
  font-feature-settings: 'tnum';
}
.stat-label { font-size: 10px; color: var(--color-muted); margin-top: 2px; }

.grade-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; border-bottom: 1px solid var(--color-divider);
}
.grade-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 999px;
  background: var(--color-bubble-surface); border: 1px solid var(--gc); color: var(--gc);
  font-size: var(--text-xs); font-weight: 600;
  transition: all var(--duration-fast);
}
.grade-pill.active { background: var(--gc); color: white; }
.grade-letter { font-weight: 700; }
.grade-count { font-feature-settings: 'tnum'; }
.spacer { flex: 1; }
.bulk-btn {
  padding: 6px 12px; border-radius: var(--radius-pill);
  background: var(--color-accent); color: var(--color-accent-text);
  font-size: var(--text-xs); font-weight: 600;
}
.bulk-btn:hover:not(:disabled) { background: var(--color-accent-hover); transform: translateY(-1px); }
.bulk-btn:disabled { opacity: 0.5; }
.bulk-progress {
  padding: 4px 20px; font-size: 10px; color: var(--color-muted);
  border-bottom: 1px solid var(--color-divider);
}

.filter-tabs {
  display: flex; gap: 4px; padding: 8px 20px 0;
  border-bottom: 1px solid var(--color-divider);
}
.filter-tab {
  padding: 6px 12px; font-size: var(--text-xs);
  border-radius: 6px 6px 0 0; color: var(--color-muted);
}
.filter-tab.active { color: var(--color-accent); background: var(--color-bubble-surface); font-weight: 600; }

.model-list {
  flex: 1; overflow-y: auto; padding: 8px 20px;
}
.model-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: var(--radius-sm);
  cursor: pointer; transition: background var(--duration-fast);
}
.model-row:hover { background: var(--color-bubble-surface); }
.model-row.selected { background: var(--color-accent-soft); }
.row-grade {
  width: 24px; height: 24px; display: inline-flex; align-items: center;
  justify-content: center; border-radius: 6px;
  font-weight: 700; font-size: 12px; flex-shrink: 0;
}
.row-name { flex: 1; font-size: var(--text-sm); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.row-score {
  width: 36px; text-align: right; font-feature-settings: 'tnum';
  font-size: var(--text-xs); color: var(--color-muted); font-weight: 600;
}
.row-hints {
  flex: 0 0 240px; font-size: 10px; color: var(--color-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.more-hint { padding: 10px; text-align: center; color: var(--color-muted); font-size: 11px; }

.detail-panel {
  padding: 12px 20px; border-top: 1px solid var(--color-divider);
  background: var(--color-bubble-surface);
}
.detail-panel h3 { margin: 0 0 8px; font-size: var(--text-sm); font-weight: 600; }
.hints-list { margin-bottom: 10px; }
.hint-item { font-size: 11px; color: var(--color-muted); line-height: 1.6; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.action-btn {
  padding: 6px 12px; border-radius: var(--radius-pill);
  background: var(--color-bubble); border: 1px solid var(--color-accent);
  color: var(--color-accent); font-size: 11px; font-weight: 600;
}
.action-btn:hover { background: var(--color-accent-soft); }

.dashboard-enter-active, .dashboard-leave-active { transition: opacity var(--duration-normal); }
.dashboard-enter-from, .dashboard-leave-to { opacity: 0; }
.dashboard-enter-active .card, .dashboard-leave-active .card { transition: transform var(--duration-normal) var(--ease-out-back); }
.dashboard-enter-from .card, .dashboard-leave-to .card { transform: scale(0.94) translateY(20px); }
</style>
