# LUVU 架构

> 版本:**v0.21**(硅基生命容器 + M7 创造统一 100%)
> 最后更新:2026-05-22
> 顶层愿景见 [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md)。

## 0. 项目本质

LUVU 是一个**可以装载不同灵魂的硅基生命容器**:

- **身体**：Live2D 形象 + 透明置顶窗口 + 像素级穿透
- **大脑**：本地/云端 LLM + SQLite 短期记忆 + 三层人格 prompt
- **手脚**：动作工坊 (motion factory) + plan executor + 桌面自动化基建
- **声音**：RVC 47 voice + Edge-TTS / CosyVoice / F5-TTS sidecar + 流式 + 嘴型同步
- **主体**：PerceptionBus + Attention Scheduler + Planner LLM + proactive 触发

**核心区别于普通桌宠**：她不只是看着，**她能做事 + 会主动 + 能创造**。
**核心区别于普通 AI 助手**：她不只在对话框里，**她在你桌面上 + 持续感知 + 真控计算机**。
**核心区别于市面 AI VTuber(airi / OLV / SoW)**:她有完整的**四大支柱**(灵魂可换 / 真控计算机 / 创造能力 / 主体性),不只是 talking head + Live2D 壳。

## 1. 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  services/ — LLM provider / motion factory / attention │  │
│  │  scheduler / planner / perception bus / model scanner  │  │
│  │  / soul loader / online store / sqlite history / disk  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ipc/ — 9 个 IPC 文件，按主题划分（v0.13 拆分后）       │  │
│  │  system / tts / thumbs / models / online / llm /       │  │
│  │  motion-factory / motion-engine / trigger / tools /    │  │
│  │  perception / market / window-control                  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  windows/ — 透明立绘 BrowserWindow + NSPanel + 拖动    │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ contextBridge IPC (deepPlain wrapper)
┌────────────────────────┴─────────────────────────────────────┐
│  Electron Renderer (Vue 3 + Pinia + PixiJS Live2D)           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  五大能力域 + infra 横切（见 §2）                       │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP localhost
┌────────────────────────┴─────────────────────────────────────┐
│  Python Sidecar (FastAPI)                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  edge-tts / CosyVoice / F5-TTS / RVC 47 voice          │  │
│  │  /v1/audio/speech (含 RVC 转换) + /v1/rvc/voices       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 2. 五大能力域 (renderer)

所有 renderer 代码归属其一。**域间通过 infra/eventbus 通信，禁止跨域直接 import store。**
纯 util 函数（如 `brain/parser.ts`）跨域使用合理（v0.13 决策）。

| 域 | 路径 | 职责 |
|----|------|------|
| **avatar** 身体 | `renderer/src/avatar/` | Live2D 渲染 / 像素穿透 / 拖动 / motion player / alpha-hit / 1389 模型库扫描 |
| **brain** 思考 | `renderer/src/brain/` | dialog store / 灵魂 system prompt 合成 / parser（流式 token 增量解析） |
| **presence** 声音 | `renderer/src/presence/` | speech store / TTS 调用 / 嘴型同步 / 双队列流式音频 |
| **hands** 行动 | `renderer/src/hands/` | approval store / plan executor 触发 / 桌面动作 |
| **attention** 主体 | `main/services/attention/` (主进程) | scheduler 5s tick / planner LLM / perception bus / sensors |

横切：
- **infra** `renderer/src/infra/` — UI 组件 / Pinia stores / eventbus / 设置面板 / 资源商店 / 引导对话框

## 3. IPC 设计

`shared/api.ts` 是 single source of truth：

```ts
interface LuvuApi {
  system: { ... }      // version / paths / disk usage / config
  window: { ... }      // 拖动 / 穿透 / 置顶
  cursor: { ... }      // 50ms tick 鼠标位置
  config: { ... }      // 读写 RuntimeConfig
  models: { ... }      // scan / heal / dedup / describe / favorites / enrich
  soul: { ... }        // load / system prompt / saveAvatar
  llm: { ... }         // chat / stream / test / healthCheck
  tts: { ... }         // speak / probe / listRvcVoices
  history: { ... }     // append / listRecent / clear
  thumbs: { ... }      // get / getBatch / save / markFailed / listMissing
  market: { ... }      // installPaths / installFromUrl / installFromZip
  motionFactory: { ... } // generate motion3.json via LLM
  motionEngine: { ... }  // play / sync / library
  trigger: { ... }       // rules
  perception: { ... }    // history / triggerSnapshot
  online: { ... }        // listRepoAssets / install / cancelInstall
  attention: { ... }     // onPlan
  tools: { ... }         // builtin + MCP tool registry,跨 provider tool_use
  // v0.21 新增:
  comfyui: { ... }       // status / list / upload / gen-image / gen-i2i / gen-t2v / gen-i2v / gen-sticker / list-recent / cancel
  memory: { ... }        // M3 per-character SQLite + embedding RAG(8 handler)
  characters: { ... }    // 多角色 CRUD + character pack export/import + memory.db opt-in
  emotional: { ... }     // primary + secondary mood / topic imprints / cross-character
  characterPack: { ... } // zip export/import 跨机器迁移
  evalRunner: { ... }    // 50 题 character-eval(本 session 真跑了 94 分灵魂回复)
  mcp: { ... }           // 手写 stdio JSON-RPC client / register/unregister 动态注入 tools
}
```

**完整 25 个 IPC channel 定义在 `electron/src/shared/channels/`** — 是 single source of truth,
preload 桥按 channel 名自动 wire 双向类型。

preload 用 `ReturnType<LuvuApi[ns][method]>` 自动同步类型，preload 实现与契约不会漂移。

跨进程克隆走 `deepPlain()` 三级 fallback：`structuredClone → JSON round-trip → manualClone`，专门解决 Vue Proxy → V8 结构化克隆失败问题。

## 4. 主体性 AI 循环 (v0.8+,v0.21 完整 9 BehaviorAction)

```
PerceptionBus (main process)
  ↓ (Mouse / Idle / Window / Time / Vision sensors)
Attention Scheduler (10s tick + 双路触发:proactive 每 45s / reactive typing_burst+app_focus_changed 等)
  ↓ (检查触发条件 + min_action_interval + cooldown + LLM rate limit 6/min)
  ↓ v0.21:agent_task 跑时 scheduler.pause() 静默 nut-js 期间(pauseDepth 引用计数)
Planner (LLM 调用,实例 field llmCallTimestamps 为 M8 多灵魂准备)
  ↓ (输入感知摘要 + soul prompt + 9 种 BehaviorAction 选项,输出 BehaviorPlan)
  ↓ LLM 失败时 rule fallback(配 fallback,日志可观察)
IPC `attention:plan` → renderer
  ↓
Plan Executor (avatar/plan-executor.ts)
  ↓ 依次执行 9 种 BehaviorAction:
  ↓   - speak / play_motion / play_group / change_emotion / idle_subtle
  ↓   - glance_at_screen / look_back_to_master
  ↓   - generate_sticker  ⭐ 真调 ComfyUI → StickerOverlay 浮窗 → 写 memory.db
  ↓   - agent_task        ⭐ 真调 nut-js + vision grounding(scheduler 自动 pause)
```

v0.21 关键升级:`generate_sticker` 不再只是 Planner 主动路径,**dialog LLM 也能在
对话里 tool_use 调用 `creative_generate_sticker`**(跨 anthropic + openai_compat)
→ 真融合"对话/创造"双路径。

设计文档：[docs/SOUL_SCHEMA.md](SOUL_SCHEMA.md) | [docs/ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md)

### 4.1 ComfyUI 创造能力路径(v0.21)

```
触发源:dialog LLM 对话决策 / Planner attention 决策 / 用户 CreatorStudioPanel
  ↓
tools/builtin.ts creative_generate_sticker(emotion, extra_prompt?)
  ↓
getSharedComfyClient()  (services/comfyui/client.ts 共享单例,endpoint 改变 abortAll 旧请求)
  ↓
buildStickerWorkflow → ComfyClient.generate
  ↓ submit /prompt → 轮询 /history(AbortSignal.any race timeout vs instance abort)
  ↓ → state=queued → running → done
downloadImage → ~/.luvu/stickers/sticker_<emotion>_<ts>.png
  ↓
emit comfyui:progress {state:'done'} → StickerOverlay 浮窗
  ↓
addMemoryForActive(text, embedding: fallbackEmbedding(text))  → per-character memory.db
  ↓ kind: 'event' / importance: 0.6 / source: 'creative_generate_sticker'
  ↓ 下次 RAG 检索能召回"我画过 happy 贴纸送主人"
```

### 4.2 dialog tool_use 跨 provider(v0.21 Round B)

```
dialog.ts 把 tools 列表对 anthropic + openai_compat **都暴露**(之前只 anthropic)
  ↓
LLM stream emit tool_use(anthropic content_block_start) 或
  tool_calls(openai-compat partial JSON 累积,跨多 chunk arguments)
  ↓
loopUntilDone toolsCapable=true(双 provider 都通)
  ↓
tools/registry invoke(policy 审批 — 旧 name 自动 migration:fs.list_dir → fs_list_dir)
  ↓
LLM 续轮拿 tool result(openai 用 role:'tool' + tool_call_id,需先 push assistant tool_calls 消息)
```

<!-- TODO v0.22 升级路径:
  当前 ChatMessage 类型不保留 tool_calls 字段,所以 openai-compat.ts 用占位
  `assistant {tool_calls: [{id, function:{name:'unknown', arguments:'{}'}}]}` 让大多数
  OAI-compat server(LM Studio / vLLM)能接受。真 OpenAI API 严格校验会拒绝。
  v0.22 真根治需要:
    1) ChatMessage 类型扩展 `tool_calls?: ToolCall[]` 字段
    2) dialog.ts 保留完整 tool_use → tool_result 串
    3) openai-compat.ts 用真 tool_calls 串替占位
  影响 ~200 行,本 v0.21 用占位是 Karpathy Rule 2(最少代码)的权衡。
-->


### 4.3 M8 灵魂社会:跨灵魂事件 memory 闭环(v0.21 Round N-U)

「mounted character = 代码层并行存活的灵魂(每个独立 planner / memory.db)」。
当 active speak 时,所有其他 mounted character 都能"作为旁观者"听到这句话,
作为 event memory 写进她们自己的 db。下次切到该灵魂为 active 时,她的 planner
在 LLM prompt 里就会带上"我作为旁观者听到的"片段当 context。

```mermaid
sequenceDiagram
  participant Sched as AttentionScheduler
  participant AttIdx as attention/index.ts
  participant PlanA as Planner(A)
  participant MemB as memory.db(B)
  participant MemA as memory.db(A)
  participant PlanB as Planner(B)
  participant LLM as LLM

  Note over Sched: 假定 A 是 active,A+B 都 mounted

  Sched->>AttIdx: onTrigger(decision)
  AttIdx->>PlanA: getPlanner(A.id).plan(decision)
  PlanA->>MemA: listMemoriesBySource(A,'cross_character:',3)
  MemA-->>PlanA: [] (A 没有听过别人说话)
  PlanA->>LLM: chatStream(prompt 无 cross-char section)
  LLM-->>PlanA: BehaviorPlan { speak: "..." }
  AttIdx->>AttIdx: send 'attention:plan' to renderer
  Note over AttIdx: ⭐ Round N: 把 A 说的话 fanout 给其他 mounted
  AttIdx->>MemB: addMemory(B, kind='event', source='cross_character:A.id')
  MemB-->>AttIdx: { id, text:"A 对 master 说: ..." }

  Note over Sched: 用户切 active → B(via charactersSwitch IPC)

  Sched->>AttIdx: onTrigger(decision)
  AttIdx->>PlanB: getPlanner(B.id).plan(decision)
  Note over PlanB: ⭐ Round P: 读自己 db 里别人说过的话
  PlanB->>MemB: listMemoriesBySource(B,'cross_character:',3)
  MemB-->>PlanB: [event{ text:"A 对 master 说: ..." }]
  PlanB->>LLM: chatStream(prompt 加 cross-char section)
  LLM-->>PlanB: BehaviorPlan { speak: "我刚才听到 A 跟你说..." }
```

**单方向 passive listening** — 不触发 other planner 自己 LLM call,避免:
- Ping-pong:A speak → B react → A react → ... 雪崩
- LLM 流量爆:N-way mounted 一次 trigger N 次 LLM call
- Rate limit 互相干扰

**embedding=[] 取舍**:Round N 写入时 embedding 为空数组(待 Round 后续 sidecar
接通),所以 `searchMemories` cosine 检索拿不到这些 event。Round P 走的是
`listMemoriesBySource(prefix, kind, limit)` SQL 直接 ts desc 排序,不依赖 embedding。

**入口 IPC(Round U,供未来 inspector UI)**:`memory:list-cross-character`
({ characterId, limit }) → Memory[]。校验 character 存在 + limit 上限 100。

## 5. 设计原则（不可破坏）

1. **域间通过 bus 通信** — 不直接 import 跨域 store（v0.13 plan-executor → brain:inject-utterance 案例）
2. **IPC 契约单一来源** — `shared/api.ts` 定义，preload 自动同步
3. **TS Tier 3 严格** — 0 any / 0 @ts-ignore / noUncheckedIndexedAccess / exactOptional / noImplicitReturns / noImplicitOverride
4. **配置默认空** — LLM endpoint / TTS sidecar URL 默认空，引导用户首次配置
5. **错误显式 throw 或 {ok, reason}** — IPC handler 统一返回 `{ok: boolean, ...}`，main 抛错走 IPC reject
6. **本地优先** — 用户数据在 `~/.luvu/`，模型库在 `electron/models-library/`，无遥测无上报
7. **(v0.21) 单例 + AbortController** — ComfyClient / planner 等长生命周期资源用模块单例 + `abortAll()` 切换时取消 in-flight 请求
8. **(v0.21) 引用计数 pause** — scheduler / 类似可重入暂停的服务用 `pauseDepth: number`,嵌套调用安全(外层 pause 不被内层 resume 提前清)
9. **(v0.21) Subagent 守护** — 每个里程碑/功能 commit 前后启动 typescript-reviewer + architect agent 审查;CRITICAL/HIGH 修完再继续

## 6. 数据流：一次对话

```
User types "你好" in InputBar
  ↓ bus.emit('brain:chat-input', {text})
brain/stores/dialog.send(text)
  ↓ window.api.llm.chat({...})         // IPC: llm:chat
main/ipc/llm.ts → main/services/llm/<provider>
  ↓ HTTP POST → LLM endpoint (Ollama/LM Studio/Anthropic)
  ↓ SSE stream
main → renderer: 'llm:chunk' event per token
  ↓ bus.emit('brain:reply-token', {delta})
  ↓ DialogBubble UI 实时打字机
  ↓ ... done
bus.emit('brain:reply-end', {full_text, emotion, intensity})
  ↓ presence/speech 监听 → window.api.tts.speak(...)
  ↓ main/ipc/tts.ts → sidecar /v1/audio/speech (含 RVC)
  ↓ 返 audio_b64
renderer 解码 → Web Audio API 播 + AudioContext analyser
  ↓ analyser.getByteFrequencyData 算 RMS
  ↓ bus.emit('presence:lipsync', {rms})
avatar/render/live2d-renderer 接收 RMS → 驱动 ParamMouthOpenY
  ↓ Live2D 嘴型动起来
```

## 7. 配置 + 数据布局

```
~/.luvu/                              # 用户数据根
├── config.json                          # RuntimeConfig (LLM/TTS/RVC/idle 等)
├── history.sqlite                       # 对话历史 (better-sqlite3, WAL mode)
├── soul/                                # 灵魂档案 (multi-file YAML)
│   ├── identity.yaml
│   ├── personality.yaml
│   └── learned_traits.yaml
├── model-scan-cache.json                # v0.13: 模型扫描 mtime 缓存
├── model-favorites.json                 # 收藏 + 最近使用
├── model-preferences.json               # 每模型 scale / offset_y
├── character-enriched.json              # LLM 角色中文名+简介缓存
├── model-descriptions.json              # AI 生成的模型描述
├── thumbs/                              # Live2D 缩略图 (~10 MB)
│   └── char:<sha1>.webp
├── logs/                                # v0.13: electron-log 写文件
│   └── main.log                         # 10 MB 轮转 + 敏感字段 redact
├── voice_clones/                        # 用户上传的 RVC 训练样本
├── cosyvoice-repo/ (6.8 MB)             # CosyVoice 仓库副本
├── rvc-venv/ (22 MB)                    # Python venv
├── models-tts/ (4-6 GB)                 # TTS 模型 (CosyVoice / F5-TTS / RVC)
└── window-state.json                    # 窗口位置 / always-on-top

electron/models-library/ (5-17 GB)       # Live2D 模型（1389 满载）
docs/rfcs/                               # 重大架构 RFC (TS Tier 3 等)
```

## 8. 安全模型 (v0.13 audit)

- **contextIsolation: true** + **nodeIntegration: false** — renderer 不能直接调 Node API
- **webSecurity: false** — Live2D 跨目录加载需要（known debt，未来用 protocol.handle 替代）
  - **mitigation**：CSP header + setWindowOpenHandler + will-navigate 三道防线
- **sandbox: false** — preload 需要 Node API
- **IPC 输入验证** — 所有用户输入路径过 path.resolve + 白名单（disk-usage / online-store）
- **YAML 解析** — `yaml.JSON_SCHEMA` 防 `!!js/*` 标签注入（soul / motion templates / trigger rules）
- **命令执行** — `execFile(cmd, [args])` 数组形式防 shell 注入（osascript / scp / ssh）
- **日志 redact** — `~/.luvu/logs/main.log` 自动脱敏 6 类敏感字段（api_key / Bearer / sk- 等）
- **single-instance lock** — 防双启冲突

## 9. 测试 (v0.21+ Round U:46 测试文件 / 628 用例 / 7 skip-smoke)

```bash
pnpm test          # vitest run — 628 passed / 7 skipped(smoke)
pnpm test:watch    # vitest 监听模式
pnpm test:coverage # v8 覆盖率报告
SMOKE_TEST=1 pnpm test --run m7-e2e         # 真出图 e2e(读真 ComfyUI)
SMOKE_TEST=1 pnpm test --run m8-closed-loop # 真 better-sqlite3 跑 N→P 闭环 fixture
```

**v0.21+ 后续 Round 增量**:
- `m7-e2e.smoke.test.ts` ⭐ — 真调 ComfyUI 出 PNG + 校验 magic header + 写真盘
- `builtin-creative.test.ts` — creative_generate_sticker tool 单测
- `openai-compat-tools.test.ts` — tool_calls 流式累积 + invalid JSON 降级
- `character-eval/runner.smoke.test.ts` — 真跑 LLM 拿 character-eval 94 分回复
- `character-pack.test.ts` — zip export/import 跨机器迁移 + memory.db opt-in
- **Round N**:`attention/index.test.ts` — 11 case 验证 notifyOtherMountedCharacters 写入路径(mock memory-store)
- **Round P**:`planner/cross-character-context.test.ts` — 7 case 验证 prompt section 拼接(mock listMemoriesBySource)
- **Round P**:`planner/factory.test.ts` +4 case — characterId 字段
- **Round T**:`m8-closed-loop.smoke.test.ts` ⭐ — 3 case 真 SQLite N→P→S 端到端(需 SMOKE_TEST=1)

完整列表 46 个 test file,覆盖五大域纯函数 + 跨进程 IPC 边界 + 灵魂演化 + ComfyUI 工具链 + M8 灵魂社会闭环。

## 10. 技术栈

- **运行时**：Electron 33 / Node 20+ / Vue 3.5 / TypeScript 5.7 (Tier 3 strict)
- **打包**：electron-vite 2.3 + electron-builder 25(v0.21 已真出 113MB+117MB DMG)
- **UI**：Vue 3 setup script + Pinia 2 + mitt eventbus + OKLCH design tokens
- **Live2D**：pixi-live2d-display 0.4 + PIXI.js 6.5 + Cubism Core(Cubism 4 only,Cubism 2 已弃用)
- **存储**：better-sqlite3 12 (WAL mode) + js-yaml 4 (JSON_SCHEMA)
- **LLM provider**:Anthropic SDK + OpenAI-compat fetch streaming(含 tool_calls 流式累积)+ Ollama native
- **创造能力**:ComfyUI HTTP 客户端(`getSharedComfyClient` 共享单例 + AbortSignal.any race)
- **MCP**:手写 stdio JSON-RPC client(不引官方 SDK,15s timeout + 进程清理)
- **RPA**:`@nut-tree-fork/nut-js` 鼠键控制 + vision grounding(主截屏 → vision LLM 定位 → 点击)
- **TTS sidecar**：Python 3.10+ + FastAPI + edge-tts / CosyVoice / F5-TTS / RVC
- **测试**：vitest 2.1 + @vitest/coverage-v8(42 file / 590 case / 4 smoke)
- **日志**：electron-log 5 (file + console + redact hooks)

---

## 历史背景

v0.1-v0.4 是 Tauri + Rust 时代，v0.6 转 Electron 吸收 [airi](https://github.com/moeru-ai/airi)
的成熟做法，五大能力域结构延续至今。
转 Electron 后的关键决策见 [docs/AIRI_STUDY.md](AIRI_STUDY.md)。
TS Tier 3 严格化 RFC 见 [docs/rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md)。
