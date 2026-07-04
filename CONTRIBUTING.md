# Contributing to LUVU

欢迎贡献！本项目是个人 AI 伴侣，但欢迎社区改进通用框架部分。

## 开发流程

### 1. Fork & Clone

```bash
gh repo fork zhwangsir/LUVU --clone
cd LUVU
```

### 2. 准备环境

```bash
# 安装依赖（pnpm workspace 会自动只装 electron 子项目）
pnpm install

# 准备 Live2D 模型（不入仓 — 受授权约束）
mkdir -p electron/models-library
# 把你的 .model3.json + .moc3 + textures 目录复制进去

# （可选）启动 TTS sidecar
bash sidecar/install.sh           # 完整安装含 CosyVoice + RVC
# or
bash sidecar/install.sh --minimal # 只装 edge-tts

cd sidecar/qwen-tts-server
source .venv/bin/activate
uvicorn main:app --port 8765
```

### 3. 创建分支

分支命名：`feat/<feature>`、`fix/<issue>`、`docs/<topic>`、`refactor/<scope>`、`chore/<task>`。

### 4. 提交规范

Conventional Commits：

```
feat: 新增情绪状态机的疲劳衰减
fix: 修复嘴型同步在多次播放后失效
docs: 补全 SOUL_SCHEMA 的反差变量说明
refactor: 抽离 Live2D 参数嗅探到独立模块
chore: 升级 electron 33 → 35
```

### 5. 验证

提 PR 前请确保：

```bash
pnpm typecheck                                  # TS 类型检查
pnpm build                                      # electron-vite 产物
pnpm -F luvu-electron package:mac            # macOS .dmg 打包（可选，需 ~2 分钟）
```

TypeScript Tier 3 严格模式开启 — `any` / `@ts-ignore` 均不被允许（RFC 0001）。

### 6. PR 模板

```markdown
## 改动摘要
（一句话）

## 改动范围
- [ ] avatar (electron/src/renderer/src/avatar/)
- [ ] brain (electron/src/renderer/src/brain/ + electron/src/main/services/llm/)
- [ ] presence (electron/src/renderer/src/presence/ + sidecar/)
- [ ] hands (electron/src/renderer/src/hands/ + electron/src/main/services/motion-factory/)
- [ ] attention (electron/src/main/services/attention/ + perception/)
- [ ] infra (UI / IPC / 配置 / 文档)

## 验证方式
（如何复现 / 测试）

## 关联 Issue
Closes #xxx
```

## 模块边界

五大能力域 + infra 横切：

| 域 | 职责 | 边界 |
|----|------|------|
| **avatar** 身体 | Live2D 渲染 / 像素穿透 / 拖动 | 不直接调 LLM / SQLite / TTS |
| **brain** 思考 | LLM provider / dialog store / 灵魂 prompt | 不直接渲染 / 不调 system shell |
| **presence** 声音 | TTS / STT / 嘴型同步 / 流式音频 | 不维护对话状态 |
| **hands** 行动 | Motion factory / Plan executor / 桌面动作 | 不写业务逻辑 |
| **attention** 主体 | PerceptionBus / Scheduler / Planner | 不直接操作 UI |

域间通信走 `infra/eventbus`（renderer）或 IPC（main ↔ renderer），不直接 import 跨域 store。
纯 util 函数（`brain/parser.ts` 等）可以跨域使用。

## 代码风格

- **TypeScript**：Tier 3 strict mode — `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitReturns` + `noImplicitOverride`。不允许 `any` / `@ts-ignore`。
- **Vue**：`<script setup lang="ts">`；组件 PascalCase；优先 `ref` 而非 `reactive`（更易跨进程 IPC 序列化）。
- **CSS**：OKLCH 颜色 + design tokens（`var(--color-*)` / `var(--text-*)` / `var(--space-*)` / `var(--ease-*)`）。
- **Python sidecar**：PEP 8；类型注解；用 venv。
- **文件大小**：单文件 < 800 行（SettingsPanel / ModelLibraryPanel 是 known 例外，欢迎拆）。
- **函数大小**：< 50 行（IPC handler 可放宽到 100 行）。

## 灵魂档案修改

`default.yaml` + `~/.luvu/soul/*.yaml` 是 LUVU 人格的语义核心。

- **layer1_core** 改动需在 PR 描述里解释意图
- **emotions.states** 改动需验证至少 4 个情绪在 Live2D 上视觉合理
- **signature_lines** 鼓励扩充

## 第三方资产

**不要把以下内容入仓**：
- Live2D 模型文件（受 Live2D 商业授权约束）
- 个人录音 / 声音克隆样本
- 任何 API key / 密钥（包括示例配置里）
- Python sidecar 的 venv / TTS 模型

`.gitignore` 已配置兜底，但提交前请 `git status` 确认。

## 关键文档

- [docs/SILICON_LIFE_VISION.md](docs/SILICON_LIFE_VISION.md) ⭐ — 顶层产品宪章(四大支柱)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 系统架构(v0.21 当前 / 9 BehaviorAction / IPC)
- [docs/PRD.md](docs/PRD.md) — 产品需求文档(v2.0)
- [docs/ROADMAP.md](docs/ROADMAP.md) — M0-M10 路线
- [docs/DECISIONS.md](docs/DECISIONS.md) — 架构决策 ADR(ADR-100~107 + 200~205)
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — 用户上手指南
- [docs/SIDECAR_SETUP.md](docs/SIDECAR_SETUP.md) — TTS sidecar 安装文档
- [docs/STATUS.md](docs/STATUS.md) — 文档现状索引
- [docs/ARCHITECTURE_MOTION_SYSTEM.md](docs/ARCHITECTURE_MOTION_SYSTEM.md) — 动作系统
- [docs/SOUL_SCHEMA.md](docs/SOUL_SCHEMA.md) — 灵魂档案 schema
- [docs/rfcs/0001-ts-strict-tier-3.md](docs/rfcs/0001-ts-strict-tier-3.md) — TS 严格化决策
- [CLAUDE.md](CLAUDE.md) — Claude Code 工程上下文(给 AI 看的)

## PR 检查清单(合并前必过)

每个 PR 必须满足:

```
[ ] typecheck 通过(`pnpm typecheck` — tsconfig.node + vue-tsc 都过)
[ ] 全 vitest 单测通过(`pnpm test`)— 输出 0 failed,无回归(每加新功能 passed 数同步增长)
[ ] E2E spec(如有改 main process / IPC):`pnpm e2e` 通过
[ ] commit message 走 conventional commits(feat / fix / docs / refactor / chore / test)
[ ] commit message 描述 why,不只是 what
[ ] CRITICAL / HIGH bug 全修(reviewer agent 跑过)
[ ] CHANGELOG 或 docs/RELEASE_vX.Y.md 加一行
[ ] 不破坏 CLAUDE.md 红线(LSUIElement / skipTransformProcessType / asset-protocol case 等)
```

## Conventional Commits 风格

| 类型 | 用途 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat(M7): 注册 creative_generate_sticker dialog tool` |
| `fix` | bug 修复 | `fix(asset-protocol): Chromium URL host 大小写丢失` |
| `refactor` | 重构(不改行为) | `refactor(Round A): ComfyClient 共享单例消重` |
| `docs` | 文档 | `docs(Round F): 补 6 个新 ADR` |
| `test` | 测试 | `test(M7): m7-e2e.smoke 真出图端到端验证` |
| `chore` | 杂活 | `chore: bump 0.16.0 → 0.21.0` |
| `perf` | 性能 | `perf(planner): rule fallback 比 LLM 决策快 25x` |

**body 描述 why**:
```
feat(Round B): openai-compat 完整 tool_calls 流式支持

M7 创造统一最后 20%:之前 dialog.ts:282 只 anthropic 用户能让 LLM 主动调
creative_generate_sticker。本轮把 LM Studio / Ollama 等 OAI 兼容用户也打通。

设计选择(Karpathy Rule 2:最少代码):
- 不动 ChatMessage 类型...
```

## RFC 流程(大架构变动)

> 影响 200+ 行 / 跨多个 service / 改 IPC channel 协议 — 必须先写 RFC

1. `docs/rfcs/NNNN-short-name.md` 草稿(参考 [0001-ts-strict-tier-3.md](docs/rfcs/0001-ts-strict-tier-3.md))
2. PR 标题前缀 `RFC:`
3. 列:背景 / 决策 / 替代方案 / 实现路径 / 风险 / 测试 / rollback 策略
4. 至少 1 人 review(或 typescript-reviewer agent 自动审查)
5. 合并 RFC = 接受方向;实现 PR 在后续单独跟进

历史 RFC:
- [0001-ts-strict-tier-3.md](docs/rfcs/0001-ts-strict-tier-3.md) — TypeScript Tier 3 严格化

## Subagent 守护工作流(v0.21 标准 dev flow)

本项目用 Claude Code subagent 守护开发质量(ADR-205)。本地 dev 也可手动跑:

### 每个里程碑(round-by-round)
```
1. 实现 feature
2. typecheck + 单测过
3. dev 真启动 30s 验证不破坏运行
4. 启动 typescript-reviewer agent 审查刚改的 diff
5. 修 CRITICAL + HIGH 反馈
6. commit
```

### 大里程碑额外加 architect 守护
- 启动 architect agent 审查跟「硅基生命容器」四大支柱对齐
- 找 hidden risks(pre-existing 技术债 + 未来 M8-M10 阻断点)

### 真实证据(本项目 v0.21 跑了 8 轮守护)

Round B reviewer agent 抓到 **CRITICAL bug**:`dialog.ts:202 loopUntilDone`
硬判 anthropic → openai_compat 用户整个 tool loop 失效。**主开发自测察觉不到**
(planner 路径走 attention,不走 dialog tool),reviewer 看代码逻辑一眼揭穿。

每个 commit 100s ~ 50K tokens(v0.21 实测 8 轮平均)。比人工 pair review 显著低成本(无需另一位工程师同步在场),且能 24/7 跑。

## 关于灵魂(Soul)修改的特殊规则

`default.yaml` + `~/.luvu/soul/*.yaml` 是 LUVU 人格的**语义核心**。

**改 layer1_core(底层本质)**:
- PR 描述必须解释为什么改
- 建议先在 Issue 讨论
- 改完跑 character-eval(`SMOKE_TEST=1 pnpm test --run runner.smoke`),分数下降 >5 需 explain

**改 emotions.states**:
- 验证 8 个情绪在 Live2D 上视觉合理(截图 PR)
- emotion_voice_map 8 voice 也要对齐

**改 signature_lines**:
- 鼓励扩充
- 保持人格 tone 一致(黏人 / 病娇 / 占有欲 / 撒娇)

## 行为守则

- 尊重他人，包括对 LUVU 的人格设定
- 不上传含真人姓名 / 联系方式 / 密码的代码或截图
- 安全问题请通过 GitHub Security Advisory 上报，不要开公开 Issue
