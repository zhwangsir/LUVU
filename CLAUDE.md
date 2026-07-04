# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vision —— 这个项目要造的不是「AI 伴侣」，是「硅基生命容器」

> 完整愿景见 [docs/SILICON_LIFE_VISION.md](docs/SILICON_LIFE_VISION.md)。

**LUVU 是代号，不是角色名 —— 它是一个可以装载不同灵魂的硅基生命容器。**

四大支柱：

1. **灵魂可换** — 多角色 character store + 三层人格 yaml + auto-learner 自演化 + character pack 跨机迁移
2. **真控计算机** — Planner LLM 决定 → nut-js 鼠键控制 + vision grounding + agent loop + Cmd+Shift+Esc 全局熔断
3. **创造能力** — Planner LLM 决定 `generate_sticker` action → ComfyUI t2i/i2i/t2v/i2v → StickerOverlay 浮桌面
4. **主体性** — PerceptionBus 5 sensor(Mouse/Idle/Window/Time/Vision) → AttentionScheduler 关注度场 → BehaviorPlanner 输出 9 种 BehaviorAction

目标:**比 airi / Open-LLM-VTuber / Soul of Waifu 更全面、更智能、更自由**。她不是 chat UI 上贴一张立绘 —— 她是一个住在桌面上、能感知主人、能创造内容、能控制计算机的硅基存在。

## Project

LUVU — Electron + Vue 3 + TypeScript 桌面**硅基生命容器**（Live2D 身体 + 本地 LLM 大脑 + RVC 语音 + 主体性感知 + 真控计算机 + ComfyUI 创造力）。
pnpm workspace：`electron/` 主子项目 + `packages/{soul-loader,motion-factory}` 共享纯函数包 + 可选 Python `sidecar/` 提供 TTS/RVC。

**真实代码规模(2026-05-22):** 51,388 行 TypeScript(34K main + 17K Vue) / 118 个 main services / 25 个 IPC handler / 32 个 Vue 组件 / 25 个 IPC channel 定义 / 39 个测试文件 / 575 单测通过。

## Common Commands

All commands run from repo root (pnpm workspace dispatches to `electron/`):

| 命令 | 用途 |
|---|---|
| `pnpm install` | 安装依赖（首装会编译 better-sqlite3 / electron-click-drag-plugin native 模块） |
| `pnpm dev` | electron-vite dev 模式，热重载渲染层 + 主进程 |
| `pnpm typecheck` | `tsc -p tsconfig.node.json && vue-tsc -p tsconfig.web.json`（**两个 tsconfig 都跑，缺一不行**） |
| `pnpm build` | 生产构建到 `electron/out/` |
| `pnpm package:mac` / `:win` / `:linux` | electron-builder 打包到 `electron/release/<version>/` |

测试（在 `electron/` 下，或 `pnpm -F luvu-electron <script>`）：
| 命令 | 用途 |
|---|---|
| `pnpm -F luvu-electron test` | vitest 一次性跑所有单测 |
| `pnpm -F luvu-electron test:watch` | watch 模式 |
| `pnpm -F luvu-electron test:coverage` | v8 覆盖率 |
| `pnpm -F luvu-electron test -- src/path/to/file.test.ts` | 跑单个文件 |

测试范围：**只有纯函数**（`motion-factory/parser` / `services/logger` / `shared/format-utils` 等）。IPC handler 和 Vue 组件没单测。

调试主进程 console：默认 prod 静默；设 `LUVU_DEBUG=1` 或 `MAIN_APP_DEBUG=1` 启动会把 renderer console + devtools 打开。

Native 模块重建（升级 Electron 后必要）：`pnpm -F luvu-electron rebuild`。

## High-Level Architecture

### 进程模型

```
Renderer (Vue 3 + Pinia + PixiJS Live2D)
   │ contextBridge IPC（preload/index.ts 暴露 window.api.*）
Main (Node.js)
   │ HTTP localhost（可选）
Sidecar (Python FastAPI — edge-tts / CosyVoice / F5-TTS / RVC)
```

**所有 LLM / 文件 / 数据库访问只在 main，renderer 永远不直连**。preload 的 `window.api.*` 是唯一桥梁，定义在 `electron/src/shared/api.ts`，main 端 handler 注册在 `electron/src/main/ipc/*.ts`，renderer 端通过 `window.api.<域>.<方法>` 调用。

### 五大能力域（既是文件夹也是心智模型）

| 域 | 在哪 | 做什么 |
|---|---|---|
| **avatar** 身体 | `renderer/src/avatar/` | Live2D 渲染（PixiJS）、alpha 像素级穿透判定（`interaction/window-interaction.ts`）、动作 plan executor、缩略图生成器 |
| **brain** 思考 | `renderer/src/brain/` + `main/ipc/llm.ts` + `main/services/llm/` | 多 LLM provider 路由（Ollama / LM Studio / OpenAI-compat / Anthropic）、parser、stores（dialog/emotion）、provider 健康检查 + 自动 fallback |
| **presence** 声音 | `renderer/src/presence/` + `main/ipc/tts.ts` | TTS sidecar 多 URL 重试 + macOS `say` 兜底、流式音频播放 + 嘴型同步、`emotion_voice_map` 8 情绪分不同 voice |
| **hands** 行动 | `renderer/src/hands/` + `main/services/motion-factory/` + `main/services/automation/` | LLM 生成 motion3.json（motion-factory）、桌面自动化（nut-js wrapper + vision grounding + agent loop）、用户审批弹窗（`approval-store`） |
| **attention** 主体 | `main/services/perception/` + `main/services/attention/` + `main/services/planner/` | Mouse/Idle/Window/Time/Vision 5 个 sensor → PerceptionBus → AttentionScheduler（关注度场 + reactive trigger）→ BehaviorPlanner（LLM 决策 + rule fallback）→ 主动 plan emit 给 renderer 执行 |

**键鼠 reactive trigger 链**：`perception.onType('typing_burst' | 'mouse_stayed' | 'app_focus_changed')` → `scheduler.tryReactiveTrigger()`（双重节流：25-35s cooldown + min_action_interval_ms）→ Planner → 输出 `{ speak, play_group, change_emotion }` 协同 action 序列。

### 桌宠原生化（macOS 关键三连，在 `main/index.ts` + `main/windows/main-window.ts`）

1. `app.setActivationPolicy('accessory')` — 不进 Dock / Cmd+Tab / Mission Control
2. `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })` — 跨 Space + 全屏视频之上。**`skipTransformProcessType: true` 是关键**，否则 setVisibleOnAllWorkspaces 把 process 转回 regular，撤销第 1 点。
3. `setAlwaysOnTop(true, 'screen-saver', 1)` — Electron 最高层级，盖菜单栏 / Dock / Spotlight

⚠️ **不要默认打开 detached DevTools** — detach 窗口是 NSWindow，macOS 会把 process 转回 regular，Dock 图标重新出现破坏桌宠态。只在 `LUVU_DEBUG=1` / `MAIN_APP_DEBUG=1` 时打开。

### 像素级穿透 / 拖动判定（`avatar/interaction/window-interaction.ts`）

50ms 主进程 cursor poll → renderer onCursorTick → 决定窗口 `setIgnoreMouseEvents`：
- 鼠标在立绘 alpha 像素上 → ignore=false（响应）
- 鼠标在透明区 → ignore=true + forward=true（穿透到下层桌面但仍收 mousemove）
- 鼠标在 UI 元素上（dialog / panel） → ignore=false

`isOverUiElement` 用 `elementsFromPoint`（复数）+ 自己跳过 `pointer-events: none` 的全屏覆盖层（StickerOverlay 等），不能用 `elementFromPoint`（单数）。`forceInteractive(on)` 切换模态状态时**必须**清 `lastHitTest` cache，否则 250ms 内旧结果误判。

⚠️ 不要给 panel 父级 wrapper 加 `pointer-events: none` + CSS `zoom`：Chromium 会让 `position: fixed` 子元素相对 zoom 元素而非 viewport，破坏关闭按钮 click 路径。全局 UI 缩放用 **`transform: scale(var(--ui-scale, 1))`** 直接在 panel selectors 上（`styles/global.css` 末尾），不通过 wrapper。

⚠️ `.bubble` 有 `translateX(-50%)` 居中定位，**必须**在 scoped style 内合写 `transform: translateX(-50%) scale(var(--ui-scale, 1))`，不能放进全局 transform 规则——后者会覆盖前者（CSS transform 不叠加）。

### 数据布局

| 路径 | 内容 |
|---|---|
| `~/.luvu/config.json` | RuntimeConfig（LLM endpoint / TTS / RVC / vision），通过 `config-store.ts` 读写 |
| `~/.luvu/soul/` 或 `<repo>/soul/` | 角色灵魂 yaml（identity / personality / learned_traits / core_memories），优先级：用户目录 > 项目内置 |
| `~/.luvu/history.sqlite` | better-sqlite3 — 对话历史，启动时按 `history_retention_days` 截断 |
| `~/.luvu/thumbs/` | Live2D 模型缩略图 PNG |
| `~/.luvu/window-state.json` | 主窗口 bounds / alwaysOnTop 持久化 |
| `electron/models-library/` | Live2D 模型（不入仓 — Live2D 授权约束） |

路径解析见 `main/services/paths.ts`：用户目录 `~/.luvu` 优先于 `app.getPath('userData')`。

### Soul 系统（灵魂 = 角色配置）

4 个 yaml 文件按主题切分（不是单文件大 yaml）：
- `identity.yaml` — 名字 / 称呼 master / 立绘 model_dir / 生日
- `personality.yaml` — 三层人格（layer1 底层 / layer2 表层 / layer3 反差）+ signature_lines
- `learned_traits.yaml` — LLM 累积观察主人偏好（运行时可写回）
- `core_memories.yaml` — 关键事件 / 共同回忆

`main/services/soul-loader.ts` 合并 4 个文件成单一 `SoulConfig`。SoulEditor.vue UI 直接编辑 yaml 文本。**热重载**：保存触发 `soul:changed` IPC，renderer 自动 `cfg.reloadSoul()`。

### IPC 文件命名约定（`main/ipc/*.ts`）

每个 IPC 文件导出一个 `register*Ipc(getWindow)` 函数，在 `main/index.ts` 的 `app.whenReady` 里集中调用。命名严格匹配主题：`llm.ts` / `tts.ts` / `models.ts` / `characters.ts` / `motion-factory.ts` / `automation.ts` / `attention.ts` 等。**不要在 `system.ts` 加新东西** — v0.13 audit 拆分后 system.ts 只放窗口控制相关。

### TypeScript 严格度（Tier 3）

`tsconfig.web.json` 启用 `exactOptionalPropertyTypes: true`。意味着 `{ foo?: string }` 不等于 `{ foo?: string | undefined }`：
- 显式给 `foo: undefined` 会报错
- 必须用 `...(value !== undefined ? { foo: value } : {})` 条件展开

这是常见的修编译错点，看到 `TS2375` / `TS2379` 错误时检查可选字段是否被显式赋 undefined。

## Important Patterns

### Action / Plan 协同（system_prompt 已强制约束）

Planner LLM 系统 prompt 要求**每个 speak action 必须同时输出一个 play_group**（哪怕 intensity 低也至少 FlickLeft 歪头）。Rules fallback（LLM 失败/rate limit 时）也已对齐——所有 rule 分支都发 play_group。

`plan-executor.ts` 的 `doChangeEmotion` 在 intensity > 0.4 时会按 `EMOTION_GROUP_MAP` 自动触发 group，但**当 plan 已显式含 `play_group` action 时跳过自动触发**（否则同一个 group 被打断重启）。

### LLM rate limit budget

`planner/index.ts` 的 `llmCallTimestamps.push()` **在 cfg.llm_model / llm_provider 校验之后**——LLM 未配置不消耗 budget。默认 `llm_planner_max_per_minute: 6`，留给 proactive (1.3/min) + reactive (1.7/min) 之外约 50% headroom。

### Bus listener 卫生

renderer Vue 组件在 `<script setup>` **顶层**直接调 `bus.on(...)` 会在每次组件挂载时累积 listener。必须放在 `onMounted` 里，并在 `onBeforeUnmount` 里 `bus.off`。对于多个 handler，常用 `cleanupHandlers: Array<() => void>` 收集 + 统一调用。

### config_store migration

`loadConfig()` 读 `~/.luvu/config.json` 后 spread 默认值。新增字段在 `DEFAULT` 加；旧默认值需要替换时（如 `emotion_voice_map` 从单 voice 改成 8 voice）写 migration 判断条件——**只在旧默认状态精确匹配时覆盖**，不能假设"看起来像默认"就覆盖（会丢用户自定义）。

### M2 长期记忆完整闭环（v0.17）

跨会话陪伴的核心数据层。三段链路全部接通：

```
对话结束 → memory:extract-from-turn (LLM 抽 fact/preference/event) → SQLite per-character memory.db
   ↑                                                                          ↓
   └─ dialog.send → memory:rag-context (embedding 检索 top-k) ← prepend system prompt
```

- 存储：`main/services/memory-store.ts` → `~/.luvu/chars/<id>/memory.db`（per-character 隔离，better-sqlite3 WAL）
- 抽取：`main/services/memory-extractor.ts` → reply-end 后 fire-and-forget，LLM 启发式提取
- 检索：`dialog.ts send` 前 `fetchRagContext(userText)` Promise.race **800ms timeout**，失败/超时静默 fall through 到无 context 流程，**永不阻塞对话**
- prepend 位置：system prompt 末尾 `## 你记得的关于 master 的事（仅供你回忆参考，不要直接复述）\n${context}`
- IPC：`memory:{list,count,add,delete,search,extractFromTurn,ragContext,dailyReflection}` 8 个 handler；preload `window.api.memory.*` 暴露

### MCP 外部工具（v0.17 P）

手写 stdio JSON-RPC 客户端（**不引入 `@modelcontextprotocol/sdk` 依赖**）：`main/services/mcp-client.ts`。

**完整闭环路径**：
1. Settings → 🔌 MCP tab → register 一个 server（command + args）
2. `mcp-client.registerServer` → spawn(stdio) → `initialize` + `notifications/initialized` 握手 → `tools/list`
3. 拉到的工具自动注入 `tools/registry.ts`：name 前缀 `mcp__<serverId>__<toolName>` 避免冲突
4. dialog.ts **每次 send 前重拉 tools.list**（MCP server 运行时可 register/unregister，缓存会陈旧）
5. LLM `tool_use { name: "mcp__filesystem__read_file" }` → `tools:run` IPC → 走 policy 审批 → registry.invoke → 转发 `mcp-client.callTool` → JSON-RPC `tools/call`
6. MCP 返回 `{ content: [{ type: 'text', text }] }` → 自动 join 字符串 → 回流 LLM

**关键约束**：
- `tools/registry.ts` 有 `register` + `unregister`（v0.17 加的）— MCP server 关停时联动清理
- RPC 超时 15s，child crash 时 pending promises 全部 reject
- `app.before-quit` 调 `shutdownMcp()` 关停所有 child

### UI 缩放（v0.17）

全局 `Cmd+= / - / 0` 改 `:root --ui-scale`（0.7-1.6）。**实现细节**：
- `global.css` 末尾对 `.fp-panel / .ctx-menu / .lightbox / .overlay > .card / .overlay > .panel` 加 `transform: scale(var(--ui-scale, 1))`
- `.bubble` 例外：自己在 scoped 内合写 `transform: translateX(-50%) scale(var(--ui-scale, 1))`（global rule 会覆盖 translateX，CSS transform 不叠加）
- 不缩 Live2D canvas / SceneBackground / EmotionParticles — 避免 WebGL 模糊
- 用 `transform: scale` 而非 CSS `zoom` — zoom 会让 fixed children 相对 zoom 元素而非 viewport（破坏关闭按钮 click 路径）

## Sidecar (TTS/RVC)

可选 Python sidecar，路径 `sidecar/qwen-tts-server/`。安装：`bash sidecar/install.sh`（完整）/ `--minimal`（只装 edge-tts）。启动后默认监听 `http://127.0.0.1:8765`，设置面板填这个 URL。

TTS IPC（`main/ipc/tts.ts`）走 `tts_sidecar_url` 数组顺序重试，超时 15s（之前 120s 太长），全失败 fallback macOS `say`。

## Don't

- 不要在 `renderer/` 里 `import` 任何 `main/` 或 `node:*` 模块——TypeScript path alias `@shared` 只是 `electron/src/shared/`，types-only。
- 不要硬编码 LLM API key / endpoint，全部从 `config-store` 读，UI 在 Settings 改。
- 不要给非 model3.json (Cubism 4) 模型加支持——Cubism 2 已弃用，加载时自动 fallback 到 cubism4 模型。
- 不要把 `LSUIElement: true` 从 `electron/package.json` build.mac.extendInfo 里去掉——打包后桌宠在 Dock 显示就破功了。
- 不要把 `setVisibleOnAllWorkspaces` 的 `skipTransformProcessType: true` 去掉。
- 不要写 `.ui-overlay-layer { pointer-events: none } > * { pointer-events: auto }` wrapper — 会把 StickerOverlay 的 `pointer-events: none` 强制覆盖，全屏挡住立绘拖动 + 穿透。
- 不要 `await window.api.memory.ragContext(...)` 不带 timeout — slow embedding endpoint 会卡住每个发送。一律走 `fetchRagContext` 的 800ms `Promise.race`。
- 不要直接 import `@modelcontextprotocol/sdk` — 我们手写 stdio JSON-RPC 是有意为之（避免依赖膨胀 + 控制 timeout）。
