<script setup lang="ts">
import { computed } from 'vue'
import { useApprovalStore } from '../../hands/approval-store'

const approval = useApprovalStore()
const cur = computed(() => approval.current)

const riskLabel: Record<string, string> = {
  low: '低风险（只读）',
  medium: '中等（本地无害）',
  high: '高风险（修改/外发）',
}

function inputPreview(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}: ${s.length > 120 ? s.slice(0, 120) + '…' : s}`
    })
    .join('\n')
}
</script>

<template>
  <transition name="approve">
    <div v-if="cur" class="overlay" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div class="card" :data-risk="cur.risk">
        <header>
          <h2 id="approval-title">LUVU 想用一个工具</h2>
          <span class="risk-pill" :data-risk="cur.risk">{{ riskLabel[cur.risk] ?? cur.risk }}</span>
        </header>
        <section class="body">
          <p class="summary">{{ cur.summary }}</p>
          <details>
            <summary>查看完整调用</summary>
            <div class="meta">
              <div><strong>工具：</strong>{{ cur.tool_name }}</div>
              <div><strong>说明：</strong>{{ cur.description }}</div>
            </div>
            <pre>{{ inputPreview(cur.input) }}</pre>
          </details>
        </section>
        <footer>
          <button class="ghost" @click="approval.decide('deny_always')">永远拒绝</button>
          <button class="ghost" @click="approval.decide('deny_once')">这次不要</button>
          <button class="primary" @click="approval.decide('allow_once')">这次允许</button>
          <button class="primary strong" @click="approval.decide('allow_always')">永远允许</button>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0% 0 0 / 0.32);
  backdrop-filter: blur(3px);
  z-index: 1800;
  pointer-events: auto;
}
.card {
  width: min(440px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--color-bubble-text);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.card[data-risk='high'] {
  border-color: oklch(75% 0.18 25 / 0.6);
  box-shadow: var(--shadow-lg), 0 0 0 3px oklch(85% 0.15 25 / 0.25);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}
.risk-pill {
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  background: oklch(94% 0.025 145 / 0.7);
  color: oklch(40% 0.12 145);
}
.risk-pill[data-risk='medium'] {
  background: oklch(94% 0.05 80 / 0.7);
  color: oklch(45% 0.15 80);
}
.risk-pill[data-risk='high'] {
  background: oklch(94% 0.08 25 / 0.7);
  color: oklch(45% 0.18 25);
}
.body {
  padding: 14px 20px 6px;
}
.summary {
  margin: 0 0 10px;
  font-size: var(--text-base);
  line-height: 1.55;
}
details summary {
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin-bottom: 8px;
}
.meta {
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin: 6px 0 8px;
  line-height: 1.6;
}
pre {
  margin: 0;
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.5;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--color-bubble-text);
}
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
  padding: 12px 20px 14px;
  border-top: 1px solid var(--color-bubble-border);
}
.ghost,
.primary {
  padding: 7px 14px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--duration-fast);
  white-space: nowrap;
}
.ghost {
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
}
.ghost:hover {
  background: oklch(92% 0.015 25 / 0.9);
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.primary.strong {
  background: oklch(55% 0.2 145);
}

.approve-enter-active,
.approve-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.approve-enter-from,
.approve-leave-to {
  opacity: 0;
}
.approve-enter-active .card,
.approve-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-expo);
}
.approve-enter-from .card,
.approve-leave-to .card {
  transform: scale(0.96) translateY(6px);
}
</style>
