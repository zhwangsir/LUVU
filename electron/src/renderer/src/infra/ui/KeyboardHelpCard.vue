<script setup lang="ts">
/**
 * UX R23: 键盘快捷键帮助卡片。
 *
 * 按 "?" 唤起 — 平台感知（mac 显 ⌘，其他显 Ctrl）。
 * 让用户不用看 README 就能发现功能。
 */
import { computed, ref, toRefs } from 'vue'
import { useFocusTrap } from './useFocusTrap'
import { CMD_KEY } from './useCmdKey'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const cardRef = ref<HTMLElement | null>(null)
const { open: openRef } = toRefs(props)
useFocusTrap(cardRef, openRef)

/** R79: 复用全局 CMD_KEY 单例, 不再每组件各算一份 */
const cmdKey = computed(() => CMD_KEY)

// R131-fix (LOW): Section/Shortcut interface 在 filteredSections 之前定义
interface Shortcut {
  keys: string[]
  label: string
}
interface Section {
  title: string
  items: Shortcut[]
}

/** R129: 搜索过滤快捷键 (按 label 子串) */
const search = ref('')

/** R129: 经搜索过滤后的 sections, 空 sections 不显示 */
const filteredSections = computed<Section[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return sections.value
  return sections.value
    .map((sec) => ({
      title: sec.title,
      items: sec.items.filter((it) =>
        it.label.toLowerCase().includes(q) || it.keys.some((k) => k.toLowerCase().includes(q)),
      ),
    }))
    .filter((sec) => sec.items.length > 0)
})

const sections = computed<Section[]>(() => [
  {
    title: '对话',
    items: [
      { keys: ['Space'], label: '展开 / 收起对话输入' },
      { keys: ['Esc'], label: '关闭对话 / 弹窗' },
      { keys: ['Enter'], label: '发送消息' },
      { keys: ['Shift', 'Enter'], label: '换行' },
      { keys: ['↑', '↓'], label: '浏览历史消息（光标在首/末位时）' },
      { keys: [cmdKey.value, '.'], label: '中止正在生成的回复' },
    ],
  },
  {
    title: '界面',
    items: [
      { keys: [cmdKey.value, '='], label: '放大 UI（不影响立绘）' },
      { keys: [cmdKey.value, '-'], label: '缩小 UI' },
      { keys: [cmdKey.value, '0'], label: '恢复默认 UI 缩放' },
      { keys: [cmdKey.value, 'K'], label: '全局搜索（命令 / 角色 / 历史）' },
      { keys: [cmdKey.value, 'Shift', 'T'], label: '循环切换主题（自动/浅/深）' },
      { keys: ['?'], label: '打开本帮助卡' },
    ],
  },
  {
    title: '立绘',
    items: [
      { keys: ['右键'], label: '弹出主菜单（角色 / 设置 / 灵魂 / 健康）' },
      { keys: ['拖动'], label: '移动桌宠位置' },
      { keys: ['滚轮'], label: '缩放立绘大小' },
      { keys: ['双击'], label: '触发互动动作' },
    ],
  },
  {
    title: '设置面板内',
    items: [
      { keys: ['←', '→'], label: '切换设置 tab' },
      { keys: ['Home', 'End'], label: '跳到首 / 末 tab' },
    ],
  },
  {
    title: 'Spotlight 内 (Cmd+K)',
    items: [
      { keys: ['/', '...'], label: '前缀过滤: 仅命令' },
      { keys: ['@', '...'], label: '前缀过滤: 仅角色' },
      { keys: [cmdKey.value, '1-9'], label: '直选第 N 项' },
      { keys: ['↑', '↓'], label: '上下选择 (wrap)' },
    ],
  },
  {
    title: '调试',
    items: [
      { keys: [cmdKey.value, 'Alt', 'I'], label: '打开 DevTools（需 LUVU_DEBUG=1）' },
    ],
  },
])

function onBackdrop(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('overlay')) {
    emit('close')
  }
}
</script>

<template>
  <transition name="help">
    <div v-if="open" class="overlay" @click="onBackdrop">
      <div ref="cardRef" class="card" role="dialog" aria-modal="true" aria-label="键盘快捷键">
        <header>
          <h2>键盘快捷键</h2>
          <input
            v-model="search"
            class="kbd-search"
            type="text"
            placeholder="🔍 过滤..."
            spellcheck="false"
            autocomplete="off"
            aria-label="过滤快捷键"
          />
          <button class="close-btn" aria-label="关闭" @click="emit('close')">✕</button>
        </header>
        <div class="body">
          <p v-if="filteredSections.length === 0" class="kbd-empty">
            没有匹配的快捷键
          </p>
          <section v-for="sec in filteredSections" :key="sec.title" class="sec">
            <h3>{{ sec.title }}</h3>
            <ul>
              <li v-for="it in sec.items" :key="it.label">
                <span class="keys">
                  <kbd v-for="k in it.keys" :key="k" class="kbd">{{ k }}</kbd>
                </span>
                <span class="label">{{ it.label }}</span>
              </li>
            </ul>
          </section>
        </div>
        <footer>
          <span class="tip">按 ? 随时唤起本卡 · 按 Esc 关闭</span>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  backdrop-filter: blur(4px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 560px;
  max-height: 82vh;
  overflow: auto;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
/* R129: 搜索框 */
.kbd-search {
  flex: 1;
  margin: 0 12px;
  padding: 6px 10px;
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.kbd-search:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus);
}
.kbd-empty {
  padding: 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: var(--text-sm);
  margin: 0;
}

.close-btn {
  background: transparent;
  color: var(--color-muted);
  font-size: var(--text-sm);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.close-btn:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}
.body {
  padding: 16px 20px 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
@media (max-width: 520px) {
  .body {
    grid-template-columns: 1fr;
  }
}
.sec h3 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sec ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sec li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-sm);
  line-height: 1.4;
}
.keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-bubble-border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-bubble-text);
  box-shadow: 0 1px 0 oklch(0% 0 0 / 0.08);
}
.label {
  color: var(--color-muted);
  text-align: right;
  flex: 1;
}
footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-bubble-border);
  text-align: center;
}
.tip {
  font-size: 11px;
  color: var(--color-muted);
}

.help-enter-active,
.help-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.help-enter-from,
.help-leave-to {
  opacity: 0;
}
.help-enter-active .card,
.help-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.help-enter-from .card,
.help-leave-to .card {
  transform: scale(0.95) translateY(8px);
}
</style>
