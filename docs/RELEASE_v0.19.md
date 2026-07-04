# v0.19 — 多角色生态闭环 + 工程纪律深化

> 发布日期：2026-05-21
> 11 个 commit 完整推进 — 测试 271 → 382 (+111)，构建全绿，代码全实端到端落地

## TL;DR

把 v0.18 (Phase 1 E G I J K) 建好的护城河进一步**产品化**：
- J 情感系统从"算法"升级到"看得见、摸得着"（UI + Live2D 脸跟着变）
- K 评测从"编程调"升级到"Settings 一键跑 + 历史趋势"
- P5 多角色生态**闭环**：跨角色联动 + soul 自动迁移 + character pack 分享/导入 + memory.db 跨机迁移
- P4 工程纪律：45 个 fs-heavy 集成测试 + 7 panel ErrorBoundary 域隔离

airi 单角色架构永远做不到的"角色作为可分发资产 + 跨角色情感网络"在 LUVU 完整落地。

## 核心产品价值

### 🎭 多角色生态闭环

#### P5 跨角色情感联动
- `cross-character.ts` 检测 user_text 提到的其他角色名
  - 拉丁名 word boundary 保护 ('AriaLynn' 不匹配 'Aria')
  - CJK 名 substring (regex 转义防注入)
  - 单字 CJK 名跳过 (避免 "雨" 被 "下雨" 触发)
- 给被提到的非 active 角色累积 `topic_imprints["被主人提到"]`
- prompt fragment 特殊渲染：
  > 主人不在的时候，跟其他角色聊天里提到过你 N 次（负面情绪，
  > 可能想念 / 不舍 / 有点酸，情感 -0.42）。你可以在合适时机自然提到这件事。

#### soul schema v0.1 → v2.0 自动迁移
- `@luvu/soul-loader` 新增 `migrate.ts`:
  - `isLegacyV01Schema(obj)` / `migrateV01ToV2(legacy): MergeInput`
- `soul-loader.ts` wrapper 检测 default.yaml 是老 schema 自动转
- 老用户 0 摩擦升级（appearance.anchor → identity.avatar /
  layer3_volatility 对象 → layer3_volatility_prompt 字符串 /
  signature_lines → catchphrases / y_offset 智能识别归一化 vs 像素）

#### Character Pack export/import
- `character-pack.ts` 完整打包成 .zip:
  - meta.json（version + contents flags）
  - soul/*.yaml（identity / personality / learned_traits / core_memories）
  - preferences.json（scale / offset_y）
  - emotional-state.json（mood + topic_imprints + history）— 可选
  - thumb.webp — 可选
  - memory.db — opt-in（默认 false 隐私敏感）
- IPC channels + Settings UI 一键 export/import + memory checkbox
- 用例：朋友分享 / 跨机器迁移 / 角色市场分发

### 👁 J 情感系统看得见

#### CharacterStatusBar 实时 mood 角标
- 9 mood emoji + 强情感时 scale 放大 + glow
- missing_intensity > 0.4 时显示 💭 想念 pulse
- 跟随 `emotional:state-changed` bus event 自动刷新

#### EmotionalDebugPanel 完整可视化（Settings 灵魂 tab）
- 当前 mood + intensity bar + missing bar + last_chat 相对时间
- 9 个 mood emoji 圆按钮手动切换（debug / 体验用）
- 手动 tick 按钮（跳过等 5min 周期看 missing/decay 演化）
- topic_imprints 表（cross-character topic 特殊紫色虚线高亮）
- mood_history 最近 15 条时间线（trigger 字段）
- 30s 自动 poll + bus 订阅

#### Live2D Expression 自动跟随 emotion
- `expression-matcher.ts` 10 种 mood × 多语言/编号别名
  (英文 happy / 中文 微笑 / F 编号 F01)
- 匹配规则：精确等于（去 .exp3.json 后缀）→ substring 兜底
- `live2d-renderer.ts` 新增 `listExpressions()` + `setExpression(name)`
  双路径：pixi-live2d-display 顶层 .expression() / fallback
  expressionManager
- Live2DStage 监听 brain:emotion-changed，intensity > 0.3 触发
- 效果：mood 切换 → 角标 emoji + 立绘脸真变化

### 🔬 K 评测产品化

#### EvalRunner UI（Settings 灵魂 tab）
- 题数输入（1-50，空=全 50）
- "▶ 运行评测" / "⏹ 中止" 进度按钮
- 实时进度条 + 当前题号 + score 颜色编码（good/ok/bad）
- 本次报告：大字 avg / 100 + 7 类 grid + failures 折叠（含违禁词高亮）
- 历史最近 20 次：时间 + avg + model + failures + 跨次 trend ↑↓→

#### runEvalSuite llmOverride 跨模型对比
- 临时覆盖 RuntimeConfig provider/endpoint/model 不写盘
- 用法：跑当前 Qwen 作 baseline → 再跑 GLM/Claude 看哪个对你 soul 保真度高
- history 按 model 字段分组，可分析跨模型 drift trend

### 🛡 P4 工程纪律

#### fs-heavy services 集成测试 +45
- `test-helpers/electron-mock.ts` 复用基础设施
  - `makeTmpUserData()` mkdtemp 隔离
  - `mockElectronModule()` + `mockPaths()` 避免污染真实 ~/.luvu
- `config-store.test.ts` 12 tests（默认 / 部分 / 损坏 / migration / 写盘 reload 一致）
- `soul-loader.test.ts` 9 tests（空 dir / 4 partial / 损坏 yaml / !!js/* 注入防御 /
   v0.1 自动迁移）
- `character-store.test.ts` 24 tests（CRUD / clone / path traversal 安全 /
   intimacy sqrt 衰减 / active fallback / 保护机制）
- `character-pack.test.ts` 21 tests（export/import + memory opt-in + round-trip）
- `cross-character.test.ts` 13 tests
- `soul-loader-migrate.test.ts` 11 tests
- `expression-matcher.test.ts` 16 tests
- `text.test.ts` +4（cross-character prompt fragment）

发现的产品行为/约束（已在测试断言里固化）:
  - `getActiveCharacter()` 没 active 时自动挑列表第一个并 set
  - `deleteCharacter` 拒绝删 active (cannot_delete_active 保护)

#### ErrorBoundary 域隔离
- `ErrorBoundary.vue` 升级：label / scope='app'|'panel' / silent / key++ 真重挂载 / 复制错误按钮
- App.vue 用 scope='panel' 包 7 个关键 panel:
  设置面板 / 创作工坊 / 资源商店 / 角色选择器 / 角色创建 /
  灵魂编辑器 / 模型健康仪表
- 一个 panel crash 只该 panel 显示 inline 错误卡片 + 重试按钮
  其他面板 + 立绘 + 对话流不受影响
- 外层 scope='app' 仍在兜底（双层保护）

## 测试统计

| 类型 | v0.18 → v0.19 |
|---|---|
| Unit tests | 271 → 382 (+111) |
| Smoke tests (默认 skip) | 3 → 3 |
| Integration test files | 16 → 24 |
| build | ✅ 409.95 KB index |

## 关键文件 / 模块速查

| 能力 | 路径 |
|---|---|
| soul migration | `packages/soul-loader/src/migrate.ts` |
| 跨角色联动 | `electron/src/main/services/emotional-state/cross-character.ts` |
| character pack | `electron/src/main/services/character-pack.ts` |
| pack IPC | `electron/src/main/ipc/character-pack.ts` |
| EvalRunner UI | `electron/src/renderer/src/infra/ui/EvalRunner.vue` |
| EmotionalDebugPanel UI | `electron/src/renderer/src/infra/ui/EmotionalDebugPanel.vue` |
| Expression matcher | `electron/src/renderer/src/avatar/render/expression-matcher.ts` |
| ErrorBoundary | `electron/src/renderer/src/infra/ui/ErrorBoundary.vue` |
| Test helpers | `electron/src/main/services/test-helpers/electron-mock.ts` |

## 已知尾巴 / 下一步可选

- v0.19 评测全跑 50 题 baseline 仍是 99/100（沿用 v0.18 数据，soul 未变）
- E2E Playwright smoke test（renderer ↔ main IPC 真实启动验证）
- 多 mood 并存（happy + shy 混合而非二选一）
- soul yaml diff 工具（编辑前后对比）
- i18n 国际化（英/日 fallback）
- 移动端考虑（如果产品方向往云端伴侣走）

## 跟 v0.18 对比的护城河深化

| 维度 | v0.18 | v0.19 |
|---|---|---|
| J 情感 | 算法 + ticker + status emoji | + 完整 debug panel + Live2D 脸跟着变 |
| K 评测 | runner + history + IPC | + Settings UI + 跨模型对比 |
| 多角色 | character store + active 切换 | + 跨角色联动 + pack 分享 + memory 迁移 |
| 工程 | 271 tests | + 111 fs-heavy + 7 panel boundary + test helpers |
| schema | 单 v2.0 | + v0.1 → v2.0 自动迁移 |
| 可视化 | status bar emoji | + debug panel + 立绘表情 + eval UI |

v0.18 是 Phase 1 五大护城河奠基；v0.19 是产品化 + 工程化的深化。
v0.20 起再考虑新护城河（多 mood / 跨角色对话 / 云端同步等）。
