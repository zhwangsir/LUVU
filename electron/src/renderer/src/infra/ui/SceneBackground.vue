<script setup lang="ts">
/**
 * v0.14 P3-T9: 场景背景 + 时间光照。
 *
 * 4 个内置场景（+ transparent 透明），按 character.scene.background_id 切换。
 * 设计：径向渐变只在立绘附近，四周渐淡到透明，保留桌宠的「漂浮在桌面」体验。
 *
 * 时间光照：基于本地时间分早/午/晚/夜，CSS filter 调色温。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCharacterStore } from '../stores/character'

const character = useCharacterStore()

const sceneId = computed(() => character.active?.scene?.background_id ?? 'transparent')
const timeLightingEnabled = computed(() => character.active?.scene?.time_lighting ?? false)

// 每分钟更新一次时间段（用于时间光照）
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 60_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

type TimeOfDay = 'morning' | 'noon' | 'evening' | 'night'
const timeOfDay = computed<TimeOfDay>(() => {
  const h = new Date(now.value).getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'noon'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
})

/** 时间光照 filter — 应用到整个 root（cover 立绘 + 背景） */
const timeFilter = computed(() => {
  if (!timeLightingEnabled.value) return 'none'
  const map: Record<TimeOfDay, string> = {
    morning: 'hue-rotate(8deg) saturate(1.05) brightness(1.02)',
    noon: 'none',
    evening: 'hue-rotate(-8deg) saturate(0.95) brightness(0.95)',
    night: 'hue-rotate(-18deg) saturate(0.85) brightness(0.78)',
  }
  return map[timeOfDay.value]
})
</script>

<template>
  <!-- 场景背景层，位于立绘下方 -->
  <div
    v-if="sceneId !== 'transparent'"
    class="scene-bg"
    :class="['scene-' + sceneId]"
    :style="{ filter: timeFilter }"
    :data-time="timeOfDay"
  >
    <!-- 星空场景的星点 -->
    <template v-if="sceneId === 'starry'">
      <span
        v-for="i in 30"
        :key="i"
        class="star"
        :style="{
          left: ((i * 37) % 100) + '%',
          top: ((i * 53) % 100) + '%',
          animationDelay: (i * 0.3) + 's',
        }"
      ></span>
    </template>
    <!-- 樱花飘落 -->
    <template v-if="sceneId === 'sakura'">
      <span
        v-for="i in 12"
        :key="i"
        class="petal"
        :style="{
          left: ((i * 29) % 100) + '%',
          animationDelay: (i * 1.7) + 's',
          animationDuration: (8 + (i % 4)) + 's',
        }"
      >🌸</span>
    </template>
    <!-- 雨夜雨滴 -->
    <template v-if="sceneId === 'rainy'">
      <span
        v-for="i in 40"
        :key="i"
        class="raindrop"
        :style="{
          left: ((i * 23) % 100) + '%',
          animationDelay: (i * 0.13) + 's',
          animationDuration: (0.4 + (i % 3) * 0.15) + 's',
        }"
      ></span>
    </template>
    <!-- 雪景雪花 -->
    <template v-if="sceneId === 'snow'">
      <span
        v-for="i in 25"
        :key="i"
        class="snowflake"
        :style="{
          left: ((i * 31) % 100) + '%',
          animationDelay: (i * 0.7) + 's',
          animationDuration: (10 + (i % 5)) + 's',
        }"
      >❄</span>
    </template>
    <!-- 火炉跳动火苗 -->
    <template v-if="sceneId === 'fireplace'">
      <span class="fire-glow"></span>
    </template>
  </div>

  <!-- 时间光照覆盖层 — 当场景为透明时也启用 -->
  <div
    v-if="timeLightingEnabled && sceneId === 'transparent'"
    class="time-overlay"
    :data-time="timeOfDay"
  ></div>
</template>

<style scoped>
.scene-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  transition: filter var(--duration-slow) var(--ease-in-out);
}

/* v0.17：所有 scene 大幅降低不透明度（0.55→0.18），让边缘真正 fade 到桌面 —
   之前矩形 panel 感来自中心高浓度色块。现在只在立绘脚下保留淡淡氛围色。 */

/* === 卧室：暖粉色径向 === */
.scene-bedroom {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(94% 0.05 25 / 0.18) 0%,
    oklch(92% 0.06 18 / 0.1) 35%,
    transparent 65%
  );
}
.scene-bedroom::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 30% 80%, oklch(85% 0.08 60 / 0.06) 0%, transparent 40%),
    radial-gradient(ellipse at 70% 75%, oklch(85% 0.08 30 / 0.06) 0%, transparent 40%);
}

/* === 星空：深蓝径向 + 闪烁星点 === */
.scene-starry {
  background: radial-gradient(
    ellipse 60% 55% at 50% 70%,
    oklch(35% 0.1 270 / 0.2) 0%,
    oklch(25% 0.08 260 / 0.12) 35%,
    transparent 65%
  );
}
.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 0 4px oklch(95% 0.02 250);
  animation: star-twinkle 3s var(--ease-in-out) infinite;
  opacity: 0.7;
}
@keyframes star-twinkle {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* === 书房：木纹色 + 黄光 === */
.scene-study {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(78% 0.06 60 / 0.18) 0%,
    oklch(70% 0.07 50 / 0.1) 35%,
    transparent 65%
  );
}
.scene-study::before {
  content: '';
  position: absolute;
  inset: 0;
  /* 模拟横向木纹纹理 */
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0,
      transparent 50px,
      oklch(60% 0.05 50 / 0.04) 50px,
      oklch(60% 0.05 50 / 0.04) 51px
    );
}

/* === 樱花：粉色 + 花瓣 === */
.scene-sakura {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(92% 0.07 18 / 0.18) 0%,
    oklch(88% 0.08 15 / 0.1) 35%,
    transparent 65%
  );
}

/* === 咖啡馆：木色 + 暖灯 === */
.scene-cafe {
  background: radial-gradient(
    ellipse 60% 50% at 50% 78%,
    oklch(85% 0.08 45 / 0.18) 0%,
    oklch(72% 0.08 40 / 0.1) 35%,
    transparent 65%
  );
}
.scene-cafe::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 30%, oklch(95% 0.12 65 / 0.18) 0%, transparent 50%);
}

/* === 海边：蓝绿 === */
.scene-ocean {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(80% 0.08 200 / 0.18) 0%,
    oklch(70% 0.1 210 / 0.1) 35%,
    transparent 65%
  );
}
.scene-ocean::before {
  content: '';
  position: absolute;
  inset: 0;
  /* 水平方向的波浪线 */
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent 40px,
      oklch(70% 0.1 215 / 0.06) 40px,
      oklch(70% 0.1 215 / 0.06) 41px
    );
}

/* === 雨夜 === */
.scene-rainy {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(32% 0.06 245 / 0.22) 0%,
    oklch(25% 0.04 240 / 0.12) 35%,
    transparent 65%
  );
}
.raindrop {
  position: absolute;
  top: -10%;
  width: 1.5px;
  height: 18px;
  background: linear-gradient(to bottom, transparent, oklch(85% 0.04 250 / 0.5));
  animation: rain-fall linear infinite;
}
@keyframes rain-fall {
  to { transform: translateY(120vh); }
}

/* === 雪景 === */
.scene-snow {
  background: radial-gradient(
    ellipse 60% 50% at 50% 75%,
    oklch(92% 0.03 230 / 0.18) 0%,
    oklch(82% 0.04 220 / 0.1) 35%,
    transparent 65%
  );
}
.snowflake {
  position: absolute;
  top: -30px;
  font-size: 12px;
  opacity: 0.7;
  color: white;
  animation: snow-fall linear infinite;
  filter: drop-shadow(0 1px 1px oklch(0% 0 0 / 0.05));
}
@keyframes snow-fall {
  0% { transform: translateY(-30px) translateX(0) rotate(0deg); opacity: 0; }
  10% { opacity: 0.85; }
  100% { transform: translateY(110vh) translateX(60px) rotate(360deg); opacity: 0; }
}

/* === 火炉 === */
.scene-fireplace {
  background: radial-gradient(
    ellipse 60% 50% at 50% 78%,
    oklch(75% 0.18 35 / 0.2) 0%,
    oklch(62% 0.15 30 / 0.12) 35%,
    transparent 65%
  );
}
.fire-glow {
  position: absolute;
  left: 50%;
  bottom: 15%;
  transform: translateX(-50%);
  width: 200px;
  height: 100px;
  background: radial-gradient(ellipse at 50% 100%, oklch(85% 0.2 50 / 0.4) 0%, transparent 70%);
  animation: fire-flicker 1.5s var(--ease-in-out) infinite;
  pointer-events: none;
}
@keyframes fire-flicker {
  0%, 100% { opacity: 0.7; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.08); }
}

/* === 图书馆 === */
.scene-library {
  background: radial-gradient(
    circle at 50% 60%,
    oklch(85% 0.05 70 / 0.55) 0%,
    oklch(75% 0.06 60 / 0.4) 30%,
    oklch(60% 0.05 55 / 0.22) 55%,
    transparent 82%
  );
}
.scene-library::before {
  content: '';
  position: absolute;
  inset: 0;
  /* 竖向「书架」纹理 */
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent 30px,
      oklch(40% 0.06 50 / 0.07) 30px,
      oklch(40% 0.06 50 / 0.07) 32px
    );
}
.petal {
  position: absolute;
  top: -30px;
  font-size: 14px;
  opacity: 0.7;
  animation: petal-fall linear infinite;
  filter: drop-shadow(0 1px 2px oklch(0% 0 0 / 0.1));
}
@keyframes petal-fall {
  0% {
    transform: translateY(-30px) translateX(0) rotate(0deg);
    opacity: 0;
  }
  10% { opacity: 0.7; }
  100% {
    transform: translateY(110vh) translateX(40px) rotate(360deg);
    opacity: 0;
  }
}

/* === 时间光照 overlay（场景透明时单独覆盖） === */
.time-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transition: background var(--duration-slow) var(--ease-in-out);
  mix-blend-mode: multiply;
}
.time-overlay[data-time='morning'] {
  background: radial-gradient(ellipse at 50% 60%, oklch(96% 0.05 65 / 0.05) 0%, transparent 70%);
}
.time-overlay[data-time='evening'] {
  background: radial-gradient(ellipse at 50% 60%, oklch(85% 0.08 30 / 0.1) 0%, transparent 70%);
}
.time-overlay[data-time='night'] {
  background: radial-gradient(ellipse at 50% 60%, oklch(40% 0.05 270 / 0.18) 0%, transparent 80%);
  mix-blend-mode: multiply;
}
</style>
