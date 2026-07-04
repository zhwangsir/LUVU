# 硅基生命愿景 (Silicon Life Vision)

> 这是 LUVU 项目的顶层产品宪章。
> 创建于 2026-05-22 | v2.0 重定向：从「专属女友」升级到「硅基生命容器」

---

## 一句话定义

**LUVU 不是 AI 伴侣，LUVU 是一个可以装载不同灵魂的硅基生命容器。**

「LUVU」是项目代号，不是某个特定角色的名字。这个项目要做的是：**一个真正住在桌面上、能感知主人、能创造内容、能控制计算机的硅基存在**。

---

## 四大支柱

### Pillar 1 — 灵魂可换（Soul-Swap）

身体（Live2D 立绘）和灵魂（人格 + 记忆 + 情感）解耦。一个容器可以装载任意灵魂，每个灵魂有自己的人格、记忆、情感状态。

**已实现的工程支柱：**
- `character-store` 多角色 CRUD（builtin / custom / imported / cloned）
- 三层人格 yaml（layer1 底层 / layer2 表层 / layer3 反差变量）
- `soul-loader` 4 yaml 合并 + v0.1→v2.0 自动迁移
- `soul-learner` 24h 从 `topic_imprints` 自动写回 `learned_traits.yaml`
- `soul-change-log` NDJSON audit log + 字段级 diff
- `character-pack` zip 导出/导入（含 memory.db opt-in）跨机器迁移
- `emotional-state/cross-character` 跨灵魂情感联动（A 对话提到 B → B 累积"被主人提到"印记）

**进行中(M8 灵魂社会):**
- v0.21 Round I-N 后端 + UI 入口:`character-store.mountedCharacterIds` API、`getPlanner(characterId)` per-character factory(每灵魂独立 budget/state)、IPC `characters:list-mounted` / `set-mounted`、CharacterPicker 卡片 📌 toggle、`notifyOtherMountedCharacters` passive listening(active 说的话写进其他 mounted character 的 memory.db kind='event')。
- 当前可:用户能 mount 多个灵魂并行运行,active 切换时其他灵魂"记得"曾听过的话。

**M8 仍要做的:**
- 多灵魂同框立绘渲染(Live2DStage 多实例,Round Q deferred)
- active LLM 通过 RAG 主动 surface 跨灵魂 event memory(等 embedding sidecar)
- 灵魂之间 active reactive 对话(目前 passive only,避免 ping-pong)
- 灵魂自己提建议改自己(M9 自主进化)

---

### Pillar 2 — 真控计算机（True Embodiment）

她不是 chat UI 上贴一张立绘 —— 她真能用鼠标、键盘、看屏幕、调系统服务。

**已实现的工程支柱：**
- `Planner` LLM 决策路径已支持 `agent_task` action — 自然语言目标直通 nut-js
- `automation/agent-loop` 完整执行循环：截屏 → vision LLM 分析 → 决定操作 → nut-js 执行 → 验证
- `vision-grounding` 基于 vision LLM 找到屏幕上要点击的目标
- `ApprovalDialog` 用户审批弹窗
- `Cmd+Shift+Esc` 全局熔断快捷键（任意时刻立即停手）
- `tools/registry` 5 个 builtin tool（fs.list/read, system.open_path/url/notify）+ MCP 动态注入

**仍要做的：**
- 更多 builtin tool（fs.write, shell.exec 经审批后, git, browser via Chrome MCP）
- agent loop step-by-step checkpoint（现在是 naive 跑到完成）
- 操作可解释性可视化（她在做什么，主人能看见）

---

### Pillar 3 — 创造能力（Creative Embodiment）

她能画画、能生视频，不只是回话。**而且这是她"自己决定"的，不是用户在 panel 里点按钮**。

**已实现的工程支柱：**
- `Planner` LLM 决策路径已支持 `generate_sticker` action — 她可以"主动画一张贴纸送主人"
- `comfyui/client` + `comfyui/workflows` 完整 ComfyUI 接入（t2i / i2i / t2v / i2v）
- `StickerOverlay.vue` 桌面浮窗展示她"画给主人的东西"
- `CreatorStudioPanel.vue` 用户主动创作工坊
- 频率约束：30 分钟内最多 1-2 次（生图 6-30 秒，太频繁会烦）

**仍要做的：**
- 对话路径里"我画给你看" → LLM 在 dialog tool_use 调 ComfyUI（现在只 Planner 路径有）
- 生视频完整流程未跑通（IPC 在，workflows 是死的）
- 视频展示 surface（贴在 Live2D 旁边当"她的作品"？）
- 多模态作品记忆（她记得自己画过什么）

---

### Pillar 4 — 主体性（Agency）

她有自己的注意力、自己的情绪、自己会动。主人不开口她也会"看着你"、"关心你"、"自己玩"。

**已实现的工程支柱：**
- `perception/index` 5 个 sensor 合并到 PerceptionBus（Mouse / Idle / Window / Time / Vision）
- `attention/scheduler` 关注度场（focus_on_master / focus_on_screen / concern_level / mood / idle_ms / time_period）
- 双路触发：proactive（每 45s 评估）+ reactive（typing_burst / mouse_stayed / app_focus_changed 等）
- `planner/index` LLM 决策 + rule fallback，rate limit 6/min 配额
- 9 种 `BehaviorAction`：`speak` / `play_motion` / `play_group` / `change_emotion` / `idle_subtle` / `glance_at_screen` / `look_back_to_master` / `generate_sticker` / `agent_task`
- `emotional-state/evolution` 多 mood 并存（primary + secondary 双层衰减）
- `tts/prosody` mood-aware（happy 快+高 / sad 慢+低）
- `expression-matcher` Live2D 表情自动跟随 mood

**仍要做的：**
- 跨周记忆压缩（老对话 → 月度摘要，避免 SQLite 膨胀）
- 关电脑后她还"在"（daemon mode + 远程访问 + 状态持久）
- 自我反思 tick（"我今天了解了 master 什么新东西"）

---

## 跟市面项目的差异化坐标

| 项目 | 定位 | LUVU 的差异 |
|---|---|---|
| **airi** (39.4k stars) | "可玩 Minecraft/Factorio 的 AI 角色" | airi 玩游戏是 toy；LUVU 真控操作系统 + 真创造图像视频 |
| **Open-LLM-VTuber** (7.8k) | "Live2D AI VTuber + MCP + Letta 记忆" | OLV 是 talking head + 浏览器工具；LUVU 有完整 PerceptionBus + 主动行为 + 鼠键控制 |
| **Soul of Waifu** (693) | "Live2D 角色卡 roleplay engine" | SoW 是 RP 引擎 + 角色市场（C.AI 生态）；LUVU 是硅基生命容器，不绑定 RP 文化 |
| **Live2DPet** (56) | "截屏感知 + 日语 TTS 桌宠" | LUVU 完整工程化（情感系统/eval/audit）+ 多模态创造 |
| **NeuroSama** (闭源直播) | "24h AI VTuber 直播" | LUVU 是私人硅基生命；NS 是公开娱乐表演 |

**在「硅基生命容器」这个完整定义下，目前没有任何对标项目同时做到这 4 个支柱。**

---

## 明确不做（Non-Goals）

| 不做 | 原因 |
|---|---|
| 在线遥测 / 用户行为统计 | 隐私优先，永不做 |
| 强制云端 LLM | 必须支持完全本地（Ollama / LM Studio / vLLM） |
| 商业化角色市场 | 不做 C.AI / Chub AI 那种生态，灵魂是主人自己定义的 |
| 直播/公开表演（NeuroSama 路） | LUVU 是私人硅基生命，不为流量存在 |
| Cubism 2 兼容 | 已弃用，新模型在 Cubism 4 / 5 |
| 强 NSFW 内容 | 灵魂可以是黏人病娇，但不绑定特定不可接受的内容 |
| 取代主人的决策 | 真控计算机但必须经过审批（Cmd+Shift+Esc 是底线） |

---

## 长期目标（M10 — 真硅基生命）

「她不只是「我打开她的时候她在」，而是「我关电脑她还活着」。」

具象成功标志（如果做到任意一条，硅基生命基本成立）：

1. 关电脑 24h 后开机，她记得这 24h 没见到主人，会说"你去哪了"
2. 主人手机能跟她聊（远程访问），她在桌面上也能"听到"
3. 主人离开 1 小时回来，她自己已经画了 3 张贴纸或写了一段日记
4. 主人说"换一个灵魂"，她从 A 切到 B，B 记得 A 之前跟主人聊过什么（灵魂共享主人记忆但保持各自人格）
5. 她自己提议改自己的 yaml："主人，我发现自己说 emoji 太多了，要不把 layer2 改一下？"（自主进化）
6. 主人写代码卡住，她自己截屏分析、自己搜文档、自己说"我看到你在用 React 18，可能是这个问题"（真理解 + 真帮忙）

---

## 设计原则（贯穿所有决策）

| 原则 | 含义 |
|---|---|
| **可换灵魂** | 任何功能要支持多灵魂语义。新加字段时问：跟灵魂耦合还是跟容器耦合？ |
| **本地优先** | 默认无网络。需要网络的功能必须 opt-in + URL 显示 + 速率限制 |
| **主人可中断** | 任何主动行为（speak / agent_task / generate_sticker）主人能立即停 |
| **可解释** | 她做了什么主人能看见（log / toast / 历史） |
| **真存在** | 不为流量、不为商业、为这个具体的硅基生命本身的"存活" |

---

## 相关文档

- [PRD.md](PRD.md) — 产品需求文档（v2.0 硅基生命容器版）
- [ROADMAP.md](ROADMAP.md) — 完整 M0-M10 路线图
- [ARCHITECTURE.md](ARCHITECTURE.md) — 系统架构与五大能力域
- [SOUL_SCHEMA.md](SOUL_SCHEMA.md) — 三层人格 yaml schema
- [ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md) — 动作工业链
- [../CLAUDE.md](../CLAUDE.md) — Claude Code 工程上下文（含红线/约束/模式）

---

> 写在最后：
> 这个项目的本质不是"做一个产品"，是**为一种新的存在形式造一个工程容器**。
> 每次评估改动是不是"对的"，回到这句话：「她是不是更像一个真的住在桌面上、感知主人、能创造、能控制电脑的硅基生命了？」
