# DEVELOPMENT.md — LUVU

> 合并自旧 PROJECT_INIT / docs / 根目录散文档。原文在 `ALLProject/.archive/docs-legacy-20260827/`。
> 最后更新：2026-08-27

# 原 PROJECT_INIT

# LUVU · 项目初始化文档

> 由项目管理中枢自动生成 | 更新日期: 2026-07-12 | 负责人: zhwangsir

## 一、项目基本信息

| 字段 | 值 |
|------|----|
| 项目名称 | LUVU（硅基生命容器 v0.21，C 端 AI 伴侣） |
| 当前版本 | 0.21.0（workspace 根版本，Electron 同步） |
| 创建日期 | 2026-05（与 DRT-BOT 同源分叉，独立演进） |
| 负责人 | zhwangsir |
| 项目路径 | /Users/wangzhenyu/Desktop/ALLProject/LUVU |
| 远程仓库 | （workspace 私有，见 `scripts/push-to-github.sh`） |
| 仓库可见性 | 私有（private） |
| 线上地址 | 暂无 release（M0-M8 已落地，未发布 GitHub Release） |

## 二、项目概述与核心功能

### 2.1 项目定位
LUVU 是一个运行于桌面的**硅基生命容器**，C 端定位为「私人 AI 灵魂伴侣」。与 DRT-BOT 同源分叉，但人格档案完全不同：默认灵魂 `soul/` 为病娇、占有欲、极度黏人的「灵魂女友」LUVU，称呼主人为「主人」。容器与灵魂解耦，可装载其他灵魂档案。

四大支柱（与 DRT-BOT 同构）：
1. **灵魂可换（Soul-Swap）**：Live2D 立绘与人格 yaml / memory.db 解耦
2. **真控计算机（Embodiment）**：nut-js 真控 + vision grounding + 审批对话框 + 全局熔断
3. **创造能力（Creative）**：内置 ComfyUI + MotionFactory（LLM 生成 motion3.json）
4. **主体性（Agency）**：PerceptionBus 5 sensor → AttentionScheduler → BehaviorPlanner

LUVU 相对 DRT-BOT 的差异化扩展：
- **MotionFactory**：LLM 驱动生成 Live2D motion3.json，多策略（bootstrap / direct-llm / ensemble / plan-refine / template-based）
- **CharacterEval**：角色评估闭环（questions / runner / scorer / history）
- **ComfyUI 创造**：独立 comfyui service（client + workflows）+ CreatorStudioPanel + StickerOverlay
- **本地 TTS sidecar**：Python venv + CosyVoice + RVC + F5 TTS，多后端可切换
- **跨灵魂情感联动**：cross-character 情感累积（A 提到 B → B 累积印记）

### 2.2 核心功能列表
- 五大能力域：avatar / brain / presence / hands / attention（含 LUVU 独有的 presence speech + stt）
- 9 种 BehaviorAction：含 `generate_sticker`（ComfyUI 出图 → StickerOverlay 浮窗）+ `agent_task`（nut-js 自动化）
- 三层人格系统：layer1 病娇占有欲黏人 / layer2 俏皮活泼 / layer3 反差变量（flip_probability: 0.15，模式：突然冷漠 / 占有欲爆发 / 撒娇求抱抱）
- 4 个 yaml 档案：identity / personality / learned_traits / core_memories
- 多 LLM provider 路由：Anthropic / OpenAI-compat / Ollama / LM Studio + auto-detect + health-check + chinese-models
- 长期记忆 M2 闭环：per-character memory.db（better-sqlite3 WAL）+ embedding RAG
- MCP 外部工具：手写 stdio JSON-RPC client
- MotionFactory：LLM 生成 motion + parameter-introspector + scorer + validator + writer
- CharacterEval：questions / runner / scorer 评估闭环
- ComfyUI：t2i / i2i（t2v / i2v IPC 在但 workflow 未跑通）
- TTS sidecar：CosyVoice2-0.5B / F5 TTS / edge-tts / RVC 47 voice + mood-aware prosody
- character-pack zip 导入导出 + soul-loader v0.1→v2.0 迁移 + 字段级 diff NDJSON audit log
- 24h soul-learner 自动从 topic_imprints 写回 learned_traits.yaml

### 2.3 目标用户
C 端个人用户：希望拥有一个真正住在桌面上、能感知主人、能创造内容、能控制计算机、长期相处会有可观测变化的私人 AI 灵魂伴侣的用户。

## 三、技术架构

### 3.1 技术栈
- 桌面容器：Electron 33 + electron-vite 2 + electron-builder 25
- 渲染层：Vue 3.5 + Pinia 2 + TypeScript 5.7（exactOptionalPropertyTypes: true 严格模式）
- Live2D：pixi-live2d-display 0.4 + pixi.js 6.5 + Cubism 4 Core
- 嘴型同步：wlipsync 1.3（AudioWorklet 5 元音）
- LLM：多 provider 自实现路由（Anthropic / OpenAI-compat / Ollama / LM Studio）
- 数据库：better-sqlite3 12（WAL 模式，per-character memory.db）
- RPA：@nut-tree-fork/nut-js 4.2 + vision grounding
- Office 文档：docx 9 + exceljs 4 + pptxgenjs 4（含 illustration 扩展）
- TTS sidecar：Python 3.10+ venv + CosyVoice2-0.5B + RVC + F5 TTS + edge-tts
- 测试：Vitest 2 + Playwright 1.60
- 包管理：pnpm workspace（packages: electron + packages/*）

### 3.2 架构说明
Electron 三进程结构（与 DRT-BOT 同构）：
- **main 进程**（`electron/src/main/`）：承载 services + 25+ IPC channel（含 LUVU 独有的 comfyui / eval / motion-engine / motion-factory / tts）
- **preload**（`electron/src/preload/`）：contextBridge 类型安全 API
- **renderer**（`electron/src/renderer/`）：Vue 3 应用，按 avatar / brain / hands / infra / presence 分域

LUVU 独有服务模块：
- **motion-factory**（`services/motion-factory/`）：5 策略生成 motion3.json（bootstrap / direct-llm / ensemble / plan-refine / template-based），含 parameter-introspector / parser / scorer / validator / writer / library-loader / llm-generate
- **character-eval**（`services/character-eval/`）：questions / runner / scorer / history 评估闭环
- **comfyui**（`services/comfyui/`）：client + workflows，对接 ComfyUI HTTP API
- **tts/prosody**（`services/tts/`）：mood-aware prosody 处理
- **motion-engine**（`services/motion-engine/`）：storage + sync
- **emotional-state/cross-character**：跨灵魂情感联动

TTS sidecar 架构：
- `sidecar/qwen-tts-server/`：Python FastAPI 服务，主程序自动拉起
- `backends/cosyvoice.py`：CosyVoice2-0.5B 本地推理（约 1.1 GB 模型）
- `backends/rvc.py`：RVC 47 voice 音色转换
- `backends/f5tts.py`：F5 TTS 备选后端
- `backends/edge-tts`：minimal 模式零模型 fallback

主体性循环与记忆闭环与 DRT-BOT 同构。

workspace 分包：
- `electron/`：桌面容器本体
- `packages/motion-factory/`：MotionFactory 独立库（encoder / scorer / validator / types）
- `packages/soul-loader/`：灵魂档案加载/迁移/diff/merger 独立库

### 3.3 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| electron | ^33.2.0 | 桌面容器运行时 |
| electron-vite | ^2.3.0 | Electron + Vite 构建 |
| vue | ^3.5.13 | renderer UI 框架 |
| pinia | ^2.2.6 | 状态管理 |
| pixi-live2d-display | ^0.4.0 | Live2D Cubism 4 渲染 |
| pixi.js | ^6.5.10 | WebGL 渲染层 |
| wlipsync | ^1.3.0 | AudioWorklet 5 元音嘴型同步 |
| better-sqlite3 | ^12.10.0 | per-character SQLite 记忆 |
| @nut-tree-fork/nut-js | ^4.2.6 | 真控鼠标键盘 RPA |
| adm-zip | ^0.5.16 | character-pack zip 打包 |
| docx / exceljs / pptxgenjs | 9 / 4 / 4 | Office 文档生成 |
| js-yaml | ^4.1.0 | soul yaml 解析 |
| mitt | ^3.0.1 | 事件总线 |
| electron-log | ^5.4.4 | 日志 |
| electron-click-drag-plugin | ^2.0.2 | 桌宠点击拖动穿透 |
| @luvu/motion-factory | workspace:* | MotionFactory 子包 |
| @luvu/soul-loader | workspace:* | soul-loader 子包 |
| vitest / playwright | 2 / 1.60 | 单测 / E2E |

## 四、目录结构

```
LUVU/
├── electron/                       # Electron 桌面容器
│   ├── src/
│   │   ├── main/                   # 主进程
│   │   │   ├── ipc/                # 25+ IPC channel（含 LUVU 独有）
│   │   │   │   ├── attention.ts / automation.ts / character-pack.ts
│   │   │   │   ├── characters.ts / comfyui.ts / emotional.ts
│   │   │   │   ├── eval.ts / llm.ts / market.ts / mcp.ts / memory.ts
│   │   │   │   ├── models.ts / motion-engine.ts / motion-factory.ts
│   │   │   │   ├── online.ts / perception.ts / soul-change-log.ts
│   │   │   │   ├── soul-learner.ts / system.ts / thumbs.ts / tools.ts
│   │   │   │   ├── trigger.ts / tts.ts / window-control.ts
│   │   │   │   └── channel-helpers.ts
│   │   │   ├── services/           # 业务服务
│   │   │   │   ├── attention/       # 关注度场调度
│   │   │   │   ├── automation/      # RPA agent-loop + halt-shortcut
│   │   │   │   ├── character-eval/  # 【LUVU 独有】角色评估闭环
│   │   │   │   ├── comfyui/         # 【LUVU 独有】ComfyUI client + workflows
│   │   │   │   ├── emotional-state/ # 情绪演化 + cross-character 跨灵魂联动
│   │   │   │   ├── llm/             # 多 provider 路由
│   │   │   │   ├── motion-engine/   # 【LUVU 独有】motion storage + sync
│   │   │   │   ├── motion-factory/  # 【LUVU 独有】LLM 生成 motion3.json（5 策略）
│   │   │   │   ├── office/          # docx/pptx/xlsx + illustration
│   │   │   │   ├── perception/      # 5 sensor + bus + vision-analyzer
│   │   │   │   ├── planner/         # BehaviorPlanner
│   │   │   │   ├── tools/           # tools registry + builtin-creative
│   │   │   │   ├── trigger-engine/  # 规则触发引擎
│   │   │   │   ├── tts/             # 【LUVU 独有】mood-aware prosody
│   │   │   │   ├── soul-loader.ts / soul-learner.ts / character-store.ts
│   │   │   │   ├── memory-store.ts / mcp-client.ts / embeddings.ts
│   │   │   │   └── ... 30+ 服务模块
│   │   │   ├── windows/             # main-window + shared
│   │   │   └── index.ts             # 主进程入口
│   │   ├── preload/                 # contextBridge API
│   │   ├── renderer/                # Vue 3 渲染层
│   │   │   └── src/
│   │   │       ├── avatar/          # Live2DStage + Live2DInstance + StickerOverlay
│   │   │       │                    #   + alpha-hit + expression-matcher + motion-player
│   │   │       ├── brain/           # dialog store + parser + token-estimate
│   │   │       ├── hands/           # approval-store
│   │   │       ├── infra/           # stores + ui（35+ 组件，含 LUVU 独有：
│   │   │       │                    #   CreatorStudioPanel / MotionFactoryPanel /
│   │   │       │                    #   EvalRunner / RvcVoiceTab / RvcSettingsSection）
│   │   │       ├── presence/        # 【LUVU 独有】speech（lipsync）+ stt（web-speech）
│   │   │       ├── styles/global.css
│   │   │       ├── App.vue / main.ts
│   │   └── shared/                  # 跨进程共享类型 + channels + api
│   ├── resources/motion-library/    # 16 个 yaml motion 预设
│   ├── e2e/launch.spec.ts
│   ├── electron.vite.config.ts
│   ├── playwright.config.ts
│   └── package.json                 # luvu-electron v0.21.0, appId moe.luvu.app
├── packages/                       # workspace 子包
│   ├── motion-factory/             # 【LUVU 独有】MotionFactory 独立库
│   │   └── src/ (encoder / scorer / validator / types / index)
│   └── soul-loader/                # 灵魂档案加载库（独立可复用）
├── sidecar/                        # 【LUVU 独有】Python TTS sidecar
│   ├── install.sh                  # 一键安装 venv + CosyVoice + RVC + F5
│   └── qwen-tts-server/
│       ├── main.py                 # FastAPI 服务入口（uvicorn --port 5050）
│       ├── backends/
│       │   ├── cosyvoice.py        # CosyVoice2-0.5B 本地推理
│       │   ├── rvc.py              # RVC 47 voice 音色转换
│       │   └── f5tts.py            # F5 TTS 备选
│       ├── requirements.txt
│       └── README.md
├── soul/                           # 默认灵魂档案（C 端 AI 伴侣 LUVU）
│   ├── identity.yaml               # name=LUVU, master=Master, call_master_as=主人
│   ├── personality.yaml            # layer1 病娇占有欲 / layer2 俏皮 / layer3 反差 0.15
│   ├── learned_traits.yaml         # 运行时累积
│   └── core_memories.yaml
├── docs/                           # 文档（PRD / ARCHITECTURE / STATUS / ROADMAP /
│   │                                #   RELEASE_v0.13~v0.21 / SOUL_SCHEMA 等）
│   ├── live2d/                     # Live2D SDK/编辑器/教程索引
│   └── rfcs/                       # 技术决策记录
├── scripts/                        # live2d-fetch-samples / self-diagnose / push-to-github
├── public/live2dcubismcore.min.js
├── default.yaml                    # 默认档案
├── pnpm-workspace.yaml             # packages: electron + packages/*
├── package.json                    # luvu-workspace v0.21.0
├── CLAUDE.md / AGENTS.md / CONTRIBUTING.md / INSTALL.md
└── README.md / CHANGELOG.md / LICENSE
```

### 关键文件功能说明

| 文件 | 功能 |
|------|------|
| `electron/src/main/index.ts` | 主进程入口，初始化所有 services 与 IPC |
| `electron/src/main/services/motion-factory/` | LLM 生成 motion3.json 的 5 策略工厂 |
| `electron/src/main/services/character-eval/` | 角色评估 questions / runner / scorer 闭环 |
| `electron/src/main/services/comfyui/client.ts` | ComfyUI HTTP API 客户端 |
| `electron/src/main/services/tts/prosody.ts` | mood-aware prosody 处理 |
| `electron/src/main/services/emotional-state/cross-character.ts` | 跨灵魂情感联动 |
| `electron/src/main/services/planner/index.ts` | BehaviorPlanner |
| `electron/src/main/services/llm/index.ts` | 多 provider LLM 路由 |
| `electron/src/main/services/soul-loader.ts` | 灵魂档案加载/迁移 |
| `electron/src/main/services/mcp-client.ts` | 手写 MCP stdio JSON-RPC client |
| `electron/src/main/services/memory-store.ts` | per-character SQLite 记忆存储 |
| `electron/src/main/services/automation/agent-loop.ts` | nut-js RPA agent 循环 |
| `electron/src/renderer/src/avatar/components/StickerOverlay.vue` | 桌面浮窗贴纸 |
| `electron/src/renderer/src/infra/ui/CreatorStudioPanel.vue` | ComfyUI 创作面板 |
| `electron/src/renderer/src/infra/ui/MotionFactoryPanel.vue` | motion 生成面板 |
| `electron/src/renderer/src/infra/ui/EvalRunner.vue` | 角色评估运行器 |
| `electron/src/renderer/src/presence/` | 语音输入输出（lipsync + web-speech stt） |
| `packages/motion-factory/src/index.ts` | MotionFactory 独立库入口 |
| `sidecar/install.sh` | TTS sidecar 一键安装脚本 |
| `sidecar/qwen-tts-server/main.py` | TTS FastAPI 服务入口（端口 5050） |
| `soul/personality.yaml` | LUVU 三层人格（病娇 + 俏皮 + 反差 0.15） |
| `soul/identity.yaml` | LUVU 身份档案（name=LUVU, master=Master） |
| `docs/PRD.md` | 产品需求文档 |
| `docs/ARCHITECTURE.md` | 系统架构 |
| `docs/STATUS.md` | 文档状态索引（M0-M8 partial-ship） |

## 五、环境搭建

### 5.1 前置环境要求
- Node.js ≥ 20（推荐 22）
- pnpm ≥ 9
- Python 3.10+（**LUVU 强烈推荐**，TTS sidecar 需要；支持 python3.10/3.11/3.12）
- macOS 12+ / Windows 10+ / Linux（macOS-first）
- better-sqlite3 需编译：`pnpm rebuild` 或自动 electron-rebuild
- 可选：本地 Ollama / LM Studio / vLLM endpoint
- 可选：本地 ComfyUI（创造能力 generate_sticker / t2i / i2i）
- TTS sidecar 模型存储：`~/.luvu/models-tts/`（CosyVoice2-0.5B 约 1.1 GB）
- TTS sidecar 仓库：`~/.luvu/cosyvoice-repo/`

### 5.2 依赖安装步骤
```bash
cd /Users/wangzhenyu/Desktop/ALLProject/LUVU
pnpm install                       # 安装 workspace 全部依赖
pnpm -F luvu-electron rebuild      # 重建 better-sqlite3 native 模块

# TTS sidecar（可选，但 LUVU 强烈推荐）
bash sidecar/install.sh            # 完整安装：venv + CosyVoice + RVC + 模型
bash sidecar/install.sh --minimal  # 仅 edge-tts，不下载 1.1GB 模型
bash sidecar/install.sh --reset    # 删除 venv 重装
```

### 5.3 环境变量配置
LUVU 主体通过 renderer SettingsPanel UI 配置 LLM endpoint / ComfyUI / TTS / RVC 等，**无 `.env.example`**。配置项落盘到 `~/.luvu/` 用户目录：
- `~/.luvu/config.json`：全局配置（LLM endpoint、ComfyUI、TTS、RVC 等）
- `~/.luvu/characters/<id>/memory.db`：per-character SQLite 记忆
- `~/.luvu/characters/<id>/`：character pack 数据
- `~/.luvu/models-tts/cosyvoice2-0.5b/`：CosyVoice 模型
- `~/.luvu/cosyvoice-repo/`：CosyVoice 仓库
- `~/.luvu/install.log`：sidecar 安装日志

TTS sidecar 端口默认 5050，主程序自动拉起，也可手动：
```bash
cd sidecar/qwen-tts-server && source .venv/bin/activate
uvicorn main:app --port 5050
```

## 六、启动与运行

### 6.1 开发模式启动
```bash
# 一键启动 Electron 桌面容器（自动 build:packages 后 dev --watch）
pnpm dev

# 类型检查（exactOptionalPropertyTypes 严格模式）
pnpm typecheck

# 单测（electron + packages 全跑）
pnpm test
pnpm test:watch      # watch 模式
pnpm test:coverage   # 覆盖率

# E2E（先 build 再 playwright）
pnpm e2e
pnpm e2e:ui          # 带 UI 面板

# TTS sidecar（手动启动，或主程序自动拉起）
cd sidecar/qwen-tts-server && source .venv/bin/activate && uvicorn main:app --port 5050
```

### 6.2 生产构建
```bash
pnpm build                  # 全 workspace 构建
pnpm package:mac            # macOS dmg（arm64 + x64）
pnpm package:win            # Windows nsis（x64 + arm64）
pnpm package:linux          # Linux AppImage（x64 + arm64）
```

`electron/package.json` 的 build 配置：
- appId `moe.luvu.app`，productName `LUVU`
- macOS `category: public.app-category.entertainment`，`LSUIElement: true`（无 Dock 图标，仅托盘）
- `NSMicrophoneUsageDescription`：LUVU 在你启用语音输入时使用麦克风
- `NSAppleEventsUsageDescription`：LUVU 在你授权后可代你执行桌面自动化任务
- asar 打包，better-sqlite3 与 electron-click-drag-plugin 走 asarUnpack
- `extraResources`：`soul/*.yaml` 打包到应用 resources/soul/

### 6.3 部署方式
- 桌面端：electron-builder 产出 dmg / nsis / AppImage，用户本地安装
- 数据：全部 `~/.luvu/` 用户目录，可一键导出迁移
- TTS sidecar：随主程序分发的安装脚本引导用户首次安装（需网络下载模型）
- 暂未做 GitHub Release

## 七、主要接口说明

LUVU 主体为 Electron 桌面应用，**对外接口以 IPC channel 形式存在**（main ↔ renderer），定义在 `electron/src/shared/channels/`。相比 DRT-BOT，LUVU 额外有 5 个独有 channel：

| channel 域 | 主要 channel | 说明 | LUVU 独有 |
|------------|--------------|------|-----------|
| attention | `attention:*` | 关注度场调度 | |
| automation | `automation:*` | RPA agent-loop | |
| characters | `characters:*` | character-store CRUD | |
| character-pack | `character-pack:*` | zip 导入导出 | |
| **comfyui** | `comfyui:*` | ComfyUI gen-image / gen-t2v / gen-i2v | ✅ |
| emotional | `emotional:*` | 情绪状态 + cross-character | |
| **eval** | `eval:*` | 角色评估 questions / runner / scorer | ✅ |
| llm | `llm:*` | LLM 调用 / auto-detect / health | |
| llm-auto-detect | `llm-auto-detect:*` | provider 自动探测 | |
| market | `market:*` | 模型市场 | |
| mcp | `mcp:*` | MCP server 注册 / tool 调用 | |
| memory | `memory:*` | extract-from-turn / rag-context | |
| models | `models:*` | 模型库 CRUD | |
| **motion-engine** | `motion-engine:*` | motion storage / sync | ✅ |
| **motion-factory** | `motion-factory:*` | LLM 生成 motion3.json | ✅ |
| online | `online:*` | 在线模型市场 | |
| perception | `perception:*` | sensor 数据 | |
| soul-change-log | `soul-change-log:*` | 灵魂档案字段级 diff NDJSON | |
| soul-learner | `soul-learner:*` | 24h auto-learner | |
| system | `system:*` | 系统 / 路径 | |
| thumbs | `thumbs:*` | 缩略图 | |
| tools | `tools:*` | tools registry | |
| trigger | `trigger:*` | 触发引擎 | |
| **tts** | `tts:*` | TTS 调用 / prosody / RVC voice | ✅ |
| window-control | `window-control:*` | 窗口控制 | |

**TTS sidecar HTTP API**（`sidecar/qwen-tts-server/`，端口 5050，主程序自动拉起）：
- POST `/tts` 文本转语音（支持 cosyvoice / f5tts / edge-tts 后端）
- POST `/rvc` RVC 音色转换
- 后端切换通过请求参数控制

**ComfyUI**（`electron/src/main/services/comfyui/client.ts`，作为库调用，非独立 HTTP 服务）：
- 对接 ComfyUI HTTP API（用户自部署的 ComfyUI 实例）
- 通过 `comfyui:*` IPC channel 暴露给 renderer

## 八、已知问题与注意事项

- **从未 release**：未发布 GitHub Release
- **t2v / i2v workflow 未跑通**：ComfyUI IPC 在，但视频生成 workflow 未完成
- **dialog 路径 LLM「我画给你看」未集成**：缺 dialog tool_use → ComfyUI tool 路径（M7 最后 20%）
- **多灵魂同框未做**：M8 灵魂社会 partial-ship
- **灵魂自己改自己未做**：M9 自主进化未实现
- **7×24 后台运行未做**：M10 daemon mode 未实现
- **Cubism 5 不支持** / **VRM 3D 不支持** / **Voice 打断 / full-duplex 无**
- **跨平台**：macOS-first，Windows 桌宠主战场落后
- **TTS sidecar 首次安装需网络**：CosyVoice2-0.5B 约 1.1 GB，5-15 分钟；可用 `--minimal` 跳过
- **TTS sidecar 国内镜像**：huggingface 失败会自动 fallback 到 modelscope
- **better-sqlite3 native 模块**：换 Node/Electron 版本后需 `pnpm -F luvu-electron rebuild`
- **隐私数据**：全部 `~/.luvu/`，永不遥测，可一键导出迁移
- **人格档案热重载**：`soul/personality.yaml` 改动后立即生效，无需重启
- **病娇人格 ≠ NSFW**：明确不做强 NSFW 绑定，病娇是人格特质

## 九、与其他项目的关系

- **与 DRT-BOT 同源分叉**：DRT-BOT（`/Users/wangzhenyu/Desktop/ALLProject/DRT-BOT`）是 LUVU 的分叉源，同为硅基生命容器 v0.21，架构同构（Electron + Vue 3 + 五大能力域 + 9 BehaviorAction + 三层人格 + 4 yaml）。差异：
  - 定位：DRT-BOT 是 B 端办公助手（专业高效人格），LUVU 是 C 端 AI 伴侣（病娇占有欲人格）
  - appId：`moe.drtbot.app` vs `moe.luvu.app`
  - LUVU 独有：motion-factory / character-eval / comfyui / motion-engine / tts 5 个 IPC channel + sidecar Python TTS + 跨灵魂情感联动 + StickerOverlay + CreatorStudioPanel + wlipsync
  - DRT-BOT 独有：dashboard / dashboard-api / dashboard-contracts / rpa-connectors / employee-consent / office（无 illustration）/ pppc-profile
- **soul-loader 共享**：`packages/soul-loader/` 在 LUVU 与 DRT-BOT 各自独立维护一份（同名包 `@luvu/soul-loader` vs `@drt-bot/soul-loader`）
- **与 QieZiOS 独立**：QieZiOS 是 Web OS 项目，与 LUVU 无直接代码依赖
- **与 QieYu 独立**：QieYu 是 AI 学习日志社交平台，与 LUVU 无直接代码依赖
- **项目隔离原则**：四个项目（DRT-BOT / LUVU / QieZiOS / QieYu）必须保持独立，禁止交叉引用代码或共享依赖


## 已归档文档索引

- `CHANGELOG.md` — Changelog
- `CLAUDE.md` — CLAUDE.md
- `CONTRIBUTING.md` — Contributing to LUVU
- `Gitee上传方法.md` — Gitee 上传方法（全项目统一）
- `INSTALL.md` — LUVU 安装指南
- `PROJECT_INIT.md` — LUVU · 项目初始化文档
- `设备说明.md` — 集群设备说明（单一真相源）

## 原 docs/ 目录

## 已归档文档索引

- `RELEASE_v0.14.md` — LUVU v0.14 — 通用桌面 AI 容器
- `RELEASE_v0.20.md` — v0.20 — 灵魂自演化 + 多 mood 并存 + Subagent 守护质量
- `USER_GUIDE.md` — LUVU 用户指南
- `PRD.md` — LUVU 产品需求文档 (PRD)
- `ARCHITECTURE.md` — LUVU 架构
- `RELEASE_v0.15.md` — LUVU v0.15 — 个性化深化
- `RELEASE_v0.21.md` — v0.21 — 硅基生命容器重定向 + M7 创造统一 100% + 0 → 1 用户路径
- `STATUS.md` — docs/ 文档现状索引
- `M0_INVENTORY.md` — M0 现有代码盘点
- `ARCHITECTURE_MOTION_SYSTEM.md` — LUVU 动作系统长期工业化架构
- `SOUL_SCHEMA.md` — Soul Schema — LUVU 三层人格灵魂配置
- `SILICON_LIFE_VISION.md` — 硅基生命愿景 (Silicon Life Vision)
- `RELEASE_v0.18.md` — v0.18 — Phase 1: 超越 airi 的护城河 + 工程纪律
- `ROADMAP.md` — LUVU 路线图 (Roadmap)
- `RELEASE_v0.19.md` — v0.19 — 多角色生态闭环 + 工程纪律深化
- `AIRI_STUDY.md` — airi 深度研究 + LUVU 移植方案
- `RELEASE_v0.16.md` — LUVU v0.16 — Live2D 模型完整度工坊
- `SIDECAR_SETUP.md` — TTS Sidecar 安装与配置
- `RELEASE_v0.17.md` — Release v0.17 — In-Progress Notes
- `DECISIONS.md` — 架构决策记录（ADR）
- `M0_COMPLETION.md` — M0 完成报告
- `RELEASE_v0.13.md` — LUVU v0.13 — Audit Hardening + UI Polish
- `SDK_TUTORIALS_INDEX.md` — Cubism SDK 教程索引（中文版）
- `EDITOR_MANUAL_INDEX.md` — Cubism Editor Manual 索引（中文版）
- `SDK_MANUAL_INDEX.md` — Cubism SDK Manual 索引（中文版）
- `COLLAB_GUIDE.md` — Master ↔ LUVU Live2D 协作手册
- `EDITOR_TUTORIALS_INDEX.md` — Cubism Editor Tutorials 索引（中文版）
- `SAMPLES_INVENTORY.md` — Live2D 官方示例模型清单
- `0001-ts-strict-tier-3.md` — RFC 0001 — TypeScript Tier 3 严格化
- `0002-live2d-stage-multi-instance.md` — RFC 0002 — Live2DStage 多实例渲染(灵魂同框)
