<script setup lang="ts">
/**
 * v0.15 A1: SceneSettingsTab — 为当前 character 选场景背景 + 时间光照。
 * 直接调 character store update（不走 RuntimeConfig form）。
 */
import { computed } from 'vue'
import { useCharacterStore } from '../../stores/character'
import { bus } from '../../eventbus'

const character = useCharacterStore()

interface SceneOption {
  id: string
  label: string
  preview: string  // emoji 缩略图
  desc: string
}

const scenes: SceneOption[] = [
  { id: 'transparent', label: '透明', preview: '⬜', desc: '默认 — 立绘漂浮在桌面' },
  { id: 'bedroom', label: '卧室', preview: '🛏', desc: '暖粉色 + 双光晕' },
  { id: 'starry', label: '星空', preview: '🌌', desc: '深蓝 + 30 颗动态星点' },
  { id: 'study', label: '书房', preview: '📚', desc: '木纹色 + 横向木纹' },
  { id: 'sakura', label: '樱花', preview: '🌸', desc: '粉色 + 飘落樱花' },
  { id: 'cafe', label: '咖啡馆', preview: '☕', desc: '木色 + 暖灯' },
  { id: 'ocean', label: '海边', preview: '🌊', desc: '蓝绿 + 波浪纹理' },
  { id: 'rainy', label: '雨夜', preview: '🌧', desc: '深灰 + 40 滴雨水' },
  { id: 'snow', label: '雪景', preview: '❄️', desc: '冷白 + 雪花飘落' },
  { id: 'fireplace', label: '火炉', preview: '🔥', desc: '橙红 + 跳动火苗' },
  { id: 'library', label: '图书馆', preview: '📖', desc: '米黄 + 书架纹理' },
]

const currentScene = computed(() => character.active?.scene?.background_id ?? 'transparent')
const timeLighting = computed(() => character.active?.scene?.time_lighting ?? false)

async function setScene(id: string): Promise<void> {
  if (!character.active) return
  const r = await window.api.characters.update({
    id: character.active.id,
    patch: { scene: { background_id: id, time_lighting: timeLighting.value } },
  })
  if (r.ok) {
    await character.refresh()
    bus.emit('ui:toast', { kind: 'success', message: `场景切换 → ${scenes.find((s) => s.id === id)?.label}`, ttl_ms: 2000 })
  }
}

async function toggleTimeLighting(): Promise<void> {
  if (!character.active) return
  const newVal = !timeLighting.value
  const r = await window.api.characters.update({
    id: character.active.id,
    patch: { scene: { background_id: currentScene.value, time_lighting: newVal } },
  })
  if (r.ok) {
    await character.refresh()
    bus.emit('ui:toast', { kind: 'info', message: `时间光照 ${newVal ? '已开启' : '已关闭'}`, ttl_ms: 2000 })
  }
}
</script>

<template>
  <section>
    <h3>场景背景</h3>
    <p class="hint">
      给当前角色 <strong>{{ character.active?.name ?? '?' }}</strong> 选一个场景背景。
      径向渐变只在立绘附近，保留桌宠「漂浮在桌面」的体验。
    </p>

    <div class="scene-grid">
      <button
        v-for="s in scenes"
        :key="s.id"
        :class="['scene-card', { active: currentScene === s.id }]"
        @click="setScene(s.id)"
      >
        <span class="scene-emoji">{{ s.preview }}</span>
        <span class="scene-label">{{ s.label }}</span>
        <span class="scene-desc">{{ s.desc }}</span>
      </button>
    </div>

    <label class="toggle-row" @click="toggleTimeLighting">
      <input type="checkbox" :checked="timeLighting" @change="toggleTimeLighting" />
      <span>
        <strong>时间光照</strong> — 早暖、午自然、晚冷、夜偏紫冷暗
      </span>
    </label>
  </section>
</template>

<style scoped>
section {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  line-height: 1.55;
}
.hint strong {
  color: var(--color-accent);
}

.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
  margin: 8px 0;
}
.scene-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  border: 2px solid transparent;
  transition: all var(--duration-fast);
  text-align: center;
  gap: 2px;
}
.scene-card:hover {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}
.scene-card.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}
.scene-emoji {
  font-size: 24px;
  line-height: 1;
  margin-bottom: 4px;
}
.scene-label {
  font-size: var(--text-sm);
  font-weight: 600;
}
.scene-desc {
  font-size: 9px;
  color: var(--color-muted);
  line-height: 1.3;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bubble-surface);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  font-size: var(--text-sm);
}
.toggle-row:hover {
  background: var(--color-bubble-surface-hover);
}
.toggle-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-accent);
}
.toggle-row span {
  flex: 1;
  color: var(--color-muted);
}
.toggle-row strong {
  color: var(--color-bubble-text);
}
</style>
