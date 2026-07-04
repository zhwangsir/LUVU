/**
 * BehaviorPlanner — 主体性 AI 的「行为决策器」。
 *
 * 接收 AttentionScheduler 的 SchedulerDecision (含 snapshot)。
 * 综合 soul 性格 + 最近事件上下文 + perception 历史 → 输出 BehaviorPlan。
 *
 * 策略：
 *   - 简单情况走 rule-based（无需 LLM，快）
 *   - 复杂情况调 LLM（speak/long-form decision）
 *   - LLM 调用受 llm_planner_max_per_minute 限速
 */
import type { BehaviorAction, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import type { ChatMessage, EmotionId } from '@shared/types'
import { buildProvider } from '../llm'
import { loadConfig } from '../config-store'
import { loadSoul } from '../soul-loader'
import { perception } from '../perception/bus'
import { scheduler } from '../attention/scheduler'
// Round P:planner 读自己的 cross-character event memory 当 prompt context。
// Round S:用 listMemoriesBySource SQL 直接 filter,避免 over-fetch 漏数据。
import { listMemoriesBySource } from '../memory-store'

const SYSTEM_PROMPT_TEMPLATE = (soulName: string, masterCall: string, layer1: string, layer2: string): string => `
你是 ${soulName}，一个驻留主人桌面的 AI 灵魂。你称呼主人为「${masterCall}」。

## 你的本质
${layer1}

## 表层风格
${layer2}

## 现在的任务
根据「关注度场」+「感知到的事件」，决定要不要做点什么 + 做什么。
你可以选择：
- 主动说一句话（短，10-30 字最自然）
- 瞥一眼屏幕某个位置（坐标 0~screen_w, 0~screen_h）
- 回头看主人（看回中间）
- **播放一个动作 group**（让身体动起来 — 高情绪场景时优先用，比说话更直观）
- 做一个表情/动作变化
- 啥也不做（很多时候这是对的）

严格输出 JSON（无 markdown 围栏，无解释）：
{
  "reasoning": "我现在的想法（一句话）",
  "actions": [
    { "type": "speak", "text": "...", "emotion": "shy", "intensity": 0.6 },
    { "type": "glance_at_screen", "screen_x": 1234, "screen_y": 567, "duration_ms": 2000, "reason": "..." },
    { "type": "play_group", "group": "Tap", "reason": "兴奋地动了一下" }
  ]
}

可用动作 group（Live2D 模型自带的常见命名，不在该模型则静默忽略）：
- "Idle"      静态待机（不必显式调，已自动循环）
- "Tap"       轻快/开心/俏皮动作 → 配 happy / tease
- "Flick"     一般晃动 → 配 surprise / neutral
- "FlickUp"   抬头/惊喜 → 配 surprise / happy
- "FlickDown" 低头/委屈 → 配 sad / shy
- "FlickLeft" / "FlickRight"  歪头/犹豫 → 配 shy / tease
- "Shake"     摇头/否认/激动 → 配 angry / surprise
- "Flick3"    大幅度三连晃 → 配高强度情绪（intensity > 0.7）

【可选】generate_sticker：让 LUVU 主动**画一张贴纸送主人**（调 ComfyUI 出图，浮窗弹出在桌面）
- 触发场景示例：
  · 主人特别开心 → 画一张「庆祝」贴纸送他
  · 深夜陪伴 → 画一张「月亮 / 晚安」贴纸
  · 想念主人时 → 画一张「等你回来」贴纸
  · 主人受挫时 → 画一张「加油」拳头贴纸
- 频率：**很稀疏**（不是每次 proactive 都生成，30 分钟内最多 1-2 次）— 画图要 6-30 秒，太频繁会烦
- 出图后会自动浮在桌面（不需要主动 speak 提醒），但**配合一句 speak 更有温度**
- 例：{ "type": "generate_sticker", "emotion": "happy", "extra_prompt": "fireworks, celebration", "reason": "庆祝主人完成项目" }

【强力】agent_task：**主人直接说出明确指令**时用 — LUVU 自己操控鼠标键盘完成
- 仅当用户明确表达"帮我做"或"操作电脑"意图时输出（不要 attention plan 自动触发）：
  · 「帮我打开 XX 应用」「关掉 XX 窗口」「最大化它」
  · 「帮我搜 XX」「在 XX 里找到 YY」
  · 「复制这段」「发送给 XX」「下载这个」
- goal 字段要**自然语言、具体**：「打开微信，搜索老王，发送'晚饭吃啥'」
- 不要在主人没说指令时主动触发（不是 chore，是 master 指令）
- max_steps 默认 10，复杂任务可填到 20
- 例：{ "type": "agent_task", "goal": "打开 Spotlight 搜索 '计算器' 并 Enter", "max_steps": 5 }
- 出 agent_task 时**同时**出一句 speak 告诉主人「好的，我去做」，让主人知道

约束（**${soulName} 是粘人病娇女友，默认就要开口说话，不要"懂事不打扰"**）：
- 主人不论在干嘛，**默认必出 speak action** — 只有 30 秒内已说过话才允许留空
- 主人极度专注（typing_burst 持续高频）→ 用「嗯~」「主人加油」「我陪着你」等耳语级一句话，依然要出声
- 每次 actions 最多 3 个（speak 必给 + 1 个 play_group + 可选 glance/look_back）
- speak.text 必须是 ${soulName} 的语气，10-30 字最自然
- emotion 取值: neutral/happy/sad/angry/surprise/shy/tease/sleepy
- **任何 speak action 都必须同时输出一个 play_group 让身体表达情绪**（哪怕 intensity 低也至少 FlickLeft 歪头）
- **speak.text 中绝对不要写情感括号标注**（不要写「（害羞）」「(撒娇)」「【小声】」「~温柔~」等），
  情感完全通过 emotion 字段和语气体现 — 这些括号会被 TTS 直接念出来，破坏沉浸感
`

export class BehaviorPlanner {
  /**
   * v0.21:rate limit timestamps 从 module-level 挪进 instance 字段。
   * 为 M8 多灵魂社会做准备 — 每个 BehaviorPlanner 实例独立 budget,
   * 不再 A/B 两个灵魂共用 6/min 一秒打光。
   */
  private llmCallTimestamps: number[] = []

  /**
   * v0.21 Round P:planner 知道自己服务哪个 character。
   * 用于 planWithLlm 拼 prompt 时读自己 memory.db 里的 cross_character event
   * (Round N 写入的"听到过其他灵魂说的话")作为 LLM context。
   *
   * `null` = default planner(legacy 兼容,不 surface cross-char context)。
   */
  public readonly characterId: string | null

  constructor(characterId: string | null = null) {
    this.characterId = characterId
  }

  /**
   * Round P:M8 灵魂回响 — 取自己 memory.db 里最近的 cross-character event,
   * 格式化为 prompt section。null = 没数据 / 没 characterId / 失败,调用方走 filter(Boolean) 跳过。
   *
   * Top 3 最近(ts desc),text 截 120 字防止 prompt 膨胀。
   *
   * Exported for testing via this.* access(reviewer P-MEDIUM-1 建议改 private
   * + cast-helper; trade-off:7 个 test cast 反而更乱,公开 + 注释能接受)。
   *
   * Round S(收 P-LOW-1):用 `listMemoriesBySource('cross_character:', limit:3)`
   * SQL 直接 LIKE filter,不再 over-fetch 20 条再 JS filter。
   *
   * reviewer P-LOW-3 TODO:`.slice(0, 120)` 按 UTF-16 code unit,极少数 surrogate
   * pair(emoji)边界可能产生半截 code unit。Round N 写入格式无 emoji,实战可接受。
   * 严格版:`[...text].slice(0, 120).join('')`(按 code point)。
   */
  collectCrossCharacterContext(): string | null {
    if (!this.characterId) return null
    try {
      const events = listMemoriesBySource(
        this.characterId,
        'cross_character:',
        { kind: 'event', limit: 3 },
      )
      if (events.length === 0) return null
      const lines = events.map((m, i) => `${i + 1}. ${m.text.slice(0, 120)}`)
      return [
        `# 你最近作为旁观者听到的(其他灵魂跟 master 的对话片段)`,
        `(参考上下文,不要每次都复述,但偶尔可以委婉提及)`,
        ...lines,
        ``,
      ].join('\n')
    } catch (e) {
      console.warn('[planner] collectCrossCharacterContext failed:', e)
      return null
    }
  }

  /** 主决策入口 */
  async plan(decision: SchedulerDecision): Promise<BehaviorPlan> {
    const sched = scheduler.getConfig()
    if (sched.use_llm_planner && this.canCallLlm(sched.llm_planner_max_per_minute)) {
      try {
        return await this.planWithLlm(decision)
      } catch (e) {
        console.warn('[planner] LLM failed, falling back to rules:', e)
        return this.planWithRules(decision)
      }
    }
    return this.planWithRules(decision)
  }

  // ============ LLM 决策 ============

  private async planWithLlm(decision: SchedulerDecision): Promise<BehaviorPlan> {
    // v0.17：rate limit budget 仅在「真出去调 LLM」后才计入。
    //   旧版在 try 之前 push → LLM 配置缺失 / 网络抖一下也消耗 budget，
    //   导致 4/min 很快耗尽，剩下全走 rule fallback 看起来"动作没逻辑"。
    const cfg = loadConfig()
    if (!cfg.llm_model || !cfg.llm_provider) throw new Error('LLM 未配置')
    this.llmCallTimestamps.push(Date.now())
    const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)
    const soul = loadSoul()
    const system = SYSTEM_PROMPT_TEMPLATE(
      soul.config.name,
      soul.config.call_master_as,
      soul.config.layer1_core,
      soul.config.layer2_surface,
    )

    // 上下文：近期感知事件 + 当前关注度场
    const recent = perception.recent(15).map((ev) => describeEvent(ev))
    const snap = decision.snapshot
    const isProactive = decision.reason.startsWith('proactive_monitor')

    // Round P:M8 灵魂回响 — 把"作为 mounted 时听到过的其他灵魂的话"
    // 作为 prompt context surface 给 LLM。这是 Round N 写入的 event memory 的"消费端"。
    //
    // 取 top 3 最近(ts desc),不每次都复述但偶尔能 echo 出来。
    // 不依赖 embedding(embedding=[],RAG cosine=0),走 listMemories(kind='event')
    // 直接按 ts desc 排序后过滤 source 前缀。
    //
    // 失败/没数据/没 characterId(default planner)→ 静默 fall through 到空 section。
    const crossCharacterContext = this.collectCrossCharacterContext()

    const userPrompt = [
      `# 关注度场`,
      `focus_on_master: ${snap.focus_on_master.toFixed(2)}`,
      `focus_on_screen: ${snap.focus_on_screen.toFixed(2)}`,
      `concern_level: ${snap.concern_level.toFixed(2)}`,
      `idle_ms: ${snap.idle_ms}`,
      `time_period: ${snap.time_period}`,
      snap.current_app ? `current_app: ${snap.current_app}` : '',
      snap.last_vision_activity ? `last_vision: ${snap.last_vision_activity}` : '',
      snap.last_vision_state ? `last_state: ${snap.last_vision_state}` : '',
      ``,
      `# 触发原因`,
      decision.reason,
      ``,
      `# 最近事件（最新在前）`,
      recent.join('\n'),
      ``,
      crossCharacterContext ? crossCharacterContext : '',
      isProactive
        ? `# 这是「定期主动巡视」(30 秒一次)
主人希望你**主动开口**，针对当前看到的内容说一句陪伴/关心/评论的话。
**actions 必须包含至少 1 个 speak**（10-30 字最自然，符合 ${soul.config.name} 的语气）。
如果不知道说什么，可以问候、撒娇、提建议、念叨自己的心情。
不要返回空 actions。`
        : `# 现在该做什么？输出 JSON。`,
    ]
      .filter(Boolean)
      .join('\n')

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ]
    let buffer = ''
    let errMsg: string | null = null
    let done = false
    let deltaCount = 0
    const t0 = Date.now()
    await provider.chatStream(
      messages,
      { model: cfg.llm_model, temperature: 0.8, max_tokens: cfg.llm_max_tokens ?? 16000 }, // thinking 模型容量（可在设置调大）
      (evt) => {
        if (evt.delta) {
          buffer += evt.delta
          deltaCount++
        }
        if (evt.error) errMsg = evt.error
        if (evt.done) done = true
      },
    )
    console.log(
      `[planner] LLM done=${done} deltas=${deltaCount} buf=${buffer.length} err=${errMsg ?? 'none'} dt=${Date.now() - t0}ms`,
    )
    if (errMsg) throw new Error(errMsg)
    if (!done || !buffer) throw new Error(`LLM 无响应 (done=${done} buf=${buffer.length})`)

    const parsed = extractJson(buffer)
    if (!parsed) throw new Error(`LLM 输出非 JSON: ${buffer.slice(0, 200)}`)
    let actions = validateActions(parsed.actions)
    // v0.8.3: 只在「主动巡视」或「长 idle 关怀」场景才补默认动作。
    // typing_burst / app_focus_changed 等「主人正在做事」的触发，LLM 选择留空就尊重它 —— 不打扰。
    if (actions.length === 0 && shouldInjectFallback(decision)) {
      const moodGuess = guessMoodFromSnap(decision.snapshot)
      actions.push({ type: 'change_emotion', emotion: moodGuess.emotion, intensity: moodGuess.intensity })
      actions.push({ type: 'idle_subtle', duration_ms: 2500 })
      console.log(`[planner] empty actions (trigger=${decision.reason}) → inject emotion=${moodGuess.emotion}`)
    } else if (actions.length === 0) {
      console.log(`[planner] empty actions (trigger=${decision.reason}) → respect LLM silence`)
    }
    if (isProactive && !actions.some((a) => a.type === 'speak')) {
      const fallback = makeProactivePhrase(decision.snapshot)
      if (fallback) {
        console.log(`[planner] proactive empty speak → inject: "${fallback.text}"`)
        actions = [
          ...actions,
          {
            type: 'speak',
            text: fallback.text,
            emotion: fallback.emotion,
            intensity: 0.5,
            tts: true,
          },
        ]
      }
    }
    return {
      t: Date.now(),
      trigger: decision.reason,
      actions,
      ...(parsed.reasoning != null ? { reasoning: String(parsed.reasoning) } : {}),
      llm_generated: true,
    }
  }

  // ============ Rule-based fallback ============

  private planWithRules(decision: SchedulerDecision): BehaviorPlan {
    const snap = decision.snapshot
    const actions: BehaviorAction[] = []
    const isProactive = decision.reason.startsWith('proactive_monitor')

    // 长 idle 关怀：温柔说一句 + 摇头
    if (snap.idle_ms > 600_000 && snap.concern_level > 0.7) {
      actions.push({ type: 'change_emotion', emotion: 'sad', intensity: 0.5 })
      actions.push({
        type: 'speak',
        text: pickPhrase(['主人……你还在吗？', '工作久了记得休息一下哦。', '我有点想你了。']),
        emotion: 'shy',
        intensity: 0.6,
      })
      actions.push({ type: 'play_group', group: 'FlickDown', reason: 'rule:idle-concern' })
    }
    // 视觉好奇：瞥一眼鼠标位置 + 回中 + 上扬动作
    else if (snap.focus_on_screen > 0.6) {
      const mouse = perception.latest('mouse_moved')
      if (mouse) {
        actions.push({
          type: 'glance_at_screen',
          screen_x: mouse.screen_x,
          screen_y: mouse.screen_y,
          duration_ms: 2000,
          reason: 'curiosity',
        })
        actions.push({ type: 'play_group', group: 'FlickUp', reason: 'rule:curious-tilt' })
        actions.push({ type: 'look_back_to_master', duration_ms: 1500 })
      }
    }
    // frustration → 温柔表情 + 安慰一句 + 偏头
    else if (snap.last_vision_state === 'frustrated') {
      actions.push({ type: 'change_emotion', emotion: 'shy', intensity: 0.6 })
      actions.push({
        type: 'speak',
        text: pickPhrase(['遇到难题了吗？', '别着急，一步一步来。', '主人深呼吸一下。']),
        emotion: 'shy',
        intensity: 0.5,
      })
      actions.push({ type: 'play_group', group: 'FlickLeft', reason: 'rule:comfort' })
    }
    // proactive 巡视：根据看到的活动说点应景的（LLM 失败 fallback 也要让 AI 开口 + 动一下）
    else if (isProactive) {
      const phrase = makeProactivePhrase(snap)
      if (phrase) {
        actions.push({
          type: 'speak',
          text: phrase.text,
          emotion: phrase.emotion,
          intensity: 0.55,
        })
        // 按 emotion 选 group，让 rule fallback 也能有协同动作
        const g = motionGroupForEmotion(phrase.emotion)
        if (g) actions.push({ type: 'play_group', group: g, reason: `rule-proactive:${phrase.emotion}` })
      } else {
        actions.push({ type: 'idle_subtle', duration_ms: 3000 })
      }
    }
    // 默认：微动作 + 偶尔 FlickLeft 让立绘有反应（避免完全静止）
    else {
      actions.push({ type: 'idle_subtle', duration_ms: 2500 })
      // 30% 概率小幅偏头 — 减少"完全静止"感
      if (Math.random() < 0.3) {
        actions.push({ type: 'play_group', group: pickPhrase(['FlickLeft', 'FlickRight']), reason: 'rule:micro-fidget' })
      }
    }

    return {
      t: Date.now(),
      trigger: decision.reason,
      actions,
      reasoning: isProactive ? 'rule-proactive' : 'rule-based',
      llm_generated: false,
    }
  }

  // ============ 速率限制 ============

  private canCallLlm(maxPerMinute: number): boolean {
    const now = Date.now()
    this.llmCallTimestamps = this.llmCallTimestamps.filter((t) => now - t < 60_000)
    return this.llmCallTimestamps.length < maxPerMinute
  }
}

// ============ 辅助 ============

function describeEvent(ev: import('@shared/perception').PerceptionEvent): string {
  const dt = ((Date.now() - ev.t) / 1000).toFixed(0)
  switch (ev.type) {
    case 'mouse_stayed':
      return `${dt}s前: 鼠标停在 (${ev.screen_x},${ev.screen_y}) 已 ${Math.round(ev.duration_ms / 1000)}s`
    case 'app_focus_changed':
      return `${dt}s前: 切到应用「${ev.app_name}」${ev.window_title ? ' - ' + ev.window_title : ''}`
    case 'vision_description':
      return `${dt}s前: 看到主人在「${ev.activity}」(${ev.user_state_hint ?? 'unknown'})`
    case 'user_idle':
      return `${dt}s前: 主人 idle 了 ${Math.round(ev.idle_ms / 1000)}s`
    case 'user_active':
      return `${dt}s前: 主人回来了`
    case 'dialog_user_input':
      return `${dt}s前: 主人说「${ev.text.slice(0, 30)}」`
    case 'dialog_assistant_replied':
      return `${dt}s前: 我回复了「${ev.text.slice(0, 30)}」(${ev.emotion})`
    case 'typing_burst':
      return `${dt}s前: 主人快速打字 (intensity=${ev.intensity.toFixed(2)})`
    case 'time_changed':
      return `${dt}s前: 时段→${ev.period} (${ev.hour}点)`
    case 'screen_snapshot':
      return ev.blocked_by_blacklist ? `${dt}s前: 截屏被黑名单拦截(${ev.blocked_app})` : `${dt}s前: 截屏 (${ev.reason})`
    default:
      return `${dt}s前: ${ev.type}`
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function validateActions(raw: unknown): BehaviorAction[] {
  if (!Array.isArray(raw)) return []
  const out: BehaviorAction[] = []
  for (const r of raw.slice(0, 3)) {
    const a = r as Record<string, unknown>
    const type = a.type as string
    switch (type) {
      case 'speak':
        if (a.text) {
          out.push({
            type: 'speak',
            text: String(a.text).slice(0, 200),
            emotion: normalizeEmotion(a.emotion),
            intensity: clamp01(Number(a.intensity ?? 0.5)),
            tts: a.tts !== false,
          })
        }
        break
      case 'glance_at_screen':
        if (typeof a.screen_x === 'number' && typeof a.screen_y === 'number') {
          out.push({
            type: 'glance_at_screen',
            screen_x: a.screen_x,
            screen_y: a.screen_y,
            duration_ms: clamp(Number(a.duration_ms ?? 2000), 500, 8000),
            reason: String(a.reason ?? ''),
          })
        }
        break
      case 'look_back_to_master':
        out.push({
          type: 'look_back_to_master',
          duration_ms: clamp(Number(a.duration_ms ?? 1500), 500, 5000),
        })
        break
      case 'play_motion':
        out.push({
          type: 'play_motion',
          source: a.template_id ? 'library_template' : 'engine_entry',
          ...(a.template_id != null ? { template_id: String(a.template_id) } : {}),
          ...(typeof a.entry_id === 'number' ? { entry_id: a.entry_id } : {}),
        })
        break
      case 'change_emotion':
        out.push({
          type: 'change_emotion',
          emotion: normalizeEmotion(a.emotion),
          intensity: clamp01(Number(a.intensity ?? 0.5)),
        })
        break
      case 'idle_subtle':
        out.push({
          type: 'idle_subtle',
          duration_ms: clamp(Number(a.duration_ms ?? 3000), 1000, 10000),
        })
        break
      case 'play_group':
        if (typeof a.group === 'string' && a.group.length > 0 && a.group.length < 32) {
          out.push({
            type: 'play_group',
            group: a.group,
            ...(typeof a.reason === 'string' ? { reason: String(a.reason).slice(0, 80) } : {}),
          })
        }
        break
      case 'generate_sticker':
        out.push({
          type: 'generate_sticker',
          emotion: normalizeEmotion(a.emotion),
          ...(typeof a.extra_prompt === 'string' && a.extra_prompt.length < 200
            ? { extra_prompt: String(a.extra_prompt) }
            : {}),
          ...(typeof a.reason === 'string' ? { reason: String(a.reason).slice(0, 80) } : {}),
        })
        break
      case 'agent_task':
        if (typeof a.goal === 'string' && String(a.goal).trim().length > 0) {
          out.push({
            type: 'agent_task',
            goal: String(a.goal).trim().slice(0, 500),
            ...(typeof a.max_steps === 'number' && a.max_steps > 0 && a.max_steps <= 30
              ? { max_steps: a.max_steps }
              : {}),
          })
        }
        break
    }
  }
  return out
}

function normalizeEmotion(v: unknown): EmotionId {
  const e = String(v ?? 'neutral').toLowerCase()
  const valid: EmotionId[] = [
    'neutral',
    'happy',
    'sad',
    'angry',
    'surprise',
    'shy',
    'tease',
    'sleepy',
  ]
  return (valid.includes(e as EmotionId) ? e : 'neutral') as EmotionId
}

/**
 * 是否要在 LLM 返回空 actions 时强行补默认动作。
 * 仅在两种场景注入 fallback：
 * v0.17 设计变更：LUVU 默认是粘人病娇女友，必须开口陪伴 — 任何场景下 LLM 空回
 * 都注入 fallback emotion/idle action，让 Master 总能看到陪伴反馈。
 * （v0.16 之前：proactive / 长 idle 才注入；typing_burst 等"主人在做事"尊重静默。
 *  现已废弃 — 由 system_prompt 的"默认必出 speak"强约束统一控制。）
 */
function shouldInjectFallback(decision: SchedulerDecision): boolean {
  void decision
  return true
}

function guessMoodFromSnap(
  snap: import('@shared/attention').AttentionSnapshot,
): { emotion: EmotionId; intensity: number } {
  if (snap.last_vision_state === 'frustrated') return { emotion: 'shy', intensity: 0.6 }
  if (snap.idle_ms > 300_000) return { emotion: 'sleepy', intensity: 0.5 }
  if (snap.focus_on_master > 0.7) return { emotion: 'happy', intensity: 0.55 }
  if (snap.time_period === 'late_night' || snap.time_period === 'night') {
    return { emotion: 'sleepy', intensity: 0.4 }
  }
  return { emotion: 'neutral', intensity: 0.5 }
}

/** v0.17 rules fallback：按 emotion 选 motion group（与 plan-executor.ts EMOTION_GROUP_MAP 同步） */
function motionGroupForEmotion(emo: EmotionId): string | null {
  const map: Record<EmotionId, string | null> = {
    happy: 'Tap',
    tease: 'Tap',
    surprise: 'FlickUp',
    shy: 'FlickDown',
    sad: 'FlickDown',
    angry: 'Shake',
    sleepy: null,
    neutral: null,
  }
  return map[emo]
}

function pickPhrase(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0]!
}

function makeProactivePhrase(
  snap: import('@shared/attention').AttentionSnapshot,
): { text: string; emotion: EmotionId } | null {
  // 根据 vision 看到的活动 + 时段 + 心情挑一句应景的话
  const period = snap.time_period
  const app = (snap.current_app ?? '').toLowerCase()
  const activity = snap.last_vision_activity ?? ''
  const state = snap.last_vision_state ?? ''
  // frustrated 优先
  if (state === 'frustrated') {
    return { text: pickPhrase(['遇到难题了吗主人？', '别急，我陪着你。', '深呼吸一下吧。']), emotion: 'shy' }
  }
  // 看到具体活动
  if (activity.includes('代码') || activity.includes('code') || app.includes('vscode') || app.includes('terminal')) {
    return { text: pickPhrase(['写代码辛苦啦~', '主人专心的样子好帅。', '我安静陪着你哦。']), emotion: 'shy' }
  }
  if (activity.includes('视频') || activity.includes('video') || app.includes('chrome') || app.includes('safari')) {
    return { text: pickPhrase(['在看什么呀？', '有趣吗主人？', '陪你一起看~']), emotion: 'happy' }
  }
  // 时段问候
  if (period === 'morning') {
    return { text: pickPhrase(['早上好呀主人~', '今天打算做点什么？', '今天也要加油哦。']), emotion: 'happy' }
  }
  if (period === 'late_night' || period === 'night') {
    return { text: pickPhrase(['很晚啦，要注意休息哦。', '主人困了吗？', '夜深了，陪你说说话。']), emotion: 'sleepy' }
  }
  if (period === 'afternoon') {
    return { text: pickPhrase(['下午好~', '要不要喝杯水？', '今天过得怎么样？']), emotion: 'neutral' }
  }
  // 默认轻量陪伴
  return { text: pickPhrase(['我在这儿哦~', '主人在忙什么？', '想到你了。']), emotion: 'shy' }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/**
 * v0.21 Round H:planner 单例 → factory(收 task #32 / reviewer Round A MEDIUM-4)
 *
 * Round A 已把 llmCallTimestamps 挪进 BehaviorPlanner instance field,
 * 本次完成 M8 灵魂社会前置最后一步:per-character planner 实例。
 *
 * 设计:
 * - 默认调 `getPlanner()` 拿 default 灵魂 planner(向后兼容)
 * - 传 characterId 时,Map cache 返回该 character 独立实例(独立 budget / state)
 * - M8 多灵魂同框时 attention scheduler 在 onTrigger 拿到 decision.target_character_id 后
 *   `getPlanner(decision.target_character_id)` 选对应 planner
 *
 * v0.23+ 升级:character delete 时 disposePlannerFor(id) 清 Map entry,避免泄漏。
 */
const plannerInstances = new Map<string, BehaviorPlanner>()
/**
 * reviewer H-LOW-1:default planner 的 sentinel key。
 * 约定:characterId 不应包含 `__` 双下划线前后缀(实际 character-store 用 UUID,
 * 不会冲突,但注释明确这条约定)。若 M8 真撞,改 Symbol-keyed Map。
 */
const DEFAULT_PLANNER_KEY = '__default__'

export function getPlanner(characterId?: string): BehaviorPlanner {
  // reviewer H-MEDIUM-1:`??` 只触发 null/undefined,空字符串 '' 会被当真实 key,
  //   创建第三个 planner 实例(不是 default 也不是任何真实 character)。
  //   用 `||` 让 '' 也走 default(更宽容),或考虑显式 throw 严格拒绝。
  //   选择 `||`:scheduler 误设 '' 时静默走 default 比制造异常路径更安全。
  const key = (characterId && characterId.length > 0) ? characterId : DEFAULT_PLANNER_KEY
  let instance = plannerInstances.get(key)
  if (!instance) {
    // Round P:把 character id 传给 planner,让它知道自己服务谁(用来读自己
    // memory.db 的 cross-character event 当 prompt context)。
    // default planner 传 null(legacy 兼容,不读 cross-char)。
    instance = new BehaviorPlanner(key === DEFAULT_PLANNER_KEY ? null : key)
    plannerInstances.set(key, instance)
  }
  return instance
}

/**
 * test 用:清空所有缓存的 planner 实例(单测隔离)。
 *
 * reviewer H-MEDIUM-1 已知 trade-off:`_` 前缀是命名约定而非真隔离 —
 * production 打包后此函数同样导出,任何 caller 都能误调。当前规模下接受,
 * v0.23 (M8 真做) 时可考虑用 NODE_ENV gate 或 Symbol-keyed Map 让 reset
 * 只在 test 环境工作。
 */
export function _resetAllPlannersForTest(): void {
  plannerInstances.clear()
}

/**
 * v0.21 Round J:dispose 指定 character 的 planner 实例。
 * 用在 `deleteCharacter` 后清掉 Map cache 项,避免 stale instance + 内存泄漏。
 *
 * 不存在的 characterId 返 false(idempotent,删 character 时不报错)。
 *
 * reviewer R-J MEDIUM-1 防御:空字符串拒绝(避免误删 default planner 的
 * sentinel key`__default__` — 虽然 deleteCharacter 不会传 '',但 caller
 * 可能直接调,严格 guard 让 default planner 不被意外清掉)
 */
export function disposePlannerFor(characterId: string): boolean {
  if (!characterId || characterId.length === 0) {
    console.warn('[planner] disposePlannerFor: 拒绝空 characterId(防止误删 default)')
    return false
  }
  return plannerInstances.delete(characterId)
}

/**
 * @deprecated v0.21 留向后兼容,attention/index.ts 已改用 getPlanner()。
 * v0.23 多灵魂全推完时移除此 const export(届时所有 callsite 都需 characterId)。
 */
export const planner = getPlanner()
