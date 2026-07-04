<script setup lang="ts">
/**
 * UX R26: 首启品牌加载动画。
 *
 * 设计：全屏覆盖，大字体衬线 "LUVU" + 心跳 ♡，
 * tagline "正在召唤你的灵魂女友…"，三点加载动画。
 *
 * 最少展示 700ms — 避免 ready 太快导致 flash 让用户看不清。
 * Bootstrap 完成后淡出，opacity 0 后真正卸载。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'

const props = defineProps<{ ready: boolean }>()
const cfg = useConfigStore()

const MIN_SHOW_MS = 700
const startTime = ref(Date.now())
const fadeOut = ref(false)

onMounted(() => {
  startTime.value = Date.now()
})

watch(
  () => props.ready,
  (now) => {
    if (!now) return
    const elapsed = Date.now() - startTime.value
    const wait = Math.max(0, MIN_SHOW_MS - elapsed)
    window.setTimeout(() => {
      fadeOut.value = true
    }, wait)
  },
)

const visible = computed(() => !props.ready || !fadeOut.value)
</script>

<template>
  <transition name="boot">
    <div v-if="visible" class="splash" :class="{ leaving: fadeOut }">
      <div class="brand">
        <span class="word">Tia</span>
        <span class="heart">♡</span>
        <span class="word">Lynn</span>
      </div>
      <div class="tagline">正在召唤你的灵魂女友…</div>
      <div class="dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div v-if="cfg.version" class="version">v{{ cfg.version }}</div>
    </div>
  </transition>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: radial-gradient(
    circle at center,
    oklch(20% 0.03 280 / 0.85) 0%,
    oklch(10% 0.02 280 / 0.95) 65%,
    oklch(8% 0.01 280 / 0.98) 100%
  );
  color: oklch(95% 0.02 280);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  pointer-events: none;
}
.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-family: 'Cormorant Garamond', 'Source Han Serif SC', 'Songti SC',
    Georgia, serif;
  font-size: clamp(3rem, 9vw, 5.5rem);
  font-weight: 300;
  letter-spacing: 0.04em;
  animation: brand-rise 0.9s var(--ease-out-expo) backwards;
}
.word {
  background: linear-gradient(
    135deg,
    oklch(95% 0.05 290) 0%,
    oklch(78% 0.18 320) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.heart {
  color: oklch(72% 0.22 0);
  font-size: 0.75em;
  display: inline-block;
  animation: heart-pulse 1.4s ease-in-out infinite;
  transform-origin: center;
  filter: drop-shadow(0 0 8px oklch(72% 0.22 0 / 0.5));
}
.tagline {
  font-size: var(--text-base);
  color: oklch(80% 0.04 280 / 0.85);
  letter-spacing: 0.08em;
  animation: brand-rise 0.9s 0.2s var(--ease-out-expo) backwards;
}
.dots {
  display: inline-flex;
  gap: 6px;
  margin-top: 6px;
  animation: brand-rise 0.9s 0.35s var(--ease-out-expo) backwards;
}
.dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: oklch(85% 0.12 320 / 0.7);
  animation: dot-fade 1.3s ease-in-out infinite;
}
/* R100: 版本号微小显示 */
.version {
  position: absolute;
  bottom: 20px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: oklch(70% 0.04 280 / 0.55);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  animation: brand-rise 0.9s 0.5s var(--ease-out-expo) backwards;
}

.dots span:nth-child(2) {
  animation-delay: 0.18s;
}
.dots span:nth-child(3) {
  animation-delay: 0.36s;
}

.splash.leaving {
  /* 离场时关闭 backdrop filter（性能） */
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

@keyframes brand-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes heart-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  20% {
    transform: scale(1.25);
    opacity: 1;
  }
  40% {
    transform: scale(1);
    opacity: 0.9;
  }
  60% {
    transform: scale(1.15);
    opacity: 1;
  }
}
@keyframes dot-fade {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.85);
  }
  40% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.boot-leave-active {
  transition: opacity 0.55s var(--ease-out-expo);
}
.boot-leave-to {
  opacity: 0;
}
</style>
