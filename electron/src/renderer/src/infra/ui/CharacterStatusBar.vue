<script setup lang="ts">
/**
 * v0.14: 当前 character 状态卡片 — 替代裸立绘 + 显式可见的"她"。
 * 位置：右上角悬浮。默认半透明，hover 完整显示。
 * 点击 → 触发切角色 picker。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCharacterStore } from '../stores/character'
import { bus } from '../eventbus'
import type { EmotionalState, Mood } from '@shared/emotional'

const character = useCharacterStore()

const emit = defineEmits<{
  (e: 'open-picker'): void
}>()

const emotionEmoji: Record<string, string> = {
  neutral: '😐',
  calm: '😐',
  happy: '😊',
  sad: '😢',
  angry: '😠',
  surprise: '😲',
  shy: '😳',
  tease: '😈',
  sleepy: '😴',
  anxious: '😰',
  missing: '🥺',
}

// Phase 1 J P3: 实时拉 EmotionalState，跟随 emotional:state-changed 刷新
const emotional = ref<EmotionalState | null>(null)
let cleanups: Array<() => void> = []

async function refreshEmotional(): Promise<void> {
  try {
    const s = await window.api.emotional.getState()
    emotional.value = s
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  void refreshEmotional()
  const onChange = (): void => {
    void refreshEmotional()
  }
  bus.on('emotional:state-changed', onChange)
  bus.on('character:switched', onChange)
  cleanups = [
    () => bus.off('emotional:state-changed', onChange),
    () => bus.off('character:switched', onChange),
  ]
})

onBeforeUnmount(() => {
  for (const c of cleanups) c()
  cleanups = []
})

const currentMood = computed<Mood>(
  () =>
    emotional.value?.current_mood ?? ((character.active?.emotion_baseline as Mood) || 'calm'),
)
const moodIntensity = computed(() => emotional.value?.mood_intensity ?? 0.3)
const missingIntensity = computed(() => emotional.value?.missing_intensity ?? 0)
const showMissingBadge = computed(() => missingIntensity.value > 0.4)
const moodEmoji = computed(() => emotionEmoji[currentMood.value] ?? '😐')

const intimacyTier = computed(() => {
  const lv = character.active?.intimacy_level ?? 0
  if (lv >= 80) return { label: '挚爱', color: 'oklch(70% 0.2 25)' }
  if (lv >= 60) return { label: '亲密', color: 'oklch(72% 0.18 18)' }
  if (lv >= 40) return { label: '熟悉', color: 'oklch(72% 0.16 50)' }
  if (lv >= 20) return { label: '认识', color: 'oklch(72% 0.12 145)' }
  return { label: '初识', color: 'oklch(72% 0.08 250)' }
})

function openPicker(): void {
  emit('open-picker')
  bus.emit('ui:toast', { kind: 'info', message: '提示：切角色 Picker 完整版在 P1-T3', ttl_ms: 2000 })
}

const initials = computed(() => {
  const n = character.active?.name ?? ''
  return n.slice(0, 2)
})
</script>

<template>
  <transition name="status">
    <div v-if="character.active" class="status-bar" :class="{ switching: character.switching }">
      <!-- 头像（点击切角色） -->
      <button class="avatar-btn" :title="`切换角色 (当前: ${character.active.name})`" @click="openPicker">
        <span class="avatar" :style="{ borderColor: intimacyTier.color }">
          <img
            v-if="character.active.avatar_thumb_url"
            :src="character.active.avatar_thumb_url"
            :alt="character.active.name"
          />
          <span v-else class="initials">{{ initials }}</span>
        </span>
        <span v-if="character.switching" class="loading-ring"></span>
      </button>

      <!-- 名字 + 心情 -->
      <div class="info">
        <div class="name-row">
          <span class="name">{{ character.active.name }}</span>
          <span
            class="emotion-tag"
            :class="{ 'mood-strong': moodIntensity > 0.7 }"
            :title="`${currentMood} (intensity ${moodIntensity.toFixed(2)})`"
          >
            {{ moodEmoji }}
          </span>
          <span
            v-if="showMissingBadge"
            class="missing-badge"
            :title="`想念主人 ${(missingIntensity * 100).toFixed(0)}%`"
          >
            💭
          </span>
        </div>
        <div class="intimacy-row">
          <div class="intimacy-bar" :title="`亲密度 ${character.active.intimacy_level} / 100`">
            <div
              class="intimacy-fill"
              :style="{
                width: character.active.intimacy_level + '%',
                background: intimacyTier.color,
              }"
            ></div>
          </div>
          <span class="intimacy-label" :style="{ color: intimacyTier.color }">
            {{ intimacyTier.label }} · {{ Math.round(character.active.intimacy_level) }}
          </span>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.status-bar {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 1900;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  opacity: 0.55;
  transition: opacity var(--duration-fast), transform var(--duration-fast);
}
.status-bar:hover {
  opacity: 1;
  transform: translateX(2px);
}
.status-bar.switching {
  opacity: 1;
}

.avatar-btn {
  position: relative;
  padding: 0;
  border-radius: 999px;
  background: transparent;
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-bubble-surface);
  border: 2px solid var(--color-accent);
  overflow: hidden;
  font-weight: 700;
  font-size: 13px;
  color: var(--color-accent);
  transition: transform var(--duration-fast) var(--ease-out-back);
}
.avatar-btn:hover .avatar {
  transform: scale(1.05);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.initials {
  letter-spacing: -0.5px;
}

/* 切换中加载圈 */
.loading-ring {
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  border: 2px solid transparent;
  border-top-color: var(--color-accent);
  animation: ring-spin 0.8s linear infinite;
}
@keyframes ring-spin {
  to { transform: rotate(360deg); }
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-bubble-text);
  white-space: nowrap;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.emotion-tag {
  font-size: 13px;
  line-height: 1;
  transition: transform var(--duration-fast) var(--ease-out-back);
}
.emotion-tag.mood-strong {
  transform: scale(1.25);
  filter: drop-shadow(0 0 4px oklch(72% 0.18 18 / 0.5));
}
.missing-badge {
  font-size: 11px;
  line-height: 1;
  margin-left: 2px;
  animation: missing-pulse 2.5s var(--ease-in-out) infinite;
}
@keyframes missing-pulse {
  0%, 100% { opacity: 0.6; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-1px); }
}

.intimacy-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.intimacy-bar {
  width: 70px;
  height: 4px;
  background: var(--color-divider);
  border-radius: 999px;
  overflow: hidden;
}
.intimacy-fill {
  height: 100%;
  border-radius: 999px;
  transition: width var(--duration-slow) var(--ease-out-expo);
}
.intimacy-label {
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  font-feature-settings: 'tnum';
}

.status-enter-active,
.status-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.status-enter-from {
  opacity: 0;
  transform: translateY(-8px) translateX(-4px);
}
.status-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
