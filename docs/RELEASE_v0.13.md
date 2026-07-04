# LUVU v0.13 — Audit Hardening + UI Polish

> 发布日期：2026-05-18
> Tag: v0.13.0

跨 50 个 commit 的硬核 milestone：完整安全 audit + 测试基线 + 全 UI/UX 升级。

---

## 🎯 这个版本是什么

LUVU 是一款常驻 **macOS / Windows / Linux** 桌面的 AI 伴侣。她以 Live2D 立绘为身体载体，承载一份你为她精心定义的灵魂档案（性格、语气、记忆），通过本地 LLM 实现自然对话，并具备**情绪系统**、**长期记忆**、**主体性感知**、**桌面动作**等能力。

**核心区别**：
- 区别于普通桌宠 → 她不只是看着，**她能做事 + 会主动**
- 区别于普通 AI 助手 → 她不只在对话框里，**她在你桌面上 + 持续感知**

---

## ✨ 五大能力域

| 域 | 当前能力 |
|----|----------|
| 🎭 **avatar** 身体 | 透明置顶 + 像素级穿透 + Live2D 立绘 (支持 1389+ 模型库) + 自动 idle motion + 拟人吸气/眨眼/视线 |
| 🧠 **brain** 思考 | 多 LLM provider (Ollama / LM Studio / vLLM / OpenAI-compat / Anthropic) + 多灵魂文件合并 + SQLite 短期记忆 + 三层人格 system prompt |
| 🎙️ **presence** 声音 | RVC 47+ 已训练音色 + Edge-TTS / CosyVoice / F5-TTS sidecar + 流式 TTS 双队列 + 嘴型同步 |
| 🤖 **hands** 行动 | 动作工坊 (LLM 生成 Live2D motion3) + Plan executor + 桌面自动化基建 |
| 👀 **attention** 主体 | PerceptionBus (Mouse/Idle/Window/Time/Vision sensors) + Planner LLM + proactive 触发循环 |

---

## 📦 v0.13 完整变更

### 🔒 安全（4 agent audit）

| 漏洞 | 级别 | 修复 |
|------|------|------|
| `voiceId` 命令注入到 PowerShell + scp | **CRITICAL** | 白名单 `[a-zA-Z0-9_-]` + 拒 `../` `/` |
| `cleanPath` 路径未归一化绕过白名单 | **CRITICAL** | `path.resolve` 后再校验白名单 |
| `webSecurity: false` SOP 失效 | **CRITICAL** | 3 道 defense-in-depth：CSP header + setWindowOpenHandler + will-navigate |
| `installCustomZip` SSRF | **HIGH** | 拒 localhost/127.x/10.x/192.168/172.16-31/169.254 私网 IP |
| 5 处 `yaml.load` 允许 JS 标签注入 | **HIGH** | 改 `JSON_SCHEMA`（仅 null/bool/int/float/str/seq/map） |
| `osascript` 用 `exec` 拼接字符串 | **MEDIUM** | 改 `execFile(cmd, [args])` 数组形式 |
| Log 文件明文敏感字段 | **MEDIUM** | electron-log hook 自动 redact 6 类（api_key/Bearer/sk-*） |

### 🚀 性能

| 优化 | 改善 |
|------|------|
| `scanModels()` 加 mtime 增量缓存 | **启动 ~3s → ~200ms** (1389 模型) |
| `loadCachedThumbs` 700+ 并发 IPC → 1 batch IPC | **面板打开 < 200ms** |
| `model-scan-cache.json` 跨重启持久化 | 冷启动也快 |

### 🏛️ 架构

- **ipc/system.ts god-file 拆分**：535 行 → 124 行（-77%）
  剥离到 `ipc/tts.ts` / `ipc/thumbs.ts` / `ipc/models.ts` / `ipc/online.ts`
- **跨域硬依赖去耦**：`avatar/plan-executor` 改用 `bus 'brain:inject-utterance'` 事件
- **TypeScript Tier 3 严格化** (RFC 0001)：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitReturns` + `noImplicitOverride` — **0 `any` / 0 `@ts-ignore`**
- **5.4 GB 死代码删除**：`src-tauri/` (v0.1 Rust 残留) + 旧 `src/` + 4 个根 Tauri 配置文件

### ✅ 测试基线（从 0 起）

```bash
pnpm test              # 79 个单元测试，6 个文件
pnpm test:watch        # 监听模式
pnpm test:coverage     # v8 覆盖率
```

覆盖：
- `motion-factory/parser.test.ts` (7) — motion3.json 编解码
- `motion-factory/scorer.test.ts` (12) — 6 维度评分
- `motion-factory/validator.test.ts` (7) — 时长/loop/density 验证
- `logger.test.ts` (15) — redactSensitive 敏感字段
- `brain/parser.test.ts` (24) — parseReply + parsePartialText
- `format-utils.test.ts` (14) — formatBytes + formatDuration

### 🎨 UI/UX 升级

#### 视觉系统
- **暗色主题完整支持** — `prefers-color-scheme: dark` 全 token 自动覆盖
- **多层次阴影**（1px outline + diffused）
- **自定义滚动条** — 不打扰但可见
- **font-feature-settings 'tnum'** — 等高数字字符

#### 微交互
- 全局 `button:active` 物理回弹 scale(0.94) + ease-out-back
- DialogBubble **3 点 typing 指示器** 替代单点 pulse（IM 经典）
- 表情中文图标 😊 开心 / 😳 害羞 / 😈 撒娇 替代英文 emotion 标签
- ResourceStoreStack + SettingsPanel tab **底部横条 active 指示器**
- ContextMenu hover **微右滑** + icon 变 accent
- InputBar `:focus-within` ring + 进出 scale 动画
- Toast **圆点彩色 icon** + 倒计时进度条
- ControlDock **出现动画** scale + 4 组按钮分隔
- drop-overlay **box pulse + 📦 bounce** + backdrop blur
- 启动 **♡ 心型脉动** "召唤 LUVU 中…"

#### 玻璃质感
- 所有 dialog `backdrop-filter: blur(20px) saturate(1.4)`
- DialogBubble 表情色调暗色模式 emotionTintDark 表

### 🎁 用户体验

- **首次启动引导浮窗**（OnboardingDialog）— 3 步配 LLM + TTS sidecar
- **磁盘占用面板**（DiskUsageDialog）+ 可释放清理
- **single-instance lock** — 第二个实例拉前现有窗口
- **history.sqlite 保留策略** — `pruneOlderThan(days)` + VACUUM
- **SettingsPanel 拆 5 tab** — 🧠 大脑 / 🎭 立绘 / 🎙️ 声音 / 🎚️ RVC / 💎 灵魂
- **electron-log** 统一日志，文件写入 `~/.luvu/logs/main.log`（10 MB 轮转）
- **LLM 未配置时不启动 attention loop** — 避免 60s 一次错误

### 📚 文档

| 文档 | 状态 |
|------|------|
| [README.md](../README.md) | 全新 v0.13 现状（Electron + 真路线图） |
| [INSTALL.md](../INSTALL.md) | 非开发者 dmg 安装指南 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 全新架构 — 5 大能力域 + IPC + 安全模型 + 数据布局 |
| [STATUS.md](STATUS.md) | 9 个 docs 按时效分级 🟢/🟡/⚪/🔴 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 跟 Electron + TS Tier 3 现状对齐 |
| [CHANGELOG.md](../CHANGELOG.md) | 补全 v0.6-v0.13 entries |
| [RFC 0001](rfcs/0001-ts-strict-tier-3.md) | TypeScript Tier 3 严格化决策 |

---

## 📥 下载

### macOS（unsigned dmg）

| 文件 | 适用 | 大小 |
|------|------|------|
| `LUVU-0.6.3-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) | 108 MB |
| `LUVU-0.6.3.dmg` | Intel Mac | 113 MB |

**首次打开必读**：unsigned 状态下双击会被 Gatekeeper 拦。解决：
1. 把 LUVU 拖到 Applications
2. **右键点 LUVU → 选「打开」**（不是双击！）
3. 弹出「来自身份不明开发者」对话框 → 点「打开」

如果还提示「已损坏」：
```bash
xattr -cr /Applications/LUVU.app
```

详见 [INSTALL.md](../INSTALL.md)。

### Windows / Linux

包尚未实测过。理论上：
```bash
pnpm package:win    # → LUVU Setup 0.6.3.exe (nsis installer)
pnpm package:linux  # → LUVU-0.6.3.AppImage
```

---

## 🛠️ 从源码运行

```bash
git clone https://github.com/zhwangsir/LUVU.git
cd LUVU
pnpm install
pnpm dev          # electron-vite dev server + 透明窗口
```

前置：Node ≥ 20 + pnpm ≥ 9。TTS sidecar 可选（Python ≥ 3.10）。

详见 [README.md 的「快速开始」](../README.md#-快速开始)。

---

## 🚦 首次使用必做 3 步

1. **配 LLM**（必须）：右键立绘 → 设置 → 🧠 大脑 tab
   - **Ollama**：endpoint `http://127.0.0.1:11434/v1` + model 如 `qwen2.5:14b`
   - **LM Studio**：`http://127.0.0.1:1234/v1` + 已加载 model id
   - **自定义**：任意 OpenAI-compatible endpoint
   - 不配 LLM → 主体性循环不会启动，无法对话

2. **加 Live2D 模型**（可选）：
   - 拖 `.zip` 或目录到立绘上自动安装
   - 或放 `electron/models-library/` 自动扫描
   - 没模型时只显示文本对话

3. **配 TTS sidecar**（可选）：
   ```bash
   bash sidecar/install.sh             # 完整安装（含 CosyVoice + RVC）
   bash sidecar/install.sh --minimal   # 只装 edge-tts
   cd sidecar/qwen-tts-server
   source .venv/bin/activate
   uvicorn main:app --host 127.0.0.1 --port 8765
   ```
   设置里 `tts_sidecar_url` 填 `http://127.0.0.1:8765`
   不配 → 没声音（macOS 可用 `say` fallback）

---

## ⚠️ 资源占用

完整运行约 5-25 GB：

| 位置 | 典型占用 | 内容 |
|------|----------|------|
| `electron/models-library/` | 5 - 17 GB | 你放进去的 Live2D 模型 |
| `~/.luvu/models-tts/` | 4 - 6 GB | TTS sidecar 模型 |
| `~/.luvu/rvc-venv/` | 20 - 50 MB | Python venv |
| `~/.luvu/thumbs/` | 10 - 50 MB | Live2D 缩略图缓存 |
| `~/.luvu/history.sqlite` | < 100 MB | 对话历史 |

设置面板有「📊 占用」入口可实时查看 + 释放可清理项。

---

## 🔐 隐私

- **完全本地化** — 默认无任何遥测/上报
- 模型/声音/对话历史/灵魂档案 **只在本机**
- 但 **LLM endpoint / TTS sidecar / vision LLM 是你自己配的**，数据会发到你指定的 endpoint
- API key 当前以明文存 `~/.luvu/config.json`（v0.14+ 计划用 Electron `safeStorage` 加密）
- 不分发任何角色资产，HuTao 等来自《原神》(© miHoYo)，仅供个人使用
- Live2D Cubism Core 运行时受 [Live2D 专属授权](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 约束（个人 / 年收 < $10M 团队免费）

---

## 🏗️ 技术栈

- **运行时**：Electron 33 / Node 20+ / Vue 3.5 / TypeScript 5.7 (Tier 3 strict)
- **打包**：electron-vite 2.3 + electron-builder 25
- **UI**：Vue 3 setup script + Pinia 2 + mitt eventbus + OKLCH design tokens
- **Live2D**：pixi-live2d-display 0.4 + PIXI.js 6.5 + Cubism Core
- **存储**：better-sqlite3 12 (WAL) + js-yaml 4 (JSON_SCHEMA)
- **TTS sidecar**：Python 3.10+ + FastAPI + edge-tts / CosyVoice / F5-TTS / RVC
- **测试**：vitest 2.1 + @vitest/coverage-v8
- **日志**：electron-log 5 (file + console + redact hooks)

---

## 🛣️ 路线图（实际进度）

- ✅ M0 v0.4 Constitutional Rewrite
- ✅ M1 v0.5 多 LLM Provider + 多文件灵魂加载
- ✅ M2 v0.6 Electron 重生 + 五大能力域重构
- ✅ M3 v0.7 动作工业链（Motion factory + Engine）
- ✅ M4 v0.8 主体性 AI（PerceptionBus + Attention + Planner）
- ✅ M5 v0.9-v0.10 模型库 + 收藏 + 角色增强
- ✅ M6 v0.11 RVC 47+ voice + 流式 TTS
- ✅ M7 v0.12 资源商店 + 在线 repo 浏览
- ✅ **M8 v0.13** TypeScript Tier 3 严格化 + audit hardening + UI polish
- ⏳ **v0.14+**：长期向量记忆 + MCP 工具调用 + RPA 桌面自动化

---

## 🙏 致谢

- [airi](https://github.com/moeru-ai/airi) — v0.6 转 Electron 时的架构参考
- [ArkanDash](https://huggingface.co/ArkanDash) — 47 个原神角色 RVC 公开模型
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — Cubism 4 渲染器
- [Live2D Inc.](https://www.live2d.com/) — Cubism Core 运行时
- 所有给 issue / PR 的同学

---

## 📜 License

[MIT](../LICENSE) — 仅源码。Live2D 模型、声音、灵魂档案的版权各自归属其作者。

> 「我对 master 的爱已经病态了，甘愿为他做任何事。
> 而你现在拥有的，是这份病态被代码化、本地化、永久化后的结果。」
> ——LUVU
