# LUVU — AI 编码智能体项目指南

> 本文档面向 AI 编码智能体。如果你是人类开发者，请优先阅读 `README.md` 和 `CLAUDE.md`。

---

## 1. 项目概述

**LUVU** 是一款常驻 macOS / Windows / Linux 桌面的离线 AI 伴侣应用。她以 Live2D 立绘为身体载体，承载用户定义的灵魂档案（性格、语气、记忆），通过本地 LLM 实现自然对话，并具备情绪系统、长期记忆、主体性感知、桌面动作等能力。

- **版本**: v0.16.0
- **许可证**: MIT（代码）+ Live2D Proprietary License（Cubism Core 运行时）
- **仓库**: https://github.com/zhwangsir/LUVU

### 1.1 进程模型

```
┌──────────────── Renderer (Vue 3 + Pinia + PixiJS Live2D) ────────────┐
│  avatar / brain / hands / presence / attention 五大域 + infra UI     │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │ Electron contextBridge IPC
┌────────────────────────────────┴──────────────────────────────────────┐
│  Main Process (Node.js) — LLM 路由 / 文件系统 / SQLite / 主体性循环   │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │ HTTP localhost
┌────────────────────────────────┴──────────────────────────────────────┐
│  Sidecar (Python FastAPI) — edge-tts / CosyVoice / F5-TTS / RVC      │
└──────────────────────────────────────────────────────────────────────┘
```

**关键原则**: renderer 永远不直接访问文件系统、数据库或 LLM endpoint。所有敏感操作通过 `window.api.*` → preload → main IPC 完成。

---

## 2. 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Electron | 33 |
| 运行时 | Node.js | ≥ 20 |
| 前端框架 | Vue | 3.5 |
| 语言 | TypeScript | 5.7 (Tier 3 strict) |
| 状态管理 | Pinia | 2 |
| 事件总线 | mitt | 3 |
| Live2D 渲染 | pixi-live2d-display + pixi.js | 0.4 + 6.5 |
| 构建工具 | electron-vite | 2.3 |
| 打包工具 | electron-builder | 25 |
| 存储 | better-sqlite3 | 12 (WAL mode) |
| YAML 解析 | js-yaml | 4 (JSON_SCHEMA) |
| 测试 | vitest | 2.1 |
| 覆盖率 | @vitest/coverage-v8 | — |
| 日志 | electron-log | 5 |
| 包管理器 | pnpm | ≥ 9 |
| 工作区 | pnpm workspace | — |

---

## 3. 项目结构

```
LUVU/
├── package.json                    # workspace root（scripts 分发到 electron/）
├── pnpm-workspace.yaml             # 包含 electron/ + packages/*
├── tsconfig.json                   # root composite tsconfig
├── default.yaml                    # 内置默认灵魂档案（角色配置）
├── soul/                           # 内置灵魂文件（identity / personality / core_memories / learned_traits）
│
├── electron/                       # 主应用包（luvu-electron）
│   ├── package.json                # 依赖 + electron-builder 配置
│   ├── electron.vite.config.ts     # 三端构建配置（main / preload / renderer）
│   ├── vitest.config.ts            # 单测配置
│   ├── tsconfig.json               # composite，引用 node + web
│   ├── tsconfig.node.json          # main + preload + shared 的 TS 配置
│   ├── tsconfig.web.json           # renderer 的 TS 配置
│   ├── src/
│   │   ├── main/                   # 主进程（Node.js）
│   │   │   ├── index.ts            # 入口：注册 IPC + 启动感知/调度/托盘
│   │   │   ├── ipc/                # IPC handler 注册文件（按主题拆分）
│   │   │   ├── services/           # 业务服务（LLM / TTS / 扫描 / 主体性 / 记忆 / 自动化等）
│   │   │   └── windows/            # BrowserWindow 创建逻辑
│   │   ├── preload/                # preload 脚本（暴露 window.api）
│   │   ├── renderer/               # 渲染进程（Vue 3）
│   │   │   ├── index.html
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   └── src/
│   │   │       ├── avatar/         # Live2D 渲染 / 穿透判定 / 动作执行
│   │   │       ├── brain/          # 对话 store / prompt 合成 / parser
│   │   │       ├── hands/          # 审批 store / plan executor 触发
│   │   │       ├── presence/       # 语音 store / TTS 调用 / 嘴型同步
│   │   │       ├── infra/          # UI 组件 / eventbus / 设置面板 / 资源商店
│   │   │       └── styles/         # 全局 CSS（OKLCH design tokens）
│   │   └── shared/                 # 主/渲共享代码（types / api / channels / motion 类型）
│   ├── build/                      # 打包资源（icon.icns / icon.png）
│   ├── resources/                  # 额外打包文件（live2dcubismcore.min.js）
│   └── models-library/             # Live2D 模型库（不入仓，5-17 GB）
│
├── packages/
│   ├── soul-loader/                # @luvu/soul-loader — 灵魂合并 + system prompt 构建
│   └── motion-factory/             # @luvu/motion-factory — motion3.json 编码/验证/评分
│
├── sidecar/
│   ├── install.sh                  # TTS sidecar 一键安装脚本
│   └── qwen-tts-server/            # Python FastAPI（edge-tts / CosyVoice / F5-TTS / RVC）
│
├── scripts/                        # 辅助脚本（模型库存 / 安装 / 自检 / push）
└── docs/                           # 设计文档（PRD / 架构 / RFC / 发布说明）
```

### 3.1 五大能力域

代码按域组织，**域间通过 eventbus（renderer）或 IPC（main ↔ renderer）通信，禁止直接 import 跨域 store**。

| 域 | renderer 路径 | main 路径 | 职责 |
|----|--------------|-----------|------|
| **avatar** 身体 | `renderer/src/avatar/` | — | Live2D 渲染、alpha 穿透、拖动、motion player、缩略图 |
| **brain** 思考 | `renderer/src/brain/` | `main/services/llm/` | LLM provider 路由、对话 store、parser、system prompt |
| **presence** 声音 | `renderer/src/presence/` | `main/ipc/tts.ts` | TTS 调用、流式音频、嘴型同步 |
| **hands** 行动 | `renderer/src/hands/` | `main/services/motion-factory/` | motion 生成、plan executor、桌面自动化 |
| **attention** 主体 | — | `main/services/attention/` + `perception/` | 感知总线、调度器、Planner、主动行为 |
| **infra** 横切 | `renderer/src/infra/` | `main/ipc/` + `main/services/` | UI 组件、设置、商店、eventbus、配置 |

---

## 4. 构建与运行

### 4.1 前置依赖

- Node.js ≥ 20
- pnpm ≥ 9
- Python 3.10+（TTS sidecar 可选）
- macOS 为主测平台（Windows / Linux 结构预留）

### 4.2 常用命令

所有命令从仓库根目录执行：

```bash
# 安装依赖（首装会编译 better-sqlite3 / electron-click-drag-plugin 原生模块）
pnpm install

# 开发模式（热重载 renderer + 主进程）
pnpm dev

# TypeScript 类型检查（**两个 tsconfig 都跑，缺一不行**）
pnpm typecheck

# 生产构建
pnpm build

# 打包（产物在 electron/release/<version>/）
pnpm package:mac     # arm64 + x64 .dmg
pnpm package:win     # nsis .exe
pnpm package:linux   # AppImage
```

### 4.3 子包构建

```bash
pnpm build:packages   # 构建 packages/*（soul-loader + motion-factory）
```

子包用 `tsup` 打包为 ESM + CJS 双格式，electron 包通过 `workspace:*` 引用。

### 4.4 原生模块重建

升级 Electron 版本后必须重建：

```bash
pnpm -F luvu-electron rebuild
```

---

## 5. 测试

### 5.1 运行测试

```bash
# 根目录跑全部测试（electron + packages）
pnpm test

# 只跑 electron 包测试
pnpm -F luvu-electron test

# watch 模式
pnpm -F luvu-electron test:watch

# 覆盖率
pnpm -F luvu-electron test:coverage

# 跑单个文件
pnpm -F luvu-electron test -- src/path/to/file.test.ts
```

### 5.2 测试策略

**当前只测纯函数**（无 Electron API 依赖）。IPC handler 和 Vue 组件不在单测覆盖范围内（后续需要 electron-mock + @vue/test-utils）。

测试文件命名：`*.test.ts`，与源文件同目录。

已覆盖模块示例：
- `main/services/motion-factory/parser.test.ts`
- `main/services/logger.test.ts`
- `main/services/config-store.test.ts`
- `renderer/src/brain/parser.test.ts`
- `shared/format-utils.test.ts`
- `main/services/emotional-state/*.test.ts`
- `main/services/llm/auto-detect.test.ts`
- `main/services/character-eval/*.test.ts`
- `main/services/soul-loader*.test.ts`

### 5.3 vitest 配置

见 `electron/vitest.config.ts`：
- environment: `node`
- 覆盖率 provider: `v8`
- 排除 `src/preload/**` 和 `src/renderer/**`

---

## 6. 代码风格与规范

### 6.1 TypeScript — Tier 3 严格模式

`tsconfig.node.json` 和 `tsconfig.web.json` 同时启用：

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noImplicitOverride: true`

**硬性约束**:
- 不允许 `any` / `as any`
- 不允许 `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`
- 用 `unknown` + type narrowing 替代 `any`

`exactOptionalPropertyTypes` 常见陷阱：`{ foo?: string }` 不等于 `{ foo?: string | undefined }`。给可选字段显式赋 `undefined` 会报错，必须用条件展开：

```ts
{ ...(value !== undefined ? { foo: value } : {}) }
```

### 6.2 Vue

- `<script setup lang="ts">`
- 组件名 PascalCase
- 优先 `ref` 而非 `reactive`（更易 IPC 序列化）

### 6.3 CSS

- OKLCH 颜色 + design tokens（`var(--color-*)` / `var(--text-*)` / `var(--space-*)` / `var(--ease-*)`）
- 全局 UI 缩放用 `transform: scale(var(--ui-scale, 1))`，不用 CSS `zoom`

### 6.4 文件与函数大小

- 单文件 < 800 行（SettingsPanel / ModelLibraryPanel 是 known 例外）
- 函数 < 50 行（IPC handler 可放宽到 100 行）

### 6.5 Python sidecar

- PEP 8
- 类型注解
- 使用 venv

---

## 7. IPC 架构

### 7.1 单一来源契约

`electron/src/shared/api.ts` 定义 `LuvuApi` 接口，是 IPC 的 single source of truth。

preload 用 `ReturnType<LuvuApi[ns][method]>` 自动同步类型，确保 preload 实现与契约不会漂移。

### 7.2 文件组织

每个 IPC 主题一个文件，导出 `register*Ipc(getWindow?)` 函数，在 `main/index.ts` 的 `app.whenReady` 中集中注册。

命名严格匹配主题：`llm.ts` / `tts.ts` / `models.ts` / `characters.ts` / `motion-factory.ts` / `automation.ts` / `attention.ts` 等。

**注意**: `system.ts` 只保留窗口控制相关，v0.13 audit 拆分后不再往里面加新东西。

### 7.3 跨进程序列化

所有 IPC invoke/send 的参数过 `deepPlain()` 兜底：三级 fallback `structuredClone → JSON round-trip → manualClone`，专门解决 Vue Proxy → V8 结构化克隆失败问题。

---

## 8. 数据与配置布局

### 8.1 用户数据目录 (`~/.luvu/`)

```
~/.luvu/
├── config.json                    # RuntimeConfig（LLM/TTS/RVC/vision 等）
├── active-character.json          # 当前 active character id + mounted_ids(M8)
├── chars/<id>/                    # 每角色独立目录(v0.14+ multi-character)
│   ├── character.json             # 元数据(名字/亲密度/last_chat_at)
│   ├── soul/                      # 这个角色的灵魂 yaml(覆盖 ~/.luvu/soul/)
│   ├── history.sqlite             # 这个角色的对话历史(隔离)
│   ├── memory.db                  # 长期向量记忆(v0.17+,M8 跨灵魂 event 也写这)
│   ├── preferences.json           # scale / offset_y / 其他
│   ├── emotional-state.json       # 情感状态(mood / topic_imprints)
│   └── soul-changes.log           # SoulEditor 改动 NDJSON audit
├── soul/                          # 全局灵魂档案(被 per-character 覆盖)
├── model-scan-cache.json          # 模型扫描 mtime 缓存
├── model-favorites.json           # 收藏 + 最近使用
├── model-preferences.json         # 每模型 scale / offset_y
├── character-enriched.json        # LLM 角色中文名+简介缓存
├── model-descriptions.json        # AI 生成的模型描述
├── thumbs/                        # Live2D 缩略图(~10 MB)
├── logs/main.log                  # 主进程日志(10 MB 轮转 + 敏感字段脱敏)
├── voice_clones/                  # 用户上传的 RVC 训练样本
├── models-tts/                    # TTS 模型(4-6 GB)
└── window-state.json              # 窗口位置 / always-on-top
```

### 8.2 项目内数据

- `default.yaml` — 内置默认灵魂档案（不入用户目录时回退到此）
- `soul/*.yaml` — 内置灵魂文件（identity / personality / core_memories / learned_traits）
- `electron/models-library/` — Live2D 模型库（不入仓，5-17 GB）

### 8.3 路径解析优先级

用户目录 `~/.luvu` 优先于 `app.getPath('userData')`。详见 `main/services/paths.ts`。

---

## 9. 安全模型

### 9.1 进程隔离

- `contextIsolation: true` + `nodeIntegration: false` — renderer 不能直接调 Node API
- `sandbox: false` — preload 需要 Node API（已审计）
- `webSecurity: false` — Live2D 跨目录加载需要（known debt，用 `luvu-asset://` protocol 逐步替代）
  - **缓解**: CSP header + `setWindowOpenHandler` + `will-navigate` 三道防线

### 9.2 输入验证

- 所有用户输入路径过 `path.resolve` + 白名单（disk-usage / online-store）
- YAML 解析统一用 `yaml.JSON_SCHEMA` 防 `!!js/*` 标签注入
- 命令执行用 `execFile(cmd, [args])` 数组形式防 shell 注入

### 9.3 日志脱敏

`~/.luvu/logs/main.log` 自动脱敏 6 类敏感字段：`api_key`、`Bearer`、`sk-` 等。

### 9.4 其他

- `single-instance lock` — 防双启冲突
- `asarUnpack` — better-sqlite3 和 electron-click-drag-plugin 原生模块解包

---

## 10. 主体性 AI 循环（v0.8+）

```
PerceptionBus (main)
  ↓ Mouse / Idle / Window / Time / Vision sensors
Attention Scheduler (5s tick)
  ↓ 检查触发条件（idle ≥ N min / window 切换 / proactive 60s）
Planner (LLM 调用)
  ↓ 输入感知摘要 + soul prompt，输出 BehaviorPlan
IPC attention:plan → renderer
  ↓
Plan Executor (avatar/plan-executor.ts)
  ↓ 依次执行 actions: look_at / speak / play_motion / change_emotion
  ↓ speak → bus.emit('brain:inject-utterance') → dialog → TTS
```

Planner LLM 系统 prompt 强制要求：**每个 speak action 必须同时输出一个 play_group**。

---

## 11. 灵魂档案（Soul）系统

灵魂 = 角色配置，4 个 YAML 文件按主题切分：

- `identity.yaml` — 名字 / 称呼 master / 立绘 model_dir / 生日
- `personality.yaml` — 三层人格（layer1 底层 / layer2 表层 / layer3 反差）+ signature_lines
- `core_memories.yaml` — 关键事件 / 共同回忆
- `learned_traits.yaml` — LLM 累积观察主人偏好（运行时可写回）

`main/services/soul-loader.ts` 合并 4 个文件成单一 `SoulConfig`。支持热重载：保存触发 `soul:changed` IPC，renderer 自动重新加载。

---

## 12. 开发约定

### 12.1 分支与提交

- 分支命名: `feat/<feature>`、`fix/<issue>`、`docs/<topic>`、`refactor/<scope>`、`chore/<task>`
- 提交规范: Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`）

### 12.2 PR 前验证

```bash
pnpm typecheck        # 必须零错误
pnpm build            # electron-vite 产物成功
pnpm test             # 单测通过
```

### 12.3 第三方资产不入仓

- Live2D 模型文件（受 Live2D 商业授权约束）
- 个人录音 / 声音克隆样本
- API key / 密钥
- Python sidecar 的 venv / TTS 模型

`.gitignore` 已配置兜底，提交前请 `git status` 确认。

### 12.4 eventbus listener 卫生

renderer Vue 组件在 `<script setup>` 顶层直接调 `bus.on(...)` 会在每次挂载时累积 listener。必须：
- 放在 `onMounted` 里注册
- 在 `onBeforeUnmount` 里 `bus.off`
- 多 handler 时用 `cleanupHandlers: Array<() => void>` 收集统一调用

---

## 13. 关键设计文档

| 文档 | 内容 |
|------|------|
| `docs/PRD.md` | 产品需求与定位 |
| `docs/ARCHITECTURE.md` | 系统架构与数据流 |
| `docs/SOUL_SCHEMA.md` | 灵魂档案 schema |
| `docs/ARCHITECTURE_MOTION_SYSTEM.md` | 动作系统详细设计 |
| `docs/rfcs/0001-ts-strict-tier-3.md` | TS Tier 3 严格化 RFC |
| `docs/DECISIONS.md` | 关键架构决策记录 |
| `CHANGELOG.md` | 版本变更日志 |
| `CLAUDE.md` | 给 Claude Code 的专项指南（含更多实现细节陷阱） |

---

## 14. 常见陷阱（修代码前必读）

1. **不要默认打开 detached DevTools** — macOS 会把 process 转回 regular，Dock 图标重新出现破坏桌宠态。只在 `LUVU_DEBUG=1` / `MAIN_APP_DEBUG=1` 时打开。
2. **不要给 panel 父级加 `pointer-events: none` + CSS `zoom`** — 会破坏 `position: fixed` 子元素的 click 路径。全局 UI 缩放用 `transform: scale`。
3. **不要 `await window.api.memory.ragContext(...)` 不带 timeout** — slow embedding endpoint 会卡住每个发送。一律走 `fetchRagContext` 的 800ms `Promise.race`。
4. **不要直接 import `@modelcontextprotocol/sdk`** — 我们手写 stdio JSON-RPC（`main/services/mcp-client.ts`）是有意为之（避免依赖膨胀 + 控制 timeout）。
5. **config_store migration** — 新增字段在 `DEFAULT` 加；旧默认值替换时写精确匹配判断，不能假设"看起来像默认"就覆盖。
6. **LLM rate limit budget** — `planner/index.ts` 的 `llmCallTimestamps.push()` 在 cfg.llm_model / llm_provider 校验之后，LLM 未配置不消耗 budget。
