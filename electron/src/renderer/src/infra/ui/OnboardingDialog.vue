<script setup lang="ts">
/**
 * v0.13 首次启动引导对话框。
 *
 * 出现条件：config.json 不存在 OR llm_endpoint 为空。
 * 3 步：欢迎 → LLM 配置 → TTS 提示（可跳）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import type { RuntimeConfig } from '@shared/types'
import LlmAutoDetectPanel from './LlmAutoDetectPanel.vue'
import { useFocusTrap } from './useFocusTrap'
import { normalizeLlmEndpoint } from '../../brain/normalize-endpoint'
import { toFriendlyError } from '../friendly-error'

const emit = defineEmits<{ (e: 'close'): void }>()
const cfg = useConfigStore()

const cardRef = ref<HTMLElement | null>(null)
// 组件只在 open 时 v-if 挂载，trap 在 mount 期内常 active
const alwaysOpen = computed(() => true)
useFocusTrap(cardRef, alwaysOpen)

const step = ref<1 | 2 | 3>(1)

/** R124+R126-fix (MED): 步切换后自动 focus 主输入框, 用 data-focus-target 避免 placeholder 文本变化失焦 */
watch(step, async (s) => {
  await nextTick()
  const target = s === 2 ? 'step2' : s === 3 ? 'step3' : null
  if (!target) return
  const el = cardRef.value?.querySelector<HTMLInputElement>(`[data-focus-target="${target}"]`)
  el?.focus()
})
const llmEndpoint = ref('')
const llmModel = ref('')
const llmApiKey = ref('')
// R75: show/hide 切换, 同 SettingsPanel R74
const showApiKey = ref(false)
const ttsSidecarUrl = ref('')
const checking = ref(false)
const checkResult = ref<{ ok: boolean; message: string } | null>(null)
// R48: TTS 试听状态
const ttsTrying = ref(false)
const ttsResult = ref<{ ok: boolean; message: string } | null>(null)

interface Preset {
  id: string
  label: string
  endpoint: string
  hint: string
}
const presets: Preset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    hint: '本机 ollama serve — model 例：qwen2.5:14b',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    hint: 'LM Studio 内置 server — model 用已加载模型 id',
  },
  {
    id: 'vllm',
    label: 'vLLM / 自定义',
    endpoint: '',
    hint: 'OpenAI-compatible 任意 endpoint',
  },
]

function applyPreset(p: Preset): void {
  llmEndpoint.value = p.endpoint
  checkResult.value = null
}

/** UX R20/R28: 子组件 emit('apply') 时填表单 */
function onAutoDetectApply(payload: { endpoint: string; model: string }): void {
  llmEndpoint.value = payload.endpoint
  llmModel.value = payload.model
  checkResult.value = null
}

async function probeLlm(): Promise<void> {
  if (!llmEndpoint.value || !llmModel.value) {
    checkResult.value = { ok: false, message: '请先填 endpoint + model' }
    return
  }
  checking.value = true
  checkResult.value = null
  try {
    const r = await window.api.llm.test({
      provider: 'openai_compat',
      endpoint: llmEndpoint.value,
      model: llmModel.value,
      api_key: llmApiKey.value,
    })
    if (r.ok) {
      checkResult.value = { ok: true, message: `✓ ${r.message}` }
    } else {
      // R60: 失败时走 friendly-error 给可操作中文提示
      const fe = toFriendlyError(r.message, 'llm')
      checkResult.value = { ok: false, message: `✗ ${fe.title}：${fe.detail}` }
    }
  } catch (e) {
    const fe = toFriendlyError(e, 'llm')
    checkResult.value = { ok: false, message: `✗ ${fe.title}：${fe.detail}` }
  } finally {
    checking.value = false
  }
}

const llmReady = computed(() => checkResult.value?.ok === true)

/** R48: TTS 试听 — 本机直接 fetch sidecar / 端点，验证服务起来了 */
async function tryTts(): Promise<void> {
  const url = ttsSidecarUrl.value.trim()
  if (!url) {
    ttsResult.value = { ok: false, message: '请先填 sidecar URL' }
    return
  }
  ttsTrying.value = true
  ttsResult.value = null
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/`, {
      signal: AbortSignal.timeout(3000),
    })
    if (resp.ok) {
      ttsResult.value = { ok: true, message: `✓ 连上了（HTTP ${resp.status}）` }
    } else {
      const fe = toFriendlyError(`HTTP ${resp.status}`, 'tts')
      ttsResult.value = { ok: false, message: `✗ ${fe.title}：${fe.detail}` }
    }
  } catch (e) {
    const fe = toFriendlyError(e, 'tts')
    ttsResult.value = { ok: false, message: `✗ ${fe.title}：${fe.detail}` }
  } finally {
    ttsTrying.value = false
  }
}

async function finish(): Promise<void> {
  const base = cfg.config ?? ({} as RuntimeConfig)
  const dto: RuntimeConfig = {
    ...base,
    llm_provider: 'openai_compat',
    llm_endpoint: llmEndpoint.value,
    llm_model: llmModel.value,
    llm_api_key: llmApiKey.value,
    tts_sidecar_url: ttsSidecarUrl.value || base.tts_sidecar_url || '',
  }
  await cfg.save(dto)
  bus.emit('ui:toast', { kind: 'success', message: '配置已保存，LUVU 已准备好', ttl_ms: 4000 })
  emit('close')
}

function skip(): void {
  bus.emit('ui:toast', {
    kind: 'info',
    message: '已跳过引导。可随时右键 → 设置 修改',
    ttl_ms: 5000,
  })
  emit('close')
}
</script>

<template>
  <transition name="onboard" appear>
    <div class="overlay" @click.self="skip">
      <div ref="cardRef" class="card" role="dialog" aria-modal="true" aria-label="LUVU 首次设置">
        <header>
          <div class="step-dots">
            <span :class="['dot', { active: step === 1 }]"></span>
            <span :class="['dot', { active: step === 2 }]"></span>
            <span :class="['dot', { active: step === 3 }]"></span>
          </div>
          <button class="skip-btn" @click="skip">跳过</button>
        </header>

        <!-- Step 1: 欢迎 -->
        <div v-if="step === 1" class="body">
          <h1>欢迎来到 LUVU 💜</h1>
          <p class="lead">
            我是你的桌面 AI 伴侣。30 秒帮你配好，咱们就能开始对话了。
          </p>
          <ul class="feature-list">
            <li>🎭 1389 个 Live2D 模型 + 角色库</li>
            <li>🎙️ RVC 47 音色 + 流式 TTS</li>
            <li>🧠 本地 LLM + 主体性感知</li>
            <li>🔒 完全本地化 — 你的数据不离开本机</li>
          </ul>
          <footer>
            <button class="primary" @click="step = 2">开始配置 →</button>
          </footer>
        </div>

        <!-- Step 2: LLM 配置 -->
        <div v-if="step === 2" class="body">
          <h2>1/2 · 配 LLM endpoint</h2>

          <LlmAutoDetectPanel @apply="onAutoDetectApply" />

          <p class="hint or-hint">— 或者选个 preset / 手填 —</p>
          <div class="presets">
            <button
              v-for="p in presets"
              :key="p.id"
              class="preset-btn"
              @click="applyPreset(p)"
            >
              <span class="preset-label">{{ p.label }}</span>
              <span class="preset-hint">{{ p.hint }}</span>
            </button>
          </div>

          <label class="field">
            <span>Endpoint</span>
            <input
              v-model="llmEndpoint"
              data-focus-target="step2"
              placeholder="http://127.0.0.1:11434/v1"
              @input="checkResult = null"
              @blur="llmEndpoint = normalizeLlmEndpoint(llmEndpoint)"
            />
          </label>
          <label class="field">
            <span>Model</span>
            <input
              v-model="llmModel"
              placeholder="qwen2.5:14b"
              @input="checkResult = null"
              @keydown.enter="probeLlm"
            />
          </label>
          <label class="field">
            <span>API Key（可选）</span>
            <div class="input-with-toggle">
              <input
                v-model="llmApiKey"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="本地端点通常留空"
              />
              <button
                v-show="llmApiKey"
                type="button"
                class="toggle-show-btn"
                :disabled="!llmApiKey"
                :title="showApiKey ? '隐藏' : '显示'"
                :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'"
                :aria-pressed="showApiKey ? 'true' : 'false'"
                @click="showApiKey = !showApiKey"
              >{{ showApiKey ? '🙈' : '👁' }}</button>
            </div>
          </label>

          <div class="probe-row">
            <button class="ghost" :disabled="checking" @click="probeLlm">
              {{ checking ? '检测中…' : '🔌 检测连通' }}
            </button>
            <span v-if="checkResult" :class="['probe-status', checkResult.ok ? 'ok' : 'fail']">
              {{ checkResult.message }}
            </span>
          </div>

          <footer>
            <button class="ghost" @click="step = 1">← 返回</button>
            <button class="primary" :disabled="!llmReady" @click="step = 3">
              下一步 →
            </button>
          </footer>
        </div>

        <!-- Step 3: TTS（可选） -->
        <div v-if="step === 3" class="body">
          <h2>2/2 · 配 TTS sidecar（可选）</h2>
          <p class="hint">
            想让 LUVU 开口说话？需要先装 Python sidecar。不装也能正常文字对话。
          </p>
          <pre class="code">$ bash sidecar/install.sh
$ cd sidecar/qwen-tts-server
$ source .venv/bin/activate
$ uvicorn main:app --host 127.0.0.1 --port 8765</pre>

          <label class="field">
            <span>Sidecar URL（装好 sidecar 后填）</span>
            <input
              v-model="ttsSidecarUrl"
              data-focus-target="step3"
              placeholder="http://127.0.0.1:8765 — 留空则不启用 TTS"
              @input="ttsResult = null"
              @keydown.enter="finish"
            />
          </label>

          <div v-if="ttsSidecarUrl.trim()" class="probe-row">
            <button class="ghost" :disabled="ttsTrying" @click="tryTts">
              {{ ttsTrying ? '检测中…' : '🔊 检测 sidecar 连通' }}
            </button>
            <span v-if="ttsResult" :class="['probe-status', ttsResult.ok ? 'ok' : 'fail']">
              {{ ttsResult.message }}
            </span>
          </div>

          <footer>
            <button class="ghost" @click="step = 2">← 返回</button>
            <button class="primary strong" @click="finish">完成 ✓</button>
          </footer>
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
  z-index: 2000;
  backdrop-filter: blur(6px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 520px;
  max-height: 86vh;
  overflow: auto;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
.step-dots {
  display: flex;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-divider);
  transition: all var(--duration-normal) var(--ease-out-back);
}
.dot.active {
  background: var(--color-accent);
  width: 20px;
  border-radius: var(--radius-pill);
}
.skip-btn {
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: transparent;
  padding: 4px 8px;
}
.skip-btn:hover {
  color: var(--color-bubble-text);
}
.body {
  padding: 22px 24px 18px;
}
h1 {
  font-size: var(--text-xl);
  margin: 0 0 10px;
  font-weight: 700;
}
h2 {
  font-size: var(--text-lg);
  margin: 0 0 6px;
  font-weight: 600;
}
.lead {
  margin: 0 0 16px;
  font-size: var(--text-base);
  line-height: 1.55;
  color: var(--color-muted);
}
.hint {
  margin: 0 0 14px;
  font-size: var(--text-sm);
  color: var(--color-muted);
  line-height: 1.55;
}
.feature-list {
  list-style: none;
  padding: 0;
  margin: 0 0 18px;
}
.feature-list li {
  padding: 6px 0;
  font-size: var(--text-sm);
}
.or-hint {
  margin: 8px 0 8px;
  font-size: 11px;
  text-align: center;
  color: var(--color-muted);
}
.presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  text-align: left;
  transition: background var(--duration-fast), border-color var(--duration-fast),
    transform var(--duration-fast);
  border: 1px solid transparent;
}
.preset-btn:hover {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent);
  transform: translateY(-1px);
}
.preset-label {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-bottom: 2px;
}
.preset-hint {
  font-size: 10px;
  color: var(--color-muted);
  line-height: 1.3;
}
.field {
  display: block;
  margin-bottom: 10px;
}
.field span {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin-bottom: 4px;
}
.field input {
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-bubble-border);
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
/* R80: .input-with-toggle 已提到 global.css 共享 */

.field input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus);
}
.code {
  margin: 0 0 14px;
  padding: 12px 14px;
  background: oklch(18% 0.01 25 / 0.95);
  color: oklch(92% 0.04 145);
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  border: 1px solid oklch(0% 0 0 / 0.1);
}
.probe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 10px;
}
.probe-status {
  font-size: var(--text-xs);
}
.probe-status.ok {
  color: var(--color-success);
  font-weight: 500;
}
.probe-status.fail {
  color: var(--color-danger);
  font-weight: 500;
}
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 18px;
}
.ghost,
.primary {
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--duration-fast);
}
.ghost {
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
}
.ghost:hover {
  background: var(--color-bubble-surface-hover);
}
.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.primary.strong {
  background: oklch(55% 0.2 145);
}

.onboard-enter-active,
.onboard-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.onboard-enter-from,
.onboard-leave-to {
  opacity: 0;
}
.onboard-enter-active .card,
.onboard-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-expo);
}
.onboard-enter-from .card,
.onboard-leave-to .card {
  transform: scale(0.96) translateY(8px);
}
</style>
