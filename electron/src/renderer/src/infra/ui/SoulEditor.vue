<script setup lang="ts">
/**
 * v0.14 P2-T8: SoulEditor — 编辑当前 character 的灵魂 yaml 文件。
 *
 * 4 个 tab: identity / personality / learned_traits / core_memories
 * 大 textarea 直接编辑 yaml，保存触发 soul reload
 */
import { onMounted, ref, watch } from 'vue'
import { useCharacterStore } from '../stores/character'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import FloatingPanel from './FloatingPanel.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const character = useCharacterStore()
const cfg = useConfigStore()

type SoulFile = 'identity' | 'personality' | 'learned_traits' | 'core_memories'
const tabs: Array<{ id: SoulFile; label: string; icon: string; hint: string }> = [
  { id: 'identity', label: '身份', icon: '🪪', hint: '名字 / 称呼 / 立绘 / 生日' },
  { id: 'personality', label: '性格', icon: '💖', hint: '三层人格 / signature_lines / 反差' },
  { id: 'learned_traits', label: '习得', icon: '📓', hint: 'LLM 累积的观察 / 你的偏好' },
  { id: 'core_memories', label: '记忆', icon: '💎', hint: '关键事件 / 纪念日 / 共同回忆' },
]

const activeTab = ref<SoulFile>('personality')
const content = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)

async function loadTab(tab: SoulFile): Promise<void> {
  if (!character.active) return
  loading.value = true
  try {
    const r = await window.api.characters.readSoulFile({
      id: character.active.id,
      filename: `${tab}.yaml`,
    })
    if (r.ok) {
      content.value = r.content ?? ''
      original.value = content.value
      dirty.value = false
    } else {
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '读取失败', ttl_ms: 4000 })
    }
  } finally {
    loading.value = false
  }
}

watch(activeTab, (t) => loadTab(t), { immediate: false })
watch(content, () => {
  dirty.value = content.value !== original.value
})

async function save(): Promise<void> {
  if (!character.active || !dirty.value) return
  saving.value = true
  try {
    const r = await window.api.characters.writeSoulFile({
      id: character.active.id,
      filename: `${activeTab.value}.yaml`,
      content: content.value,
    })
    if (r.ok) {
      original.value = content.value
      dirty.value = false
      // soul:changed 已由主进程发，cfg.reloadSoul 会被监听
      await cfg.reloadSoul()
      bus.emit('ui:toast', { kind: 'success', message: '已保存并热重载灵魂', ttl_ms: 2500 })
    } else {
      bus.emit('ui:toast', { kind: 'error', message: `保存失败: ${r.reason}`, ttl_ms: 5000 })
    }
  } finally {
    saving.value = false
  }
}

function close(): void {
  if (dirty.value && !confirm('有未保存的改动，确定离开？')) return
  emit('close')
}

onMounted(() => loadTab(activeTab.value))
</script>

<template>
  <FloatingPanel
    storage-key="soul-editor"
    :title="`✏️ 编辑灵魂${character.active ? ' — ' + character.active.name : ''}`"
    theme="dark"
    :defaults="{ width: 820, height: 700 }"
    @close="close"
  >
    <template #sub-header>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          :class="['tab', { active: activeTab === t.id }]"
          @click="activeTab = t.id"
        >
          <span class="t-icon">{{ t.icon }}</span>
          <span class="t-label">{{ t.label }}</span>
        </button>
      </nav>
      <div class="hint-bar">
        {{ tabs.find((t) => t.id === activeTab)!.hint }}
      </div>
    </template>

    <div class="body">
      <div v-if="loading" class="loading">加载中…</div>
      <textarea
        v-else
        v-model="content"
        class="editor"
        spellcheck="false"
        placeholder="# yaml 内容\nschema_version: '2.0'\n..."
      ></textarea>
    </div>

    <template #footer>
      <div class="ft-bar">
        <span v-if="dirty" class="dirty-tag">● 有未保存的改动</span>
        <span v-else-if="!loading" class="clean-tag">✓ 已是最新</span>
        <span class="spacer"></span>
        <button class="ghost" @click="close">关闭</button>
        <button class="primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? '保存中…' : '保存并热重载' }}
        </button>
      </div>
    </template>
  </FloatingPanel>
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
  max-width: 720px;
  height: 86vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-divider);
}
.header-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.header-sub {
  font-size: var(--text-sm);
  color: var(--color-muted);
}
.x-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: var(--color-muted);
}
.x-btn:hover {
  background: var(--color-bubble-surface-hover);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 20px 0;
  background: var(--color-bubble-surface);
  border-bottom: 1px solid var(--color-divider);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  font-size: 12px;
  color: var(--color-muted);
  background: transparent;
  border-radius: 8px 8px 0 0;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
}
.tab:hover {
  color: var(--color-bubble-text);
  background: var(--color-bubble);
}
.tab.active {
  color: var(--color-accent);
  background: var(--color-bubble);
  font-weight: 600;
}
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
.t-icon { font-size: 14px; }

.hint-bar {
  padding: 8px 20px;
  font-size: 11px;
  color: var(--color-muted);
  background: var(--color-bubble-surface);
  border-bottom: 1px solid var(--color-divider);
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  overflow: hidden;
}
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: var(--text-sm);
}
.editor {
  flex: 1;
  resize: none;
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.editor:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus);
}

footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-divider);
}
.dirty-tag {
  font-size: 12px;
  color: var(--color-warn);
  font-weight: 500;
}
.clean-tag {
  font-size: 12px;
  color: var(--color-success);
}
.spacer { flex: 1; }
.ghost,
.primary {
  padding: 8px 16px;
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
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

.soul-editor-enter-active,
.soul-editor-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.soul-editor-enter-from,
.soul-editor-leave-to {
  opacity: 0;
}
.soul-editor-enter-active .card,
.soul-editor-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.soul-editor-enter-from .card,
.soul-editor-leave-to .card {
  transform: scale(0.94) translateY(20px);
}
</style>
