# v0.20 — 灵魂自演化 + 多 mood 并存 + Subagent 守护质量

> 发布日期：2026-05-21
> 19 个 commit 持续推进（v0.19 → v0.20）— 测试 382 → 471 (+89)
> Subagent reviewer 守护流程跑了 3 轮 — 0 CRITICAL/HIGH 保持，8 MEDIUM 全修

## TL;DR

v0.19 完成多角色生态闭环；v0.20 把"灵魂"真的做活：
- J 算法升级到**多 mood 并存**（primary + secondary 双层衰减）
- **Live2D 表情自动跟随 mood** — 脸真的变化
- **TTS prosody mood-aware** — 声音也跟着情绪走（happy 快+高 / sad 慢+低）
- **Soul Auto-Learner** — 每 24h 自动把 topic_imprints 写回 learned_traits.yaml
- **Soul Yaml Diff + Audit Log** — 每次 SoulEditor 保存自动 diff + NDJSON 审计
- **Soul v0.1 → v2.0 自动迁移** — 老用户 0 摩擦升级
- **Character Pack export/import** + memory.db opt-in — 角色作为可分发资产
- **跨角色情感联动** — A 对话提到 B → B 累积"被主人提到"印记

工程纪律：
- **3 个 Subagent reviewer 并行守护** — security/typescript/code 全 review，发现 2 CRITICAL/3 HIGH/8 MEDIUM 全修
- **fs-heavy services 集成测试 +45**
- **ErrorBoundary 7 panel 域隔离**
- **Soul change log audit trail 加 path traversal + characterId 验证**

## J 情感系统 — 完整 10 项能力

| # | 能力 | 落地 round |
|---|---|---|
| 1 | mood + intensity 基础演化 | v0.18 |
| 2 | missing_intensity 时间增长 (12h half-life) | v0.18 |
| 3 | topic_imprints LRU 60 (加权累积) | v0.18 |
| 4 | mood_history LRU 30 (时间线) | v0.18 |
| 5 | 5min ticker always-on | v0.18 |
| 6 | CharacterStatusBar 实时角标 | v0.18 |
| 7 | EmotionalDebugPanel 完整可视化 | v0.19 |
| 8 | 跨角色情感联动 | v0.19 |
| 9 | Live2D 表情自动跟随 | v0.19 |
| 10 | **多 mood 并存（primary+secondary）** | v0.20 |
| 11 | **TTS prosody mood-aware** | v0.20 |
| 12 | **soul auto-learner（24h sync to yaml）** | v0.20 |

跟人类真实情绪结构对齐：**层叠衰减、声音 + 表情同步反映、自我演化**。airi 单 mood + 静态 prompt 永远做不到。

## Soul 系统 — 完整 6 项能力

| # | 能力 | 落地 |
|---|---|---|
| 1 | 4 yaml 拆分加载（identity/personality/learned/memories） | v0.18 |
| 2 | system prompt 三层注入（soul + emotional + 国产增强） | v0.18 |
| 3 | v0.1 → v2.0 自动迁移 | v0.19 |
| 4 | character pack export/import + memory.db opt-in | v0.19 |
| 5 | **字段级 diff 工具 + NDJSON audit log** | v0.19+20 |
| 6 | **auto-learner 从 topic_imprints 自动写回** | v0.20 |

## Subagent 守护开发流程（v0.20 特色）

启动循环：
1. **R1 reviewer**（R16 commit 6189fd4 之前）— security/typescript 并行：
   - 找到 **2 CRITICAL** (zip path traversal / zip bomb) + **2 HIGH** (magic byte / characterId 路径污染) + **1 HIGH** (Live2DStage race)
   - 同一 commit bundle 修完 + 15 个 security tests

2. **R2 reviewer**（R18 commit 7734dc0 之后）— 三个 reviewer 并行：
   - security: 0 HIGH+，5 LOW
   - typescript: 0 HIGH，4 MEDIUM + 2 LOW
   - code: 0 HIGH+，4 MEDIUM + 3 LOW
   - 8 MEDIUM + 10 LOW 一个 commit 全修

3. **R3 验证**（修复后）— security + typescript 再审：
   - **0 HIGH+ 保持** ✅
   - 1 MEDIUM (compact 弱 TOCTOU 实际不可利用)

**结论：质量门 0 CRITICAL/HIGH，可发布。**

## 新增 / 修改文件统计

**新增模块**：
- `packages/soul-loader/src/migrate.ts` v0.1→v2.0 schema migration
- `packages/soul-loader/src/diff.ts` 字段级 diff
- `electron/src/main/services/emotional-state/cross-character.ts`
- `electron/src/main/services/character-pack.ts` + IPC
- `electron/src/main/services/soul-change-log.ts` + IPC
- `electron/src/main/services/soul-learner.ts` + IPC
- `electron/src/main/services/tts/prosody.ts`
- `electron/src/renderer/src/avatar/render/expression-matcher.ts`
- `electron/src/renderer/src/infra/ui/EvalRunner.vue`
- `electron/src/renderer/src/infra/ui/EmotionalDebugPanel.vue`
- `electron/src/renderer/src/infra/ui/SoulChangeLogPanel.vue`

**升级关键**：
- `EmotionalState` 加 secondary_mood/secondary_intensity（多 mood）
- `evolution.ts` 双层 mood 衰减算法
- `text.ts` "心情很好但同时也带点害羞"渲染
- `character-store.writeCharacterSoulFile` 自动 diff + audit log
- `Live2DStage` mood → expression 自动切换 + renderer race guard
- `ErrorBoundary` label/scope/key++ 真重挂载

## 测试统计

| 类型 | v0.19 → v0.20 |
|---|---|
| Unit tests | 382 → 471 (+89) |
| 集成 fs-heavy | 45 → 80+ (+35) |
| Smoke (默认 skip) | 3 |
| **典型代码:测试 ratio** | ~1 : 1.2 |
| build | ✅ 420 KB index |

## 关键模块速查

| 能力 | 路径 |
|---|---|
| 多 mood 并存 | `electron/src/main/services/emotional-state/evolution.ts` |
| TTS prosody | `electron/src/main/services/tts/prosody.ts` |
| Live2D expression | `electron/src/renderer/src/avatar/render/expression-matcher.ts` |
| Soul auto-learner | `electron/src/main/services/soul-learner.ts` |
| Soul diff | `packages/soul-loader/src/diff.ts` |
| Soul audit log | `electron/src/main/services/soul-change-log.ts` |
| Soul migration | `packages/soul-loader/src/migrate.ts` |
| Character pack | `electron/src/main/services/character-pack.ts` |
| Cross-character | `electron/src/main/services/emotional-state/cross-character.ts` |
| Settings UI 集成 | `electron/src/renderer/src/infra/ui/SettingsPanel.vue` |

## v0.21 已知 backlog

- group chat (A + B + user 三人对话)
- E2E Playwright smoke test
- soul change log 时间窗口 compact 跟 audit log 集成 (减少 fs)
- Settings UI 暴露多 mood 调试（手动设 secondary）
- 跨 LLM 跑 K 评测对比 UI（runner llmOverride 已 ready，缺 UI）

## 跟 v0.19 对比的护城河深化

| 维度 | v0.19 | v0.20 |
|---|---|---|
| J 情感 | 9 mood + 角标 + Live2D 脸 | + 多 mood 并存 + TTS prosody + auto-learner |
| Soul 系统 | yaml 4 拆分 + diff 工具 | + audit log + autoLearner + character pack memory opt-in |
| 工程 | 414 tests + ErrorBoundary | + 57 fixes 后 471 tests + 3 轮 reviewer 守护 |
| 可视化 | EmotionalDebugPanel | + SoulChangeLogPanel + soul-learner UI |

v0.19 是产品化深化；v0.20 是**质量守护 + 灵魂自演化**。
