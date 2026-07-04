<script setup lang="ts">
/**
 * LUVU 资源商店（v0.12）
 *
 * 整合 Live2D 立绘 + RVC 音色 + 在线下载为统一 UI。
 *
 * 结构：
 *   ├ Tab bar：[立绘 | 音色 | 在线]
 *   └ Tab 内容：
 *       - 立绘 → ModelLibraryPanel embedded
 *       - 音色 → RvcVoiceTab
 *       - 在线 → OnlineStoreTab（RVC + Live2D 推荐 repo 浏览 + 一键装）
 */
import { ref } from 'vue'
import { useConfigStore } from '../stores/config'
import FloatingPanel from './FloatingPanel.vue'
import ModelLibraryPanel from './ModelLibraryPanel.vue'
import RvcVoiceTab from './RvcVoiceTab.vue'
import OnlineStoreTab from './OnlineStoreTab.vue'

const cfg = useConfigStore()
const emit = defineEmits<{ (e: 'close'): void }>()

type TabId = 'avatars' | 'voices' | 'online'
const activeTab = ref<TabId>('avatars')
</script>

<template>
  <FloatingPanel
    storage-key="resource-store"
    title="🎁 LUVU 资源商店"
    theme="light"
    :defaults="{ width: 1100, height: 800 }"
    @close="emit('close')"
  >
    <template #sub-header>
      <div class="tabbar">
        <button :class="['tab', { active: activeTab === 'avatars' }]" @click="activeTab = 'avatars'">
          🎭 立绘 <span class="badge">{{ cfg.models.length }}</span>
        </button>
        <button :class="['tab', { active: activeTab === 'voices' }]" @click="activeTab = 'voices'">
          🎙️ 音色
        </button>
        <button :class="['tab', { active: activeTab === 'online' }]" @click="activeTab = 'online'">
          ☁️ 在线
        </button>
      </div>
    </template>

    <div class="tab-body">
      <ModelLibraryPanel
        v-if="activeTab === 'avatars'"
        :embedded="true"
        @close="emit('close')"
      />
      <RvcVoiceTab v-else-if="activeTab === 'voices'" />
      <OnlineStoreTab v-else-if="activeTab === 'online'" />
    </div>
  </FloatingPanel>
</template>

<style scoped>
.store-panel {
  position: fixed;
  inset: 24px;
  z-index: 3000;
  background: oklch(99% 0.003 250 / 0.97);
  backdrop-filter: blur(28px) saturate(1.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  border-radius: 24px;
  border: 1px solid oklch(85% 0.02 250 / 0.5);
  box-shadow: 0 20px 80px oklch(0% 0 0 / 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}
.store-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
}
.store-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: oklch(25% 0.05 250);
}
.close-btn {
  width: 32px; height: 32px;
  border-radius: 999px;
  font-size: 16px;
  color: oklch(45% 0.05 25);
  background: oklch(94% 0.02 25 / 0.5);
  transition: all 150ms;
}
.close-btn:hover { background: oklch(90% 0.05 25 / 0.7); }

/* Tab bar */
.tabbar {
  display: flex;
  gap: 4px;
  padding: 16px 24px 0;
  border-bottom: 1px solid var(--color-divider);
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: 10px 10px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  transition: color var(--duration-fast), background var(--duration-fast);
}
.tab:hover { background: var(--color-bubble-surface); color: var(--color-bubble-text); }
.tab.active {
  color: var(--color-accent);
  background: var(--color-bubble-surface);
  font-weight: 600;
}
/* v0.13 UX: active tab 下面有横条指示器，跟 Material / iOS 一致 */
.tab.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 10px;
  right: 10px;
  height: 2px;
  background: var(--color-accent);
  border-radius: 2px 2px 0 0;
  animation: tab-bar-in 0.3s var(--ease-out-back);
}
@keyframes tab-bar-in {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-radius: 999px;
}
.badge.soon {
  background: oklch(94% 0.06 80 / 0.7);
  color: var(--color-warn);
}
@media (prefers-color-scheme: dark) {
  .badge.soon { background: oklch(35% 0.06 80 / 0.5); }
}

.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
  color: oklch(50% 0.05 250);
}
.ph-icon { font-size: 56px; opacity: 0.6; }
.ph-title { font-size: 18px; font-weight: 600; color: oklch(35% 0.08 250); }
.placeholder p {
  max-width: 480px;
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}
</style>
