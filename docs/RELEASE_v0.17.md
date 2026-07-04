# Release v0.17 — In-Progress Notes

> **状态**：v0.17 是渐进式 release，本文档记录截至当前合并到 main 的 v0.17 内容（未打 dmg）。
> 上一个 release：[v0.16.0 — 模型完整度工坊](RELEASE_v0.16.md)

## 大方向（来自 v0.16 release notes）

> v0.17: 外部 MCP server discovery + RPA
> v0.16.1: 接 AI 原画生成（SD/NovelAI）+ 图层切割

## 本次合并的 3 个支柱

### 1. 桌宠原生化（macOS daemon-style）

让 LUVU 从"一个应用"变成"驻留桌面的生物"。关键改动 in `main/index.ts` + `main/windows/main-window.ts`：

- `app.setActivationPolicy('accessory')` — 不进 Dock / Cmd+Tab / Mission Control
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`
  - `skipTransformProcessType: true` 是关键。`setVisibleOnAllWorkspaces` 默认会把 accessory process 转回 regular（撤销前者），传 true 阻止
- `setAlwaysOnTop(true, 'screen-saver', 1)` — Electron 最高层级（盖菜单栏 / Dock / Spotlight / 全屏视频）
- 默认不开 detached DevTools — detach 窗口是 NSWindow，macOS 会把 process 转回 regular。`LUVU_DEBUG=1` / `MAIN_APP_DEBUG=1` 时打开
- Tray menu 加 UI zoom 三连入口（`🔍+ / 🔎− / ↻`）

### 2. AI 原画生成（v0.16.1 范围）

底层已在 v0.16 ComfyUI 集成中接通（`main/services/comfyui/*.ts` + `CreatorStudioPanel.vue` 5 tabs）。本次增量：

- CreatorStudioPanel T2I 加 **快速 prompt 模板 chip**（Live2D 立绘 / 贴纸 / 卧室背景 / 星空背景 / 角色设定图）— 用户 1 秒触发"标准 prompt"
- 完整 pipeline：T2I (文生图) / I2I (图生图) / T2V (文生视频) / I2V (图生视频) / 历史
- ComfyUI status / checkpoint / sampler / scheduler / lora / video model 全部已枚举

**未做（明确范围外）**：图层切割 + moc3 自动编译。这两步需要 PSD 解析（dpsd-py 等库）+ Live2D Cubism Editor 自动化，超出 LLM 代码工具范围。当前 release 仅支持：用户用 AI 生成原画 → 手工导入 Cubism Editor 制作 → 拖回 LUVU。

### 3. 外部 MCP server 客户端（v0.17 范围）

新文件：`main/services/mcp-client.ts` (~190 行) + `main/ipc/mcp.ts` + `shared/api.ts` 加 `mcp` surface。

手写最小 JSON-RPC over stdio 客户端，不引入 `@modelcontextprotocol/sdk` 依赖：

- `mcp:register` — `spawn(command, args, env)` 启动 stdio MCP server → `initialize` 握手 → `tools/list` 拉取工具清单
- `mcp:list-servers` / `mcp:list-tools` — 查询已注册的 server 和它们暴露的工具
- `mcp:call-tool` — `tools/call` JSON-RPC 转发调用
- `mcp:unregister` — `child.kill()` 清理
- App 退出时 `shutdownAll()` 全部关停

**未做**：UI 入口（设置面板需要加 MCP server 列表 tab — 单独 task）。目前只有 IPC，用户暂时无法在界面里加 MCP server。

## 视觉融入感（桌宠真正像活着）

- SceneBackground 9 个场景渐变浓度 `0.55 → 0.18`，shape 从 `circle 50% 60%` → `ellipse 60% 50% at 50% 75%` — 只在立绘脚下有色，不再像 panel
- Live2D canvas 双层 `filter: drop-shadow(...) drop-shadow(...)` — 跟随 alpha 形状投影（不是矩形 box-shadow）
- DialogBubble 改漫画气泡风：`border-radius: 22px 22px 22px 8px` + drop-shadow + 不透明度 0.94 → 0.82 + 7s 动态隐藏（按字数 5-18s）
- 立绘头顶位置（之前在右下角像 toast），箭头朝下指向 character

## AI 行为协同

- TTS `emotion_voice_map` 8 情绪分不同 Edge voice（happy=Xiaoxiao / sad=Xiaobei / angry=Xiaohan / shy=Xiaoyi / tease=Xiaoshuang / sleepy=Xiaomo / surprise=Xiaoxiao / neutral=Xiaoyi）+ 旧默认 migration
- Rules planner 加 `play_group` action — LLM 失败 fallback 时立绘也有动作
- Reactive trigger — `mouse_stayed / typing_burst / app_focus_changed` 经 25-35s cooldown 即时反应
- LLM planner budget 4→6/min — proactive (1.3/min) + reactive (1.7/min) 留 50% headroom
- 鼠标 hover alpha 命中区 35% 概率触发微反应（FlickLeft/Right/Tap + shy/happy/tease emotion）

## 长期向量记忆 IPC 桥接通（M2）

v0.15 的 `memory:*` IPC 之前 main 端注册了但 preload 没暴露 → renderer 调用是空操作。本次：

- `shared/api.ts` 加 `memory: { list / count / add / delete / search / extractFromTurn / ragContext / dailyReflection }` 8 个方法 type
- `preload/index.ts` 加 invoke wrapper
- `dialog.ts` 从 `(window.api as unknown).memory?.extractFromTurn` cast 改回 typed `window.api.memory.extractFromTurn` 调用

## 稳定性

- Live2D 模型加载失败自动 fallback 3 次到下一个可用 cubism4 模型（不再黑屏）
- `Live2DStage.vue` 3 个 bus listener (`lipsync` / `emotion-changed` / `mouse-inside`) 之前没 `bus.off`，热重载累积泄漏 — 改 `cleanupHandlers` 数组统一清理
- `App.vue` `character:switched` 匿名 handler 没 off — 加 `offCharSwitchedFn` 引用
- LLM budget push 移到 cfg 校验之后 — 未配置不消耗 4/min budget
- `isOverUiElement` 用 `elementsFromPoint`(复数) 穿透 `pointer-events: none` 全屏覆盖层；250ms cache + `forceInteractive` 时清空
- DialogBubble `transform: translateX(-50%) scale(var(--ui-scale, 1))` scoped 内合写 — 不能放进 global rule（transform 不叠加）

## 文档

- 新增 `CLAUDE.md`（架构 + 五大域 + 桌宠原生化关键三连 + 像素穿透判定 + IPC 命名 + Tier 3 TS strict + Don't 列表）

## 下一步路线

- **v0.17.1**：MCP server UI（设置面板加 "外部工具" tab 让用户加 server）
- **v0.17.2**：M2 RAG context prepend 接入 chat 前置流程（IPC 通了但还没在 dialog flow 里调）
- **v0.18**：图层切割研究 — 调研 dpsd / Live2D Cubism Editor 自动化可行性

---

## License

[MIT](../LICENSE)
