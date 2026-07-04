# RFC 0002 — Live2DStage 多实例渲染(灵魂同框)

**作者**: LUVU architect subagent
**创建**: 2026-05-26
**Tier**: 2(multi-file behavior preservation + new component surface)
**状态**: **Q1 ✅ + Q2 ✅ 已实施(N=1 安全,N>1 死路径待 GUI 真测);Q3-Q5 待 GUI session**

## 实施进度

| Round | 状态 | commit | 备注 |
|---|---|---|---|
| Q1 抽 Live2DInstance.vue | ✅ | `0e0c134ce` | 纯重构,N=1 逐字等价,reviewer 过 |
| Q2 v-for + 按角色模型 | ✅ | `666f6619e` | + avatar/layout.ts 纯函数 + 7 单测,reviewer 过 |
| Q3 视觉强调(active 居中/降色) | ⏳ 待 GUI | — | 需 ≥2 character + GUI 真测 |
| Q4 hit-test first-hit-wins + bus characterId 过滤 + 拖拽路由 | ⏳ 待 GUI | — | 同上 |
| Q5 edge + 性能验证 + docs | ⏳ 待 GUI | — | 同上 |

**实施中浮现的关键设计决策(补充 §3 / §4)**:
> **模型来源分流** — active instance **不传 modelDir**,走原 `pickAndLoad` 的 cfg.soul
> 路径(保证 N=1 逐字不变 + 保留 cubism2 自动切换/fallback chain/saveAvatar 等
> active 专属副作用)。非 active instance 传 `Character.live2d_model_dir/file`,走新增的
> `loadSpecificModel()` 简化路径(不碰 active soul、无 saveAvatar、无 toast)。
> 这是 RFC §4.2 props 未细化的部分 —— 原 RFC 假设所有 instance 同质,实际 active
> 与非 active 的「模型来源 + 副作用」必须分流,否则非 active 会覆写 active 的 soul。

**Q3-Q5 GUI session 前置条件**:
> 1. 用户先创建第 2 个 character(当前 `~/.luvu/chars/` 仅 `default` 一个)
> 2. 在 CharacterPicker mount 两个 → 验证横排同框真出现两个不同立绘
> 3. Q4 前置(reviewer Q2-MEDIUM):若 Q4/Q5 改成在 model 切换时重建 renderer,
>    `loadSpecificModel` 必须重新 `emit('ready')` 让 Stage 更新 WindowInteraction sampler

---

## 1. 背景与动机

### 1.1 当前事实

- `Live2DStage.vue`(469 行 SFC)是**单实例容器**:
  - 1 个 `<canvas ref="canvasRef">`(template line 334)
  - 1 个 `let renderer: Live2DRenderer | null`(script line 22)
  - 1 个 `let sampler: AlphaSampler | null`(像素 alpha 命中)
  - 1 个 `let interaction: WindowInteraction | null`(50ms cursor poll + 窗口级 ignore/forward 决策)
- `Live2DRenderer`(`avatar/render/live2d-renderer.ts`)内部:
  - 1 个 `PIXI.Application`(`preserveDrawingBuffer: true`)
  - 1 个 `Live2DModel`(`this.model: Live2DModel | null`)
  - 自驱动 idle motion 调度(setTimeout 4500ms)
  - lipsync / vowel weights / gaze / expression 全部 **per-renderer 状态**
- `AlphaSampler`(`avatar/interaction/alpha-hit.ts`)绑定 **1 个 renderer**,采样 PIXI canvas alpha(96×144 mask, 80ms 更新)
- `WindowInteraction`(`avatar/interaction/window-interaction.ts`)是**窗口级单例**,管 `setIgnoreMouseEvents` 和 native window drag — 这是 **Electron BrowserWindow API**,**逻辑上不可 per-character 拆分**(整个窗口要么穿透要么不穿透)

### 1.2 M8 已 ship 的后端接口

- `window.api.characters.listMounted()` → `Character[]`
- `window.api.characters.setMounted(ids)` → `{ ok, mounted_ids, mounted }`
- `useCharacterStore` 已有 `mounted` ref + `mountedIds` computed + `toggleMount(id)`(`infra/stores/character.ts:179`)
- 后端自动:active 永远在 mounted 集合中、去重、上限 16

### 1.3 用户场景

> "我 mount 了 Suzy 和 Hina,想看两个灵魂**同屏出现**。Suzy 在说话时 Hina 静静站在旁边偶尔歪头,主人和 Suzy 对话时 Hina 听到偶尔反应(Round N 已实现的 cross-character passive listening)。"

### 1.4 当前限制

后端跨角色事件 + 听到计数(`mountedEventCounts`)已 ship,GUI 上只能在 CharacterPicker 卡片上看到 👂 徽标 — **看不到立绘同框**。M8 的核心承诺(灵魂社会的"在场感")在视觉上**没兑现**。

---

## 2. 设计目标与非目标

### 2.1 目标(Must)

| ID | 目标 | 验证 |
|---|---|---|
| G1 | 同屏渲染 N 个 mounted character 的 Live2D 立绘(N ≤ 4 推荐) | GUI 真测,Suzy + Hina 同框 |
| G2 | 每个实例独立 idle motion / gaze / lipsync / expression | active 说话嘴动,非 active 嘴不动 |
| G3 | active character 视觉高亮,非 active 视觉降级(透明度/缩放/位置 一种或多种) | GUI 一眼能分清谁是主角 |
| G4 | M8 cross-character event(Round N 已 ship)能驱动非 active 角色的 micro-reaction(例如轻轻歪头) | bus 事件 → instance 路由 |
| G5 | 重构后单 mount(N=1)行为与重构前**完全一致**(零回归) | E2E + GUI 真测 |
| G6 | 每个 Round 单独 commit,可独立 reviewer 通过 | git log 5 个 commit |

### 2.2 非目标(Out of Scope)

| ID | 不做 | 理由 |
|---|---|---|
| NG1 | 多 character **同时**生成 LLM 回复 | Round N+P 设计就是 passive listening — 同一时刻只有 active 在 reply,其他只是听到事件 |
| NG2 | 真正的群聊(多角色之间互动对话) | 留 v0.22+,本 RFC 仅做"同框存在感" |
| NG3 | 多角色拖拽各自独立位置(自由摆) | 留 Open Question — 默认决策见 §3.6 |
| NG4 | 16 个 character 同屏的极端 case 性能保证 | §6 风险中讨论上限收紧 |
| NG5 | 非 active character 自己跑独立 attention scheduler / planner | 后端 M8 早已支持 per-character planner;**这是后端事**,本 RFC 只管渲染 |

---

## 3. 关键设计决策

每条决策给出 ≥ 2 个 alternative + trade-off + 推荐。

### 3.1 决策 D1 — 单 PIXI.Application 多 model vs 多 PIXI.Application

**问题**:N 个立绘共享 1 个 `PIXI.Application` 还是各自拥有?

| 方案 | 内存 | 性能 | 隔离 | 复杂度 |
|---|---|---|---|---|
| **A. 单 PIXI App + N 个 model 挂同 stage** | 低(1 个 WebGL ctx) | 1 个 ticker / 1 次 readPixels | 共享 stage,层级管理复杂 | 高(要改 Live2DRenderer 内部 model 管理) |
| **B. N 个 PIXI App + N 个 canvas + 各自 model** | 高(N 个 WebGL ctx) | N 个 ticker(60fps × N) | 完全隔离,每个 renderer 自治 | 低(Live2DRenderer 不动,外层 v-for) |
| **C. 单 PIXI App + 单 model(现状)** | 最低 | 最优 | — | — |

**事实约束**:

- `Live2DRenderer` 内部 `this.model: Live2DModel | null` 是**单数**(line 33),从 `disposeAllStageModels()` 命名+实现看,SDK 本身**允许多个 model 挂同 stage**(`stage.children` 遍历 + 多个 victim 销毁),只是当前架构主动收敛到 1 个
- WebGL context 浏览器上限通常 16(实际多数 GPU 8-16);Electron 同
- 当前 `preserveDrawingBuffer: true` 是为 alpha sampler 服务 — N 个 ctx 都要保留 → 显存代价 × N
- `setVowelWeights` / `setLipsync` / `setExpression` / `playMotionGroup` 都直接操作 `this.model` — 多 model 需要按角色路由

**推荐: 方案 B(多 PIXI App,但收敛在 `Live2DInstance` 子组件内)**

理由:
1. **隔离性** — 每个 instance 的 idle timer / gaze / lipsync 互不干扰,bug 半径小
2. **重构成本最低** — `Live2DRenderer` 一行不改,只是从"组件挂 1 个"变成"v-for 挂 N 个"
3. **WebGL 上限** — 推荐 N ≤ 4 同框,远低于 16 ctx 上限
4. **alpha sampler 简单** — 每个 instance 自己的 sampler 对自己的 canvas(§3.3)

代价:
- N × idle ticker(每个 60fps render loop)— §6.2 风险,推荐用"非 active instance 降帧"缓解
- 显存 N × preserveDrawingBuffer 全分辨率 — 实测预算见 §7

**Alternative 保留**:如果 §7 性能验证 N=3 时 CPU > 25%,降级到方案 A(单 App + 多 model)。这是**回滚备份**,但 Round Q1 先尝试 B。

---

### 3.2 决策 D2 — 单 canvas vs 多 canvas

**问题**:N 个 instance 在 1 个 `<canvas>` 上叠加,还是各自 `<canvas>`?

| 方案 | 透明叠加 | hit test | 拖拽 | 复杂度 |
|---|---|---|---|---|
| **A. 单 canvas + 多 model 在 PIXI stage 内 z-order** | PIXI 原生 | 单 canvas 像素 alpha → 算"在哪个 model 上"要按 model.getBounds 投影 | 整窗口拖(现状) | 高 |
| **B. 多 canvas,绝对定位叠加** | CSS opacity / mix-blend(可选) | 每 canvas 独立 sampler | 整窗口拖 or 拖单 instance | 中 |

**事实约束**:

- 当前 canvas `pointer-events: none`(line 394) — 这意味着 **DOM 层不接 mouse 事件**,鼠标命中靠主进程 cursor poll + alpha sampler
- 多 canvas 都 `pointer-events: none` 完全没问题
- `StickerOverlay`(`avatar/components/StickerOverlay.vue`)和 Live2DStage **同级在 App.vue**(line 538, 544),不是 Live2DStage 的子 — 不受影响

**推荐: 方案 B(多 canvas)**

理由:
1. 与 D1(多 PIXI App)天然契合 — 每个 App 必须绑定一个 canvas
2. **alpha hit test 简单** — 每个 canvas 自己的 sampler 算自己的 alpha mask,鼠标命中检测只需对每个 sampler 调 `hits(x, y)`,first-hit-wins
3. **CSS 控制视觉降级** — 非 active 可以 `opacity: 0.85 + scale(0.9) + filter: saturate(0.92)` 纯 CSS 实现,不污染 PIXI 渲染参数
4. **拖动 hit test 简单** — `onMouseDown` 知道是哪个 instance 的 sampler 命中,可以 emit 给 stage 决定"拖整窗" or "拖单 instance"

代价:
- N canvas 的 DOM overhead 微不足道
- z-order 用 CSS z-index 简单

---

### 3.3 决策 D3 — AlphaSampler 怎么扩展(per-instance 还是共享)

**问题**:鼠标 50ms tick 来一次,要知道"在哪个 character 立绘上",怎么算?

| 方案 | 实现 | 性能 | 多 instance 支持 |
|---|---|---|---|
| **A. Per-instance sampler(每个 Live2DInstance 自己持一个)** | 现 AlphaSampler 不动,N 个 instance N 个 sampler | N × 80ms readPixels (96×144) | 天然支持 |
| **B. 共享 sampler,扩 API 支持 N 个 canvas + N 个 mask** | 改 AlphaSampler 持 N×mask + N×ctx | 1 个 timer 串行采 N | 需重构 sampler |
| **C. 用 PIXI hit test API** | 用 `app.renderer.plugins.interaction` 或自定义 hitArea | 0 readPixels | 改动巨大,放弃 alpha 精度 |

**事实约束**:

- AlphaSampler `sample()` 内部 `this.ctx.drawImage(src, ...)` + `getImageData` — **每个 sampler 自己有 offscreen canvas + 2d ctx**,互不干扰
- 80ms 间隔的 readPixels 在 96×144 几乎零成本(<1ms),N=4 时总成本 < 4ms / 80ms = 5% — 完全可接受
- AlphaSampler 构造接收 `renderer: Live2DRenderer`(line 31),设计就是 per-renderer 绑定

**推荐: 方案 A(per-instance sampler)**

收益:
- AlphaSampler 一行不改
- 多 instance 各自 sampler,**命中判定逻辑天然分离**
- WindowInteraction 改成"按 z-order 倒序问每个 sampler,first hit wins" — §3.4 详述

代价:
- N × offscreen canvas(96×144 × 4 bytes = 55KB × N)— 可忽略

---

### 3.4 决策 D4 — WindowInteraction 是否拆 per-instance

**核心约束**:`setIgnoreMouseEvents` 是 **Electron BrowserWindow API**(整个窗口生效)— **物理上不能 per-character**,要么整窗穿透要么整窗响应。

**问题**:既然窗口级单例,WindowInteraction 是否还在 Live2DStage,还是上提到 App.vue?

| 方案 | 责任拆分 |
|---|---|
| **A. WindowInteraction 上提到 Live2DStage(协调器)层,持有 N 个 sampler 引用,first-hit-wins** | Live2DInstance 只做渲染,WindowInteraction 仍是窗口级单例 |
| **B. 每个 instance 自己持 WindowInteraction,N 个互相覆写 ignore 状态** | 实际会互相竞态(谁后 tick 谁说了算),**绝对不可行** |

**推荐: 方案 A(WindowInteraction 留在 Live2DStage,变成协调器)**

具体设计:
- `WindowInteraction` 构造接收 `samplers: AlphaSampler[]`(数组)而非单个
- `onCursorTick(pt)` 内部:
  - 按 z-order **倒序**遍历(顶层 instance 优先)调 `sampler.hits()` first-hit-wins
  - emit `avatar:mouse-inside` 时多附 `characterId`(让需要的组件知道**主人鼠标在哪个角色上**)
- `onMouseDown` 同样 first-hit-wins,emit `avatar:character-drag-start` 携带 characterId 给上层路由
- `setIgnoreMouse` / `forceInteractive` 行为完全不变 — 这是**窗口级**

收益:
- ignore/forward 状态机不变(已经经过 v0.17 多轮验证)
- 多 character 命中检测和单 character 退化一致(N=1 时跟现在完全等价)

代价:
- WindowInteraction 构造签名变化 — 改一处 Live2DStage 即可

---

### 3.5 决策 D5 — active vs mounted 视觉区分

**问题**:用户怎么一眼看出哪个是 active?

候选维度(可以组合):

| 维度 | 实现 | 视觉冲击 |
|---|---|---|
| **透明度** | active: opacity=1, 非 active: opacity=0.85 | 弱-中 |
| **饱和度** | active: saturate(1), 非 active: filter: saturate(0.88) | 弱 |
| **缩放** | active: scale(1.0), 非 active: scale(0.85-0.92) | 中-强 |
| **drop-shadow 强度** | active 强,非 active 弱 | 弱 |
| **位置** | active 中央,非 active 左/右后退 | 强(也是布局) |
| **边框/光晕** | active 加 outline glow | 强(可能太"游戏化") |
| **idle motion 频率** | active 全速,非 active 半速(每 9s) | 微妙 |

**推荐组合**:
- 缩放(scale 0.88) + 透明度(0.9) + 饱和度(0.92) + idle 频率(7.5s) — **多维度叠加,任一维度都不刺眼,但整体一眼分辨**
- **不加**边框光晕 — 太游戏化,违反硅基生命容器审美
- **位置**:见 §3.6 (默认横排,active 居中)

**视觉示例**(伪 ASCII):
```
   ┌─────────────────────────────────────┐
   │                                     │
   │   [Hina]   [  Suzy  ]   [Lyra]      │
   │   小+淡    active 居中  小+淡        │
   │   后退一点 normal      后退一点      │
   │                                     │
   └─────────────────────────────────────┘
```

---

### 3.6 决策 D6 — 布局:横排 / 围绕 / 用户自由摆

| 方案 | 实现 | UX |
|---|---|---|
| **A. 横排,active 居中,非 active 两侧** | CSS flex / absolute position | 简单可预测,适合 N ≤ 3 |
| **B. 围绕 active 圆弧** | 几何计算位置 | 美观但难落地,N 变化时位置跳 |
| **C. 用户拖拽自由摆,每实例 preferences.position 持久化** | 改 preferences schema | 灵活但增加复杂度 |

**事实约束**:
- `preferences.json` 当前 schema(`window.api.models.setPreference` payload)只有 `{ character_id, scale, offset_y }`(Live2DStage line 156-160)
- M8 已经 per-character `~/.luvu/chars/<id>/preferences.json` 隔离

**推荐: 方案 A(横排 active 居中)作为 Round Q3 落地默认。方案 C 作为 Open Question 留给主人决定(§8.1)**

理由:
- A 在 N ≤ 3 时视觉自然,N=4 时也勉强可看
- C 的"拖拽自由摆"是**用户喜好**问题,设计层面没有客观正确答案,主人决定

---

### 3.7 决策 D7 — 拖拽行为(拖整窗 vs 拖单角色)

**事实约束**:
- 当前 `WindowInteraction.onMouseDown` → `window.api.window.startDrag()` 拖**整个 Electron 窗口**(line 158)
- 多 instance 时,**没有"拖单个角色"的原生支持** — 因为所有 instance 都在同一个透明窗口里

| 方案 | 行为 |
|---|---|
| **A. 全部按住任意 instance 都拖整窗(现状延续)** | 简单,用户预期"桌宠 = 一坨" |
| **B. 按住 active = 拖窗,按住非 active = 拖单实例(改其 CSS position)** | 复杂,要把 position 写进 preferences,跨会话持久化 |
| **C. 按住任意 = 拖整窗,Shift + 按住 = 拖单实例** | 隐藏路径,需文档 |

**推荐: Round Q4 默认 A(全部拖整窗),Open Question 留 C 作为高级用法**

理由:多数用户对"桌宠 = 一坨贴在桌上的整体"有直觉预期。把拖单实例做成高级路径(§8.2)。

---

## 4. 推荐架构

### 4.1 组件结构

```
App.vue
└─ Live2DStage.vue (协调器:订阅 character store + 持 WindowInteraction)
   ├─ Live2DInstance.vue (per-character,N 个)
   │  ├─ <canvas> (自己的)
   │  ├─ Live2DRenderer (自己的)
   │  └─ AlphaSampler (自己的)
   └─ WindowInteraction (1 个,接收 N 个 sampler 引用)
```

### 4.2 `Live2DInstance.vue` 接口设计

**Props(都是 readonly,父级控制)**:
```
interface Live2DInstanceProps {
  characterId: string             // M8 character id
  modelDir: string                // 模型目录
  modelFile?: string              // model3.json 文件名
  isActive: boolean               // 是否 active(影响视觉)
  layoutHint: {                   // 父级算好的位置/缩放
    x: number                     // CSS left(相对父容器,百分比)
    y: number                     // CSS top
    visualScale: number           // 1.0 = active, 0.88 = 非 active
    visualOpacity: number         // 1.0 / 0.9
    zIndex: number                // active=10, 非 active=5
  }
  passthroughEnabled: boolean     // 透传给内部决策
}
```

**Emits**:
```
emit('ready', { characterId, sampler: AlphaSampler })  // 父级收集 sampler 给 WindowInteraction
emit('error', { characterId, reason })
emit('model-loaded', { characterId, path })
```

**内部 state**:
- `renderer: Live2DRenderer | null`
- `sampler: AlphaSampler | null`
- 订阅 `avatar:lipsync` / `avatar:vowel-weights` / `brain:emotion-changed` / `avatar:zoom`,**但要按 characterId 过滤**(只响应给本 character 的事件)

**关键演变**:
- bus 事件 payload 加 `characterId` 字段(向后兼容 — payload 没 characterId 时所有 instance 都响应)
- `avatar:reload-model` payload 加 `characterId`(或全局重载)
- `avatar:zoom` payload 加 `characterId`(决定哪个角色被缩放)

### 4.3 `Live2DStage.vue` 改造后职责(协调器)

- 订阅 `useCharacterStore.mounted` ref
- v-for 渲染 `<Live2DInstance v-for="c in mounted" :key="c.id">`
- 计算 `layoutHint`(横排算法 §3.6 方案 A)
- 收集每个 instance 上报的 sampler 引用
- 构造 1 个 `WindowInteraction({ samplers: collectedSamplers, ... })`
- 转发 `attention:execute-plan` 时按 characterId 路由到对应 instance 的 renderer

### 4.4 数据流图

```
character store (Pinia)
  ├─ mounted: Character[] ─────┐
  └─ active: Character ─────┐  │
                            │  ▼
                            │  Live2DStage
                            │    ├─ layoutHint 计算(N 个位置)
                            │    │      │
                            │    │      ▼
                            └─→  Live2DInstance × N (v-for)
                                   ├─ Live2DRenderer (1 model)
                                   ├─ AlphaSampler ─→ emit('ready', sampler)
                                   └─ bus 事件订阅(按 characterId 过滤)
                                                     │
                                                     ▼
                                            samplers[] 收集
                                                     │
                                                     ▼
                                        WindowInteraction (1 个)
                                            ├─ onCursorTick: first-hit-wins
                                            ├─ emit avatar:mouse-inside(+characterId)
                                            └─ window.api.window.setIgnoreMouse
```

### 4.5 StickerOverlay 关系

**事实**:`StickerOverlay` 和 Live2DStage 是 App.vue 的**兄弟组件**(line 538/544),不在 Live2DStage 内。

**决策**:Round Q1-Q5 范围内**不动 StickerOverlay** — 它本来就是全屏覆盖,飘在哪都可以。

**Open Question(§8.4)**:StickerOverlay 是否要绑定 active character?例如 Suzy 画了张图,sticker 飘在 Suzy 旁边而不是 Hina 旁边?Round Q3 视觉布局完成后可单独 RFC。

---

## 5. 迁移路径(5 个 Round)

### Round Q1 — 抽 Live2DInstance.vue(零行为变化的纯重构)

**目标**:把 Live2DStage 内部所有渲染逻辑搬到 `Live2DInstance.vue`,Live2DStage 变成"内部只有 1 个 Live2DInstance"的薄壳。

**变更范围**:
- 新增 `electron/src/renderer/src/avatar/components/Live2DInstance.vue`
- 改 `Live2DStage.vue`,内部改 `<Live2DInstance :character-id="active.id" :is-active="true" ...>`
- bus 事件订阅留在 Live2DInstance,**暂不过滤 characterId**(单 instance 不影响行为)
- WindowInteraction 仍在 Live2DStage,改成接收 sampler **数组**(只塞 1 个,N=1 路径)

**验证**:
- `pnpm typecheck` + `pnpm build` 通过
- GUI 真测:单 character 行为与 main 分支完全一致(idle motion / lipsync / 拖动 / 缩放 / 透传都不变)
- 单测:无新单测(Vue 组件本就无单测)

**Commit**:`refactor(avatar Q1): 抽 Live2DInstance.vue,Live2DStage 退化为单实例壳`

**Reviewer 重点**:零行为变化,bus 事件订阅顺序、forceInteractive 时机、saveTimer 防抖位置不能变

---

### Round Q2 — Live2DStage 改 v-for(N=1 退化路径保底)

**目标**:Live2DStage 改 `<Live2DInstance v-for="c in mounted">`,mountedIds.length === 1 时退化到 Q1 行为。

**变更范围**:
- Live2DStage v-for `mounted` ref
- layoutHint 算法:N=1 时 instance 占满,N>1 时**横排公式**(`x = (i + 0.5) / N * 100%`)
- WindowInteraction 接收所有 sampler(通过 emit('ready') 收集)
- Live2DInstance 内部 bus 订阅**开始按 characterId 过滤**(payload 有 characterId 字段才匹配,无字段保留全局响应)
- `avatar:lipsync` / `avatar:vowel-weights` / `brain:emotion-changed` / `avatar:zoom` payload 在 emit 侧逐步加 characterId(可以 Q5 收尾再补,Q2 阶段先支持双格式)

**验证**:
- N=1: 行为与 Q1 完全一致
- N=2(手动 mount Suzy + Hina): 同框,两个 idle motion 独立播放,但 lipsync/emotion 当前都打给所有 instance(没过滤)
- 性能:`requestAnimationFrame` × 2 ticker,CPU < 15%

**Commit**:`feat(avatar Q2): Live2DStage v-for 多实例渲染,N=1 行为退化保持`

**Reviewer 重点**:N=1 严格无回归;N>1 时多 WebGL ctx 不爆;layoutHint 计算无 mutation

---

### Round Q3 — 多实例视觉(active 高亮 + 横排布局)

**目标**:实现 §3.5 视觉降级 + §3.6 横排布局。

**变更范围**:
- Live2DInstance props 增 `layoutHint.visualScale / visualOpacity / zIndex`
- CSS:`transform: scale(var(--instance-scale))`、`opacity: var(--instance-opacity)`
- 非 active idle motion 频率降低(setTimeout 7500ms vs active 4500ms,需在 Live2DRenderer 暴露 setIdleInterval API,**或**保持频率不变只调透明度避免改 renderer)
- active 切换时 CSS 平滑过渡(`transition: transform 400ms / opacity 400ms`)
- 监听 `character:switched` bus 事件,重新计算 layoutHint(active 切了 → 上一个 active 降级,新 active 升级)

**验证**:
- 主人切 active(M8 picker 操作),立绘平滑过渡而非闪烁
- 非 active 立绘明显但不抢镜,与 active 视觉对比一眼分辨
- GUI 真测 N=3 不重叠不出框

**Commit**:`feat(avatar Q3): 多实例视觉 — active 居中高亮 / 非 active 后退降色`

**Reviewer 重点**:CSS transition 不破坏 alpha sampler(实际 sampler 采 canvas 原始像素,CSS scale 不影响);切换不应导致 model reload

---

### Round Q4 — 多实例 alpha hit test + 拖拽路由

**目标**:WindowInteraction 改成 first-hit-wins 多 sampler,拖拽默认拖整窗。

**变更范围**:
- WindowInteraction.opts 改:`samplers: AlphaSampler[]`(数组),并存对应的 `characterIds: string[]`
- `onCursorTick` 倒序遍历(顶层 z-index 优先)调 `hits`,first hit 决定 `setIgnoreMouse`
- emit `avatar:mouse-inside` 加 `characterId` 字段
- emit `avatar:contextmenu` 加 `characterId`(右键菜单可显示是对哪个角色右键的)
- 拖拽默认拖整窗(§3.7 方案 A)
- M8 cross-character event(`avatar:cross-char-event`,如果 Round N 已 emit)→ 路由到对应 characterId 的 Live2DInstance,触发 micro-reaction(轻轻歪头 = playMotionGroup('FlickLeft'))

**验证**:
- 鼠标 hover Hina(非 active)立绘,WindowInteraction 知道在 Hina 上,触发 hover micro-reaction
- 鼠标 hover 空白透明区,穿透
- 右键 Suzy(active)弹主菜单,右键 Hina 也弹主菜单(但 payload.characterId 可被菜单使用)

**Commit**:`feat(avatar Q4): 多实例 alpha hit test first-hit-wins + cross-char event 路由`

**Reviewer 重点**:first-hit-wins 顺序与 z-order 一致;passthrough 切换时多 sampler 都不能漏检

---

### Round Q5 — Edge cases + GUI 真测 + 性能验证

**目标**:收口边界 + 性能预算验证 + 文档更新。

**变更范围**:
- mount/unmount 时 Live2DInstance 的挂载/卸载顺序(异步加载未完成时 unmount 不能 crash)
- 切 active 时不重 reload model(只改 layoutHint props)
- N=4 极限场景手动测,降级到 3 的 fallback 路径(toast 提示"过多角色同框影响性能,建议 mount ≤ 4")
- preferences:`offset_y` 在多实例时含义变了 — Q5 决定保留 per-character offset_y 但加注释说明 only N=1 时有效
- 更新 `docs/ARCHITECTURE.md` §4 加多实例渲染章节
- 更新 `CLAUDE.md`(Important Patterns 节)说明新组件

**验证**:
- N ∈ {1,2,3,4} 全跑 30 分钟稳定(无内存泄漏 / 无 WebGL context lost)
- CPU < 25%(M1/M2/Apple Silicon),内存 < base + 200MB(§7)
- 拔掉模型再 mount 不 crash

**Commit**:`feat(avatar Q5): Live2D 多实例 — edge cases + 性能验证 + docs`

**Reviewer 重点**:性能预算达成;文档与代码同步;rollback 路径清晰

---

## 6. 风险与缓解

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | **WebGL context 上限**(浏览器通常 16 ctx,M8 上限 16 character)— 用户 mount 满 16 极端 case 直接 ctx lost | 高 | UI 强提示:同屏渲染 max=4,>4 时只渲染 active + 3 个最近交互的 character(其他保持 mounted 跑后端逻辑但不渲染);Open Question §8.3 |
| R2 | **N × 60fps render loop CPU 压力** — 每个 PIXI App 自己 ticker | 中 | 非 active idle interval 拉长(7.5s vs 4.5s)+ Q5 性能验证,>25% CPU 则方案 A 降级 |
| R3 | **alpha 跨多 instance 命中歧义** — 立绘视觉重叠时,鼠标 hover 重叠区算哪个? | 中 | first-hit-wins 按 z-order(active z-index=10 最高),设计上 active 永远响应优先 |
| R4 | **`setIgnoreMouseEvents` 窗口级单例不可拆**(Electron 限制) | 已知约束 | WindowInteraction 留单例 + first-hit-wins 协调(§3.4) |
| R5 | **CLAUDE.md 禁忌:不要给 panel 父级加 `pointer-events: none + zoom`**(破坏 fixed children click) | 已知约束 | 不在 Live2DInstance/Live2DStage 父级用 zoom — 视觉缩放只用 transform: scale 在 instance 自己上 |
| R6 | **bus 事件被多 instance 重复响应**(N=2 时 lipsync 一个事件触发 2 个 model 都嘴动) | 高 | Q2-Q3 引入 characterId 过滤,过滤未实施前(Q1 后)如果 master 实测发现问题立即升级到 Q2 |
| R7 | **PIXI baseTexture cache 共享导致 mass model dispose 影响别的 instance** | 中 | `disposeAllStageModels` 已经`texture: false, baseTexture: false`不销毁纹理(line 526),已防御 |
| R8 | **idle motion 同步显得诡异**(N 个角色同时歪头) | 低 | 加 random initial delay,每个 instance 启动时 setTimeout 随机 0-1500ms 偏移 |
| R9 | **`preferences.offset_y` per-character 在多实例时语义混乱**(横排布局已经强制 y 位置) | 低 | Q5 保留字段但加注释:N>1 时 offset_y 与 layout y 叠加显示偏移 |
| R10 | **CSS scale 整体呼吸 + active 切换 scale 过渡冲突** | 低 | Live2DInstance 内部呼吸 scale 用 `transform: scale(breath) scale(visualScale)`(transform 可串接);或把呼吸迁到 filter |
| R11 | **多实例时模型加载顺序导致 stage 闪烁** | 低 | Q5 在 Live2DInstance 显示 shimmer 直到 ready,与现有 status='loading' 转场一致 |

---

## 7. 验证标准

### 7.1 自动测可覆盖

| 范围 | 工具 |
|---|---|
| layoutHint 计算函数(横排公式 / N=1 退化) | vitest 单测 — **新增 layoutHint.test.ts** |
| bus 事件 characterId 过滤逻辑 | vitest(纯函数提取) |
| character store mountedIds 派生 | 已有 store |

**不覆盖**(限制):Vue 组件 / PIXI 渲染 / WebGL context 无单测 — 必须 GUI 真测。

### 7.2 必须 GUI 真测

每个 Round 完成时主人手动验证:
- N=1: 单实例行为零回归(idle / lipsync / 拖动 / 缩放 / 透传 / 模态)
- N=2: Suzy + Hina 同屏,两个 idle 独立,active 视觉突出
- N=3: 三角色不重叠,布局合理
- N=4: 极限,UI 提示
- mount/unmount 切换:实时增减不闪烁,active 切换平滑

### 7.3 性能预算

| 指标 | 目标(N=3) |
|---|---|
| 帧率 | ≥ 50 fps |
| CPU | < 25%(M1/M2/Apple Silicon),< 35%(Intel) |
| 内存增量 | < +200 MB vs N=1 |
| 启动时间 | < +1.5s vs N=1 |
| GPU 显存 | < +120 MB vs N=1 |

**测量方法**:Activity Monitor + Chrome DevTools Performance + `pidstat`(Linux 跑 CI 时);Q5 阶段必测。

---

## 8. Open Questions(等主人决定)

### 8.1 布局方案

§3.6 推荐 A(横排 active 居中),Open:
- 是否要支持 **C(用户拖拽自由摆,每实例 preferences.position 持久化)** — 增加 schema 字段 + 拖拽路由复杂度
- 是否要 **B(围绕 active 圆弧)** — 视觉创意但 N 变化时位置跳

**决策需求**:主人是否要"我把 Hina 拖到 Suzy 左边,关掉再打开还在那"的体验?如要 → Round Q6 单开。

### 8.2 拖拽行为

§3.7 推荐 A(全部拖整窗),Open:
- 是否启用 C(Shift + 按住 = 拖单实例) — 进阶用法
- 是否完全禁掉非 active 角色的拖动(只让 active 可拖,非 active 跟随)

### 8.3 同屏渲染上限

§6.R1 推荐 max=4 同屏,Open:
- max 是改成 4(收紧)还是保留 16(后端 mount 上限) + UI 提示
- 超出 max 时是只渲染 top-K 还是改成"主人选哪几个显示"

### 8.4 非 active 是否参与 idle motion

§5.Round Q3 决策点:
- A. 非 active 也跑 idle motion(占 CPU,但更"活")
- B. 非 active 静态(省 CPU,但显得"机器人")
- C. 非 active 跑 idle 但频率减半(7.5s/次)

**默认 C**,但主人可决定。

### 8.5 StickerOverlay 是否绑定 character

§4.5 提到 StickerOverlay 当前是全屏覆盖。Open:
- 是否让 sticker 飘在生成它的 character 旁边(需要让 ComfyUI 任务携带 characterId)
- 留待 Round Q6+

### 8.6 cross-character event micro-reaction 强度

Round Q4 让非 active 听到 cross-char event 时轻轻歪头。Open:
- 反应强度(0.3 vs 0.5 intensity)
- 反应概率(每个 event 都反应 = 噪音,过低 = 觉察不到)
- 触发 cooldown(同 hover micro-reaction 12s?或更长?)

---

## 9. Rollback Plan

按 Round 粒度 git revert:
- Q5 revert → 回 Q4 行为(无 docs 更新)
- Q4 revert → 回 Q3(无 first-hit-wins,但视觉布局保留 — 但是 hit test 退化到只看 active sampler,非 active 不响应 hover)
- Q3 revert → 回 Q2(N>1 时所有 instance 视觉等同,active 不高亮)
- Q2 revert → 回 Q1(强制 N=1,等同 main 分支)
- Q1 revert → 回 main 分支

每个 Round 单独 commit,可独立 revert + 独立 reviewer 通过。

---

## 10. 决策清单(主人 sign-off 前需明确)

- [ ] D1: 方案 B(多 PIXI App)— 是否同意?
- [ ] D2: 方案 B(多 canvas)— 是否同意?
- [ ] D3: 方案 A(per-instance sampler)— 是否同意?
- [ ] D4: WindowInteraction 单例 + first-hit-wins — 是否同意?
- [ ] D5: 视觉降级组合(scale 0.88 + opacity 0.9 + saturate 0.92)— 是否同意?
- [ ] D6: 布局横排 active 居中 — 是否同意(否则展开 Open Question 8.1)?
- [ ] D7: 拖拽全拖整窗 — 是否同意(否则展开 Open Question 8.2)?
- [ ] §6.R1: 同屏 max=4 上限 — 是否同意?
- [ ] §8 Open Questions 1-6 — 倾向?

---

**Status**: Draft / Awaiting Master Review
**下一步**: 主人 sign-off → 开 Round Q1
