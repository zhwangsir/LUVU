<script setup lang="ts">
/**
 * v0.14: CharacterCreator — 3 步向导创建新角色。
 *
 * 步骤 1: 名字 + 称呼 + 描述
 * 步骤 2: 选立绘 (Live2D model) + 灵魂模板 + 可选关键词
 * 步骤 3: 选音色 (RVC voice, 可选)
 *
 * 完成后调用 store.create → 自动切换到新角色
 */
import { computed, onMounted, ref } from 'vue'
import { useCharacterStore } from '../stores/character'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import type { SoulTemplate } from '@shared/character'

const emit = defineEmits<{ (e: 'close'): void }>()

const character = useCharacterStore()
const cfg = useConfigStore()

const step = ref<1 | 2 | 3>(1)
const creating = ref(false)

const name = ref('')
const callAs = ref('主人')
const description = ref('')

// 立绘
const modelDir = ref('')
const modelFile = ref('')
const modelSearch = ref('')

// 灵魂模板
const template = ref<SoulTemplate>('gentle')
const customKeywords = ref('')

// 音色
const rvcVoices = ref<string[]>([])
const rvcVoice = ref('')
const previewingVoice = ref<string | null>(null)
const selectedCharacterId = ref<string | null>(null) // 选模型时自动捕获 model.meta.character_id

// v0.15 B2: 试听 5 秒
async function previewVoice(voiceId: string): Promise<void> {
  if (previewingVoice.value) return
  previewingVoice.value = voiceId
  try {
    const r = await window.api.tts.speak({
      text: '你好主人～我是这个声音哦',
      voice: voiceId,
      emotion: 'happy',
    })
    if (r.ok) {
      const audio = new Audio(`data:${r.mime};base64,${r.audio_b64}`)
      await audio.play()
      await new Promise((res) => audio.addEventListener('ended', res, { once: true }))
    } else {
      bus.emit('ui:toast', { kind: 'error', message: `试听失败: ${r.reason ?? ''}`, ttl_ms: 3000 })
    }
  } finally {
    previewingVoice.value = null
  }
}

// 模板预览
interface TemplateInfo {
  id: SoulTemplate
  label: string
  emoji: string
  desc: string
}
const templates: TemplateInfo[] = [
  { id: 'gentle', label: '温柔治愈', emoji: '🌸', desc: '说话轻柔，永远耐心，像一杯热茶' },
  { id: 'genki', label: '元气活泼', emoji: '🌟', desc: '永远充满活力，电池满格' },
  { id: 'tsundere', label: '冷淡毒舌', emoji: '🌙', desc: '表面冷，心里在乎，傲娇' },
  { id: 'cool', label: '成熟御姐', emoji: '🔮', desc: '冷静理性，简洁可靠，距离感' },
  { id: 'yandere', label: '病娇占有', emoji: '🩸', desc: '极度黏人，占有欲爆发（请勿乱选）' },
  { id: 'custom', label: '完全自定义', emoji: '✏️', desc: '空白模板，创建后改 yaml' },
]

// 模型列表（按搜索过滤）
const filteredModels = computed(() => {
  const q = modelSearch.value.trim().toLowerCase()
  const list = cfg.models.filter((m) => m.meta?.complete && m.cubism === 'cubism4')
  if (!q) return list.slice(0, 30)
  return list
    .filter((m) => m.display.toLowerCase().includes(q) || m.dir.toLowerCase().includes(q))
    .slice(0, 30)
})

function selectModel(m: { dir: string; model_file: string; display: string; meta?: { character_id?: string } }): void {
  modelDir.value = m.dir
  modelFile.value = m.model_file
  // v0.15 B2: 捕获模型的 character_id 以便 finish 时拉缩略图作头像
  selectedCharacterId.value = m.meta?.character_id ?? null
}

const selectedModelLabel = computed(() => {
  if (!modelDir.value) return ''
  const m = cfg.models.find((x) => x.dir === modelDir.value)
  return m?.display ?? modelDir.value
})

onMounted(async () => {
  try {
    const r = await window.api.tts.listRvcVoices()
    if (r.ok) rvcVoices.value = r.voices
  } catch {
    /* 无 RVC sidecar 不影响 */
  }
})

// 步骤验证
const canNext = computed(() => {
  if (step.value === 1) return name.value.trim().length > 0 && callAs.value.trim().length > 0
  if (step.value === 2) return modelDir.value && modelFile.value
  return true
})

async function finish(): Promise<void> {
  if (creating.value) return
  creating.value = true
  try {
    const kw = customKeywords.value
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const desc = description.value.trim()
    const rvc = rvcVoice.value.trim()
    const r = await character.create({
      name: name.value.trim(),
      call_master_as: callAs.value.trim(),
      template: template.value,
      live2d_model_dir: modelDir.value,
      live2d_model_file: modelFile.value,
      ...(desc ? { description: desc } : {}),
      ...(rvc ? { rvc_voice: rvc } : {}),
      ...(kw.length > 0 ? { custom_personality_keywords: kw } : {}),
    })
    if (!r.ok) {
      bus.emit('ui:toast', { kind: 'error', message: `创建失败: ${r.reason}`, ttl_ms: 5000 })
      return
    }
    // v0.15 B2: 如果选的模型有 character_id 且有缩略图缓存 → 写到 avatar_thumb_url
    if (selectedCharacterId.value) {
      try {
        const thumb = await window.api.thumbs.get(selectedCharacterId.value)
        if (thumb.exists && thumb.url) {
          await window.api.characters.update({
            id: r.character.id,
            patch: { avatar_thumb_url: thumb.url },
          })
        }
      } catch {
        /* 缩略图缺失不阻塞创建 */
      }
    }
    bus.emit('ui:toast', { kind: 'success', message: `已创建 ${r.character.name}，正在切换...`, ttl_ms: 3000 })
    await character.switchTo(r.character.id)
    emit('close')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <transition name="creator" appear>
    <div class="overlay" @click.self="emit('close')">
      <div class="card">
        <header>
          <div class="step-dots">
            <span :class="['dot', { active: step >= 1 }]"></span>
            <span :class="['dot', { active: step >= 2 }]"></span>
            <span :class="['dot', { active: step >= 3 }]"></span>
          </div>
          <button class="x-btn" @click="emit('close')">✕</button>
        </header>

        <!-- Step 1: 基本信息 -->
        <div v-if="step === 1" class="body">
          <h1>1/3 · 起个名字</h1>
          <p class="lead">先给这个新的「她」一个身份。</p>

          <label class="field">
            <span>名字</span>
            <input v-model="name" placeholder="例如：胡桃 / 纳西妲 / 小诗 / Aria" maxlength="20" />
          </label>

          <label class="field">
            <span>她怎么叫你（master）</span>
            <input v-model="callAs" placeholder="主人 / 老板 / 你的名字 / Sir" maxlength="20" />
          </label>

          <label class="field">
            <span>一句话简介（可选）</span>
            <input v-model="description" placeholder="例如：陪我深夜写代码的温柔小天使" maxlength="80" />
          </label>

          <footer>
            <button class="primary" :disabled="!canNext" @click="step = 2">下一步 →</button>
          </footer>
        </div>

        <!-- Step 2: 立绘 + 模板 -->
        <div v-if="step === 2" class="body">
          <h1>2/3 · 选她的样子和性格</h1>

          <div class="section">
            <span class="section-label">🎭 立绘 (Live2D)</span>
            <input
              v-model="modelSearch"
              placeholder="搜索模型名（如「胡桃」「nahida」）"
              class="search-input"
            />
            <div class="model-grid">
              <button
                v-for="m in filteredModels"
                :key="m.absolute_path"
                :class="['model-pill', { active: modelDir === m.dir }]"
                @click="selectModel(m)"
                :title="m.absolute_path"
              >
                {{ m.display }}
              </button>
            </div>
            <div v-if="modelDir" class="selected-hint">✓ 已选：{{ selectedModelLabel }}</div>
            <div v-if="filteredModels.length === 0" class="empty-hint">
              没找到匹配模型。先去资源商店安装些 Live2D 模型？
            </div>
          </div>

          <div class="section">
            <span class="section-label">💎 灵魂模板</span>
            <div class="template-grid">
              <button
                v-for="t in templates"
                :key="t.id"
                :class="['template-card', { active: template === t.id }]"
                @click="template = t.id"
              >
                <span class="t-emoji">{{ t.emoji }}</span>
                <span class="t-label">{{ t.label }}</span>
                <span class="t-desc">{{ t.desc }}</span>
              </button>
            </div>
          </div>

          <label class="field">
            <span>额外的性格关键词（可选，逗号分隔）</span>
            <input v-model="customKeywords" placeholder="例如：爱猫、晨型人、不爱吃辣" maxlength="100" />
          </label>

          <footer>
            <button class="ghost" @click="step = 1">← 返回</button>
            <button class="primary" :disabled="!canNext" @click="step = 3">下一步 →</button>
          </footer>
        </div>

        <!-- Step 3: 音色 -->
        <div v-if="step === 3" class="body">
          <h1>3/3 · 选她的声音（可选）</h1>
          <p class="lead">
            如果你装了 TTS sidecar + RVC，可以从已训练音色里选一个；不选就用纯 TTS。
          </p>

          <div v-if="rvcVoices.length > 0" class="rvc-list">
            <button :class="['voice-pill', { active: rvcVoice === '' }]" @click="rvcVoice = ''">
              不用 RVC（纯 TTS）
            </button>
            <div v-for="v in rvcVoices" :key="v" class="voice-row">
              <button
                :class="['voice-pill', { active: rvcVoice === v }]"
                @click="rvcVoice = v"
              >
                {{ v }}
              </button>
              <button
                class="preview-btn"
                :disabled="previewingVoice !== null"
                :title="`试听 ${v}`"
                @click="previewVoice(v)"
              >
                <span v-if="previewingVoice === v">⏸</span>
                <span v-else>▶</span>
              </button>
            </div>
          </div>
          <div v-else class="empty-hint">
            RVC sidecar 未连接 / 无已训练音色。创建后可以在设置里改。
          </div>

          <footer>
            <button class="ghost" @click="step = 2">← 返回</button>
            <button class="primary strong" :disabled="creating" @click="finish">
              {{ creating ? '创建中…' : '✓ 创建并切换' }}
            </button>
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
  backdrop-filter: blur(8px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 600px;
  max-height: 88vh;
  overflow: auto;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-divider);
}
.step-dots {
  display: flex;
  gap: 6px;
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
.body {
  padding: 22px 24px 18px;
}
h1 {
  font-size: var(--text-xl);
  margin: 0 0 8px;
  font-weight: 700;
}
.lead {
  margin: 0 0 18px;
  font-size: var(--text-sm);
  color: var(--color-muted);
}

.section {
  margin-bottom: 18px;
}
.section-label {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin-bottom: 8px;
  font-weight: 600;
}
.search-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-bubble-border);
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  font-family: inherit;
  margin-bottom: 8px;
  box-sizing: border-box;
}
.search-input:focus {
  border-color: var(--color-accent);
  outline: none;
}

.model-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
}
.rvc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
.voice-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.voice-row .voice-pill {
  flex: 1;
  text-align: left;
}
.preview-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--color-bubble-surface);
  color: var(--color-accent);
  font-size: 10px;
  flex-shrink: 0;
}
.preview-btn:hover:not(:disabled) {
  background: var(--color-accent-soft);
  transform: scale(1.08);
}
.preview-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}
.model-pill,
.voice-pill {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  background: var(--color-bubble-surface);
  border: 1px solid transparent;
  font-size: 11px;
  color: var(--color-bubble-text);
  white-space: nowrap;
  transition: all var(--duration-fast);
}
.model-pill:hover,
.voice-pill:hover {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent-soft);
}
.model-pill.active,
.voice-pill.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}
.selected-hint {
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--color-success);
  font-weight: 500;
}
.empty-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--color-muted);
  padding: 10px 12px;
  background: var(--color-bubble-surface);
  border-radius: var(--radius-sm);
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.template-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  border: 2px solid transparent;
  text-align: left;
  transition: all var(--duration-fast);
}
.template-card:hover {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent-soft);
}
.template-card.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}
.t-emoji {
  font-size: 18px;
  margin-bottom: 2px;
}
.t-label {
  font-size: var(--text-sm);
  font-weight: 600;
}
.t-desc {
  font-size: 10px;
  color: var(--color-muted);
  line-height: 1.4;
}

.field {
  display: block;
  margin-bottom: 14px;
}
.field span {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin-bottom: 4px;
  font-weight: 600;
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
.field input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus);
  outline: none;
}

footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 18px;
}
.ghost,
.primary {
  padding: 9px 18px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
}
.ghost {
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
}
.ghost:hover {
  background: var(--color-bubble-surface-hover);
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.primary.strong {
  background: oklch(55% 0.2 145);
}

.creator-enter-active,
.creator-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.creator-enter-from,
.creator-leave-to {
  opacity: 0;
}
.creator-enter-active .card,
.creator-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.creator-enter-from .card,
.creator-leave-to .card {
  transform: scale(0.94) translateY(20px);
}
</style>
