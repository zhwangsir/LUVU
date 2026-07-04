<script setup lang="ts">
/**
 * 🎨 创作工坊 — Phase 2（用 FloatingPanel 重构）
 * 5 个 tab：文生图 / 图生图 / 文生视频 / 图生视频 / 历史
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FloatingPanel from './FloatingPanel.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

type Tab = 't2i' | 'i2i' | 't2v' | 'i2v' | 'history'
const tab = ref<Tab>('t2i')

// === 全局资源 ===
const checkpoints = ref<string[]>([])
const samplers = ref<string[]>([])
const schedulers = ref<string[]>([])
const videoModels = ref<string[]>([])
const loading = ref(false)
const endpoint = ref<string>('')
const connected = ref<boolean | null>(null)
const statusError = ref<string>('')

async function refreshResources(): Promise<void> {
  loading.value = true
  try {
    const st = await window.api.comfyui.status()
    connected.value = st.ok
    endpoint.value = st.endpoint ?? ''
    statusError.value = st.error ?? ''
    if (!st.ok) return
    const [ck, sm, vm] = await Promise.all([
      window.api.comfyui.listCheckpoints(),
      window.api.comfyui.listSamplers(),
      window.api.comfyui.listVideoModels(),
    ])
    checkpoints.value = ck.items ?? []
    samplers.value = sm.samplers ?? []
    schedulers.value = sm.schedulers ?? []
    videoModels.value = vm.items ?? []
    if (!t2iForm.value.checkpoint && checkpoints.value.length > 0) {
      const pick = checkpoints.value.find((c) => /ghost|anime|noobai|animagine|pony/i.test(c)) ?? checkpoints.value[0]
      t2iForm.value.checkpoint = pick!
      i2iForm.value.checkpoint = pick!
      i2vForm.value.checkpoint = pick!
    }
    if (!t2iForm.value.sampler && samplers.value.length > 0) {
      const s = samplers.value.find((x) => x === 'euler_ancestral') ?? samplers.value[0]
      t2iForm.value.sampler = s!
      i2iForm.value.sampler = s!
      i2vForm.value.sampler = s!
    }
    if (!t2iForm.value.scheduler && schedulers.value.length > 0) {
      t2iForm.value.scheduler = 'normal'
      i2iForm.value.scheduler = 'normal'
      i2vForm.value.scheduler = 'simple'
    }
    if (!t2vForm.value.model && videoModels.value.length > 0) {
      t2vForm.value.model = videoModels.value[0]!
    }
  } finally {
    loading.value = false
  }
}

// === 表单 ===
const t2iForm = ref({
  prompt: '', negative: '', checkpoint: '',
  width: 768, height: 768, steps: 24, cfg: 7.5,
  sampler: '', scheduler: '', seed: -1,
})
const i2iForm = ref({
  prompt: '', negative: '', checkpoint: '',
  inputImage: '', inputImagePreview: '', denoise: 0.55,
  width: 768, height: 768, steps: 28, cfg: 7.5,
  sampler: '', scheduler: '', seed: -1,
})
const t2vForm = ref({
  prompt: '', model: '', seed: -1, promptExtend: true, watermark: false,
})
const i2vForm = ref({
  prompt: '', negative: '', checkpoint: '',
  inputImage: '', inputImagePreview: '',
  length: 81, width: 768, height: 432, steps: 30, cfg: 6.0,
  sampler: '', scheduler: '', seed: -1,
})

// === 状态 ===
const running = ref(false)
const lastResult = ref<{ ok: boolean; files?: string[]; error?: string } | null>(null)
const progressMsg = ref<string>('')

const progressOff = window.api.comfyui.onProgress((p) => {
  if (p.state === 'queued') progressMsg.value = '排队中…'
  else if (p.state === 'running') progressMsg.value = '生成中…'
  else if (p.state === 'done') progressMsg.value = '完成 ✓'
})
onBeforeUnmount(() => progressOff?.())

// === 上传 ===
async function pickAndUpload(target: 'i2i' | 'i2v'): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp'
  input.onchange = async (): Promise<void> => {
    const file = input.files?.[0]
    if (!file) return
    const srcPath = (file as File & { path?: string }).path
    if (!srcPath) {
      alert('无法读取文件路径（Electron 环境下应能拿到 .path）')
      return
    }
    progressMsg.value = '上传到 ComfyUI…'
    const r = await window.api.comfyui.uploadImage({ srcPath })
    if (!r.ok || !r.comfyName) {
      progressMsg.value = `上传失败: ${r.error}`
      return
    }
    progressMsg.value = ''
    const preview = `luvu-asset://${r.localCachePath}`
    if (target === 'i2i') {
      i2iForm.value.inputImage = r.comfyName
      i2iForm.value.inputImagePreview = preview
    } else {
      i2vForm.value.inputImage = r.comfyName
      i2vForm.value.inputImagePreview = preview
    }
  }
  input.click()
}

// === 生成 ===
function withSeed<T extends { seed: number }>(v: T): T {
  return v.seed < 0 ? { ...v, seed: undefined as unknown as number } : v
}

async function runT2I(): Promise<void> {
  if (!t2iForm.value.prompt.trim()) return alert('prompt 不能为空')
  if (!t2iForm.value.checkpoint) return alert('选一个 checkpoint')
  running.value = true
  progressMsg.value = '提交中…'
  try {
    const r = await window.api.comfyui.generateImage(withSeed(t2iForm.value))
    lastResult.value = r
    progressMsg.value = r.ok ? `完成 ✓ ${r.files?.length ?? 0} 张` : `失败: ${r.error}`
  } finally {
    running.value = false
  }
}

async function runI2I(): Promise<void> {
  if (!i2iForm.value.inputImage) return alert('请先上传一张图')
  if (!i2iForm.value.prompt.trim()) return alert('prompt 不能为空')
  if (!i2iForm.value.checkpoint) return alert('选一个 checkpoint')
  running.value = true
  progressMsg.value = '提交中…'
  try {
    const r = await window.api.comfyui.generateI2I(withSeed(i2iForm.value))
    lastResult.value = r
    progressMsg.value = r.ok ? `完成 ✓ ${r.files?.length ?? 0} 张` : `失败: ${r.error}`
  } finally {
    running.value = false
  }
}

async function runT2V(): Promise<void> {
  if (!t2vForm.value.prompt.trim()) return alert('prompt 不能为空')
  if (!t2vForm.value.model) return alert('选一个视频模型')
  running.value = true
  progressMsg.value = '提交中…文生视频较慢，预计 1-3 分钟'
  try {
    const r = await window.api.comfyui.generateVideoT2V(withSeed(t2vForm.value))
    lastResult.value = r
    progressMsg.value = r.ok ? `完成 ✓ ${r.files?.length ?? 0} 段` : `失败: ${r.error}`
  } finally {
    running.value = false
  }
}

async function runI2V(): Promise<void> {
  if (!i2vForm.value.inputImage) return alert('请先上传一张图')
  if (!i2vForm.value.checkpoint) return alert('选一个 checkpoint（要支持视频）')
  running.value = true
  progressMsg.value = '提交中…图生视频较慢，预计 1-3 分钟'
  try {
    const r = await window.api.comfyui.generateVideoI2V(withSeed(i2vForm.value))
    lastResult.value = r
    progressMsg.value = r.ok ? `完成 ✓ ${r.files?.length ?? 0} 段` : `失败: ${r.error}`
  } finally {
    running.value = false
  }
}

async function cancel(): Promise<void> {
  await window.api.comfyui.cancel()
  progressMsg.value = '已请求中断'
}

// === 历史 ===
type HistItem = { kind: string; path: string; mtime: number; size: number }
const history = ref<HistItem[]>([])
async function refreshHistory(): Promise<void> {
  history.value = await window.api.comfyui.listRecent('all')
}
const historyFiltered = computed(() => history.value)

function fileUrl(p: string): string { return `luvu-asset://${encodeURI(p)}` }
function isVideo(p: string): boolean { return /\.(mp4|mov|webm|webp)$/i.test(p) }
function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function formatTime(ms: number): string { return new Date(ms).toLocaleString() }

const previewItem = ref<HistItem | null>(null)
function openPreview(h: HistItem): void { previewItem.value = h }
function closePreview(): void { previewItem.value = null }

onMounted(() => {
  void refreshResources()
  void refreshHistory()
})
</script>

<template>
  <FloatingPanel
    storage-key="creator-studio"
    title="🎨 创作工坊"
    theme="dark"
    :defaults="{ width: 900, height: 720 }"
    @close="emit('close')"
  >
    <template #header-extra>
      <span :class="['dot', connected === true ? 'ok' : connected === false ? 'err' : '']" />
      <span class="ep" :title="endpoint">{{ endpoint || '未配置' }}</span>
      <button class="mini" @click="refreshResources" :disabled="loading">
        {{ loading ? '...' : '↻' }}
      </button>
    </template>

    <template #sub-header>
      <div class="tabs">
        <button :class="{ active: tab === 't2i' }" @click="tab = 't2i'">📷 文生图</button>
        <button :class="{ active: tab === 'i2i' }" @click="tab = 'i2i'">🖼️ 图生图</button>
        <button :class="{ active: tab === 't2v' }" @click="tab = 't2v'">🎬 文生视频</button>
        <button :class="{ active: tab === 'i2v' }" @click="tab = 'i2v'">🎞️ 图生视频</button>
        <button :class="{ active: tab === 'history' }" @click="(tab = 'history'), refreshHistory()">
          📋 历史
        </button>
      </div>
    </template>

    <div v-if="!connected" class="warn">
      <div v-if="statusError">⚠ ComfyUI 不可达：{{ statusError }}</div>
      <div v-else>⚠ ComfyUI endpoint 未配置或离线，去 Settings 里设 <code>comfyui_endpoint</code></div>
    </div>

    <!-- 文生图 -->
    <section v-show="tab === 't2i'" class="form">
      <label>Prompt</label>
      <textarea v-model="t2iForm.prompt" placeholder="cute anime girl, sticker style, white background, ..." rows="3" />
      <!-- v0.17：Live2D 立绘原画 quick prompt 模板 — 接 AI 原画生成 pipeline 第一步 -->
      <div class="quick-prompts">
        <span class="qp-label">🎨 快速模板</span>
        <button class="chip" @click="t2iForm.prompt = 'full body, standing, anime girl portrait, transparent background, isolated character, masterpiece, best quality, vtuber style, front facing'">Live2D 立绘</button>
        <button class="chip" @click="t2iForm.prompt = 'cute chibi anime girl, sticker, transparent background, isolated, kawaii, official art'">贴纸</button>
        <button class="chip" @click="t2iForm.prompt = 'cozy bedroom interior, anime background, warm lighting, no humans, scenery'">卧室背景</button>
        <button class="chip" @click="t2iForm.prompt = 'starry night sky, anime scenery, no humans, deep blue, magical, masterpiece'">星空背景</button>
        <button class="chip" @click="t2iForm.prompt = 'character reference sheet, multiple angles, anime girl, full body, turnaround, character design'">角色设定图</button>
      </div>
      <label>Negative (可选)</label>
      <textarea v-model="t2iForm.negative" placeholder="lowres, bad anatomy, ..." rows="2" />
      <div class="row">
        <div class="col"><label>Checkpoint</label>
          <select v-model="t2iForm.checkpoint">
            <option v-for="c in checkpoints" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="col"><label>Sampler</label>
          <select v-model="t2iForm.sampler">
            <option v-for="s in samplers" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="col"><label>Scheduler</label>
          <select v-model="t2iForm.scheduler">
            <option v-for="s in schedulers" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="col"><label>Width</label><input type="number" v-model.number="t2iForm.width" step="64" /></div>
        <div class="col"><label>Height</label><input type="number" v-model.number="t2iForm.height" step="64" /></div>
        <div class="col"><label>Steps</label><input type="number" v-model.number="t2iForm.steps" /></div>
        <div class="col"><label>CFG</label><input type="number" v-model.number="t2iForm.cfg" step="0.5" /></div>
        <div class="col"><label>Seed (-1=随机)</label><input type="number" v-model.number="t2iForm.seed" /></div>
      </div>
      <button class="primary" :disabled="running || !connected" @click="runT2I">
        {{ running ? '生成中…' : '生成图片' }}
      </button>
    </section>

    <!-- 图生图 -->
    <section v-show="tab === 'i2i'" class="form">
      <label>输入图片</label>
      <div class="img-pick">
        <img v-if="i2iForm.inputImagePreview" :src="i2iForm.inputImagePreview" class="preview" />
        <button @click="pickAndUpload('i2i')">{{ i2iForm.inputImage ? '换一张' : '选择图片' }}</button>
        <span v-if="i2iForm.inputImage" class="upload-name">已上传: {{ i2iForm.inputImage }}</span>
      </div>
      <label>Prompt</label>
      <textarea v-model="i2iForm.prompt" rows="3" />
      <label>Negative (可选)</label>
      <textarea v-model="i2iForm.negative" rows="2" />
      <div class="row">
        <div class="col"><label>Checkpoint</label>
          <select v-model="i2iForm.checkpoint">
            <option v-for="c in checkpoints" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="col"><label>Denoise (0=不变, 1=全新)</label>
          <input type="number" v-model.number="i2iForm.denoise" step="0.05" min="0" max="1" />
        </div>
        <div class="col"><label>Sampler</label>
          <select v-model="i2iForm.sampler">
            <option v-for="s in samplers" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="col"><label>Steps</label><input type="number" v-model.number="i2iForm.steps" /></div>
        <div class="col"><label>CFG</label><input type="number" v-model.number="i2iForm.cfg" step="0.5" /></div>
        <div class="col"><label>Seed</label><input type="number" v-model.number="i2iForm.seed" /></div>
      </div>
      <button class="primary" :disabled="running || !connected || !i2iForm.inputImage" @click="runI2I">
        {{ running ? '生成中…' : '基于此图生成' }}
      </button>
    </section>

    <!-- 文生视频 -->
    <section v-show="tab === 't2v'" class="form">
      <label>Prompt（视频描述）</label>
      <textarea v-model="t2vForm.prompt" rows="4" placeholder="一只白色小猫在草地上奔跑，阳光明媚..." />
      <div class="row">
        <div class="col"><label>视频模型 (Wan2 API)</label>
          <select v-model="t2vForm.model">
            <option v-for="m in videoModels" :key="m" :value="m">{{ m }}</option>
            <option v-if="videoModels.length === 0" disabled>未发现 — 需 ComfyUI 装 Wan2 节点</option>
          </select>
        </div>
        <div class="col"><label>Seed</label><input type="number" v-model.number="t2vForm.seed" /></div>
        <div class="col"><label>Prompt Extend</label>
          <input type="checkbox" v-model="t2vForm.promptExtend" />
        </div>
        <div class="col"><label>Watermark</label><input type="checkbox" v-model="t2vForm.watermark" /></div>
      </div>
      <button class="primary" :disabled="running || !connected" @click="runT2V">
        {{ running ? '生成中…' : '生成视频（1-3 分钟）' }}
      </button>
    </section>

    <!-- 图生视频 -->
    <section v-show="tab === 'i2v'" class="form">
      <label>起始帧图片</label>
      <div class="img-pick">
        <img v-if="i2vForm.inputImagePreview" :src="i2vForm.inputImagePreview" class="preview" />
        <button @click="pickAndUpload('i2v')">{{ i2vForm.inputImage ? '换一张' : '选择图片' }}</button>
        <span v-if="i2vForm.inputImage" class="upload-name">已上传: {{ i2vForm.inputImage }}</span>
      </div>
      <label>动作描述 (可选)</label>
      <textarea v-model="i2vForm.prompt" rows="2" placeholder="人物缓慢转头，眨眼，微笑..." />
      <label>Negative (可选)</label>
      <textarea v-model="i2vForm.negative" rows="2" />
      <div class="row">
        <div class="col"><label>Checkpoint (视频)</label>
          <select v-model="i2vForm.checkpoint">
            <option v-for="c in checkpoints" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="col"><label>Length (帧)</label><input type="number" v-model.number="i2vForm.length" step="1" /></div>
        <div class="col"><label>Width</label><input type="number" v-model.number="i2vForm.width" step="64" /></div>
        <div class="col"><label>Height</label><input type="number" v-model.number="i2vForm.height" step="64" /></div>
      </div>
      <div class="row">
        <div class="col"><label>Steps</label><input type="number" v-model.number="i2vForm.steps" /></div>
        <div class="col"><label>CFG</label><input type="number" v-model.number="i2vForm.cfg" step="0.5" /></div>
        <div class="col"><label>Sampler</label>
          <select v-model="i2vForm.sampler">
            <option v-for="s in samplers" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="col"><label>Scheduler</label>
          <select v-model="i2vForm.scheduler">
            <option v-for="s in schedulers" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="col"><label>Seed</label><input type="number" v-model.number="i2vForm.seed" /></div>
      </div>
      <button class="primary" :disabled="running || !connected || !i2vForm.inputImage" @click="runI2V">
        {{ running ? '生成中…' : '基于此图生成视频（1-3 分钟）' }}
      </button>
    </section>

    <!-- 历史 -->
    <section v-show="tab === 'history'" class="history">
      <div class="hist-toolbar">
        <button @click="refreshHistory">刷新</button>
        <span class="muted">{{ history.length }} 条</span>
      </div>
      <div class="grid">
        <div v-for="h in historyFiltered" :key="h.path" class="cell" @click="openPreview(h)">
          <video v-if="isVideo(h.path)" :src="fileUrl(h.path)" muted preload="metadata" />
          <img v-else :src="fileUrl(h.path)" />
          <div class="meta">
            <span class="kind">{{ h.kind }}</span>
            <span class="size">{{ formatSize(h.size) }}</span>
            <span class="time">{{ formatTime(h.mtime) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Lightbox -->
    <div v-if="previewItem" class="lightbox" @click.self="closePreview">
      <button class="lb-close" @click="closePreview">✕</button>
      <video v-if="isVideo(previewItem.path)" :src="fileUrl(previewItem.path)" controls autoplay loop class="lb-media" />
      <img v-else :src="fileUrl(previewItem.path)" class="lb-media" />
      <div class="lb-meta">
        <span class="kind">{{ previewItem.kind }}</span>
        <span>{{ formatSize(previewItem.size) }}</span>
        <span>{{ formatTime(previewItem.mtime) }}</span>
        <code class="path">{{ previewItem.path }}</code>
      </div>
    </div>

    <template #footer>
      <div v-if="running || progressMsg || lastResult" class="ftbar">
        <span class="progress">{{ progressMsg }}</span>
        <button v-if="running" class="cancel" @click="cancel">中断</button>
        <div v-if="lastResult?.ok" class="last-files">
          最近输出: {{ lastResult.files?.length ?? 0 }} 个
          <a v-for="f in lastResult.files ?? []" :key="f" :href="fileUrl(f)" target="_blank">
            {{ f.split('/').pop() }}
          </a>
        </div>
      </div>
    </template>
  </FloatingPanel>
</template>

<style scoped>
/* 这些 class 在 FloatingPanel body 内生效 — 不与外壳样式冲突 */

/* === header-extra 部分 === */
.dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7280; }
.dot.ok { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); }
.dot.err { background: #ef4444; }
.ep {
  color: #94a3b8; font-size: 0.85em; font-family: ui-monospace, monospace;
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mini {
  background: transparent; border: 1px solid #374151; color: #d1d5db;
  padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.9em;
}
.mini:hover { background: rgba(255, 255, 255, 0.06); }

/* === Tabs === */
.tabs { display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid #2a2e3a; margin: 0 -20px -16px; }
.tabs button {
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: #9ca3af; padding: 8px 12px; cursor: pointer; font-size: 0.95em; font-weight: 500;
  transition: color 0.15s, border-color 0.15s;
}
.tabs button:hover { color: #d1d5db; }
.tabs button.active { color: #60a5fa; border-bottom-color: #60a5fa; }

.warn {
  margin: 16px 20px 0; padding: 8px 12px;
  background: rgba(251, 191, 36, 0.08); color: #fbbf24;
  font-size: 0.95em; border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.2);
}
.warn code { background: #1f2937; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }

/* === Form === */
.form, .history { padding: 16px 20px; }
.form label { display: block; font-size: 0.85em; color: #94a3b8; margin: 12px 0 4px; font-weight: 500; }
.form label:first-child { margin-top: 0; }
.form textarea,
.form input[type=number],
.form input[type=text],
.form select {
  width: 100%; background: #0a0c11; color: #e5e7eb; border: 1px solid #2a2e3a;
  border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 0.95em;
  box-sizing: border-box; transition: border-color 0.15s, background 0.15s;
}
.form textarea:focus, .form input:focus, .form select:focus {
  outline: none; border-color: #60a5fa; background: #0f1115;
}
.form textarea { resize: vertical; min-height: 56px; font-family: ui-monospace, monospace; line-height: 1.5; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row .col { flex: 1; min-width: 110px; }

.img-pick { display: flex; gap: 12px; align-items: center; padding: 8px 0; }
.preview { width: 88px; height: 88px; object-fit: contain; background: #0a0b0e; border: 1px solid #2a2e3a; border-radius: 6px; }
.img-pick button {
  padding: 6px 12px; background: #374151; color: white; border: none;
  border-radius: 6px; cursor: pointer; font-size: 0.9em;
}
.img-pick button:hover { background: #4b5563; }
.upload-name { font-size: 0.8em; color: #94a3b8; word-break: break-all; font-family: ui-monospace, monospace; }

.primary {
  margin-top: 16px; padding: 12px 20px;
  background: linear-gradient(180deg, #2563eb, #1d4ed8); color: white;
  border: none; border-radius: 6px; cursor: pointer;
  font-size: 1em; font-weight: 600; letter-spacing: 0.3px; width: 100%;
  transition: transform 0.1s, box-shadow 0.15s;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
}
.primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(37, 99, 235, 0.4); }
.primary:disabled { background: #374151; cursor: not-allowed; opacity: 0.5; box-shadow: none; transform: none; }

/* === History === */
.hist-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.hist-toolbar button {
  background: transparent; border: 1px solid #374151; color: #d1d5db;
  padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em;
}
.muted { color: #6b7280; font-size: 0.85em; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.cell {
  background: #1a1d24; border: 1px solid #2a2e3a; border-radius: 6px;
  overflow: hidden; cursor: pointer;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.cell:hover {
  transform: translateY(-2px); border-color: #60a5fa;
  box-shadow: 0 6px 16px rgba(96, 165, 250, 0.15);
}
.cell img, .cell video { width: 100%; height: 140px; object-fit: cover; background: #000; display: block; }
.meta { padding: 4px 8px; font-size: 0.78em; color: #9ca3af; display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
.meta .kind { color: #60a5fa; font-weight: 600; text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.5px; }

/* === Lightbox === */
.lightbox {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  z-index: 1100; padding: 40px; gap: 12px;
}
.lb-close {
  position: absolute; top: 20px; right: 24px;
  background: rgba(255, 255, 255, 0.1); color: white; border: none;
  width: 36px; height: 36px; border-radius: 50%; font-size: 18px; cursor: pointer;
}
.lb-close:hover { background: rgba(255, 255, 255, 0.2); }
.lb-media { max-width: 90vw; max-height: 80vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6); }
.lb-meta { display: flex; gap: 12px; font-size: 12px; color: #d1d5db; align-items: center; flex-wrap: wrap; justify-content: center; }
.lb-meta .kind { color: #60a5fa; font-weight: 600; text-transform: uppercase; font-size: 11px; }
.lb-meta .path {
  background: rgba(255, 255, 255, 0.05); padding: 2px 6px; border-radius: 3px;
  font-family: ui-monospace, monospace; font-size: 11px;
  max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* === Footer 内容 === */
.ftbar { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; }
.ftbar .progress { color: #fbbf24; font-weight: 500; }
.ftbar .cancel {
  align-self: flex-start; padding: 3px 12px;
  background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;
}
.ftbar .last-files { color: #9ca3af; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ftbar .last-files a {
  color: #60a5fa; text-decoration: none; word-break: break-all;
  padding: 1px 6px; background: rgba(96, 165, 250, 0.1); border-radius: 3px;
  font-family: ui-monospace, monospace; font-size: 0.85em;
}
.ftbar .last-files a:hover { background: rgba(96, 165, 250, 0.2); }

/* v0.17: 快速 prompt 模板 chip */
.quick-prompts {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 6px; margin: 6px 0 8px;
}
.qp-label {
  font-size: 11px; color: rgba(229, 231, 235, 0.55);
  margin-right: 4px;
}
.chip {
  padding: 4px 10px; font-size: 11px;
  background: rgba(96, 165, 250, 0.12);
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 999px;
  color: rgba(229, 231, 235, 0.85);
  cursor: pointer;
  transition: all 150ms;
}
.chip:hover {
  background: rgba(96, 165, 250, 0.25);
  border-color: rgba(96, 165, 250, 0.5);
  color: white;
}
</style>
