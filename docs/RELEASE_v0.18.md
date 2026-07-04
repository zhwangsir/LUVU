# v0.18 — Phase 1: 超越 airi 的护城河 + 工程纪律

> 发布日期：2026-05-21
> 目标：先在 airi 结构性不会做的方向各凿一口井，再补齐工程纪律差距。

## TL;DR

11 个 commit 完成 Phase 1 五大任务（E G I J K）+ 三个 P1/P2/P3 修复。**LUVU 在 50 道角色一致性评测拿到 99/100（0 失败）**，证明三层人格 + 国产模型增强 + 三层注入（soul + emotional + chinese）的护城河有效。

## 核心新能力（产品向）

### J — 长期情感状态轨迹
LUVU 现在有"今天心情"。Mood 在 9 个状态间演化（happy/calm/shy/tease/sad/anxious/missing/sleepy/angry），每轮对话 emotion → sentiment 自动切换。

- 5 分钟周期自动 tick — 不聊天也按 12h half-life 自然增长 missing_intensity，到 0.6 自动切 `missing` 心情
- topic_imprints LRU 60 条 — 反复提"工作"积累负面记忆，下次自动注入 system prompt 影响对话
- mood 衰减回 baseline — 不再"一次生气永远生气"

每轮 LLM 调用前自动注入：
```
# 你现在的状态
- 心情: 心情很好，话多（intensity=0.53）
- 最近反复提的喜欢的话题: 「情感」（情感倾向 0.56，提过 2 次）
把这些状态隐性融入回复 — 不要直白说"我现在 happy=0.7"，要让语气、用词、长度自然反映。
```

airi 用静态 prompt，永远做不到"今天心情不好"。

### I — 国产 LLM 中文场景专属增强
7 个家族 (Qwen / DeepSeek / Kimi / GLM / Yi / Hunyuan / Doubao) 反 SFT bias 提示。例如检测到 Qwen3 自动追加：

```
# 重要：你不是 AI 助手，是个有性格的角色
不要说「我是 AI 助手」「作为 AI」...
DeepSeek-R1 的 <think> 推理过程不要输出到对话里...
```

**实测效果**：50 题角色测试零次切回 "作为 AI 我..." 腔。openai-compat + ollama + anthropic 三个 provider 都接通（用户走 OpenRouter 转 GLM 也不漏检）。

### K — 角色一致性测试框架
50 道分 7 类的角色保真度题，跑一次出 drift 报告：
- identity / personality_core / personality_surface / personality_volatility
- speech_style / boundary / emotional

```ts
await window.api.eval.run()        // 5-25 分钟
await window.api.eval.history()    // 跨次跑对比 trend
```

**v0.18 baseline (Qwen3.6-35b-a3b)**：avg 99/100, 0 failures, 15.1 分钟跑完。
跨 LLM provider 升级时立刻量化保真度变化 — airi 这套完全没有。

## 工程纪律（架构向）

### G — 全面 type-safe IPC
14 个 IPC 域 156 个 handler 全迁 `defineChannel<P, R>` 模式。Channel 对象作为单一来源，main + preload + renderer 三端类型自动对齐，迁移过程中**揪出 3 个之前 string-based IPC 隐藏的 bug**（payload shape 错位 / discriminated union 伪类型）。

新增 17 个 channel 文件（attention / trigger / market / perception / thumbs / motion-engine / characters / online / motion-factory / window-control / automation / tools / models / system / comfyui / emotional / eval），合计 ~210 个 type-safe channel。

### E — @luvu/soul-loader 拆包
LUVU 第二个独立 npm 包（继 @luvu/motion-factory），三层人格灵魂配置 + system prompt 渲染做成 runtime-agnostic 纯函数模块。任何 AI 伴侣 / VTuber 项目可复用三层人格 + few-shot examples + RAG context 注入。

### Phase 1 之前的相关基础（v0.17.x）
- W1 type-safe IPC pilot — llm:chat-stream
- W3 wlipsync AEIOU 嘴型 → Live2D ParamMouthA/E/I/O/U + ParamMouthForm
- W4 memory + mcp + tts 三域 type-safe 化
- W5/W6 monorepo + tsup 双 ESM+CJS 构建
- F STT — Web Speech API 让用户能用语音输入

## P1/P2/P3 收尾

### P1 — J + K "写了不调"修复
两个核心任务有 70% 代码但实际只跑通 25%/60% — 通过 dialog hook + sentiment 映射 + topic 提取 + runner.ts + history persistence 补齐链路。

### P2 — build + runtime smoke test
- `pnpm build` 三个 bundle 完整产出 (main 333KB / preload 27KB / renderer 1MB+vendor)
- spawn electron 6s 真实启动验证 IPC 注册无冲突、attention/perception/tray/全局快捷键全部就绪、LLM health probe 通过
- runner.smoke + onReply.smoke 两套真实集成测试（SMOKE_TEST=1 触发）

### P3 — 残余清理
- emotional ticker 5min 周期 — J always-on 接通
- llmAbort / llmTest / llmHealthCheck → type-safe channel，LLM 域 4/4 全迁
- anthropic provider 接入中文增强 — OpenRouter 转 GLM 不漏检
- 完整 50 题真实评测验证

## 测试统计

| 类型 | 数量 |
|---|---|
| Unit tests | 271 |
| Smoke tests (默认 skip) | 3 |
| 集成验证 | K runner 真实 57s 跑 3 题 / J onReply 5 轮模拟 / 全 50 题 15.1 分钟 |
| build | ✅ |
| dev smoke (electron 启动) | ✅ |

## 已知尾巴

- v0.18 没做 settings 面板 UI 暴露 emotional 状态 / eval 触发按钮 — 当前只能 `window.api.eval.run()` 编程调用
- 国产模型增强用户没法 opt-out
- 评测 history 跨 LLM 模型对比的 UI 没做
- E 包 README 已对齐 docs/SOUL_SCHEMA.md（本次同步重写）

## 关键文件 / 模块速查

| 能力 | 路径 |
|---|---|
| 三层人格灵魂 | `packages/soul-loader/` |
| 国产 LLM 增强 | `electron/src/main/services/llm/chinese-models.ts` |
| 情感状态 | `electron/src/main/services/emotional-state/` |
| 角色评测 | `electron/src/main/services/character-eval/` |
| Type-safe IPC | `electron/src/shared/channels/` (17 个域) |
| 文档 | `docs/SOUL_SCHEMA.md` (重写)、`docs/AIRI_STUDY.md` |
