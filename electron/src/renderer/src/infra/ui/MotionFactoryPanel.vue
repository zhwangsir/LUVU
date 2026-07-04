<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import type { ModelMotionSummary, MotionDraft } from '@shared/motion'

const emit = defineEmits<{ (e: 'close'): void }>()

const cfg = useConfigStore()

const selectedDir = ref<string>('')
const summary = ref<ModelMotionSummary | null>(null)
const description = ref('')
const style = ref('')
const generating = ref(false)
const draft = ref<MotionDraft | null>(null)
const draftRaw = ref('')
const writing = ref(false)
const introspecting = ref(false)
const semanticsReport = ref<string>('')

// 只列「可用 cubism4」
const modelOptions = computed(() =>
  cfg.models
    .filter((m) => m.cubism === 'cubism4' && m.meta?.has_core)
    .map((m) => ({
      value: m.dir,
      label: `${m.meta?.recommended ? '⭐ ' : ''}${m.display}${
        m.meta?.motion_count != null ? ` · ${m.meta.motion_count} 现有动作` : ''
      }`,
      absolute: m.absolute_path,
    })),
)

watch(
  selectedDir,
  async (dir) => {
    if (!dir) {
      summary.value = null
      semanticsReport.value = ''
      return
    }
    const opt = modelOptions.value.find((o) => o.value === dir)
    if (!opt) return
    const modelDirAbs = opt.absolute.replace(/\/[^/]+\.model3\.json$/i, '')
    try {
      summary.value = await window.api.motion.summarize(modelDirAbs)
    } catch (e) {
      bus.emit('ui:toast', { kind: 'error', message: `分析模型失败：${String(e)}`, ttl_ms: 6000 })
    }
  },
)

async function runIntrospect(): Promise<void> {
  if (!selectedDir.value) return
  const opt = modelOptions.value.find((o) => o.value === selectedDir.value)
  if (!opt) return
  const modelDirAbs = opt.absolute.replace(/\/[^/]+\.model3\.json$/i, '')
  introspecting.value = true
  try {
    semanticsReport.value = await window.api.motion.introspectDebug(modelDirAbs)
  } catch (e) {
    bus.emit('ui:toast', { kind: 'error', message: `语义分析失败：${String(e)}`, ttl_ms: 6000 })
  } finally {
    introspecting.value = false
  }
}

const examples = [
  '温柔点头',
  '害羞低头',
  '听到夸奖时眼睛弯起来微笑',
  '生气鼓脸',
  '兴奋地举起手',
  '困倦地揉眼睛',
  '撒娇歪头',
  '惊讶张嘴',
]

function pickExample(t: string): void {
  description.value = t
}

async function generate(): Promise<void> {
  if (!selectedDir.value || !description.value.trim()) return
  generating.value = true
  draft.value = null
  draftRaw.value = ''
  try {
    const opt = modelOptions.value.find((o) => o.value === selectedDir.value)
    if (!opt) throw new Error('模型未选')
    const modelDirAbs = opt.absolute.replace(/\/[^/]+\.model3\.json$/i, '')
    const styleVal = style.value.trim() || undefined
    const r = await window.api.motion.generate({
      model_dir: modelDirAbs,
      description: description.value.trim(),
      ...(styleVal !== undefined ? { style: styleVal } : {}),
      examples: 2,
    })
    if (!r.ok || !r.draft) {
      // 把详细 reason 同时展示到 draftRaw 区域，方便用户读完整错误信息
      const detail = r.reason ?? '生成失败（无详细原因）'
      bus.emit('ui:toast', { kind: 'error', message: detail.slice(0, 200), ttl_ms: 10000 })
      draftRaw.value = `❌ 生成失败：\n\n${detail}\n\n请到「设置」检查 LLM 配置后重试。`
      return
    }
    draft.value = r.draft
    draftRaw.value = JSON.stringify(r.draft, null, 2)
    bus.emit('ui:toast', { kind: 'success', message: '已生成草稿，preview 后可保存', ttl_ms: 3000 })
  } finally {
    generating.value = false
  }
}

async function saveDraft(): Promise<void> {
  if (!draft.value || !selectedDir.value) return
  writing.value = true
  try {
    const opt = modelOptions.value.find((o) => o.value === selectedDir.value)
    if (!opt) return
    // v0.8.2: draft.value 是 Vue reactive Proxy，IPC structuredClone 不能直接传
    // 用 JSON 一次转成纯 plain object
    const r = await window.api.motion.write({
      model_json_path: opt.absolute,
      draft: JSON.parse(JSON.stringify(draft.value)),
      group: 'Generated',
    })
    if (r.ok) {
      bus.emit('ui:toast', {
        kind: 'success',
        message: `已写入：${r.motion_path?.split('/').pop()}（已自动重载模型）`,
        ttl_ms: 5000,
      })
      // 重新汇总
      if (selectedDir.value) {
        const modelDirAbs = opt.absolute.replace(/\/[^/]+\.model3\.json$/i, '')
        summary.value = await window.api.motion.summarize(modelDirAbs)
      }
      draft.value = null
      draftRaw.value = ''
      // v0.8.2: 自动重载 Live2D 模型让新 motion 立刻生效
      await cfg.rescanModels()
      bus.emit('avatar:reload-model')
    } else {
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '写入失败', ttl_ms: 8000 })
    }
  } finally {
    writing.value = false
  }
}

onMounted(() => {
  // 默认选当前 soul 用的模型
  selectedDir.value = cfg.soul?.avatar.model_dir ?? modelOptions.value[0]?.value ?? ''
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel">
      <header>
        <h2>🎬 动作工坊 <span class="beta">实验</span></h2>
        <button class="close" @click="emit('close')">×</button>
      </header>

      <section>
        <label>
          <span>目标模型</span>
          <select v-model="selectedDir">
            <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <p v-if="summary" class="hint">
          已有 {{ summary.motions.length }} 个动作 · {{ summary.params.length }} 个可调参数
          <span v-if="summary.params.length === 0" class="warn">
            ⚠ 该模型无任何示例动作，生成可能不准；先用 Editor 做 1-2 个示例</span
          >
        </p>
        <div class="row">
          <button class="ghost" :disabled="introspecting || !selectedDir" @click="runIntrospect">
            {{ introspecting ? '分析中…' : '🔬 语义分析（看 LLM 看到啥）' }}
          </button>
        </div>
        <pre v-if="semanticsReport" class="json-edit small">{{ semanticsReport }}</pre>
      </section>

      <section>
        <label>
          <span>描述</span>
          <textarea
            v-model="description"
            rows="2"
            placeholder="想让她做什么动作？例如「温柔地点头」"
            class="big"
          />
        </label>
        <div class="row examples">
          <button
            v-for="ex in examples"
            :key="ex"
            class="chip"
            @click="pickExample(ex)"
            :disabled="generating"
          >
            {{ ex }}
          </button>
        </div>
        <label>
          <span>风格</span>
          <input
            v-model="style"
            type="text"
            placeholder="（可选）如「优雅」/「俏皮」/「夸张」..."
          />
        </label>
        <div class="row">
          <button
            class="primary"
            :disabled="generating || writing || !selectedDir || !description.trim()"
            @click="generate"
          >
            {{ generating ? '生成中…（调用 LLM）' : '🪄 生成动作' }}
          </button>
        </div>
      </section>

      <section v-if="draftRaw">
        <h3>预览（编辑后保存）</h3>
        <textarea v-model="draftRaw" class="json-edit" rows="10" />
        <p class="hint">
          可手动微调 keyframes 数值；time 单位秒，value 必须在参数 min/max 范围内
        </p>
        <div class="row">
          <button class="ghost" @click="draft = null; draftRaw = ''">放弃</button>
          <button class="primary" :disabled="writing" @click="saveDraft">
            {{ writing ? '保存中…' : '💾 保存到模型' }}
          </button>
        </div>
        <p class="hint">
          保存后会写入 motions/ 目录 + 自动更新 model3.json 的 Motions 列表。
          重载模型可让 pixi 重新加载（设置面板 → 重扫 → 切回此模型）。
        </p>
      </section>

      <footer>
        <button class="ghost" @click="emit('close')">关闭</button>
      </footer>
    </div>
  </div>
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
  backdrop-filter: blur(3px);
  animation: fadein var(--duration-fast) var(--ease-out-expo);
  z-index: 1850;
}
@keyframes fadein {
  from { opacity: 0; } to { opacity: 1; }
}
.panel {
  width: min(540px, 94vw);
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
}
.beta {
  font-size: var(--text-xs);
  background: oklch(94% 0.05 80 / 0.7);
  color: oklch(45% 0.12 80);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-weight: 500;
  margin-left: 8px;
}
.close {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 18px;
  color: var(--color-muted);
}
.close:hover { background: oklch(95% 0.015 25 / 0.6); }
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
section h3 {
  margin: 0 0 4px;
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accent);
}
label {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: start;
  gap: 10px;
}
label > span {
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding-top: 6px;
}
input, select, textarea {
  font: inherit;
  font-size: var(--text-sm);
  padding: 6px 10px;
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-sm);
  background: white;
  color: var(--color-bubble-text);
  outline: none;
  resize: none;
  transition: border-color var(--duration-fast);
  width: 100%;
}
input:focus, select:focus, textarea:focus { border-color: var(--color-accent); }
.big { min-height: 60px; }
.json-edit {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
}
pre.json-edit {
  background: oklch(94% 0.012 25 / 0.6);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 30vh;
  overflow-y: auto;
  margin: 0;
}
.small {
  font-size: 10px;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.examples {
  margin-left: 90px;
}
.chip {
  font-size: var(--text-xs);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
  border: 1px solid transparent;
  transition: all var(--duration-fast);
}
.chip:hover:not(:disabled) {
  background: oklch(90% 0.05 25 / 0.7);
  border-color: var(--color-accent);
}
.ghost, .primary {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
}
.ghost {
  background: oklch(95% 0.012 25 / 0.7);
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.hint {
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin: 4px 0;
}
.warn {
  color: oklch(45% 0.15 25);
  display: block;
  margin-top: 4px;
}
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  border-top: 1px solid var(--color-bubble-border);
  padding-top: 12px;
}
</style>
