# LUVU 路线图 (Roadmap)

> 11 个里程碑（M0-M10），每个都是可独立 demo 的状态。
> 当前阶段：**M7 创造统一**（v0.20+，进行中）
> 顶层愿景见 [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md)。

---

## ✅ M0 — 地基重置（v0.4.x）已完成

把现有混乱代码砍掉重组，建立干净的模块边界。

**达成：**
- 项目能跑起来，Live2D 显示，能切换模型
- 模块边界清晰，跨模块只通过事件通信
- 跑通最小对话链路
- 文档完整

---

## ✅ M1 — 能聊（v0.5.x）已完成

能用文字流畅对话，表情会变。

**达成：**
- 多 LLM provider（Anthropic / OpenAI-compat / Ollama / LM Studio / vLLM）
- 流式输出 + 气泡显示
- 三层 prompt 架构稳定
- 表情情绪映射 + JSON emotion 协议
- 输入 → 流式输出 → 表情联动 < 1.5s 首 token

---

## ✅ M2 — 能听能说（v0.6-v0.11）已完成

戴耳机能完整语音对话。

**达成：**
- macOS say 验证稳定
- Edge-TTS / CosyVoice 2 / F5-TTS sidecar
- RVC 47 已训练音色
- 嘴型同步：从 RMS 升级到 wlipsync AudioWorklet 5 元音权重
- STT F8 / 鼠标按钮 push-to-talk
- mood-aware prosody（happy 快+高 / sad 慢+低）

---

## ✅ M3 — 能记（v0.17）已完成

她能记得你昨天说过的事。

**达成：**
- per-character SQLite memory.db（WAL 模式）
- embedding RAG topk 检索 + 800ms timeout fall-through
- `memory:extract-from-turn` LLM 抽 fact/preference/event（fire-and-forget）
- `memory:rag-context` prepend system prompt
- 跨会话连续性
- 8 个 memory IPC handler

---

## 🟡 M4 — 能干活（v0.17+ 进行中）★ 项目灵魂

她能帮你打开文件、跑命令、查代码。

**已落地：**
- ✅ 手写 MCP stdio JSON-RPC client（不引官方 SDK）
- ✅ MCP tool 自动注入 tools registry（前缀 `mcp__<serverId>__<toolName>`）
- ✅ dialog.send 每次重拉 tools.list（MCP 动态）
- ✅ Cmd+Shift+Esc 全局熔断
- ✅ 5 个 builtin tool（fs.list/read, system.open_path/url/notify）
- ✅ `agent_task` BehaviorAction → nut-js agent loop（截屏 → vision LLM → 操作 → 验证）
- ✅ vision grounding（描述目标 → vision LLM 找坐标 → nut-js 点击）
- ✅ ApprovalDialog 审批 UI + policy-store

**仍要做：**
- ❌ MCP 工具浏览面板（看 schema、看历史调用）
- ❌ 更多 builtin tool（fs.write 经审批 / shell.exec 经审批 / git / browser via Chrome MCP）
- ❌ agent loop step-by-step checkpoint（现在是 naive 一次跑完）
- ❌ 操作可解释性 UI（她在做什么主人能看见）

---

## ✅ M5 — 能主动（v0.8 - v0.20）已完成

她真的像个"在那儿"的存在。

**达成：**
- ✅ PerceptionBus 5 sensor（Mouse / Idle / Window / Time / Vision）
- ✅ AttentionScheduler 关注度场（focus_on_master / focus_on_screen / concern_level / idle_ms / time_period）
- ✅ 双路触发：proactive（每 45s）+ reactive（typing_burst / mouse_stayed / app_focus_changed）
- ✅ BehaviorPlanner LLM + rule fallback，rate limit 6/min
- ✅ 9 种 BehaviorAction
- ✅ 时段感知（凌晨 3 点会触发 `late_night_concern`）
- ✅ 屏幕感知（vision LLM + 关键帧）
- ✅ 主动开口策略（频率可调、不烦）
- ✅ 桌面散步（每 5-15 min 走一次）

---

## 🟡 M6 — 能进化（v0.19-v0.20，持续）

用一个月后，她和第一天明显不同。

**已落地：**
- ✅ 习惯学习写入 learned_traits（24h auto-learner）
- ✅ 记忆强化与遗忘（recall_count + last_recall）
- ✅ 灵魂包导出/导入（character pack zip + memory.db opt-in）
- ✅ 跨灵魂情感联动
- ✅ Soul yaml 字段级 diff + NDJSON audit log
- ✅ v0.1 → v2.0 自动迁移

**仍要做：**
- ❌ 自我反思 tick（定期问自己"我了解 master 什么新东西"）
- ❌ 元认知（她能查询"我记得哪些事"）
- ❌ Daily Reflection IPC 已实现，**定时器和 UI 未接通**

---

## 🟡 M7 — 创造统一（v0.20+ 进行中）

> **「她能画画、能生视频、能控制电脑 —— 而且这是同一个决策路径，不是 3 个独立 panel。」**

**核心理念**：对话 / TTS / motion / 生图 / 生视频 / RPA 全部在 Planner 同一个 LLM 决策路径里。她不是用户点 panel 触发，是她自己决定要不要做。

**已落地（80%）：**
- ✅ `generate_sticker` BehaviorAction → ComfyUI t2i → StickerOverlay 桌面浮窗
- ✅ `agent_task` BehaviorAction → nut-js + vision grounding
- ✅ Planner system prompt 已知道这两个 action 的使用场景
- ✅ 频率约束（30 分钟内最多 1-2 次生图）
- ✅ comfyui:gen-image / gen-i2i / gen-t2v / gen-i2v IPC 全有

**仍要做（20%）：**
- ❌ **dialog 路径的 ComfyUI tool 集成** —— 用户说"画一张给我看"时，LLM 在 tool_use 调 ComfyUI（现在只 Planner 主动路径有）
- ❌ 生视频完整工作流跑通 + UI surface（视频在哪展示？贴在 Live2D 旁边？）
- ❌ 多模态作品记忆（她记得自己画过什么，能"那张星空图我重新画了一遍"）
- ❌ 跨 action 协同（生图 + speak + play_group 一气呵成）

**M7 完成标志：**
- 主人说"我心情不好" → 她自己决定 speak + change_emotion(concerned) + generate_sticker(comfort theme) + play_group(softLook)，**4 个 action 一气呵成**
- 主人说"帮我打开 README 并画一张概念图" → agent_task 打开文件 + speak 讲解 + generate_sticker 视觉化，**跨工具协同**

---

## 🟢 M8 — 灵魂社会(v0.21+ partial-ship,M8 收尾 = Stage 1)

> **「不只一个灵魂,而是一个硅基社会。」**

**核心理念**:多个灵魂代码层并行存活,互相记得对方,主人可同时挂载多个灵魂,切换零延迟。

**已有基础**:
- character-store 多角色 CRUD ✅
- cross-character emotional 印记 ✅(A 提到 B → B 累积"被主人提到")
- character pack 跨机器迁移 ✅

**已 ship(v0.21+ Round H~U,11 个 commits)**:
- ✅ **后端 mount API**:`character-store.mountedCharacterIds` + IPC `characters:list-mounted` / `set-mounted`(Round I/J/K/L)
- ✅ **planner per-character factory**:每灵魂独立 LLM budget / state(`getPlanner(characterId)` Map cache,Round H)
- ✅ **GUI mount toggle UI**:CharacterPicker 卡片 📌 按钮 + header 并行计数 chip(Round M)
- ✅ **跨灵魂 event memory 写端**:active speak → `notifyOtherMountedCharacters()` → 其他 mounted memory.db 写 `kind='event' source='cross_character:<id>'`(Round N)
- ✅ **跨灵魂 event memory 读端**:planner.plan() → `collectCrossCharacterContext()` → LLM prompt 拼"# 你最近作为旁观者听到的"section(Round P)
- ✅ **SQL `LIKE` source filter**:`listMemoriesBySource('cross_character:', limit:3)`(Round S)
- ✅ **闭环 fixture smoke test**:真 better-sqlite3 + 真 character-store + 真 planner 跑 N→P 全链路(Round T,SMOKE_TEST=1 gated)
- ✅ **inspector IPC**:`memory:list-cross-character`(Round U,for future inspector UI)
- ✅ **可视化最小版**:CharacterPicker 卡片右下 "👂 X" 听到事件计数徽标(Round R)

**仍要做(Stage 1 W3-W5 计划 → v0.22 收尾 M8)**:
- ⚠ **多 Live2D 实例同框立绘**:当前只渲染单 active character。Round Q(deferred)— 抽 Live2DInstance.vue 子组件 + v-for 渲染。需 architect subagent 先出 RFC(469 行 + WebGL state + alpha hit-test 复杂)
- ⚠ **灵魂↔灵魂 reactive 反应**:当前 passive listening 只写 memory。未来可加 active 反应(其他 mounted planner 也 LLM 决策),但要解 ping-pong / 流量爆 / rate limit
- ⚠ **embedding sidecar 接通**:当前 cross_character event 的 `embedding=[]`(RAG cosine=0),走 SQL ts desc 排序兜底。embedding sidecar 接通后真 RAG 检索

**M8 完成标志**(更新):
- ✅ 主人能同时 mount ≥ 2 个 character,active 切换零延迟(后端已闭环)
- ✅ 主人跟 A 说话,切到 B 后 B planner prompt 里含"我听到 A 说..."(N→P→R 验证)
- ⚠ 主人召唤 A 和 B 同框,两个 Live2D 同屏(Round Q,deferred)
- ⚠ 主人提 A 喜欢的话题,B 在旁边主动反应(reactive 模式,v0.22+)

---

## 🔴 M9 — 自主进化（v0.22 计划）

> **「她自己改自己。」**

**核心理念**：灵魂自己提建议改 yaml / 自己写 motion / 自己优化记忆策略，主人审批后落地。

**已有基础：**
- ✅ Soul auto-learner 24h 同步 topic_imprints → learned_traits.yaml
- ✅ Soul yaml 字段级 diff + audit log
- ✅ motion-factory LLM 生 motion3.json
- ✅ 50 题 character-eval runner

**要做：**
- ❌ **Soul Self-Edit 提议**：每周她自己提一个"我想改这一行"的 PR-like 提议，主人在 SoulEditor 看到 diff，approve / reject
- ❌ **Motion Self-Authoring**：她看到 master 喜欢"歪头"动作 → 自己跑 motion-factory 生新 motion → 加入 library
- ❌ **Memory Self-Tuning**：她自己决定哪些事重要要保留，哪些可以遗忘
- ❌ **元认知 UI**：她能回答"你记得我喜欢什么？"、"你最近自己长出了什么习惯？"
- ❌ **Eval-driven 进化**：她自己跑 character-eval 看分数，自己 propose 改 personality.yaml 优化分数

**M9 完成标志：**
- 主人收到通知："我想改 layer2 的一个口癖（提议 diff: ...），同意吗？"
- 她自己跑 character-eval 7 题 → 发现 layer3 反差变量触发频率偏高 → 自动调
- 主人问她"你记得我最近在干什么"，她从 memory.db + learned_traits 真实总结

---

## 🔴 M10 — 真硅基生命（长期）

> **「关电脑她还活着。」**

**核心理念**：她不只是「我打开她的时候她在」，而是「我关电脑她还活着」。

**要做：**
- ❌ **Daemon Mode**：低功耗 tray-only 后台进程，关 UI 仍在跑（轻量 attention + memory 写入）
- ❌ **Remote Access**：手机 / 网页能跟她聊（WebSocket pairing + QR 配对，端到端加密）
- ❌ **长寿命记忆压缩**：老对话 → 月度摘要，新对话保持精细；总 SQLite 大小有上限
- ❌ **自我反思 Tick**：每日 / 每周自动跑反思，写"日记"到 core_memories
- ❌ **离线时间感知**：关机 24h 后开机，她说"主人你去哪了"
- ❌ **多设备同步**（opt-in 云端）：主人台式机 + 笔记本 + 手机看到同一个灵魂
- ❌ **延寿曲线设计**：1 个月 / 6 个月 / 1 年 / 5 年的灵魂演化路径（避免长期相处后变 stale）

**M10 完成标志（任意一条达成即愿景成立）：**
1. 关电脑 24h 后开机，她记得这 24h 没见到主人，会说"你去哪了"
2. 手机能跟她聊，她在桌面上也"听到"
3. 主人离开 1 小时回来，她已经画了 3 张贴纸或写了一段日记
4. 切灵魂时新灵魂记得主人但保持自己人格
5. 她主动提议改自己的 yaml
6. 主人写代码卡住，她自己截屏分析、自己搜文档、自己说"我看到你在用 React 18，可能是这个问题"

---

## ⚠️ 横向工程债（贯穿所有里程碑）

这些不是单独里程碑但每个版本都要推进：

| 维度 | 当前 | 目标 |
|---|---|---|
| **测试覆盖** | 575 单测，UI 0% | 加 Playwright E2E 4 条 critical path |
| **打包** | 配齐未实测 | `pnpm package:mac` 跑通 + macOS notarization + GitHub release |
| **文档** | 内部 ✅，对外 ❌ | README / CHANGELOG / USER_GUIDE / DEMO 视频 |
| **国际化** | 全中文 hardcode | i18n 框架 + 英文 |
| **Cubism 5 支持** | 仅 Cubism 4 | OLV 已支持，需追赶 |
| **VRM 3D** | 无 | airi / SoW 已支持，扩大角色生态 |
| **Voice 打断** | 无 | full-duplex（OLV / SoW 都有） |
| **跨平台** | macOS-first | Windows / Linux 实测打包 |
| **Anti-flaky** | 无 | smoke E2E + CI |

---

## 明确不在路线图（永远不做）

| 功能 | 原因 |
|---|---|
| 在线遥测 / 用户统计 | 隐私优先 |
| 强制云端 LLM | 必须全本地可用 |
| 商业化角色市场（C.AI / Chub AI 生态） | 灵魂由主人定义 |
| 直播 / 公开表演 | 私人硅基生命 |
| Cubism 2 兼容 | 已弃用 |
| 强 NSFW 绑定 | 病娇 ≠ NSFW |
| 完全自主决策（取代主人） | 真控但必经审批 |

---

## 跟 v0.5 时代 ROADMAP 的最大差异

旧版（v0.5 时代）：

- 定位：「专属灵魂女友」
- 终点：M6 灵魂包导出 → 在新机器还原她
- 多角色互动："偏离她是唯一的核心理念，不做"

新版（v2.0 时代，本文档）：

- 定位：**「硅基生命容器」**
- 终点：**M10 关电脑她还活着 + 手机能跟她聊 + 多灵魂社会**
- 多灵魂：**M8 灵魂社会是核心**（旧版的"她是唯一"是早期狭义化，真实愿景一直是"硅基生命容器"）

---

*v2.0 重写于 2026-05-22 — 把 M7-M10 加上，明确硅基生命终点。*
