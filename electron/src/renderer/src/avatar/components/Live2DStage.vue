<script setup lang="ts">
/**
 * Live2DStage — 立绘舞台「协调器」(RFC 0002 Round Q1 + Q2)。
 *
 * Q1:渲染逻辑下沉到 Live2DInstance,Stage 持窗口级 WindowInteraction。
 * Q2:v-for(character.mounted)多实例横排。
 *   - N=1(典型):单 instance 填满舞台,active,走 cfg.soul 路径 → 与 Q1 逐字等价
 *   - N>1:active 走 cfg.soul,非 active 传 modelDir 加载自己角色模型;横排等分
 *
 * WindowInteraction 是 Electron BrowserWindow 级单例(setIgnoreMouseEvents 整窗生效,
 * 不可 per-character 拆,RFC §3.4)→ 只接 active instance 的 sampler。
 * 非 active 的 hit-test 路由(first-hit-wins)留 Q4。
 *
 * 容器 class 必须保留 `live2d-stage` — window-interaction.ts isOverUiElement()
 * 靠它判定"非 UI 区"放行穿透(见该文件 line 130)。
 */
import { onBeforeUnmount, ref, watch, computed } from 'vue'
import type { Live2DRenderer } from '../render/live2d-renderer'
import type { AlphaSampler } from '../interaction/alpha-hit'
import type { BehaviorPlan } from '@shared/attention'
import { WindowInteraction } from '../interaction/window-interaction'
import { executePlan } from '../plan-executor'
import { computeInstanceLayout } from '../layout'
import { useCharacterStore } from '../../infra/stores/character'
import { bus } from '../../infra/eventbus'
import type { Character } from '@shared/character'
import Live2DInstance from './Live2DInstance.vue'

const props = defineProps<{
  passthroughEnabled?: boolean
}>()

const character = useCharacterStore()
const containerRef = ref<HTMLDivElement | null>(null)

let interaction: WindowInteraction | null = null
/**
 * 当前 active instance 的 renderer —— plan-executor 执行 BehaviorPlan 时需要它
 * (play_motion / play_group / glance / change_emotion 等动作直接操作 renderer)。
 * 由 onInstanceReady 在 active instance 就绪时存入。
 *
 * N=1 当前安全:Vue 父先于子 unmount,Stage.onBeforeUnmount 先把它置 null,
 * 之后 Live2DInstance 才 destroy renderer,onExecutePlan 的 `!activeRenderer` guard 拦住。
 * ⚠️ Q4 前置(reviewer Q-MEDIUM):active hot-swap(切角色不 unmount Stage)时,旧
 * instance destroy 到新 instance ready 之间有窗口期,activeRenderer 指向已销毁 renderer。
 * Q4 实施时须在 character.active 变化时(watch)清 activeRenderer=null 关掉这个窗口。
 */
let activeRenderer: Live2DRenderer | null = null

const passthrough = computed(() => props.passthroughEnabled !== false)

/**
 * 要渲染的 instance 列表。正常 = mounted(后端保证含 active 且非空)。
 * 防御:mounted 为空(bootstrap 异常)时退化到 [active],再空则 []。
 * N=1 时 = [active],与 Q1 单实例等价。
 */
const renderList = computed<Character[]>(() => {
  if (character.mounted.length > 0) return character.mounted
  if (character.active) return [character.active]
  return []
})

/** active instance 不传 modelDir → 走 cfg.soul 路径(N=1 逐字不变)。 */
function isActiveChar(c: Character): boolean {
  return c.id === character.active?.id
}

/** instance 渲染就绪 → 仅用 active instance 的 sampler 装配窗口级 WindowInteraction */
function onInstanceReady(payload: {
  characterId: string
  renderer: Live2DRenderer
  sampler: AlphaSampler
}): void {
  // Q2:只 wire active 的 sampler。非 active 的 hit-test 路由(first-hit-wins)留 Q4。
  if (payload.characterId !== (character.active?.id ?? '')) return
  if (!containerRef.value) return
  // 存 active renderer 供 plan-executor 用(主动行为 / dialog reply actions 执行)
  activeRenderer = payload.renderer
  // 防御性销毁旧的(Q4 active hot-swap 时复用此路径)。
  // reviewer Q1-Point2:destroy() 必须先完成(set destroyed=true + 停 cursor poll)
  // 再用新 sampler,否则旧 poll tick 可能命中已 destroy 的 sampler。Q4 hot-swap load-bearing。
  interaction?.destroy()
  interaction = new WindowInteraction({
    container: containerRef.value,
    sampler: payload.sampler,
    renderer: payload.renderer,
    passthroughEnabled: () => passthrough.value,
  })
}

/**
 * 主体性执行链接通(修 pre-existing 断点):App.vue 把 main 算出的 BehaviorPlan
 * (主动巡视)和 dialog reply 内联 actions 都 emit 成 `attention:execute-plan`,
 * 但此前**无人监听** → plan-executor.executePlan 从未被调用 → 主动行为(speak /
 * play_motion / change_emotion / generate_sticker / agent_task)全部丢弃。
 *
 * 这里由协调器接住,用 active instance 的 renderer + 舞台 container 执行。
 * executePlan 内部自带 abort-old-on-new,并发 plan 安全。
 */
const onExecutePlan = ({ plan }: { plan: BehaviorPlan }): void => {
  if (!activeRenderer || !containerRef.value) return
  void executePlan(plan, { renderer: activeRenderer, container: containerRef.value })
}
bus.on('attention:execute-plan', onExecutePlan)

watch(passthrough, (on) => {
  interaction?.forceInteractive(!on)
})

onBeforeUnmount(() => {
  bus.off('attention:execute-plan', onExecutePlan)
  interaction?.destroy()
  interaction = null
  activeRenderer = null
})
</script>

<template>
  <div ref="containerRef" class="live2d-stage">
    <Live2DInstance
      v-for="(c, i) in renderList"
      :key="c.id"
      :character-id="c.id"
      :is-active="isActiveChar(c)"
      :layout-hint="computeInstanceLayout(renderList.length, i)"
      :model-dir="isActiveChar(c) ? undefined : c.live2d_model_dir"
      :model-file="isActiveChar(c) ? undefined : c.live2d_model_file"
      @ready="onInstanceReady"
    />
  </div>
</template>

<style scoped>
.live2d-stage {
  position: absolute;
  inset: 0;
  background: transparent;
}
</style>
