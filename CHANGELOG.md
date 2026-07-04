# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 路线
- ✅ M0-M10 v0.4-v0.15
- ✅ **M11 v0.16**: Live2D 模型完整度工坊
- 🚧 **v0.17 进行中** ([RELEASE_v0.17.md](docs/RELEASE_v0.17.md))
  - ✅ 桌宠原生化（accessory + skipTransformProcessType + screen-saver level）
  - ✅ AI 原画生成（ComfyUI 5 tabs + quick prompt 模板 chip）
  - ✅ 外部 MCP server 客户端（stdio JSON-RPC，无 SDK 依赖）
  - ✅ M2 长期记忆 IPC 桥接通（main 端早已存在，preload 暴露 + dialog typed 调用）
  - ✅ 视觉融入感（drop-shadow + 漫画气泡 + scene 浓度降低）
  - ✅ AI 行为协同（TTS 8 voice + rules play_group + reactive trigger + LLM budget 6/min）
  - ✅ MCP server UI（设置面板 🔌 MCP tab — 添加/列表/展开 tools/移除）
  - ✅ MCP tools 接入 LLM tool_use 链路（register 后自动注入 registry，前缀 `mcp__<id>__<tool>`，LLM 可直接调用外部 MCP 工具）
  - ✅ RAG context 接入 chat 前置流程（send 前 800ms timeout 拉记忆 prepend system）
  - ❌ 图层切割（PSD 解析 + Cubism Editor 自动化超范围 — 推迟 v0.18）

---

## [0.16.0] — 2026-05-18 — 模型完整度工坊

跨 5 task：

### Added
- **T1** motion-factory 接真 LLM 生成（auto-fill 不再 placeholder）
- **T2** 8 标准 expression 一键模板 (Cubism 行业参数命名)
- **T3** 5 物理预设库 (短发 / 长发 / 双马尾 / 长裙 / 短裙)
- **T4** 参数命名标准化检测（基于 35 个 STANDARD_PARAM_NAMES + 启发式建议）
- **T5** 🔬 ModelHealthDashboard — 全库完整度统计 + grade 分布 + 批量补全 D 级 + 详情面板一键操作

### Output
- `electron/release/0.16.0/LUVU-0.16.0-arm64.dmg`
- `electron/release/0.16.0/LUVU-0.16.0.dmg`

完整说明 + Live2D 技术解释见 [docs/RELEASE_v0.16.md](docs/RELEASE_v0.16.md)

---

## [0.15.0] — 2026-05-18 — 个性化深化

13 个 commit 跨 5 路径：

### Added — 路径 B 个性化
- 灵魂 few-shot examples (5 模板 × 5 示范对话) — LLM 输出质量飞跃
- CharacterCreator 音色试听 + 自动头像（从立绘 thumb）
- CharacterPicker 克隆角色 ⎘ 按钮

### Added — 路径 A 沉浸感
- SceneBackground 扩到 11 个场景（+ 咖啡馆/海边/雨夜/雪景/火炉/图书馆）
- SettingsPanel 加 🌅 场景 tab
- Live2D 切换 shimmer 过渡（消除空窗硬切）
- Live2D stage 呼吸跟情绪联动（happy 1.6s / sleepy 4.0s）

### Added — 路径 E 立绘模型设计辅助
- model-learnings.ts 行业标准学习库 + 完整度评分 (A/B/C/D)
- model-auto-fill.ts 一键补全缺失 motion/expression (MVP placeholder)
- IPC: models:compute-learnings / get-learnings / evaluate / auto-fill

### Added — 路径 C 长期记忆
- per-character memory.db (sqlite + cosine search, 不装 sqlite-vec)
- memory-extractor 自动抽取 preference/event
- buildRagContext top-K RAG prepend
- daily reflection (占位，v0.16 接 LLM)
- 7 个 memory IPC handlers

### Added — 路径 D MCP 工具
- 3 内置 zero-config tools: get_current_time / list_recent_files / recall_memory
- soul-loader buildSystemPrompt 自动注入 tools 描述
- IPC: mcp:list / mcp:run

### Output
- `electron/release/0.15.0/LUVU-0.15.0-arm64.dmg`
- `electron/release/0.15.0/LUVU-0.15.0.dmg`

完整说明见 [docs/RELEASE_v0.15.md](docs/RELEASE_v0.15.md)

---

## [0.14.0] — 2026-05-18 — 通用 AI 容器

**定位重构**：从「LUVU 一个角色」→「装任何「她」的桌面 AI 容器」

### Added
- **Character 系统** — 每个 Character = (Live2D 模型 + RVC 音色 + 灵魂档案 + 可选 LLM 覆盖) 原子绑定
- **CharacterStatusBar** — 左上角浮窗显示头像 + 心情 + 亲密度（5 阶色等级）
- **CharacterPicker** — 一键切换角色，1 秒同步切立绘/音色/灵魂/对话历史
- **CharacterCreator** — 3 步向导创建新角色 + 5 内置 SoulTemplate (gentle/genki/tsundere/cool/yandere)
- **SoulEditor** — GUI 编辑 4 个灵魂 yaml + 保存热重载
- **SceneBackground** — 4 场景 (bedroom/starry/study/sakura) + 时间光照（早暖晚冷夜偏紫）
- **EmotionParticles** — 7 emotion 各自专属粒子池（happy ✨ / shy 💗 / tease 💖 等）
- **主动性升级** — 时间事件（早安/午饭/下午茶/晚安/深夜关心）+ 疲劳曲线（连续 90 min 关心）

### Changed
- 数据布局 `~/.luvu/` → `~/.luvu/chars/<id>/` per-character 隔离
- history.sqlite 现按 active character 动态切换 db handle
- soul-loader 现读 active character soul dir
- ModelLibraryPanel 默认只展开角色数前 3 IP（DOM 节点 1800→240）
- SettingsPanel 拆 RvcSettingsSection 子组件
- ControlDock 加切角色 + 编辑灵魂入口

### Migration
- 自动检测 v0.13 老 `~/.luvu/{soul,history.sqlite}` → copy 到 `chars/default/`
- 读 identity.yaml 生成 character.json
- 老数据保留作 backup

### Output
- `electron/release/0.14.0/LUVU-0.14.0-arm64.dmg` (unsigned)
- `electron/release/0.14.0/LUVU-0.14.0.dmg` (x64, unsigned)

完整说明见 [docs/RELEASE_v0.14.md](docs/RELEASE_v0.14.md)

---

## [0.13.0] — 2026-05-18 — Audit Hardening

### Added
- TypeScript Tier 3 严格化 (RFC 0001) — noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitReturns + noImplicitOverride，0 `any` / 0 `@ts-ignore`
- 首次启动引导浮窗（OnboardingDialog）— 3 步配 LLM + TTS sidecar
- 磁盘占用面板（DiskUsageDialog）+ 可清理项「释放」按钮
- electron-log 接管 console，文件写入 `~/.luvu/logs/main.log`
- single-instance lock — 第二个实例拉前现有窗口
- history.sqlite 保留策略 — pruneOlderThan(days) + VACUUM
- SettingsPanel 拆 5 tab（🧠 大脑 / 🎭 立绘 / 🎙️ 声音 / 🎚️ RVC / 💎 灵魂）
- INSTALL.md 非开发者 dmg 安装指南
- docs/STATUS.md 文档现状索引

### Changed
- 根 `package.json` 瘦身 — 删 4 个 Tauri deps + 3 个 CSS devDeps
- 默认 `llm_endpoint` / `llm_model` 改空字符串，未配置时不启动 attention loop
- `pnpm-workspace.yaml` 删根 `.` member
- README 重写 — Electron + v0.6.3 真实现状

### Removed
- `src-tauri/` (5.4 GB Rust target + 配置) — v0.1 Tauri 死代码
- `src/` (144 KB v0.1 Vue renderer 副本)
- 根 `index.html` / `vite.config.ts` / `tailwind.config.js` / `postcss.config.js`

### Output
- `electron/release/0.6.3/LUVU-0.6.3-arm64.dmg` (108 MB, unsigned)
- `electron/release/0.6.3/LUVU-0.6.3.dmg` (113 MB, x64, unsigned)

---

## [0.12.0] — 2026-05-17 — 资源商店 + 在线 repo

- 资源商店 (ResourceStorePanel) 3 tab：立绘 / 音色 / 在线
- OnlineStoreTab — 浏览 HuggingFace + GitHub 真实 repo（curl 验证 7 HF + 4 GitHub）
- 自定义 URL 安装 — installCustomZip
- system:open-external IPC

## [0.11.0] — 2026-05-17 — RVC + 流式 TTS

- F5-TTS + CosyVoice + RVC 47 voice sidecar
- 流式 TTS 双队列 + EPIPE 守卫
- RVC 9 项高级参数（f0 / index_rate / protect / filter_radius / rms_mix_rate / resample_sr）
- 设置面板 RVC tab
- backends/rvc.py: 修一连串依赖（ffmpeg-python / faiss / parselmouth / pyworld / torchcrepe）+ sys.argv 清理 + chdir + weight_root env

## [0.10.0] — 2026-05-17 — 模型质量工业链

- model-describer / model-dedup / model-healer / model-scanner 完整闭环
- 1389 模型缩略图 PIXI off-screen 渲染 + thumb-store 持久化
- character-enricher LLM 给 ~1400 角色补中文名 + 1 行简介
- ip-knowledge 已知 IP 列表
- ModelLibraryPanel: viewMode (all / favorites / recent) + 未识别 IP 归「📦 其他」桶

## [0.9.0] — 2026-05-16 — 模型库改造

- model-preferences / model-favorites 持久化（~/.luvu/）
- live2d-renderer: idle motion auto-pick + auto-fit + hideBackgroundParts

## [0.8.0] — 2026-05-16 — 主体性 AI

- Phase A: PerceptionBus 主体性架构基建
- Phase B: 视觉感知（截屏 + LM Studio vision LLM 分析）
- Phase C+D+E: Attention Scheduler + Planner + Plan 执行
- v0.8.1: LLM 健康自检 IPC + 独立 CLI 脚本 + thinking 模型 reasoning_content + 大 max_tokens
- v0.8.2: 视觉三件套从 RuntimeConfig 透传

## [0.7.0] — 2026-05-16 — 动作工业链

- v0.7.0: 模型市场 — 拖放/ZIP/URL 一键安装
- v0.7.1: AI 动作工坊 MVP — Claude 学已有模型风格生成 motion3.json
- v0.7.2: ParameterIntrospector 语义识别基建
- v0.7.3: MotionLibrary + MotionEngine
- v0.7.4: 完整工业链 — Phase 1.D + 2 + 4 + MotionPlayer + UI
- v0.7.5: LM Studio / Qwen MoE jinja template 兼容

## [0.6.0] — 2026-05-15 — Electron 重生 ★ 五大能力域

- 从 Tauri 转 Electron + 吸收 airi 成熟做法
- 五大能力域结构：avatar / brain / hands / presence / attention（infra 横切）
- v0.6.0-v0.6.11: Live2D race condition / 切模型 cubism2→cubism4 自动回退 /
  含 # 或 ? 文件名 Texture loading / 黑屏占位模型 3 层防御 / preload IPC deepPlain 等
- v0.6.1: 设置按钮 setIgnoreMouseEvents 默认 false（穿透卡死修复）

---

## [0.5.0] — 2026-05-16 — M1 能聊

### 多 LLM Provider + 多文件灵魂加载

**LLM Provider 抽象**：
- `brain/providers/mod.rs::LlmProvider` 统一 trait
- `anthropic.rs` — Claude Messages API 流式（带 tool_use 预留位）
- `ollama.rs` — Ollama 原生 `/api/chat` NDJSON
- `openai_compat.rs` — 重命名整合（vLLM / LM Studio / 旧 endpoint）
- `build_provider(name, endpoint, api_key)` 工厂：菜单切换 provider 即生效

**SoulConfig 多文件 loader**：
- `load_from_path(&Path)` 智能判断：path 是目录 → 多文件，是单文件 → 旧 schema
- `load_from_soul_dir(&Path)` 解析 `soul/{identity,personality,learned_traits}.yaml` 合成 SoulConfig
- `locate_default_soul()` 优先 `soul/` 目录，回退 `default.yaml`（兼容旧版）
- 未编辑 yaml 字段（emotions / behavior / tts）用 sensible defaults

**RuntimeConfig 加 llm_provider 字段**：
- `"anthropic" | "ollama" | "openai_compat"`
- 菜单 → LLM Tab → Provider 下拉

**设置面板大幅简化**：
- 砍掉过期字段（live2d_* / motion_* / extra_model_dirs）
- 模型 Tab 改为只读展示（编辑请编辑 soul/identity.yaml）+ 搜索路径管理
- 自主散步 slider 砍掉（M5 重做）
- 添加 LLM Provider 下拉

### 砍代码
- `RuntimeConfig` 中 9 个 v0.3 字段（live2d_* / motion_* / extra_model_dirs）
- `extra_model_dirs` 独立 JSON 文件（`~/Library/Application Support/LUVU/extra_model_dirs.json`）
- 旧 `OpenAiCompatProvider` 直接 import → 全部走 `build_provider`

### 编译验证
- ✅ pnpm typecheck 无错误
- ✅ cargo check 无错误（1 warning，已 #[allow]）
- ✅ pnpm build 成功

---

## [0.4.0] — 2026-05-16 — Constitutional Rewrite ★ M0

### 项目宪法落地：五大能力域

按 ARCHITECTURE.md 重组整个项目。从"通用桌宠 SDK"重定向为
**"常驻桌面的自我进化型 AI 智能体"**：身体（Live2D）+ 大脑（LLM）+ **手脚（MCP 工具调用）** + 灵魂（人格 + 记忆）。

```
avatar/   形象表现（Live2D + 窗口）
brain/    智能核心（LLM + 记忆 + persona）
hands/    工具执行（MCP，M4 启用，目录占位）
presence/ 陪伴交互（TTS / STT / 主动行为）
infra/    基础设施（config / eventbus / system）
```

**模块间通信只走事件总线**（mitt 前端 + Tauri emit 后端）。  
**禁止跨域 import 内部函数**。

### 砍代码（8 项）
- `alpha/mask.ts` — 128×96 像素穿透 mask
- `core/motion.rs` + `commands/motion.rs` — 散步系统（M5 重做）
- `behavior/persona.ts` — 10 状态 FSM
- `behavior/autoComment.ts` — 主动开口（M5 重做）
- `behavior/idle.ts` — 8 种 idle 动作（与 persona 重叠）
- `emotion/fsm.ts` — 关键词触发表（LLM JSON emotion 取代）
- `alpha/sampler.ts::hitTestAlpha` — 拖动逻辑保留，hit-test 砍
- RuntimeConfig 中 `live2d_*` / `motion_*` / `extra_model_dirs` 字段（迁到 soul）

### 灵魂 YAML 拆分
单文件 `default.yaml` 拆为 4 份：
- `soul/identity.yaml` — 身份 + avatar 模型路径 + 搜索路径
- `soul/personality.yaml` — 三层人格 prompt 模板
- `soul/core_memories.yaml` — 永久注入的核心记忆
- `soul/learned_traits.yaml` — 系统自动写入

### 新增
- `src/infra/eventbus.ts` — mitt + EventMap（完整事件类型定义）
- `src-tauri/src/infra/eventbus.rs` — Rust 端事件名常量
- `hands/` 目录占位 + README
- 5 个域 README（明确边界规范）
- 4 份文档：`ARCHITECTURE.md` / `ROADMAP.md` / `DECISIONS.md` / `M0_INVENTORY.md` / `M0_COMPLETION.md`

### 编译验证
- ✅ `pnpm typecheck` — 0 错误
- ✅ `cargo check` — 0 错误
- ✅ `pnpm build` — 成功

### 自审计通过
- 跨域 `crate::core::` / `crate::commands::` 残留：0
- 前端 `@/{alpha,behavior,live2d,components,stores,emotion,audio}` 残留：0
- RuntimeConfig 砍掉 9 个迁出字段，新增 0 字段

历史 v0.1 - v0.3 改动保留在 git history。**v0.4.0 是干净起点**。

---

## [0.3.2] — 2026-05-16 — Stability Pass

### 关键 bug 修复（实测发现的 5 个问题）

**1. webview 进程崩溃 → 看不到立绘**
- 根因：Cubism 2 dylanNew CDN 异步加载与 WKWebView 不兼容
- 修复：移除 Cubism 2 CDN；把 Cubism 4 core JS 本地化到 `public/live2dcubismcore.min.js`（避免任何 CDN 嫌疑）
- Cubism 2 模型支持留 v0.4 用本地版重做

**2. ConfigDto 部分字段无 #[serde(default)] → config.json 缺字段时全部加载失败**
- 给 `ConfigDto` 加 `#[serde(default)]` (struct 级别) + 手动 impl Default 委托给 RuntimeConfig::default()
- 之后任意字段缺失都会回落到合理默认，不会让前端 store 加载失败

**3. 模型抽动**
- 根因：persona FSM 用 `setInterval(1000ms)` 跑 walk/run/sit 的 sin 波动 → 按 1Hz 采样的正弦看着像抽搐
- 修复：拆分为决策 1Hz + 动画 60Hz（RAF）。决策仍每秒一次，但 idle offset 的 sin 波在每帧更新

**4. 眨眼频率过快**
- scheduleNext 没检查 stopped flag → stop 后旧 loop 还在排队
- 加 stopped 检查 + 间隔从 2.5-5.5s 放慢到 3.5-7s（更接近真实人眨眼频率）

**5. 设置按钮打不开**
- alpha mask 128×96 分辨率覆盖不了 32×32 的齿轮按钮 → 鼠标穿透
- 暂时禁用 alpha mask 推送（`startMaskPush()` 关闭），mouse tracker 退化为纯 rect 穿透（与 v0.2.3 一致）
- 像素穿透留 v0.4 用更高分辨率 mask 或 DOM hit-region 重做

### 体验改进
- 自主散步首次延迟从 60s 缩到 **20s**（启动后更快看到效果）
- 菜单 → 行为 → **"立即散步一次"** 按钮（不等间隔，立刻验证移动）

---

## [0.3.1] — 2026-05-15 — Mass Model Library

### 大型模型库支持（~3000 个模型）

**Cubism 2 兼容**：
- HTML 同时引入 `live2d.min.js` + `live2dcubismcore.min.js`
- renderer 改用 pixi-live2d-display 默认入口，自动按文件后缀选 SDK
- 扫描器同时识别 `*.model3.json` (Cubism 4) 和 `model.json` (Cubism 2)
- 模型列表显示 Cubism 2 / Cubism 4 badge

**自定义模型搜索路径**：
- `RuntimeConfig.extra_model_dirs: Vec<String>` 持久化到 config.json
- 命令：models_add_search_path / models_remove_search_path / models_list_search_paths
- 菜单 → 外观/模型 → "+ 添加搜索路径" 按钮调 Tauri dialog 选目录
- vite middleware 启动时读 config.json 把额外路径加入 serve 根（新增路径需重启生效）

**扫描器优化（避免 3000 模型卡死）**：
- 项目根：深度 1 + 仅"看起来像 Live2D"的目录
- 外部库：深度 5 递归 + 找到模型就不再深入子目录
- 上限 4000 个结果
- 跳过 node_modules/.venv/.git 等

**模型列表 UI 增强**：
- 显示「父目录 · 模型名」
- Cubism 2 棕色 badge，Cubism 4 红色
- 外部模型蓝色"外部" badge
- 顶部显示总数

---

## [0.3.0] — 2026-05-15 — Living Companion

### 桌宠化：LUVU 真的会在桌面散步了

**核心理念**：从"固定窗口里的 Live2D 立绘"升级为"在桌面上有意图地活动的桌宠"。

**默认窗口尺寸缩小**：320×480（原 480×720），占屏更小

**Rust MotionController（窗口自主移动后台 loop）**：
- `core/motion.rs` 16ms tick + cubic ease in-out 平滑插值
- 拖动时暂停 + emit `motion::tick` / `motion::end`
- 命令：`motion_status / motion_set_target / motion_cancel / motion_set_dragging / motion_screen_size`

**Persona 状态机 + 意图引擎**（`src/behavior/persona.ts`）：
- 6 状态：stand / walk / run / sit / sleep / peek
- 心情维度：mood / energy / attention / curiosity（每秒 tick）
- 时段感知：深夜 energy↓，睡觉 energy↑
- 鼠标交互：mouse::global 驱动 attention
- 决策示例：
  - energy<25 + 夜里 → sleep
  - 鼠标在窗口里 + attention>60 → peek
  - 用户 2 分钟没动鼠标 → walk 主动靠近
  - mood>80 + 移动中 → run

**Live2D 状态动作映射**：
- walk：身体周期摆 + 头身上下波动
- run：摆幅×2 + 头前倾
- sit：身体下沉
- sleep：闭眼 + 头微低 + 呼吸放大
- peek：身体微前倾 + 害羞脸红

**拖动改造**：
- 拖动通知 motion 暂停 + 取消正在进行的自主移动
- 释放时解锁

**菜单 → 行为 tab 扩展**：
- 自主移动开关 + 间隔下限/上限 slider（30s ~ 60min）+ 速度 (0.3-2.5x)
- 默认间隔 90-300s（每 2-5 分钟换位置）

### 新增 Rust 命令
- `motion_status / motion_set_target / motion_cancel / motion_set_dragging / motion_screen_size`

### 新增前端模块
- `src/behavior/persona.ts` — FSM + 意图引擎 + 配置热重载

---

## [0.2.3] — 2026-05-15

### 修复（v0.2.2 测试发现的两个交互 bug）

**1. 立绘无法拖动**
- 根因：Tauri 2 `start_dragging` 通过 IPC 调用时，原始 NSEvent 已经过期 → macOS NSWindow.performDrag 失效
- 修复：放弃 `start_dragging`，改为前端 mousedown 时记录 screen 起点 → mousemove 持续 invoke `window_set_position`
- 新增 Rust 命令 `window_set_position(x, y)` 和 `window_get_position()`
- 新增 capability `core:window:allow-set-position` / `core:window:allow-outer-position`

**2. 点击设置按钮无反应**
- 根因：alpha mask 推送后，UI chrome（齿轮按钮、设置面板、输入框）在 mask 里 alpha=0 → mask 误判为穿透区 → 点击事件被 ignore
- 修复：mask 推送前，从 DOM 收集 `[data-uichrome="1"]` / `input` / `textarea` / `button` / `select` 元素的 bbox，叠加到 mask 上标记为 on-pixel
- 这样 mouse tracker 同时认 立绘 alpha 区 + UI 元素 区 为不穿透

### 实测验证
- mouse tracker 切换日志显示 rect / mask 判定正常
- HTTP 端点 `/live2d/HuTao-Live2D/*.*` 全部 200
- 进程稳定运行无 panic/ERROR

---

## [0.2.2] — 2026-05-15

### 一次连击：Voice Clone + 像素穿透 + STT（A+A 路线）

**CosyVoice 2 voice clone（情感增强 TTS）**
- `sidecar/qwen-tts-server/backends/cosyvoice.py` 完整实装
- 用 `inference_instruct2`：emotion → 中文指令 token 控制语气（happy/shy/angry/sad/...）
- 注册的 sample 类型 voice 自动走 cosyvoice 推理
- **一个基础样本可派生所有情绪**（不需要每个情绪都单独录）

**一键安装脚本**
- `sidecar/install.sh`：venv + pip + clone CosyVoice + 下载 1.1GB 模型
- 国内镜像 fallback（huggingface 失败 → modelscope）
- `[STEP]/[OK]/[FAIL]` 进度行可被前端解析
- `sidecar_install_status` / `sidecar_install_run` Rust 命令
- `--minimal` 模式跳过 CosyVoice

**像素级穿透回归**
- 前端 `src/alpha/mask.ts`：Live2D canvas 每 200ms readPixels → 128×96 1-bit mask（1.5KB）→ invoke 推 Rust
- `window::AlphaMask::hit_test_unit(u,v)` + `SharedMask` Arc/RwLock
- Mouse tracker 用 rect + mask 双重判断
- 哈希变化才推（立绘静止时 IPC 接近零）

**STT：cpal 录音 + whisper + F8**
- `core/stt.rs`：cpal 跨平台录音 → hound 写 WAV
- Sidecar `/v1/audio/transcribe`：faster-whisper 默认 small
- 全局快捷键 **F8** toggle（按一次开始 / 再按一次停止+转写）
- 转写后 emit → 前端 dialog.send 自动触发对话
- 输入栏麦克风按钮：红色脉冲=录音中，黄色=识别中

### 新增依赖
- Rust：`cpal@0.15` `hound@3` `tauri-plugin-global-shortcut@2`；`reqwest` 加 `multipart`
- Python：`faster-whisper>=1.0`；CosyVoice 由 install.sh 处理

### 新增命令
- `sidecar_install_status` / `sidecar_install_run`
- `window_set_alpha_mask`
- `stt_status` / `stt_toggle`

### 新增前端模块
- `src/alpha/mask.ts` — alpha buffer 推送
- `src/stores/stt.ts` — STT 事件订阅 + 自动 dispatch
- `src/components/InputBar.vue` 增麦克风按钮

---

## [0.2.1] — 2026-05-15

### 新增：TTS Sidecar 完整实装 + 多 backend

**Python sidecar（之前是 stub）**：
- 真实 FastAPI 服务，支持 4 个 backend：
  - `edge_tts`（默认）：微软 Edge TTS，中文 4 种女声（晓晓/晓伊/云夏/晓萌），质量稳定无需下载
  - `openai_compat`：转发到任意 OpenAI 兼容 `/v1/audio/speech` 端点
  - `qwen3_tts` / `cosyvoice` / `gpt_sovits`：预留槽位（v0.2.2 启用真实 voice clone）
- voice 注册表持久化到 `~/.luvu/voice_clones/registry.json`
- `/v1/audio/clone` 单样本注册 + `/v1/audio/register-batch` 批量扫描子目录

**Rust 端 sidecar 自启动管理**：
- `core/sidecar.rs::SidecarManager` — spawn / kill / health probe
- 启动时探测端口；外部已有进程 → External 复用；否则 spawn Python 子进程
- spawn 失败 / probe 不通 → 降级 macos_say
- 退出时自动清理 child process
- 命令：`sidecar_status` / `sidecar_start` / `sidecar_stop` / `tts_list_voices` / `tts_register_voices_dir` / `tts_example_voice_dir`

**TTS provider 失败降级**：
- sidecar 失败 → 自动 fallback macos_say，不打断对话

**菜单 TTS tab 增强**：
- Sidecar 状态 badge（External / Spawned / Failed）+ 启停按钮
- 一键从 `example_voice/` 注册 4 个情绪音色
- 情绪 → voice 路由表（7 种情绪 × 下拉选择已注册音色）

### 新增：长期向量记忆基础

- `core/embed.rs`：OpenAI-compat `/v1/embeddings` 客户端 + cosine 相似度 + blob 编解码
- `memory.recall_similar(query_emb, k)`：全表扫描 cosine，返回 top-K（量小够用）
- `chat_send` 流程：发起前若配置了 embedding endpoint，embed 当前 user message → 召回 top-3 → 注入 system prompt 的「过往记忆摘要」
- 记忆被召回时更新 `last_recall` + `recall_count`

### 新增：记忆凝练

- `commands/distill.rs::memory_distill(look_back?)`
- 调 LLM 让它输出 JSON 数组的事实/事件/偏好/观察
- 每条 fact 调 embedding 后写入 `memories` 表
- **自动 tick**：`behavior/distillTick.ts` 每 30 分钟一次（首次延迟 5 分钟）
- **手动按钮**：设置 → 系统 → "凝练为长期记忆"

### 菜单：LLM tab 加 Embedding 子区

- Embedding Endpoint 字段（留空则不启用记忆召回）
- Embedding Model 字段（默认 text-embedding-3-small，可改 bge-m3 等）

### RuntimeConfig 扩展

- `emotion_voice_map: HashMap<String, String>` — 持久化情绪→voice 路由
- `embedding_endpoint` / `embedding_model`

---

## [0.2.0] — 2026-05-15

### 重大重构：Renderer 参数合成（修复"动作不流畅"根因）

**根因**：focus / emotion / idle / blink 各自直接 `setParameterValueById`，互相覆盖。
**修复**：`LUVURenderer` 统一管理 4 个参数源，每帧合成一次：
```
final = (override 在窗口内 ? value : focus + emotion + idle)
```
- focus 60fps 指数缓动到 target（约 200ms 时间常数）
- emotion live2d 表用 4/秒缓动到目标
- idle action 写 `setIdleOffset` 偏移，结束自动清掉
- 眨眼 / 嘴型同步用 `overrideParam` 短窗强制覆盖
- `wroteKeys` 跟踪上一帧写过的 key，本帧无源时主动回 0 避免残留漂移

### 菜单完整重构（5 Tab）
- **LLM**：endpoint / model / api key + 测试连通
- **外观 / 模型**：列出本机所有 Live2D 模型（项目根 + ~/.luvu/models/），点击切换；缩放 / 偏移 slider 实时联动
- **行为**：5 个 slider 调 idle / autoComment 间隔、情绪衰减、反差概率
- **语音**：TTS provider + sidecar URL
- **系统**：打开数据 / 模型目录、清空对话、版本号

### 多模型支持（不再固定胡桃）
- Rust `models_scan` 扫描项目根 + `~/.luvu/models/`
- vite middleware 改为 `/live2d/<model_dir>/<file>` 路由
- 生产 build 自动复制所有模型到 `dist/live2d/`
- 配置变化 → Live2DStage watch → 自动 reload renderer

### LLM JSON 协议
- system prompt 要求 LLM 输出 `{"text":..., "emotion":..., "intensity":...}`
- Rust `parse_reply` 容错（markdown fence、首尾 `{}` 定位、降级）
- 前端流式时用 `extractStreamingText` 从 raw 提取 text（打字机效果保留）
- 情绪不再依赖前端关键词 FSM

### 行为参数热重载
- idle 间隔 / autoComment 间隔 / 情绪衰减 / scale / offset 改了立刻生效
- behavior 模块 `watch` config 字段变化重启 scheduler

### 新增 Rust 命令
- `models_scan` / `system_clear_history` / `system_reveal_data_dir` / `system_reveal_models_dir` / `system_version`

---

## [0.1.3] — 2026-05-15

### 修复（实测发现的两个交互降级）

**1. 视线跟随只在窗口内有效**
- 根因：`focus.ts` 用 `window.mousemove`，与穿透同一个 bug——窗口外 webview 收不到事件，视线卡在最后位置
- 修复：Rust mouse tracker 现在每 80ms `emit("mouse::global", payload)`，前端监听该事件驱动视线
- 副带改进：renderer.setFocus 现在加 clamp + 联动 ParamAngleZ / ParamBodyAngleX，视线跟随更生动
- 现效果：鼠标在屏幕任何位置，LUVU 的视线都跟着转

**2. 自主行为太少**
- 原仅有 eyeBlink + 程序化呼吸，立绘看起来"愣着"
- 新增 `src/behavior/idle.ts`：每 8-15s 随机触发一个 idle 动作（轻歪头/看远/撇嘴/微笑/脸红/深呼吸 共 8 种）
- 新增 `src/behavior/emotionTick.ts`：每 30s tick 一次情绪衰减，跌破阈值时自动回归 neutral
- 新增 `src/behavior/autoComment.ts`：按 `behavior.auto_comment_interval_sec` 周期 ±25% 抖动触发主动开口
- 新增 Rust `chat_send_proactive` command：autoComment 走单独路径，hint 注入 system prompt，**不污染对话历史**
- 时段感知 prompt：根据当前时间（早晨/正午/午后/傍晚/深夜）拼 prompt，让主动话题贴合时段

### 新增
- `src/behavior/{idle,autoComment,emotionTick}.ts`
- `chat_send_proactive` Tauri command
- `dialog.sendProactive()` store action
- `mouse::global` 全局鼠标位置事件（80ms 节流）
- `GlobalMouseEvent` payload 类型（含物理坐标 + 窗口 rect + scale_factor）

---

## [0.1.2] — 2026-05-15

### 修复（实测发现的致命交互 bug）

**所有 UI 失效**：点击设置按钮、立绘拖动、输入框输入全部失败。

**根因**：原方案在前端用 mousemove 监听切换 `ignore_cursor_events`。但当 `ignore=true`（穿透）后，webview 完全收不到任何鼠标事件，导致前端**永远无法把 ignore 切回 false**。一旦穿透就锁死。

**修复**：把穿透判定从前端 mousemove 改为 **Rust 后台线程轮询全局鼠标位置**。
- 新增 `src-tauri/src/window.rs::spawn_mouse_tracker`
- 用 `device_query@2` crate 每 40ms 拿全局鼠标坐标
- 与 Tauri 的 `outer_position` / `outer_size` 比对（Retina 物理像素一致，已实测 DPR=2 数值匹配）
- 鼠标在窗口外 → `set_ignore_cursor_events(true)`
- 鼠标在窗口内 → `set_ignore_cursor_events(false)`，webview 立刻可交互

**副作用**：v0.1.2 暂时**退化为矩形穿透**（窗口内透明区不再穿透）。像素级穿透留到 v0.2，那时需要把前端 alpha buffer 通过 event 同步到 Rust 端。

前端 `alpha/sampler.ts` 现在只保留 mousedown→drag 逻辑，UI 元素白名单（input/button/[data-uichrome]）保护设置面板和输入框。

实测确认日志：
```
mouse=(1320,621) window=(160,160,1120,1600) inside=false → ignore=true
```
device_query 在 macOS Retina 返回物理像素，与 Tauri 一致。

---

## [0.1.1] — 2026-05-15

### 修复（首次实测发现的真实问题）
- **Live2D 加载失败 Network error**：根因是 Tauri asset 协议解析含空格的相对路径会失败。改走 vite middleware `/live2d/*`（dev）+ closeBundle 复制到 dist/（prod），跨环境一致。
- **鼠标无法拖动窗口**：alpha sampler 加 mousedown 监听，命中立绘时 invoke `window_start_drag` 启动 native 拖窗。
- **缺设置界面**：新增右上角齿轮 → SettingsPanel.vue，包含 LLM endpoint/model/api key、TTS provider/sidecar URL，带"测试连通"按钮，配置持久化到 `config.json`。

### 稳定性
- LLM `connect_timeout = 5s`（避免 endpoint 不可达时卡 120s）
- Live2D 加载失败显示中文错误卡片（不再静默 console.error）
- `chat::token`/`chat::end` listen 提前到 store 创建期，避免事件 race
- TTS 自动播放 + 嘴型同步串联：`chat::end → speakWithLipSync → AnalyserNode RMS → ParamMouthOpenY`
- 移除冗余 import 与未使用变量

### 新增
- `window_start_drag` Tauri command + `core:window:allow-start-dragging` capability
- `config_load` / `config_save` / `config_test_llm` Tauri command
- `src/audio/speaker.ts` TTS 播放 + lipSync 协调模块
- `src/components/SettingsPanel.vue`
- `src/stores/config.ts`

---

## [0.1.0] — 2026-05-15

### 新增（Foundation 基础框架）
- **Tauri 2.x + Vue 3 + TypeScript** 跨平台项目骨架
- **透明置顶无边框窗口** + 系统托盘（显隐 / 重载灵魂 / 退出）
- **像素级点击穿透**（前端 alpha 采样 + Tauri `set_ignore_cursor_events`）
- **Live2D 渲染**（PixiJS + pixi-live2d-display + Cubism 4 runtime）
  - 自动眨眼（程序化，不依赖 model3.json EyeBlink 组）
  - 程序化呼吸
  - 视线跟随鼠标
  - 参数嗅探（开发模式 console 打印）
- **三层人格 system prompt 生成器**
  - Layer 1：病娇灵魂底层
  - Layer 2：胡桃俏皮表层
  - Layer 3：反差变量（每轮 15% 触发）
- **灵魂热重载**（notify watcher 监听 `default.yaml`）
- **OpenAI-compat LLM 适配层** + SSE 流式 token 推送
- **6 情绪状态机** + 情绪→Live2D 参数缓动映射
- **SQLite 短期记忆**（消息流 + 长期记忆 schema 预留 + 观察事件流）
- **对话气泡 UI** + 输入栏（打字机效果）
- **TTS 适配层**：macOS `say` fallback + Qwen3-TTS Python sidecar 骨架
- **嘴型同步**（Web Audio AnalyserNode RMS → ParamMouthOpenY）
- **设计文档**：PRD / ARCHITECTURE / SOUL_SCHEMA / DECISIONS

### 引入的开源依赖
- 前端：`vue@3.5`, `pinia@2.3`, `pixi.js@6.5`, `pixi-live2d-display@0.4`, `@tauri-apps/api@2.11`
- 后端：`tauri@2.11`, `reqwest@0.12`, `rusqlite@0.32`（bundled）, `tokio@1`, `serde-yaml@0.9`, `notify@6`
- Sidecar：`fastapi@0.115`, `uvicorn@0.32`（v0.2 启用 torch/transformers）

### 已知局限（v0.1.0 明确不做）
- Windows / Linux 完整适配（结构预留，实测延后到 v0.5）
- Vision LLM / 屏幕感知（v0.3）
- RPA 自动操作（v0.4）
- Voice clone 实际推理（v0.2，目前 sidecar 返回静音占位）
- 表情/动作 motion 文件（永久走程序化驱动）

[Unreleased]: https://github.com/zhwangsir/LUVU/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/zhwangsir/LUVU/releases/tag/v0.5.0
[0.4.0]: https://github.com/zhwangsir/LUVU/releases/tag/v0.4.0
[0.3.2]: https://github.com/zhwangsir/LUVU/releases/tag/v0.3.2
[0.3.1]: https://github.com/zhwangsir/LUVU/releases/tag/v0.3.1
[0.3.0]: https://github.com/zhwangsir/LUVU/releases/tag/v0.3.0
[0.2.3]: https://github.com/zhwangsir/LUVU/releases/tag/v0.2.3
[0.2.2]: https://github.com/zhwangsir/LUVU/releases/tag/v0.2.2
[0.2.1]: https://github.com/zhwangsir/LUVU/releases/tag/v0.2.1
[0.2.0]: https://github.com/zhwangsir/LUVU/releases/tag/v0.2.0
[0.1.3]: https://github.com/zhwangsir/LUVU/releases/tag/v0.1.3
[0.1.2]: https://github.com/zhwangsir/LUVU/releases/tag/v0.1.2
[0.1.1]: https://github.com/zhwangsir/LUVU/releases/tag/v0.1.1
[0.1.0]: https://github.com/zhwangsir/LUVU/releases/tag/v0.1.0
