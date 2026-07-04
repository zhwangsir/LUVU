# M0 现有代码盘点

> 重组前的代码资产清单。重组后归档此文档。

## 砍 / 留 / 新增 总览

### ❌ 砍（8 项）

| 文件 | 原因 |
|---|---|
| `src/alpha/mask.ts` | 128×96 像素穿透 mask 副作用大，多次引入 UI bug |
| `src-tauri/src/core/motion.rs` | 窗口自主散步，过早设计 |
| `src-tauri/src/commands/motion.rs` | motion 命令 |
| `src/behavior/persona.ts` | 10 状态 FSM + 意图引擎，过度设计 |
| `src/behavior/autoComment.ts` | 主动开口，M5 重做 |
| `src/behavior/idle.ts` | 8 种 idle 动作，与 persona 重叠 |
| `src/emotion/fsm.ts` 内的关键词触发表 | LLM JSON emotion 取代 |
| `src/alpha/sampler.ts` 的 `hitTestAlpha` | 拖动逻辑保留，hit-test 砍 |

### ✅ 留（按新结构归位）

#### Avatar 域
- `src/live2d/renderer.ts` → `src/avatar/render/renderer.ts`
- `src/live2d/eyeBlink.ts` → `src/avatar/animation/eyeBlink.ts`
- `src/live2d/focus.ts` → `src/avatar/animation/focus.ts`
- `src/live2d/lipSync.ts` → `src/avatar/animation/lipSync.ts`
- `src/components/Live2DStage.vue` → `src/avatar/components/Live2DStage.vue`
- `src/emotion/mapping.ts` → `src/avatar/emotion-params/mapping.ts`
- `src/alpha/sampler.ts`（拖动部分） → `src/avatar/interaction/drag.ts`
- `src-tauri/src/window.rs` → `src-tauri/src/avatar/window.rs`
- `src-tauri/src/commands/window.rs` → `src-tauri/src/avatar/commands.rs`
- `src-tauri/src/commands/models.rs` → `src-tauri/src/avatar/models.rs`

#### Brain 域
- `src-tauri/src/core/llm.rs` → `src-tauri/src/brain/providers/openai_compat.rs`
- `src-tauri/src/core/memory.rs` → `src-tauri/src/brain/memory/store.rs`
- `src-tauri/src/core/embed.rs` → `src-tauri/src/brain/memory/embed.rs`
- `src-tauri/src/core/soul.rs` → `src-tauri/src/brain/persona/loader.rs` + `prompt.rs`
- `src-tauri/src/commands/chat.rs` → `src-tauri/src/brain/chat.rs`
- `src-tauri/src/commands/distill.rs` → `src-tauri/src/brain/memory/distill.rs`
- `src-tauri/src/commands/memory.rs` → `src-tauri/src/brain/memory/commands.rs`
- `src/stores/dialog.ts` → `src/brain/stores/dialog.ts`
- `src/stores/emotion.ts` → `src/brain/stores/emotion.ts`
- `src/stores/soul.ts` → `src/brain/stores/soul.ts`
- `src/types/soul.ts` → `src/brain/types/soul.ts`
- `src/components/DialogBubble.vue` → `src/brain/components/DialogBubble.vue`
- `src/components/InputBar.vue` → `src/brain/components/InputBar.vue`

#### Presence 域
- `src-tauri/src/core/tts.rs` → `src-tauri/src/presence/tts.rs`
- `src-tauri/src/commands/tts.rs` → `src-tauri/src/presence/tts_commands.rs`
- `src-tauri/src/core/sidecar.rs` → `src-tauri/src/presence/sidecar_mgr.rs`
- `src-tauri/src/commands/sidecar.rs` → `src-tauri/src/presence/sidecar_commands.rs`
- `src-tauri/src/core/stt.rs` → `src-tauri/src/presence/stt.rs`
- `src-tauri/src/commands/stt.rs` → `src-tauri/src/presence/stt_commands.rs`
- `src/audio/speaker.ts` → `src/presence/speech/speaker.ts`
- `src/stores/stt.ts` → `src/presence/stores/stt.ts`
- `src/behavior/distillTick.ts` → `src/brain/memory/distillTick.ts`（搬到 brain）
- `src/behavior/emotionTick.ts` → `src/brain/emotion/decayTick.ts`（搬到 brain）
- `sidecar/qwen-tts-server/` → `sidecar/speech/`（整体重命名）

#### Infra 域
- `src-tauri/src/lib.rs` → 保留位置（main 入口）
- `src-tauri/src/main.rs` → 保留
- `src-tauri/src/error.rs` → `src-tauri/src/infra/error.rs`
- `src-tauri/src/tray.rs` → `src-tauri/src/infra/tray.rs`
- `src-tauri/src/commands/config.rs` → `src-tauri/src/infra/config.rs`
- `src-tauri/src/commands/system.rs` → `src-tauri/src/infra/system.rs`
- `src-tauri/src/commands/soul.rs` → 合并到 `brain/persona/loader.rs`
- `src/components/SettingsPanel.vue` → `src/infra/ui/SettingsPanel.vue`
- `src/stores/config.ts` → `src/infra/stores/config.ts`
- `src/styles/global.css` → `src/infra/styles/global.css`
- `src/env.d.ts` → 保留位置
- `src/App.vue` → 保留位置
- `src/main.ts` → 保留位置

### ➕ 新增（M0）

- `src/infra/eventbus.ts` — mitt 实例 + 事件类型定义
- `src-tauri/src/infra/eventbus.rs` — Rust 端事件辅助（封装 Tauri emit）
- `soul/identity.yaml` — 拆出来
- `soul/personality.yaml` — 拆出来
- `soul/core_memories.yaml` — 拆出来（空）
- `soul/learned_traits.yaml` — 拆出来（空）
- 五大域 README.md（每个域内一份）
- `src/hands/README.md` — M4 占位
- `src-tauri/src/hands/mod.rs` — M4 占位
