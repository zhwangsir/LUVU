/**
 * 工具审批队列 store。
 *
 * 主进程 ←→ renderer 协议：
 *   主 'tools:approval-request' { invocation_id, tool_name, summary, risk, input }
 *   renderer 'tools:approval-decision' { invocation_id, decision }
 *
 * 多个调用并发时按队列展示（一次一个 dialog）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ApprovalDecision, ApprovalRequest } from '@shared/tools'

export const useApprovalStore = defineStore('approval', () => {
  const queue = ref<ApprovalRequest[]>([])
  let unsub: (() => void) | null = null

  const current = computed(() => queue.value[0] ?? null)

  function bootstrap(): void {
    if (unsub) return
    unsub = window.api.tools.onApprovalRequest((req) => {
      queue.value.push(req)
    })
  }

  function teardown(): void {
    unsub?.()
    unsub = null
  }

  function decide(decision: ApprovalDecision): void {
    const req = queue.value.shift()
    if (!req) return
    window.api.tools.sendApprovalDecision({ invocation_id: req.invocation_id, decision })
  }

  return { queue, current, bootstrap, teardown, decide }
})
