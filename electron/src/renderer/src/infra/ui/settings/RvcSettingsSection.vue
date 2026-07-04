<script setup lang="ts">
/**
 * v0.14 P2-T6: RVC 音色转换设置 section — 从 SettingsPanel 剥离。
 * Form 双向绑定通过 reactive prop（Vue 3 reactive 引用透传）。
 */
import type { RuntimeConfig } from '@shared/types'

defineProps<{
  form: RuntimeConfig
  rvcVoices: string[]
  rvcStatus: string
}>()

defineEmits<{
  (e: 'markDirty'): void
  (e: 'refresh'): void
}>()
</script>

<template>
  <section>
    <h3>RVC 音色转换（你的真声）</h3>
    <p class="hint">
      流程：text → 底座 TTS 生成中性 wav → RVC 转你训练好的音色 → 最终 wav。
      需要先在 workstation 上用 <code>C:\LUVU-rvc</code> 训练 .pth 模型。
    </p>

    <label>
      <span>RVC 音色</span>
      <div class="row" style="flex: 1; gap: 6px">
        <select v-model="form.rvc_voice" @change="$emit('markDirty')" style="flex: 1">
          <option value="">— 不启用 RVC，用底座 TTS 原声 —</option>
          <option v-for="v in rvcVoices" :key="v" :value="v">{{ v }}</option>
        </select>
        <button class="ghost" @click="$emit('refresh')">↻ 刷新</button>
      </div>
    </label>
    <p v-if="rvcStatus" class="hint" :class="rvcStatus.startsWith('✗') ? 'bad' : 'ok'">
      {{ rvcStatus }}
    </p>

    <label v-if="form.rvc_voice">
      <span>音调偏移（半音）</span>
      <div class="row" style="flex: 1; gap: 8px; align-items: center">
        <input type="range" min="-12" max="12" step="1"
          v-model.number="form.rvc_f0_up_key" @change="$emit('markDirty')" style="flex: 1" />
        <span style="min-width: 40px; text-align: right">{{ form.rvc_f0_up_key }}</span>
      </div>
    </label>
    <p v-if="form.rvc_voice" class="hint">男→女 +12，女→男 -12，同性 0。底座 TTS 是女声时，转你声 -12 试试。</p>

    <label v-if="form.rvc_voice">
      <span>索引权重</span>
      <div class="row" style="flex: 1; gap: 8px; align-items: center">
        <input type="range" min="0" max="1" step="0.05"
          v-model.number="form.rvc_index_rate" @change="$emit('markDirty')" style="flex: 1" />
        <span style="min-width: 40px; text-align: right">{{ Number(form.rvc_index_rate ?? 0).toFixed(2) }}</span>
      </div>
    </label>
    <p v-if="form.rvc_voice" class="hint">0 = 纯模型，1 = 全用索引检索。0.75 推荐，越高越像但伪影也多。</p>

    <label v-if="form.rvc_voice">
      <span>F0 算法</span>
      <select v-model="form.rvc_f0_method" @change="$emit('markDirty')">
        <option value="rmvpe">rmvpe（推荐 · 快 + 准）</option>
        <option value="harvest">harvest（最准 · 慢）</option>
        <option value="pm">pm（最快 · 易抖）</option>
      </select>
    </label>

    <!-- v0.11 高级参数（折叠区） -->
    <details v-if="form.rvc_voice" class="advanced">
      <summary>🔧 高级参数（声音质感微调）</summary>
      <label>
        <span>清音保护 (protect)</span>
        <div class="row" style="flex: 1; gap: 8px; align-items: center">
          <input type="range" min="0" max="0.5" step="0.01"
            v-model.number="form.rvc_protect" @change="$emit('markDirty')" style="flex: 1" />
          <span style="min-width: 50px; text-align: right">{{ Number(form.rvc_protect ?? 0.33).toFixed(2) }}</span>
        </div>
      </label>
      <p class="hint">越高越保护辅音/呼吸的清晰度。0.33 推荐。太低会变机器声。</p>

      <label>
        <span>F0 平滑 (filter_radius)</span>
        <div class="row" style="flex: 1; gap: 8px; align-items: center">
          <input type="range" min="0" max="7" step="1"
            v-model.number="form.rvc_filter_radius" @change="$emit('markDirty')" style="flex: 1" />
          <span style="min-width: 50px; text-align: right">{{ form.rvc_filter_radius }}</span>
        </div>
      </label>
      <p class="hint">F0 中值滤波半径。≥3 去 harvest 算法的呼吸杂音；rmvpe 用 0 也可以。</p>

      <label>
        <span>音量包络 (rms_mix_rate)</span>
        <div class="row" style="flex: 1; gap: 8px; align-items: center">
          <input type="range" min="0" max="1" step="0.05"
            v-model.number="form.rvc_rms_mix_rate" @change="$emit('markDirty')" style="flex: 1" />
          <span style="min-width: 50px; text-align: right">{{ Number(form.rvc_rms_mix_rate ?? 1).toFixed(2) }}</span>
        </div>
      </label>
      <p class="hint">1 = 完全用源音量曲线，0 = 用目标音色固有音量。1 保持戏剧化语气，0 更接近角色平均音量。</p>

      <label>
        <span>输出采样率 (Hz)</span>
        <select v-model.number="form.rvc_resample_sr" @change="$emit('markDirty')">
          <option :value="0">保持源采样率（推荐）</option>
          <option :value="16000">16000 (极省带宽)</option>
          <option :value="32000">32000</option>
          <option :value="40000">40000</option>
          <option :value="48000">48000 (高保真)</option>
        </select>
      </label>
      <p class="hint">0 = 不重采样。多数 RVC 模型本身就是 40k/48k。</p>
    </details>
  </section>
</template>

<style scoped>
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
section h3 {
  margin: 0 0 4px 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-bubble-text);
}
.hint {
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin: 0;
  line-height: 1.5;
}
.hint.ok { color: var(--color-success); }
.hint.bad { color: var(--color-danger); }
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--text-sm);
}
label > span:first-child {
  min-width: 90px;
  color: var(--color-muted);
  font-size: var(--text-xs);
}
input[type='range'] {
  accent-color: var(--color-accent);
}
select, input[type='text'], input[type='number'], input[type='password'] {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-bubble-border);
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  font-family: inherit;
}
.ghost {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  font-size: var(--text-xs);
}
.ghost:hover {
  background: var(--color-bubble-surface-hover);
}
.advanced {
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--color-bubble-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-divider);
}
.advanced summary {
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-muted);
  user-select: none;
}
.advanced summary:hover {
  color: var(--color-bubble-text);
}
.advanced > label,
.advanced > .hint {
  margin-top: 8px;
}
code {
  padding: 1px 6px;
  background: var(--color-bubble-surface);
  border-radius: 4px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
</style>
