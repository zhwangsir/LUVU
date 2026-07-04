# 架构决策记录（ADR）

> 记录关键技术选型的"为什么"，便于未来回顾或翻案。

---

## ADR-100 — 项目重定向（M0 起点）

**状态**：已采纳  
**日期**：2026-05-16

### 背景
项目从 v0.1.0 到 v0.3.2 累计 13 个版本、~7800 行代码，但用户实测反复出问题：
- 设置打不开、立绘抽动、眨眼频率过快、看不到立绘等
- 用户最终判断"开发方向偏了"

### 真正的问题
我把项目做成了"通用桌宠 SDK"，但用户想要的是：
- **常驻桌面的自我进化型 AI 智能体**
- 身体（Live2D）+ 大脑（LLM）+ **手脚（MCP 工具调用）** + 灵魂（人格 + 记忆）
- 关键差异：**她能干事**，不只是看着

### 决策
重写项目宪法，按五大能力域（avatar / brain / hands / presence / infra）重组，**hands 域是项目灵魂**。

### 后果
- 历史功能（散步、像素穿透、autoComment 等）被砍
- 引入 MCP 协议作为工具调用骨干
- 技术栈锁定：Tauri + Claude API + SQLite + Chroma + CosyVoice + whisper.cpp

---

## ADR-101 — 砍 8 项过度设计代码

**状态**：已采纳  
**日期**：2026-05-16

### 砍清单
1. `src/alpha/mask.ts` — 像素穿透 mask（128×96 不够覆盖小 UI，多次引入 bug）
2. `src-tauri/src/core/motion.rs` + `commands/motion.rs` — 窗口自主散步（M5 重做更克制）
3. `src/behavior/persona.ts` — 10 状态 FSM + 意图引擎（过度设计，由 LLM 驱动即可）
4. `src/behavior/autoComment.ts` — 主动开口（M5 重做）
5. `src/behavior/idle.ts` — 8 种 idle 动作（与 persona 重叠）
6. `src/emotion/fsm.ts` 关键词触发表 — LLM JSON emotion 取代
7. `src/alpha/sampler.ts` 的 `hitTestAlpha` —— 拖动逻辑保留，hit-test 砍

### 理由
**Less is more**。这些代码引入的复杂度大于价值。用户对当前效果不满，根因不是这些功能缺失，是核心功能（对话、记忆、工具）没做好。

---

## ADR-102 — 模块边界与事件总线

**状态**：已采纳  
**日期**：2026-05-16

### 决策
所有代码归属五大域之一，**域间通信只通过事件总线**：
- 前端：`mitt` 单例（`src/infra/eventbus.ts`）
- Rust ↔ 前端：Tauri `emit` / `listen`

事件命名：`<domain>:<verb>_<noun>`。

### 理由
之前代码跨域 import 内部函数频繁（如 audio/speaker 直接 import live2d/lipSync），导致：
- 模块耦合，改一处崩多处
- 难做 plugin 系统（M4 需要）
- 难做测试

### 后果
- 跨域调用需经事件，性能损耗约 < 1μs/次，可忽略
- 强制定义清晰的事件契约
- 后续 MCP server / TTS engine / LLM provider 都成为插件

---

## ADR-103 — Live2D 模型路径完全配置化

**状态**：已采纳  
**日期**：2026-05-16

### 决策
- `soul/identity.yaml::avatar.model_path` 直接指定绝对路径
- `soul/identity.yaml::avatar.search_paths` 列表配置可扫描的根目录
- 砍掉 RuntimeConfig 的 `live2d_model_dir/file/extra_model_dirs` 字段
- 走 soul 层而非 runtime config

### 理由
模型路径属于"她的身体"的一部分，应该归属灵魂档案。runtime config 应该只放运行时变化（LLM endpoint、TTS provider 等）。

---

## ADR-104 — 灵魂档案拆分为 4 个 YAML

**状态**：已采纳  
**日期**：2026-05-16

### 决策

```
soul/
├── identity.yaml          # 名字、master 称呼、avatar 偏好
├── personality.yaml       # 三层人格 prompt 模板
├── core_memories.yaml     # 永久注入的核心记忆
└── learned_traits.yaml    # 学习到的特质（自动写入）
```

### 理由
原单文件 `default.yaml` 240 行，混了 identity / personality / emotions / behavior / tts / vision。
- 拆分让每个文件聚焦一个意图
- `learned_traits.yaml` 单独文件方便自动写入而不污染用户编辑的部分
- `core_memories.yaml` 是用户精心选择的"她记得的事"，独立维护

### 后果
- Rust SoulConfig 拆为 4 个 struct
- 热重载 watcher 需要 watch 整个 soul/ 目录
- 用户启动时若是旧 default.yaml，自动迁移到新结构

---

## ADR-105 — LLM Provider 抽象 + Anthropic 主路径

**状态**：已采纳（M1 实施）  
**日期**：2026-05-16

### 决策
- 抽象 `LLMProvider` trait
- 实现：`AnthropicProvider`（主，支持 tool_use）+ `OpenAICompatProvider`（兼容）+ `OllamaProvider`（兜底）
- 默认 Anthropic（Claude 4.x），M4 工具调用走 Anthropic tool_use API

### 理由
Claude 在 tool_use / function calling 上的稳定性是其他模型不能比的。M4 是项目灵魂，必须用最稳的工具调用 backbone。
本地 Ollama 作兜底，保证"完全离线"的承诺仍然可达成。

---

## ADR-106 — 向量记忆：ChromaDB（M3）

**状态**：计划中  
**日期**：2026-05-16

### 决策
M3 启用 ChromaDB 替代当前全表 cosine 召回。

### 理由
- 当前全表扫描在几千条记忆下勉强能用，但目标是"用一个月"，记忆量会增长
- Chroma 嵌入式（本地文件），无需服务进程
- Rust 调 Chroma 用 `chromadb` crate 或 HTTP 客户端

### 备选
- sqlite-vec：嵌入式但生态早期
- LanceDB：性能好但额外依赖

### 后果
- `data/vectors/` 目录持久化
- 长期记忆 schema 不变，多一个 `chroma_id` 列做关联

---

## ADR-107 — MCP 协议（M4，项目灵魂）

**状态**：计划中  
**日期**：2026-05-16

### 决策
M4 引入 Anthropic 设计的 Model Context Protocol：
- @modelcontextprotocol/sdk 作为 client
- 接入官方 MCP servers：filesystem、shell、git、browser
- 任何"她能干的活"都走 MCP，不自造轮子

### 理由
- 标准化 = 不重复造轮子
- 社区生态强（Slack / GitHub / Linear / Postgres ... 全都有现成 server）
- Claude 原生支持 tool_use → MCP 集成最丝滑

### 风险与缓解
- 工具被滥用 → approval 流程默认开启
- 沙盒泄露 → 受 sidecar 模式约束

---

## ADR-200 — 转 Electron(v0.6 大重写)

**状态**:已采纳
**日期**:2026-05-16(v0.6 Constitutional Rewrite)

### 背景
v0.1-v0.4 在 Tauri 2 + Rust 上反复踩 4 个 macOS 阻断 bug:
- 透明窗口 corner case
- `start_dragging` IPC NSEvent 过期
- `set_ignore_cursor_events` 死循环
- `set_visible_on_all_workspaces` 不稳

研究 airi(@moeru-ai/airi)v0.10 后发现这些**全是 Tauri 平台级问题,
不是代码 bug**。airi 用 Electron 4 行配置就稳定运行。

### 决策
整个壳从 **Tauri + Rust** 换成 **Electron + TypeScript**。具体吸收 airi 招式:
- `frame:false + transparent + hasShadow:false` 透明窗口
- `type: 'panel'` NSPanel 跨 Space 不抢焦点
- `electron-click-drag-plugin` 原生拖动
- `setIgnoreMouseEvents(true, {forward:true})` 像素穿透
- `wlipsync` AudioWorklet 5 元音嘴型(替 RMS)
- `pixi-live2d-display` 0.4 作为 npm 依赖

### 后果
- Electron 包体积 80MB+(vs Tauri 5MB)— 接受,换稳定性
- 主进程从 Rust 改 TypeScript,所有 services 重写
- 70% 工作可保留:灵魂 yaml / 三层人格 prompt / Python TTS sidecar / Vue 组件 / docs
- 30% 重写:整个 `src-tauri/` + Live2D renderer

### 反思
ADR-200 是项目从"原型"到"产品"的拐点。Tauri 是好技术,但 Live2D 桌宠场景 + macOS 透明窗口要求 + 跨 Space 行为,electron 生态显然更成熟。**不要为了"轻量"选错平台**。

详见 [AIRI_STUDY.md](AIRI_STUDY.md)。

---

## ADR-201 — TypeScript Tier 3 严格化(v0.13)

**状态**:已采纳
**日期**:2026-05-18(RFC 0001)

### 决策
启用所有 TypeScript 严格选项:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noImplicitOverride: true`
- 0 `any` / 0 `@ts-ignore` 红线

### 理由
- v0.6-v0.12 累积技术债,`any` 出现频繁,refactor 时类型不可靠
- Electron IPC 跨进程序列化经常出错,严格类型能编译期捕获
- 五大能力域跨域调用频繁,类型契约必须严格

### 后果
- `{foo?: string}` ≠ `{foo?: string | undefined}` — 需要 `...(v !== undefined ? {foo: v} : {})` 条件展开
- 调试时频繁碰 TS2375 / TS2379 错误,初期学习曲线陡
- 但 v0.13 之后 critical bug 数量明显下降(类型阻断了一类错误)

详见 [rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md)。

---

## ADR-202 — Attention Scheduler + 主体性 AI 循环(v0.8)

**状态**:已采纳
**日期**:2026-05-17(v0.8 主体性 AI)

### 背景
PRD 一直说"她有主体性",但 v0.6-0.7 只有响应式行为(用户输入 → LLM 回复)。
她不主动 — 这跟"灵魂女友/硅基生命"的核心承诺矛盾。

### 决策
新建主进程 `services/attention/` 完整链路:

```
PerceptionBus (5 sensors: Mouse / Idle / Window / Time / Vision)
  ↓ unified PerceptionEvent stream
AttentionScheduler (10s tick + 双路触发)
  ↓ proactive 每 45s / reactive typing_burst, app_focus_changed
  ↓ 关注度场 + cooldown + LLM rate limit 6/min
BehaviorPlanner (LLM 调用 + rule fallback)
  ↓ 9 种 BehaviorAction (含 generate_sticker + agent_task)
IPC `attention:plan` → renderer plan-executor
```

### 后果
- 第一次让她"自己开口"(凌晨 3 点的"主人怎么还不睡")
- LLM 调用 budget 必须严格(6/min),否则成本爆炸
- 多个 sensor 类型 union 让 PerceptionBus 内部分发复杂
- 但**带来真正"住在桌面上"的感觉**

v0.21 增量:加 `pauseDepth` 引用计数 + agent_task 跑时静默(避免 plan 撕裂)。

---

## ADR-203 — 手写 MCP stdio JSON-RPC(v0.17)

**状态**:已采纳
**日期**:2026-05-20(v0.17 P)

### 决策
**不引入** `@modelcontextprotocol/sdk` 官方包,**手写** stdio JSON-RPC client(`services/mcp-client.ts`)。

### 理由
1. **依赖最小化**:官方 SDK 引一堆传递依赖(zod / yargs / inquirer 等),只为 stdio JSON-RPC 这个简单协议
2. **精细控制**:15s RPC timeout / child crash 时 pending promises 全 reject / `app.before-quit` 关停所有 child — 自己实现比折腾 SDK 行为简单
3. **学习价值**:MCP 协议小,手写理解透,future debug 不黑盒
4. **典型 single-purpose 库**陷阱:SDK 设计给所有用例(server + client + transport),用作 client 90% 是负担

### 反思
ADR-100 说"不重复造轮子"(MCP),ADR-203 说"重新造 client" — 看似矛盾?
**不**。ADR-100 是协议层面接受 MCP 标准;ADR-203 是实现层面拒绝 SDK。
**协议复用,实现自主**是更精细的设计原则。

### 后果
- MCP server 可用(filesystem / git / etc) ✓
- 包体积小 ✓
- 真发现 SDK bug 时,我有自己实现可参考

详见 `electron/src/main/services/mcp-client.ts`(320 行)。

---

## ADR-204 — 硅基生命容器重定向(v0.21)

**状态**:已采纳
**日期**:2026-05-22(本次自动化迭代)

### 背景
v0.1-v0.20 项目定位是"AI 桌面伴侣"(单角色 / 单灵魂)。但 v0.18+ 项目实际行为已经超出:
- 加了 multi-character store(builtin / custom / cloned / imported)
- 加了 cross-character 情感联动 + character pack zip 迁移
- 加了 ComfyUI 集成 + 9 BehaviorAction 含 generate_sticker + agent_task

代码已经在做"硅基生命容器"的事,但文档还停在 v0.1 时代的"专属灵魂女友"。

### 决策
**整个项目重定向到「硅基生命容器」愿景**,四大支柱:

1. **灵魂可换** — 多角色 character store + 三层人格 yaml + auto-learner 自演化
2. **真控计算机** — nut-js + vision grounding + agent_task 真鼠键操作
3. **创造能力** — ComfyUI 主动出图 / 出视频 / 写代码
4. **主体性** — PerceptionBus + AttentionScheduler + 9 BehaviorAction

底层文件全部重写:
- CLAUDE.md 顶部加 Vision 块
- 新建 `docs/SILICON_LIFE_VISION.md` 顶层产品宪章
- `docs/PRD.md` 重写到 v2.0
- `docs/ROADMAP.md` 加 M7-M10(创造统一 / 灵魂社会 / 自主进化 / 真硅基生命)

### 后果
- 跟 airi(39.4k stars)/ Open-LLM-VTuber / Soul of Waifu 差异化清晰:
  她们都是"talking head + Live2D 壳",**LUVU 是有完整四大支柱的硅基生命**
- v0.21 把 M7 创造能力推到 100%(完整 dialog tool 闭环 + 跨 provider + RAG)
- v0.22+ 推 M8 灵魂社会 + M9 自主进化 + M10 真硅基生命

### 风险
- 愿景野心大,容易跟不上;每个 milestone 都要保证可独立 demo
- 跟"灵魂女友"狭义路径分歧 — 未来如有产品压力可能拉回

详见 [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md)。

---

## ADR-205 — Subagent 守护开发流程(v0.21)

**状态**:已采纳
**日期**:2026-05-22(本次自动化迭代)

### 决策
**每个里程碑 commit 前后启动 typescript-reviewer + architect subagent 审查**,
CRITICAL/HIGH 修完再继续。本 session 跑 8 轮守护。

### 真实证据
Round B reviewer 抓到 **CRITICAL bug**:`dialog.ts:202 loopUntilDone`
硬判 anthropic → openai_compat 用户整个 tool loop 失效。**主开发自测察觉不到**
(planner 路径走 attention,不走 dialog tool),reviewer 看代码逻辑一眼揭穿。

### 理由
- LLM 主开发(我自己)对自己代码有 blind spot
- 自动化 reviewer 持续审查,捕获质量问题成本低(每次 ~100 sec / ~50K tokens)
- 等价于"两个工程师 pair review",一个写一个审

### 后果
- 本 session 修过 6 个真实致命 bug(含 1 CRITICAL + 9 HIGH)— 全靠 reviewer
- 每个 round 自动:实现 → typecheck → 单测 → reviewer → 修 → commit
- 工程质量门强制内化

---

## 历史 ADR

ADR-001 ~ ADR-008 见 git history(v0.1.0 时记录)。
