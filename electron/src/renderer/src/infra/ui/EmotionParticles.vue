<script setup lang="ts">
/**
 * v0.14 P3-T10: 情绪 particle effects — 听 brain:emotion-changed，
 * 在立绘上方放一组动态 emoji 粒子，2 秒后自动消失。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'
import type { EmotionId } from '@shared/types'

interface Particle {
  id: number
  emoji: string
  x: number       // % within container
  y: number
  delay: number   // 0~0.4s
  drift: number   // -40~+40 px horizontal drift
  scale: number   // 0.8~1.2
}

const particles = ref<Particle[]>([])
let nextId = 1
let lastTriggerAt = 0
const COOLDOWN_MS = 800 // 防 burst 触发太频繁

/** 每个 emotion 的 particle 池：强度 ≥ 0.5 时触发 */
const POOL: Record<EmotionId, string[]> = {
  neutral: [],
  happy: ['✨', '✨', '⭐', '💫'],
  sad: ['💧', '💧', '💦'],
  angry: ['⚡', '💢', '💥'],
  surprise: ['❗', '⁉️', '✨'],
  shy: ['💗', '💗', '💕', '🌸'],
  tease: ['💖', '💞', '🌷'],
  sleepy: ['💤', '😴', '☁️'],
}

let unsub: (() => void) | null = null

onMounted(() => {
  const handler = ({ emotion, intensity }: { emotion: EmotionId; intensity: number }): void => {
    if (intensity < 0.5) return
    const now = Date.now()
    if (now - lastTriggerAt < COOLDOWN_MS) return
    lastTriggerAt = now
    spawn(emotion, intensity)
  }
  bus.on('brain:emotion-changed', handler)
  unsub = () => bus.off('brain:emotion-changed', handler)
})

onBeforeUnmount(() => {
  unsub?.()
})

function spawn(emotion: EmotionId, intensity: number): void {
  const pool = POOL[emotion]
  if (!pool || pool.length === 0) return
  // 数量：强度 0.5 → 3 个, 0.8 → 5 个, 1.0 → 7 个
  const count = Math.max(3, Math.round(intensity * 7))
  const startId = nextId
  for (let i = 0; i < count; i++) {
    const e = pool[i % pool.length] ?? '✨'
    const p: Particle = {
      id: nextId++,
      emoji: e,
      // 立绘大致在右下方区域（透明窗口里立绘默认中下偏右）
      x: 35 + Math.random() * 30, // 35% - 65%
      y: 45 + Math.random() * 20, // 45% - 65%
      delay: Math.random() * 0.4,
      drift: (Math.random() - 0.5) * 80,
      scale: 0.8 + Math.random() * 0.4,
    }
    particles.value.push(p)
  }
  // 2 秒后清掉这批
  const ids = new Set<number>()
  for (let i = startId; i < nextId; i++) ids.add(i)
  setTimeout(() => {
    particles.value = particles.value.filter((p) => !ids.has(p.id))
  }, 2200)
}
</script>

<template>
  <div class="particles-layer" aria-hidden="true">
    <span
      v-for="p in particles"
      :key="p.id"
      class="particle"
      :style="{
        left: p.x + '%',
        top: p.y + '%',
        '--drift': p.drift + 'px',
        '--scale': p.scale,
        animationDelay: p.delay + 's',
      }"
    >
      {{ p.emoji }}
    </span>
  </div>
</template>

<style scoped>
.particles-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1400; /* 在立绘之上，对话泡之下 */
  overflow: hidden;
}
.particle {
  position: absolute;
  font-size: 22px;
  opacity: 0;
  animation: particle-float 2s var(--ease-out-expo) forwards;
  filter: drop-shadow(0 2px 4px oklch(0% 0 0 / 0.2));
  user-select: none;
}
@keyframes particle-float {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.5);
  }
  15% {
    opacity: 1;
    transform: translate(calc(var(--drift) * 0.3), -10px) scale(var(--scale));
  }
  80% {
    opacity: 0.9;
    transform: translate(var(--drift), -50px) scale(var(--scale));
  }
  100% {
    opacity: 0;
    transform: translate(calc(var(--drift) * 1.2), -70px) scale(calc(var(--scale) * 0.8));
  }
}
</style>
