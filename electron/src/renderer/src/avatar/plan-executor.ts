/**
 * BehaviorPlan 执行器 — 在 renderer 把 plan.actions 序列依次落到立绘 / 对话 / TTS。
 *
 * 关键：plan 的执行是异步、可中断的（新 plan 来时取消旧的）。
 */
import { ref } from 'vue'
import type { BehaviorAction, BehaviorPlan } from '@shared/attention'
import type { Live2DRenderer } from './render/live2d-renderer'
import { bus } from '../infra/eventbus'
// v0.13 (audit architecture): avatar 域不再直接 import brain/stores/dialog
// 改用 bus 'brain:inject-utterance' 事件，dialog store 自己监听

interface ExecOpts {
  renderer: Live2DRenderer
  container: HTMLElement
}

/** 当前执行状态 */
export const currentPlan = ref<BehaviorPlan | null>(null)
let abortFlag = { aborted: false }

export async function executePlan(plan: BehaviorPlan, opts: ExecOpts): Promise<void> {
  // 取消旧的
  abortFlag.aborted = true
  abortFlag = { aborted: false }
  const myAbort = abortFlag
  currentPlan.value = plan

  for (const action of plan.actions) {
    if (myAbort.aborted) break
    try {
      await executeOne(action, opts)
    } catch (e) {
      console.warn('[plan-executor]', action.type, 'failed:', e)
    }
  }
  if (!myAbort.aborted) currentPlan.value = null
}

async function executeOne(action: BehaviorAction, opts: ExecOpts): Promise<void> {
  switch (action.type) {
    case 'glance_at_screen':
      return doGlance(action, opts)
    case 'look_back_to_master':
      return doLookBack(action, opts)
    case 'speak':
      return doSpeak(action)
    case 'play_motion':
      return doPlayMotion(action)
    case 'change_emotion':
      return doChangeEmotion(action, opts)
    case 'idle_subtle':
      return new Promise((r) => setTimeout(r, action.duration_ms))
    case 'play_group':
      return doPlayGroup(action, opts)
    case 'generate_sticker':
      return doGenerateSticker(action)
    case 'agent_task':
      return doAgentTask(action)
  }
}

/** v0.17 E-4：LUVU 跑 agent 任务（fire-and-forget — agent loop 异步跑） */
async function doAgentTask(
  action: Extract<BehaviorAction, { type: 'agent_task' }>,
): Promise<void> {
  console.log(`[plan-exec] agent_task goal="${action.goal}" max_steps=${action.max_steps ?? 10}`)
  // 不 await — agent loop 可能跑几分钟，不阻塞 plan 链
  void window.api.agent
    .runTask({ goal: action.goal, ...(action.max_steps != null ? { max_steps: action.max_steps } : {}) })
    .then((r) => {
      const verb = r.ok ? '完成' : '没完成'
      const detail = r.ok ? r.final_message ?? '' : r.reason ?? ''
      console.log(`[plan-exec] agent_task ${verb}: ${detail}`)
      // 让 LUVU 自己报告结果（注入 utterance + TTS）
      bus.emit('brain:inject-utterance', {
        text: r.ok ? `${detail || '完成了 ~'}` : `没做成：${detail || '不知道哪步错了'}`,
        emotion: r.ok ? 'happy' : 'shy',
        intensity: 0.6,
      })
      bus.emit('brain:reply-end', {
        stream_id: `agent-${Date.now()}`,
        full_text: r.ok ? (detail || '完成了 ~') : `没做成：${detail || ''}`,
        emotion: r.ok ? 'happy' : 'shy',
        intensity: 0.6,
      })
    })
    .catch((e) => console.warn('[plan-exec] agent_task error:', e))
}

/** v0.17 C：LUVU 主动调 ComfyUI 画贴纸送主人（fire-and-forget — 长时间生成不阻塞 plan） */
async function doGenerateSticker(
  action: Extract<BehaviorAction, { type: 'generate_sticker' }>,
): Promise<void> {
  console.log(`[plan-exec] generate_sticker emotion=${action.emotion} reason=${action.reason ?? '-'}`)
  // 不 await — 生成需 6-30 秒，让 plan 立刻往下走
  void window.api.comfyui
    .generateSticker({
      emotion: action.emotion,
      ...(action.extra_prompt ? { extraPrompt: action.extra_prompt } : {}),
    })
    .then((r) => {
      if (!r.ok) console.warn('[plan-exec] generate_sticker failed:', r.error)
    })
    .catch((e) => console.warn('[plan-exec] generate_sticker error:', e))
}

/** v0.17 D：直接播 model3.json 自带 motion group */
async function doPlayGroup(
  action: Extract<BehaviorAction, { type: 'play_group' }>,
  opts: ExecOpts,
): Promise<void> {
  const ok = opts.renderer.playMotionGroup(action.group)
  if (!ok) console.warn(`[plan-exec] play_group "${action.group}" — model 无此 group`)
}

/** v0.17 B：情绪 → motion group 智能映射（fallback 顺序：找不到首选就试备用） */
const EMOTION_GROUP_MAP: Record<string, string[]> = {
  happy:    ['Tap', 'FlickUp', 'Flick'],
  tease:    ['Tap', 'FlickRight', 'Flick'],
  surprise: ['FlickUp', 'Shake', 'Flick3'],
  shy:      ['FlickDown', 'FlickLeft', 'Flick'],
  sad:      ['FlickDown'],
  angry:    ['Shake', 'Flick3'],
  sleepy:   [],
  neutral:  [],
}

/** 屏幕坐标 → 立绘 canvas 坐标 → setGaze */
async function doGlance(
  action: Extract<BehaviorAction, { type: 'glance_at_screen' }>,
  opts: ExecOpts,
): Promise<void> {
  // 窗口 bounds 主进程拿，转 canvas 局部
  const bounds = await window.api.window.getBounds()
  if (!bounds) return
  const localX = action.screen_x - bounds.x
  const localY = action.screen_y - bounds.y
  // canvas 中心相对值（设备坐标 → 立绘视线参数空间）
  const rect = opts.container.getBoundingClientRect()
  // 注意：localX/Y 可能为负或超 rect.width/height（鼠标在窗口外）
  // 转 setGaze 的"canvas 局部坐标" — setGaze 内会算 (cx, cy) → 视线归一化
  // 即便落在窗口外，也能驱动立绘向那个方向看（参数会被钳到 ±30）
  opts.renderer.setGaze(localX, localY)
  await new Promise((r) => setTimeout(r, action.duration_ms))
  void rect
}

async function doLookBack(
  action: Extract<BehaviorAction, { type: 'look_back_to_master' }>,
  opts: ExecOpts,
): Promise<void> {
  // 看向 canvas 中心 = 正面对主人
  const rect = opts.container.getBoundingClientRect()
  opts.renderer.setGaze(rect.width / 2, rect.height / 2)
  await new Promise((r) => setTimeout(r, action.duration_ms))
}

async function doSpeak(action: Extract<BehaviorAction, { type: 'speak' }>): Promise<void> {
  // v0.13: 主动说话 — 通过 bus 让 brain/stores/dialog 自己注入 assistant turn
  // 不再直接 import useDialogStore，消除 avatar → brain 跨域硬依赖
  bus.emit('brain:inject-utterance', {
    text: action.text,
    emotion: action.emotion,
    intensity: action.intensity,
  })
  // TTS 由 speech store 自动接 reply-end 事件触发
  bus.emit('brain:reply-end', {
    stream_id: `proactive-${Date.now()}`,
    full_text: action.text,
    emotion: action.emotion,
    intensity: action.intensity,
  })
  bus.emit('brain:emotion-changed', { emotion: action.emotion, intensity: action.intensity })
}

async function doPlayMotion(
  action: Extract<BehaviorAction, { type: 'play_motion' }>,
): Promise<void> {
  if (action.source === 'library_template' && action.template_id) {
    const cfg = await import('../infra/stores/config').then((m) => m.useConfigStore())
    if (!cfg.soul) return
    const soulDir = cfg.soul.avatar.model_dir
    const opt = cfg.models.find((m) => m.dir === soulDir)
    if (!opt) return
    const modelDirAbs = opt.absolute_path.replace(/\/[^/]+\.model3\.json$/i, '')
    const r = await window.api.library.apply({
      template_id: action.template_id,
      model_dir: modelDirAbs,
    })
    if (r.ok && r.draft) {
      bus.emit('avatar:play-draft', { draft: r.draft })
    }
  }
  // entry_id 模式: v0.8.1 加（需要从 motion-engine 读 motion3 → 转 draft）
}

async function doChangeEmotion(
  action: Extract<BehaviorAction, { type: 'change_emotion' }>,
  opts: ExecOpts,
): Promise<void> {
  bus.emit('brain:emotion-changed', { emotion: action.emotion, intensity: action.intensity })
  // v0.17 B：情绪 intensity > 0.4 时按映射触发一个动作 group，让身体跟着情绪走
  // 但如果当前 plan 已经显式给了 play_group（rules / LLM 自带动作）→ 不要二次触发，
  // 否则同一个 group 会立即被打断重启（看起来像"动作没反应"）。
  if (action.intensity > 0.4) {
    const planHasGroup = currentPlan.value?.actions.some((a) => a.type === 'play_group')
    if (planHasGroup) return
    const candidates = EMOTION_GROUP_MAP[action.emotion] ?? []
    for (const group of candidates) {
      if (opts.renderer.playMotionGroup(group)) break
    }
  }
}
