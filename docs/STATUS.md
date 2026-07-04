# docs/ 文档现状索引

> 写给「想理解 LUVU 当前架构 + 愿景」的新人。各文档时效不一，按本表找。
> 最近 audit：**v2.0 硅基生命容器重定向（2026-05-22）**
> 最近 autonomous round：**M8 灵魂社会 partial-ship（Round M+N+O,617 单测）**

## 🟢 现行（v2.0 当前）

| 文档 | 用途 | 状态 |
|------|------|------|
| [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md) ⭐ **顶层产品宪章** | 「硅基生命容器」四大支柱 + 差异化 + 非目标 | v2.0 当前 |
| [PRD.md](PRD.md) | 产品需求文档（v2.0 重写） | v2.0 当前 |
| [ROADMAP.md](ROADMAP.md) | 完整 M0-M10 路线图（v2.0 重写，加 M7-M10） | v2.0 当前 |
| [RELEASE_v0.21.md](RELEASE_v0.21.md) | v0.21 硅基生命容器重定向 + M7 100% + 0 → 1 用户路径 | v0.21 当前 |
| [USER_GUIDE.md](USER_GUIDE.md) | 主人 + 0→1 用户上手指南(onboarding / FAQ / macOS 权限 / 数据备份 / 故障诊断) | **v0.21 当前**(本 session 新建) |
| [SIDECAR_SETUP.md](SIDECAR_SETUP.md) | TTS sidecar 安装文档(各 backend 依赖 / 启动 / 嘴型同步 / embedding) | **v0.21 当前**(本 session 新建) |
| [RELEASE_v0.20.md](RELEASE_v0.20.md) | v0.20 灵魂自演化 + 多 mood 并存 release notes | v0.20 当前 |
| [RELEASE_v0.19.md](RELEASE_v0.19.md) | v0.19 多角色生态闭环 | v0.19 当前 |
| [RELEASE_v0.18.md](RELEASE_v0.18.md) | v0.18 三层人格 + 情感系统 | v0.18 当前 |
| [RELEASE_v0.17.md](RELEASE_v0.17.md) | v0.17 长期记忆 M2 + MCP | v0.17 当前 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统架构(五大域 / 9 BehaviorAction / ComfyUI / MCP / 25 IPC) | **v0.21 当前**(本 session 重写) |
| [DECISIONS.md](DECISIONS.md) | 架构决策 ADR(ADR-100~107 + 新增 ADR-200~205:Electron / TS Tier 3 / Attention / 手写 MCP / 硅基生命 / Subagent 守护) | **v0.21 当前**(本 session 补 6 个 ADR) |
| [ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md) | 动作工业链（v0.7 落地） | v0.7+ 当前 |
| [SOUL_SCHEMA.md](SOUL_SCHEMA.md) | 灵魂档案 schema（4 yaml 拆分） | v0.5+ 当前 |
| [../README.md](../README.md) | 用户视角 quick-start + 四大支柱 + M0-M10 路线 + SILICON_LIFE_VISION 链接 | **v0.21+M8 当前**(Stage 1 W2 重写) |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本日志 | 部分过时，实际进度看 git log |
| [rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md) | TypeScript Tier 3 严格化 RFC | v0.13 当前 |

## 🟡 历史快照（archived，仅参考）

| 文档 | 说明 |
|------|------|
| [AIRI_STUDY.md](AIRI_STUDY.md) | v0.6 转 Electron 前研究 airi 的笔记，是历史决策依据 |
| [M0_COMPLETION.md](M0_COMPLETION.md) | v0.4 M0 重写完成记录 |
| [M0_INVENTORY.md](M0_INVENTORY.md) | v0.4 M0 inventory |
| [_archived_default.yaml](_archived_default.yaml) | 老灵魂档案备份 |
| [RELEASE_v0.13.md](RELEASE_v0.13.md) | v0.13 TS Tier 3 + audit 修复批 |
| [RELEASE_v0.14.md](RELEASE_v0.14.md) | v0.14 历史 |
| [RELEASE_v0.15.md](RELEASE_v0.15.md) | v0.15 历史 |
| [RELEASE_v0.16.md](RELEASE_v0.16.md) | v0.16 历史 |

## 🔴 已知文档债

- ~~**新 ARCHITECTURE.md**~~ — ✅ v0.21 本 session 重写(完整 9 BehaviorAction + ComfyUI 创造路径 + dialog tool 跨 provider)
- ~~**新 DECISIONS ADR**~~ — ✅ v0.21 本 session 补 6 个 ADR(ADR-200 转 Electron / 201 TS Tier 3 / 202 Attention / 203 手写 MCP / 204 硅基生命 / 205 Subagent 守护)
- ~~**TTS 安装文档**~~ — ✅ v0.21 本 session [SIDECAR_SETUP.md](SIDECAR_SETUP.md)
- ~~**USER_GUIDE.md**~~ — ✅ v0.21 本 session [USER_GUIDE.md](USER_GUIDE.md)
- ~~**CONTRIBUTING.md** PR / RFC / commit 风格规范~~ — ✅ v0.21 本 session 补 PR 检查清单 + Conventional Commits + RFC 流程 + Subagent 守护 workflow

## 当前 audit 改动（v2.0 硅基生命重定向 — 2026-05-22）

由 Claude Code 在 worktree `compassionate-engelbart-c80410` 上做的底层文件重定义：

- ✅ `CLAUDE.md` — 顶部加 **Vision「硅基生命容器」** 块，四大支柱声明
- ✅ `docs/SILICON_LIFE_VISION.md` — **新建**顶层产品宪章
- ✅ `docs/PRD.md` — 从 v0.1.0 Foundation 重写到 **v2.0.0 Silicon Life Container**
- ✅ `docs/ROADMAP.md` — 扩展 M0-M6，**新增 M7-M10**（创造统一 / 灵魂社会 / 自主进化 / 真硅基生命）
- ✅ `docs/STATUS.md` — 本文档，反映新结构
- ✅ `electron/electron.vite.config.ts` — 修复 wlipsync top-level await 阻断 dev（target: 'chrome130'）

**真实运行验证（2026-05-22 03:00）：**
- pnpm install ✅ 801 packages reused
- typecheck ✅ exit 0
- 单测 ✅ 575 passed / 3 skipped / 578 total
- `pnpm dev` ✅ 5 个 subsystem 全启动（logger / perception / emotional / attention / tray / halt-shortcut）
- attention scheduler 真实在跑（30 秒触发 2 次 reactive + 2 次 rule-based plan）

**仍未跑通的（用户数据 / 权限问题，非代码 bug）：**
- LLM endpoint config 是 placeholder `"x"` `"b"` — 需要主人填真实 endpoint
- `electron/models-library/` 没有 Live2D 模型（.gitignored 不入仓）— `totalModels=0`
- macOS 屏幕录制权限未授 — screen-sensor capture failed

## v0.21+ Autonomous Round 进展（M8 灵魂社会 partial-ship）

| Round | Commit | 主线 |
|---|---|---|
| E-L | `f27e928b`...`aa6040a3` | docs(ARCHITECTURE / DECISIONS / USER_GUIDE / SIDECAR_SETUP) + planner factory + character-store mountedCharacterIds + IPC mount-set/list + import 自动 mount |
| K | `74dc2c61` | attention onTrigger 用 active character 作 planner target |
| M | `1bf71cda` | CharacterPicker mount toggle UI(📌 卡片按钮 + header 并行计数 chip) |
| N | `ddaabcce` | M8 灵魂↔灵魂 passive listening:active 说话 → 其他 mounted character `memory.db` 写 `kind='event'` |
| O | `fa786e5c` | docs(USER_GUIDE §3.5 灵魂社会 + SILICON_LIFE_VISION partial-ship + RELEASE_v0.21 追加 Round E-N 表) |

测试数:575 → 606 → 617(Round N 加 11 个 attention/index.test.ts)。

**M8 仍要做的**(优先级降序):
- Round P(等 embedding sidecar):active planner 通过 RAG 主动 surface 跨灵魂 event memory 到 prompt — 让 active character 真"想起"听过的话
- Round Q(deferred):Live2DStage 多实例同框立绘(469 行 + WebGL/alpha 风险大,需 architect 设计)
- Round R(可选):Settings 面板 cross-character memory 检视 panel — 让用户能看到 Round N 实际写入的 event 列表

---

完整愿景 → [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md)
完整路线 → [ROADMAP.md](ROADMAP.md)
完整产品定位 → [PRD.md](PRD.md)
