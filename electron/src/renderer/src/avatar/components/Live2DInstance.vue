<script setup lang="ts">
/**
 * Live2DInstance — 单个角色的 Live2D 渲染单元(RFC 0002 Round Q1)。
 *
 * 从 Live2DStage.vue 抽出:canvas + Live2DRenderer + AlphaSampler + 模型加载
 * + per-instance bus handler(lipsync / vowel / emotion / hover / zoom / reload)
 * + 呼吸动画 + loading/error overlay。
 *
 * 窗口级的 WindowInteraction(穿透 / 拖动 / 右键)留在父级 Live2DStage —
 * 它是 Electron BrowserWindow 级单例,不可 per-character 拆(见 RFC §3.4)。
 * instance 把自己的 sampler 通过 emit('ready') 上报,由 Stage 装配。
 *
 * Q1 阶段:characterId / isActive 为 Q2(v-for)/ Q3(视觉降级)铺路,
 * 内部 pickAndLoad 仍读 cfg.soul(active model),行为与重构前完全一致。
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Live2DRenderer } from '../render/live2d-renderer'
import { AlphaSampler } from '../interaction/alpha-hit'
import type { InstanceLayout } from '../layout'
import { useConfigStore } from '../../infra/stores/config'
import { bus } from '../../infra/eventbus'

const props = defineProps<{
  /** M8 character id */
  characterId: string
  /** 是否 active — Q3 将驱动视觉降级(scale/opacity/saturate) */
  isActive: boolean
  /** 舞台 slot 布局(Q2 横排)。N=1 时为填满整舞台,行为与 Q1 等价 */
  layoutHint: InstanceLayout
  /**
   * Q2:非 active instance 加载「自己角色」的模型(来自 Character.live2d_model_dir)。
   * active instance 不传 → 走原 cfg.soul 路径(逐字不变,N=1 安全)。
   * 显式 `| undefined`:exactOptionalPropertyTypes 下允许模板 `:model-dir="cond ? undefined : x"`。
   */
  modelDir?: string | undefined
  modelFile?: string | undefined
}>()

const emit = defineEmits<{
  /** 渲染就绪 → 上报 characterId + renderer + sampler 给 Live2DStage 装配 WindowInteraction */
  ready: [payload: { characterId: string; renderer: Live2DRenderer; sampler: AlphaSampler }]
}>()

const cfg = useConfigStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const rootRef = ref<HTMLDivElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMsg = ref<string>('')
// v0.15 A3: 当前情绪，驱动 CSS 呼吸节奏
const currentEmotion = ref<string>('neutral')
const currentIntensity = ref(0.5)

let renderer: Live2DRenderer | null = null
let sampler: AlphaSampler | null = null
/** v0.17: 在 onMounted 内注册的 bus.on 清理列表 — onBeforeUnmount 统一调用，防 listener 泄漏 */
const cleanupHandlers: Array<() => void> = []
/** Q1: 窗口 resize 监听句柄 — 搬进 instance 后补 onBeforeUnmount 清理(原 Stage 漏清,见 commit 说明) */
let onResize: (() => void) | null = null

onMounted(async () => {
  if (!canvasRef.value || !rootRef.value) return
  const { offsetWidth: w, offsetHeight: h } = rootRef.value
  renderer = new Live2DRenderer({ canvas: canvasRef.value, width: w, height: h })

  await pickAndLoad()

  if (!renderer) return
  sampler = new AlphaSampler(renderer)

  // RFC §3.4: 上报 sampler/renderer 给父级 Live2DStage 装配窗口级 WindowInteraction
  emit('ready', { characterId: props.characterId, renderer, sampler })
  // v0.21：初次广播头部锚点（延迟一次等 model bounds 稳定）→ 气泡跟随头顶
  emitHeadPos()
  setTimeout(emitHeadPos, 250)

  // 嘴型驱动 —— 监听总线
  const lipsyncHandler = ({ value }: { value: number }): void => {
    renderer?.setLipsync(value)
  }
  bus.on('avatar:lipsync', lipsyncHandler)

  // Phase 1 W3: AEIOU 元音权重驱动 ParamMouthForm + 多参数（VRoid 风格）
  const vowelHandler = (w: { A: number; E: number; I: number; O: number; U: number }): void => {
    renderer?.setVowelWeights(w)
  }
  bus.on('avatar:vowel-weights', vowelHandler)

  // v0.15 A3: 情绪变化驱动 stage 整体呼吸节奏
  // P5: 同时尝试切换 Live2D expression — 若模型有匹配的 expression，
  // 立刻播让情绪在脸上"看得到"。intensity > 0.3 才触发避免微调闪烁
  const emotionHandler = ({ emotion, intensity }: { emotion: string; intensity: number }): void => {
    currentEmotion.value = emotion
    currentIntensity.value = intensity
    // ts-reviewer HIGH: 防 race — 动态 import 的 Promise resolve 时 renderer 可能已被
    // onBeforeUnmount 置 null。把 renderer 闭包成 snapshot 并显式 guard
    const snapshot = renderer
    if (snapshot && intensity > 0.3) {
      void import('../render/expression-matcher').then(({ matchExpression }) => {
        if (!snapshot || snapshot !== renderer) return // 组件已卸载或 renderer 已重建
        const available = snapshot.listExpressions()
        const matched = matchExpression(emotion, available)
        if (matched) snapshot.setExpression(matched)
      })
    }
  }
  bus.on('brain:emotion-changed', emotionHandler)

  // v0.17：鼠标 hover 立绘像素时的微反应 — 让她"感受到"主人
  //   - 鼠标进入 alpha 命中区（不是只进窗口）→ 12 秒冷却内 35% 概率触发一次小动作
  //   - 冷却 12 秒避免来回 hover 时疯狂触发
  // 修复(实测 model 无 FlickLeft/FlickUp → playMotionGroup no-op,hover 不动):
  //   不再硬编码组名,从模型「实际拥有的组」里选 —— 优先轻反应组(Tap/Flick*),
  //   模型没有这些就退回任意可用组,保证任何模型都能动起来。
  let lastHoverReactAt = 0
  const HOVER_REACT_COOLDOWN_MS = 12_000
  const HOVER_REACT_PREFERRED = ['FlickLeft', 'FlickRight', 'Tap', 'FlickUp', 'TapBody', 'Flick']
  const HOVER_REACT_EMOTIONS: Array<'shy' | 'happy' | 'tease'> = ['shy', 'happy', 'tease']
  const hoverHandler = ({ inside }: { inside: boolean }): void => {
    if (!inside) return
    if (!renderer) return
    const now = Date.now()
    if (now - lastHoverReactAt < HOVER_REACT_COOLDOWN_MS) return
    if (Math.random() > 0.35) return
    const available = renderer.listMotionGroups()
    if (available.length === 0) return // 模型无任何动作组 → 不强行
    const preferred = HOVER_REACT_PREFERRED.filter((g) => available.includes(g))
    const pool = preferred.length > 0 ? preferred : available
    lastHoverReactAt = now
    const group = pool[Math.floor(Math.random() * pool.length)]!
    const emo = HOVER_REACT_EMOTIONS[Math.floor(Math.random() * HOVER_REACT_EMOTIONS.length)]!
    renderer.playMotionGroup(group)
    bus.emit('brain:emotion-changed', { emotion: emo, intensity: 0.5 })
  }
  bus.on('avatar:mouse-inside', hoverHandler)

  // v0.21：可选「眼神跟随鼠标」——开关在设置。开启时每个 cursor tick 把视线投向光标。
  // 只 active 实例响应；关闭时不驱动视线（交回 SDK idle + BehaviorPlanner）。
  const gazeFollowHandler = ({ x, y }: { inside: boolean; x: number; y: number }): void => {
    if (props.modelDir) return
    if (!renderer) return
    if (cfg.config?.gaze_follow_cursor !== true) return
    renderer.setGaze(x, y)
  }
  bus.on('avatar:mouse-inside', gazeFollowHandler)

  cleanupHandlers.push(() => {
    bus.off('avatar:lipsync', lipsyncHandler)
    bus.off('avatar:vowel-weights', vowelHandler)
    bus.off('brain:emotion-changed', emotionHandler)
    bus.off('avatar:mouse-inside', hoverHandler)
    bus.off('avatar:mouse-inside', gazeFollowHandler)
  })

  // 窗口尺寸响应（节流）
  onResize = (): void => {
    if (!renderer || !rootRef.value) return
    renderer.resize(rootRef.value.offsetWidth, rootRef.value.offsetHeight)
    emitHeadPos()
  }
  window.addEventListener('resize', onResize)
})

watch(
  () => cfg.soul?.avatar.model_dir,
  async (dir, prev) => {
    if (!renderer) return
    // Q2:非 active instance(有 modelDir)不跟 active soul 变化走 — cfg.soul 是 active 的
    if (props.modelDir) return
    if (!dir || dir === prev) return
    await pickAndLoad()
  },
)

// Q2:非 active instance 的角色模型变化(用户编辑了该角色 live2d_model_dir)→ 重载
watch(
  () => props.modelDir,
  async (dir, prev) => {
    if (!renderer) return
    if (!dir || dir === prev) return
    await pickAndLoad()
  },
)

// v0.8.2: 接收强制 reload — 动作工坊保存 / Heal 后用
const onReloadModel = (): void => {
  if (renderer) void pickAndLoad()
}
bus.on('avatar:reload-model', onReloadModel)

// v0.9→v0.21: 立绘缩放（滚轮 / 菜单 ⊕⊖）+ 拖动移动 + 节流持久化（scale + offset_x/y，按角色）
let lastSavedCharId: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 当前 active 角色的 character_id（持久化 key）；非 active 实例（有 modelDir）返回 null */
function activeCharId(): string | null {
  if (props.modelDir) return null
  const currentDir = cfg.soul?.avatar.model_dir
  const found = currentDir ? cfg.models.find((m) => m.dir === currentDir) : null
  return found?.meta?.character_id ?? null
}

/** 节流持久化立绘 scale + offset（500ms）—— 从 renderer 读真实当前值 */
function persistAvatarPref(): void {
  const charId = activeCharId()
  if (!charId || !renderer) return
  lastSavedCharId = charId
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!renderer || !lastSavedCharId) return
    const off = renderer.getOffset()
    void window.api.models.setPreference({
      character_id: lastSavedCharId,
      scale: renderer.getScaleHint(),
      offset_x: off.x,
      offset_y: off.y,
    })
  }, 500)
}

/** v0.21：广播头部锚点，让对话气泡跟随立绘头顶（仅 active 实例） */
function emitHeadPos(): void {
  if (props.modelDir) return
  const a = renderer?.getHeadAnchor()
  if (a) bus.emit('avatar:head-pos', a)
}

const onZoom = (payload: { delta: number; reset?: boolean }): void => {
  if (!renderer) return
  if (props.modelDir) return // 只 active 实例响应全局缩放
  if (payload.reset) {
    renderer.applyScaleHint(1.0)
    const o = renderer.getOffset()
    renderer.nudgeOffset(-o.x, -o.y) // 复位到画布中心
  } else {
    renderer.applyScaleHint(renderer.getScaleHint() + payload.delta)
  }
  persistAvatarPref()
  emitHeadPos()
}
bus.on('avatar:zoom', onZoom)

// v0.21 全屏画板：拖动立绘 → 在画布内移动（不再移动窗口）
const onMove = (payload: { dx: number; dy: number }): void => {
  if (!renderer) return
  if (props.modelDir) return // 只 active 实例响应拖动
  renderer.nudgeOffset(payload.dx, payload.dy)
  persistAvatarPref()
  emitHeadPos()
}
bus.on('avatar:move', onMove)

/** v0.17：记录加载失败的 dir，下次 pickAndLoad 跳过它 */
const failedDirs = new Set<string>()
const MAX_FALLBACK_ATTEMPTS = 3

/**
 * Q2:非 active instance 的模型加载 — 按 props.modelDir 加载「自己角色」的模型。
 * 不碰 active soul(无 saveAvatar)、不做 cubism2 自动切换、不刷 toast — 这些
 * 副作用只属于 active 的 pickAndLoad。失败仅置 error 状态 + console。
 *
 * reviewer Q2-MEDIUM(Q4 前置条件):本函数复用既有 renderer(只 loadModel 换 model,
 * 不重建 renderer/sampler)→ 上报给 Stage 的 sampler 引用始终有效,无需 re-emit ready。
 * 若 Q4/Q5 改成重建 renderer,则必须重新 emit('ready') 让 Stage 更新 WindowInteraction sampler。
 */
async function loadSpecificModel(modelDir: string, modelFile: string | undefined): Promise<void> {
  if (!renderer) return
  status.value = 'loading'
  try {
    if (cfg.models.length === 0) await cfg.rescanModels()
    const found =
      cfg.models.find(
        (m) => m.dir === modelDir && (!modelFile || m.model_file === modelFile),
      ) ?? cfg.models.find((m) => m.dir === modelDir)
    if (!found || found.cubism !== 'cubism4' || !found.meta?.has_core) {
      status.value = 'error'
      errorMsg.value = `角色模型「${modelDir}」未找到或不完整`
      console.warn('[live2d] non-active model load failed:', modelDir, found?.cubism, found?.meta?.has_core)
      return
    }
    // per-character preference(M8 已 per-character,按 character_id 隔离)
    let userHint = 1.0
    let offsetX = 0
    let offsetY = 0
    const prefCharId = found.meta?.character_id
    if (prefCharId) {
      const pref = await window.api.models.getPreference(prefCharId)
      if (pref) {
        userHint = pref.scale
        offsetX = pref.offset_x ?? 0
        offsetY = pref.offset_y
      }
    }
    await renderer.loadModel(found.file_url, { scale: userHint, offsetX, offsetY })
    status.value = 'ready'
  } catch (e) {
    console.error('[live2d] non-active load failed', e)
    status.value = 'error'
    errorMsg.value = String(e)
  }
}

async function pickAndLoad(): Promise<void> {
  if (!renderer) return
  // Q2:非 active instance 走简化的按角色加载路径(不碰 active soul)
  if (props.modelDir) {
    return loadSpecificModel(props.modelDir, props.modelFile)
  }
  status.value = 'loading'
  try {
    if (cfg.models.length === 0) await cfg.rescanModels()

    const wanted = cfg.soul?.avatar.model_dir
    const wantedFile = cfg.soul?.avatar.model_file

    const exact =
      cfg.models.find(
        (m) => m.dir === wanted && (!wantedFile || m.model_file === wantedFile),
      ) ?? cfg.models.find((m) => m.dir === wanted)

    // diagnostic：让 main log 能看到 wanted vs 是否有匹配
    console.warn(
      `[live2d] PICK wanted="${wanted}" file="${wantedFile}" exact=${exact ? 'HIT' : 'MISS'} totalModels=${cfg.models.length}`,
    )
    if (!exact && wanted) {
      const partial = cfg.models.filter((m) => m.dir.includes(wanted ?? '') || (wanted ?? '').includes(m.dir))
      console.warn(`[live2d] PICK partial matches:`, partial.slice(0, 3).map((m) => ({ dir: m.dir, file: m.model_file })))
    }

    // v0.6.11: 优先级 = ⭐ builtin 推荐 > 完整 cubism4 > 任意 cubism4 > 报错
    const recommended = cfg.models.filter((m) => m.meta?.recommended)
    const completeC4 = cfg.models.filter(
      (m) => m.cubism === 'cubism4' && m.meta?.complete,
    )
    const anyC4 = cfg.models.filter((m) => m.cubism === 'cubism4')
    const fallbackChain = [...recommended, ...completeC4.filter((m) => !recommended.includes(m)), ...anyC4]
    let found = exact

    // 选了 cubism2 → fallback
    if (found && found.cubism !== 'cubism4') {
      const fallback = fallbackChain[0]
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${found.dir}」是 Cubism 2 格式，当前不支持。已自动切到「${fallback.dir}」`,
          ttl_ms: 6000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        found = fallback
      } else {
        status.value = 'error'
        errorMsg.value = `「${found.dir}」是 Cubism 2 格式，当前版本不支持；也没有任何 Cubism 4 (*.model3.json) 模型可用`
        bus.emit('ui:toast', { kind: 'error', message: errorMsg.value, ttl_ms: 8000 })
        return
      }
    }

    // 选了 cubism4 但缺关键资源（moc/texture）→ fallback
    if (found && found.cubism === 'cubism4' && found.meta && !found.meta.has_core) {
      const fallback = fallbackChain.find((m) => m.dir !== found?.dir)
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${found.dir}」缺失关键文件（${found.meta.reason ?? '未知'}）。已自动切到「${fallback.dir}」`,
          ttl_ms: 6000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        found = fallback
      }
    }

    if (!found) found = fallbackChain[0] ?? cfg.models[0]

    if (!found) {
      status.value = 'error'
      errorMsg.value = '未找到任何 Live2D 模型。请把模型放到 ~/.luvu/models 或项目根目录。'
      console.warn('[live2d] no model found at all')
      return
    }

    if (found.cubism !== 'cubism4') {
      status.value = 'error'
      errorMsg.value = '只找到 Cubism 2 模型，当前版本仅支持 Cubism 4 (*.model3.json)'
      bus.emit('ui:toast', { kind: 'error', message: errorMsg.value, ttl_ms: 8000 })
      return
    }

    // v0.9→v0.21: 优先用 model 的 per-character preference（user 调过的 scale + 画布内位置）
    // 没存过就走默认（scale=1.0 约半屏高、居中）
    let userHint = 1.0
    let offsetX = 0
    let offsetY = 0
    const charId = found.meta?.character_id
    if (charId) {
      const pref = await window.api.models.getPreference(charId)
      if (pref) {
        userHint = pref.scale
        offsetX = pref.offset_x ?? 0
        offsetY = pref.offset_y
      }
    }
    await renderer.loadModel(found.file_url, { scale: userHint, offsetX, offsetY })
    status.value = 'ready'
    bus.emit('avatar:model-loaded', {
      model_path: found.absolute_path,
      cubism: found.cubism,
    })
    // v0.6.11 运行时验证：加载 1.5s 后 alpha sampler 检查
    // 修订：不再自动 fallback —— 调试期间隐藏错误成本太高，宁可白屏让用户看到
    const loadedDir = found.dir
    setTimeout(() => {
      if (!sampler || !renderer) return
      if (status.value !== 'ready') return
      if (cfg.soul?.avatar.model_dir !== loadedDir) return
      if (sampler.isReady() && !sampler.hasOpaque()) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${loadedDir}」加载后画面全透明（模型加载成功但 PIXI 渲染 0 像素）。打开 DevTools (Cmd+Opt+I) 看 console 错误`,
          ttl_ms: 15000,
        })
        console.warn('[live2d] alpha sampler: 0 opaque pixels for', loadedDir, found.file_url)
      }
    }, 1500)
  } catch (e) {
    console.error('[live2d] load failed', e)
    const failedDir = cfg.soul?.avatar.model_dir
    if (failedDir) failedDirs.add(failedDir)
    // v0.17：自动 fallback 到第一个可用且未失败的模型，最多 3 次
    if (failedDirs.size < MAX_FALLBACK_ATTEMPTS) {
      const fallback = cfg.models.find(
        (m) => m.cubism === 'cubism4' && m.meta?.has_core && !failedDirs.has(m.dir),
      )
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${failedDir}」加载失败，自动切到「${fallback.dir}」`,
          ttl_ms: 5000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        return pickAndLoad()
      }
    }
    status.value = 'error'
    errorMsg.value = String(e)
    bus.emit('ui:toast', { kind: 'error', message: `立绘加载失败：${String(e)}`, ttl_ms: 8000 })
    bus.emit('avatar:model-error', { reason: String(e) })
  }
}

onBeforeUnmount(() => {
  bus.off('avatar:reload-model', onReloadModel)
  bus.off('avatar:zoom', onZoom)
  bus.off('avatar:move', onMove)
  // v0.17: 清理所有 onMounted 内注册的 bus handler（lipsync / brain:emotion-changed / avatar:mouse-inside）
  for (const cleanup of cleanupHandlers) cleanup()
  cleanupHandlers.length = 0
  if (saveTimer) clearTimeout(saveTimer)
  // Q1: 补 resize 监听清理(原 Live2DStage 漏清,搬进 instance 后修;Q2 多实例
  // mount/unmount 时这个清理是必须的,否则每个实例泄漏一个 resize listener)
  if (onResize) {
    window.removeEventListener('resize', onResize)
    onResize = null
  }
  renderer?.destroy()
  sampler?.destroy()
  renderer = null
  sampler = null
})
</script>

<template>
  <div
    ref="rootRef"
    class="live2d-instance"
    :data-state="status"
    :data-emotion="currentEmotion"
    :style="{
      '--emotion-intensity': currentIntensity,
      left: layoutHint.leftPercent + '%',
      width: layoutHint.widthPercent + '%',
      top: layoutHint.topPercent + '%',
      height: layoutHint.heightPercent + '%',
    }"
  >
    <canvas ref="canvasRef" class="live2d-canvas" />
    <!-- v0.15 A2: 切换 character 时的 shimmer 过渡层 -->
    <transition name="shimmer">
      <div v-if="status === 'loading'" class="shimmer-veil">
        <div class="shimmer-pulse"></div>
      </div>
    </transition>
    <div v-if="status === 'loading'" class="overlay">
      <span class="dot" />正在召唤……
    </div>
    <div v-else-if="status === 'error'" class="overlay error">
      <span>{{ errorMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
.live2d-instance {
  position: absolute;
  /* Q2: left/width/top/height 由 layoutHint inline style 驱动(N=1 = 0/100/0/100 即 inset:0)。
     不再写死 inset:0 — 多实例横排时各占自己 slot。 */
  background: transparent;
  /* Q1: instance 不接 DOM 鼠标事件 — 命中由主进程 cursor poll + alpha sampler 处理。
     设 none 确保即使 elementsFromPoint 命中此 wrapper 也被 window-interaction 跳过(防穿透误判)。 */
  pointer-events: none;
  /* v0.15 A3: 整体呼吸 — transform-origin: bottom 让脚下不动头/胸前后微浮 */
  transform-origin: 50% 90%;
  animation: stage-breath 2.4s var(--ease-in-out) infinite;
}
/* 不同 emotion 不同呼吸节奏 + 振幅 — 用 emotion-intensity 0-1 调强度 */
.live2d-instance[data-emotion='happy'] {
  animation-duration: 1.6s; /* 兴奋呼吸快 */
}
.live2d-instance[data-emotion='angry'] {
  animation-duration: 1.2s; /* 怒气呼吸最快 */
}
.live2d-instance[data-emotion='surprise'] {
  animation-duration: 1.3s;
}
.live2d-instance[data-emotion='shy'],
.live2d-instance[data-emotion='tease'] {
  animation-duration: 2.0s;
}
.live2d-instance[data-emotion='sad'] {
  animation-duration: 3.2s; /* 难过呼吸长 */
}
.live2d-instance[data-emotion='sleepy'] {
  animation-duration: 4.0s; /* 困了呼吸最慢 */
}
@keyframes stage-breath {
  /* scale 振幅基础 0.6% × intensity */
  0%, 100% { transform: scale(calc(1 - var(--emotion-intensity, 0.5) * 0.006)); }
  50% { transform: scale(calc(1 + var(--emotion-intensity, 0.5) * 0.006)); }
}
.live2d-instance[data-state='loading'] {
  animation: none; /* loading 时不呼吸 */
}
.live2d-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
  /* v0.8.2: canvas pointer-events: none，让上层 UI（ControlDock/DialogBubble）能正常 hit-test。
     立绘鼠标命中由主进程 cursor poll + alpha-hit sampler 处理，不依赖 canvas 自己接事件。 */
  pointer-events: none;
  /* v0.15 A2: loading 时 canvas 整体淡出 */
  transition: opacity var(--duration-normal) var(--ease-in-out);
  /* v0.17：立绘 drop-shadow — 让她"贴"在桌面而不是漂浮 panel 里。
     filter: drop-shadow 比 box-shadow 强 — 跟随 alpha 形状（非矩形），真正像影子。 */
  filter: drop-shadow(0 12px 24px oklch(0% 0 0 / 0.28))
          drop-shadow(0 4px 8px oklch(0% 0 0 / 0.18));
}
.live2d-instance[data-state='loading'] .live2d-canvas {
  opacity: 0.3;
}

/* v0.15 A2: shimmer 切换过渡 — 切角色时柔和过渡而非硬切 */
.shimmer-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  overflow: hidden;
}
.shimmer-pulse {
  position: absolute;
  inset: 20% 25%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--color-accent-soft) 0%,
    transparent 70%
  );
  animation: shimmer-breath 1.5s var(--ease-in-out) infinite;
  filter: blur(20px);
  opacity: 0.5;
}
@keyframes shimmer-breath {
  0%, 100% { transform: scale(0.85); opacity: 0.3; }
  50% { transform: scale(1.05); opacity: 0.7; }
}

.shimmer-enter-active,
.shimmer-leave-active {
  transition: opacity var(--duration-normal) var(--ease-in-out);
}
.shimmer-enter-from,
.shimmer-leave-to {
  opacity: 0;
}
.overlay {
  position: absolute;
  inset: auto 16px 16px 16px;
  padding: 8px 12px;
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.overlay.error {
  background: oklch(95% 0.05 25 / 0.95);
  color: oklch(40% 0.12 25);
}
.dot {
  width: 6px;
  height: 6px;
  background: var(--color-accent);
  border-radius: 999px;
  animation: pulse 1s var(--ease-out-expo) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}
</style>
