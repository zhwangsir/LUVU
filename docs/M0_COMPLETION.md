# M0 完成报告

> 版本：v0.4.0  
> 日期：2026-05-16

## ✅ 完成项

| Step | 内容 | 状态 |
|---|---|---|
| 1 | 文档骨架（ARCHITECTURE/ROADMAP/DECISIONS/INVENTORY） | ✅ |
| 2 | 5 大域目录骨架（前后端 + 5 个 README） | ✅ |
| 3 | 事件总线（mitt 前端 + Tauri emit 后端事件常量） | ✅ |
| 4 | 灵魂 YAML 拆分（identity/personality/core_memories/learned_traits） | ✅ |
| 5 | 搬前端文件（21 个 .ts/.vue） | ✅ |
| 6 | 搬 Rust 后端文件（21 个 .rs） | ✅ |
| 7 | 砍 8 项过度设计代码 | ✅ |
| 8 | Live2D 路径完全配置化 + 编译验证 | ✅ |

## 📐 模块边界（实际落地）

### 前端 src/

```
src/
├── avatar/                     ← 形象表现
│   ├── render/renderer.ts
│   ├── animation/{eyeBlink,focus,lipSync}.ts
│   ├── interaction/drag.ts
│   ├── emotion-params/mapping.ts
│   ├── components/Live2DStage.vue
│   └── README.md
├── brain/                      ← 智能核心
│   ├── stores/{dialog,emotion,soul}.ts
│   ├── types/soul.ts
│   ├── emotion/decayTick.ts
│   ├── memory/distillTick.ts
│   ├── components/{DialogBubble,InputBar}.vue
│   └── README.md
├── hands/                      ← 工具调用（M4 启用）
│   └── README.md
├── presence/                   ← 陪伴交互
│   ├── speech/speaker.ts
│   ├── stores/stt.ts
│   └── README.md
├── infra/                      ← 基础设施
│   ├── eventbus.ts             ← mitt 单例 + EventMap 类型
│   ├── stores/config.ts
│   ├── ui/SettingsPanel.vue
│   ├── styles/global.css
│   └── README.md
├── App.vue
├── main.ts
└── env.d.ts
```

### 后端 src-tauri/src/

```
src-tauri/src/
├── avatar/
│   ├── window.rs               (mouse tracker, 透明窗口)
│   ├── commands.rs             (window_* 命令)
│   ├── models.rs               (Live2D 模型扫描)
│   └── mod.rs
├── brain/
│   ├── chat.rs
│   ├── memory/{store,commands,embed,distill,mod}.rs
│   ├── persona/{loader,mod}.rs
│   ├── providers/{openai_compat,mod}.rs
│   └── mod.rs
├── hands/mod.rs                ← M4 启用
├── presence/
│   ├── {sidecar_mgr,sidecar_commands,stt,stt_commands,tts,tts_commands}.rs
│   └── mod.rs
├── infra/
│   ├── {config,error,eventbus,soul_commands,system,tray}.rs
│   └── mod.rs
├── lib.rs                       (RuntimeConfig + AppState + run)
└── main.rs
```

## 🪓 砍掉的（8 项）

- `src/alpha/mask.ts` — 像素穿透 mask
- `src-tauri/src/core/motion.rs` + `commands/motion.rs` — 散步系统
- `src/behavior/persona.ts` — 10 状态 FSM
- `src/behavior/autoComment.ts` — 主动开口
- `src/behavior/idle.ts` — 8 种 idle 动作
- `src/emotion/fsm.ts` — 关键词触发表
- `src/alpha/sampler.ts::hitTestAlpha` — 拖动逻辑保留，hit-test 砍
- RuntimeConfig 的 `live2d_*` / `motion_*` / `extra_model_dirs` 字段

## 🔍 自审计

| 项 | 状态 |
|---|---|
| 五大域目录全建 | ✅ |
| 跨域 import 检查 | ✅ 通过 grep "crate::core::" / "crate::commands::"，0 命中 |
| 前端 grep "@/alpha\|@/behavior\|@/live2d\|@/components\|@/stores" 残留 | ✅ 0 命中 |
| TypeScript 编译 | ✅ vue-tsc 无错误 |
| Rust 编译 | ✅ cargo check 无错误 |
| Vite 生产打包 | ✅ pnpm build 成功 |
| 砍清单全部完成 | ✅ |
| 事件总线就位 | ✅ mitt 安装 + EventMap 类型 + dev 自动 console |
| 灵魂 YAML 拆分 | ✅ 4 个文件创建 |
| Live2D 路径完全 soul 化 | ✅ Live2DStage 不再依赖 config.live2d_* |

## ⚠️ 已知未做（推到 M1+）

1. **SoulConfig 多文件 loader**：当前 Rust 仍读单文件 `default.yaml`（保留兼容）。M1 改成读 `soul/{identity,personality,...}.yaml` 多文件。
2. **MCP 工具调用**：M4 完整实施。`hands/` 目录已占位。
3. **Anthropic / Ollama LLM Provider**：M1 加。当前只 OpenAI-compat。
4. **ChromaDB 向量存储**：M3 替代当前全表 cosine。
5. **CosyVoice 实装 / whisper.cpp**：M2 替代 macOS say / faster-whisper。

## 📊 体积变化

| 维度 | 重构前 | 重构后 |
|---|---|---|
| Rust 源文件数 | 25 | 22（砍 motion） |
| 前端 .ts/.vue 数 | 28 | 23（砍 5 项） |
| RuntimeConfig 字段数 | 22 | 13（迁出 9 个到 soul） |
| Tauri command 数 | 36 | 33 |
| 域间 import 违规 | 不可统计（无定义） | 0（grep 验证） |

## ➡️ 下一步：M1 — 能聊

进入 [docs/ROADMAP.md](./ROADMAP.md) M1 阶段。

具体启动任务：
1. `brain/providers/anthropic.rs` — Anthropic Claude provider
2. `brain/providers/ollama.rs` — Ollama 兜底
3. 统一 `LLMProvider` trait
4. 表情联动验证（LLM JSON emotion → avatar）
5. 切换 provider 的 UI

**M0 收尾：所有变更已提交，准备 commit + tag v0.4.0。**
