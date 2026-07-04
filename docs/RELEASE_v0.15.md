# LUVU v0.15 — 个性化深化

> 发布日期：2026-05-18
> Tag: v0.15.0

**v0.15 是 v0.14 容器之上的精细化深化** — 让「她」更像她、更有沉浸感、能记住你、会做事。

---

## 🎯 v0.15 核心改进

跨 5 个路径 13 个 commit，几乎所有方面都升级了：

### 路径 B — 个性化升级

| Feature | 描述 |
|---------|------|
| **B1 灵魂 few-shot examples** | 5 个 SoulTemplate 每个 5 段示范对话，**LLM 输出质量飞跃** — 不再泛 AI 腔，直接学角色的语气/用词/emotion 选择 |
| **B2 音色试听 + 自动头像** | CharacterCreator 第 3 步每个 RVC voice 旁边 ▶ 试听 5 秒；选完立绘自动抓 thumb 作角色头像 |
| **B3 克隆角色** | CharacterPicker 卡片右上 ⎘ 按钮，一键 fork 现有角色微调（重置亲密度/历史，复制灵魂/偏好） |

### 路径 A — 沉浸感升级

| Feature | 描述 |
|---------|------|
| **A1 11 场景 + 🌅 Scene tab** | SceneBackground 扩到 11 个（+ 咖啡馆 / 海边 / 雨夜 / 雪景 / 火炉 / 图书馆）；SettingsPanel 加场景 tab 可视化选 |
| **A2 切换 shimmer 过渡** | 切角色时 canvas opacity 淡出 + accent radial-gradient 呼吸 shimmer + 淡入，消除空窗硬切 |
| **A3 立绘呼吸跟情绪** | stage 整体 CSS transform 呼吸节奏跟随 emotion + intensity（happy 1.6s 快振幅大 / sleepy 4.0s 慢振幅小） |

### 路径 E — 立绘模型设计辅助

| Feature | 描述 |
|---------|------|
| **E1 行业标准学习数据库** | 扫所有 cubism4 模型抽取 motion_groups / expression_names / physics 覆盖率 / 完整度分布。出现频率 ≥ 30% 算「标准」 |
| **E1 完整度评分 + 缺失检测** | 每模型 0-100 评分 + A/B/C/D 等级 + missing_motion_groups / missing_expressions 列表 |
| **E2 一键自动补全** | `models:auto-fill` IPC — 调 evaluate 拿 missing → 生成 placeholder motion/expression → 写文件 + 更新 model3.json FileReferences。MVP placeholder（v0.15.1 接 motion-factory LLM 真生成） |

### 路径 C — 长期记忆基建

| Feature | 描述 |
|---------|------|
| **C1 per-character memory.db** | 每角色独立 sqlite，schema: memories(id, kind, text, embedding(JSON), importance, source, ts)。cosine similarity 应用层搜索（不装 sqlite-vec extension） |
| **C2 自动事件抽取** | heuristic 抽取「我喜欢/我是」→ preference (importance 0.7)，长对话 → event (0.4)。fallback embedding 用 32 维 hash |
| **C3 RAG 上下文 + daily reflection** | buildRagContext top-K 相关记忆 prepend prompt；dailyReflection 占位（v0.16 接 LLM 总结） |

### 路径 D — MCP 工具调用

| Feature | 描述 |
|---------|------|
| **D1 内置 3 个 MCP tools** | get_current_time / list_recent_files (Desktop/Downloads/Documents) / recall_memory (检索长期记忆) |
| **D2 灵魂自动注入 tools prompt** | system prompt 末尾自动列「你可以用的工具」+ tool_use JSON 协议描述，LLM 直接会用 |

---

## 📦 重要文件

```
electron/src/main/services/
├── model-learnings.ts       # E1: 行业标准 + 完整度评分
├── model-auto-fill.ts       # E2: 自动补全 motion/expression
├── memory-store.ts          # C1: per-character memory.db + cosine search
├── memory-extractor.ts      # C2+C3: 事件抽取 + RAG + reflection
└── mcp-registry.ts          # D1+D2: 3 内置 tools + soul prompt

electron/src/main/ipc/
├── memory.ts                # 7 memory IPC handlers
└── tools.ts                 # 加 mcp:list + mcp:run

electron/src/renderer/src/infra/ui/settings/
└── SceneSettingsTab.vue     # A1: 11 场景卡片网格 UI

electron/src/renderer/src/infra/ui/
├── SceneBackground.vue      # A1: 11 场景渲染（+ 6 个新场景）
└── CharacterCreator.vue     # B2: 加音色试听 + 头像捕获
```

---

## 📥 下载

| 文件 | 适用 |
|------|------|
| `LUVU-0.15.0-arm64.dmg` | Apple Silicon |
| `LUVU-0.15.0.dmg` | Intel Mac |

**首次打开**：右键 → 打开（unsigned dmg 绕过 Gatekeeper）。详见 [INSTALL.md](../INSTALL.md)。

---

## 🚦 从 v0.14 升级

完全无缝 — Character 数据结构未变。重启即可享受：
- 新 character 创建时自动用 few-shot examples（旧 character 走 SoulEditor 保存一次会触发 yaml 升级）
- 新 character 自动有头像（旧 character 显示 initials）
- 设置面板多一个 🌅 场景 tab
- 切角色有 shimmer 过渡
- 立绘呼吸跟情绪
- 长期记忆 + MCP 工具 IPC ready（v0.16 接 LLM/embedding 完整通路）

---

## 🛣️ 路线图

- ✅ M0-M9: v0.4-v0.14
- ✅ **M10 v0.15**: 个性化深化（B+A+E+C+D 5 路径）
- ⏳ **v0.15.1**: 接真 embedding API + LLM 抽取 + auto-fill 用真 LLM 生成
- ⏳ **v0.16**: 外部 MCP server discovery + 完整 RPA 桌面动作

---

## 📜 License

[MIT](../LICENSE)
