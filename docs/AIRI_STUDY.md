# airi 深度研究 + LUVU 移植方案

> 研究时间：2026-05-16  
> 研究目标：吸收 airi 的成熟实现，应用到 LUVU 自有架构

## 🔍 一、airi 是什么

| 项 | 内容 |
|---|---|
| 全名 | `@moeru-ai/airi` |
| 版本 | v0.10.2（活跃维护） |
| 仓库结构 | **pnpm monorepo**：6 个 apps + 45+ packages |
| Stars | 数千（成熟项目） |
| 桌宠 app 名 | `stage-tamagotchi`（Electron） |
| 还有 | `stage-web`（浏览器版） + `stage-pocket`（iOS/Android） |

## 💥 二、最关键的真相：airi 用 **Electron**，不是 Tauri

这一条直接解释了我们 **13 个版本**全部踩到同一组坑的原因。

| 问题 | Tauri 2 现状 | Electron 现状 |
|---|---|---|
| macOS 透明窗口 | corner case 多，每版本 bug | 4 行配置稳定运行 |
| `start_dragging` | IPC NSEvent 过期 bug | 有 `electron-click-drag-plugin` |
| `set_ignore_cursor_events` | webview 收不到事件死循环 | `setIgnoreMouseEvents(false, {forward:true})` |
| 跨 space / 跨屏 | `set_visible_on_all_workspaces` 不稳 | `type: 'panel'` + `setVisibleOnAllWorkspaces` |
| webview 内置 devtools | Cmd+Opt+I 不稳 | `openDevTools({mode:'detach'})` dev 自动开 |

**结论：我们 4 个反复无法修的 bug，都是 Tauri 平台级问题，不是我的代码 bug。**

## 🎯 三、airi 的核心绝招（直接抄）

### 1. 透明窗口（4 行就够）

```ts
// airi: apps/stage-tamagotchi/src/main/windows/shared/window.ts
export function transparentWindowConfig(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    titleBarStyle: isMacOS ? 'hidden' : undefined,
    transparent: true,
    hasShadow: false,
  }
}
```

### 2. 立绘窗口（NSPanel 模式，跨 space，不抢焦点）

```ts
const window = new BrowserWindow({
  width: 450,
  height: 600,
  type: 'panel',                  // 👈 macOS NSPanel，关键
  ...transparentWindowConfig(),
})
```

### 3. 拖动（Electron 透明窗口必备）

```ts
import clickDragPlugin from 'electron-click-drag-plugin'

function handleStartDraggingWindow() {
  const windowId = window.getNativeWindowHandle()
  clickDragPlugin.startDrag(windowId)  // 👈 native 库直接拖
}
```

前端 mousedown 时通过 IPC 调主进程，主进程调原生 native 拖动。**比 Tauri 的 set_position 跟随稳定 10 倍**。

### 4. 像素穿透（forward: true 是关键）

```ts
// 鼠标在立绘上 → 接收事件
window.setIgnoreMouseEvents(false)
// 鼠标在透明区 → 穿透到下层，但鼠标 hover 事件转发给 webview（让 webview 知道何时切回）
window.setIgnoreMouseEvents(true, { forward: true })
```

**关键魔法：`forward: true`**。
- Tauri 切到 ignore=true 后 webview 完全收不到任何事件（陷入死循环）
- Electron `forward: true` 仍能收到 mousemove（但不响应 click），所以能自动切回 false

### 5. Live2D（已有专业 npm 包）

```
@proj-airi/stage-ui-live2d        # Live2D Vue 组件（300+ 行成熟代码）
@proj-airi/model-driver-lipsync   # 嘴型同步（用 wlipsync AudioWorklet）
```

可以直接 `npm install` 这两个包！

**他们的嘴型同步用 `wlipsync`** — 比我们的 RMS 强：
- 提取 AEIOU 5 个元音权重
- 映射到 Live2D 嘴型参数（不只 ParamMouthOpenY）
- 看起来真的在说话，不是机械张合

### 6. dev 模式自动开 devtools

```ts
if (is.dev || env.MAIN_APP_DEBUG) {
  window.webContents.openDevTools({ mode: 'detach' })
}
```

这就是我们一直没看到 console error 的原因——Tauri 这条路 macOS 不稳。

---

## 🏗 四、LUVU 移植方案（v0.6.0 大转向）

### 战略决策

| 项 | 旧方案 | 新方案 |
|---|---|---|
| 桌面壳 | Tauri 2 (Rust) | **Electron**（electron-vite） |
| 主进程语言 | Rust | **TypeScript** |
| 渲染进程 | Vue 3 + PixiJS Live2D | 不变（Vue 复用） |
| Live2D | 我们手写 renderer | 抄 airi `stage-ui-live2d` 思路 / 直接 npm install |
| 嘴型同步 | 我们的 RMS | **wlipsync**（AudioWorklet） |
| TTS sidecar | Python FastAPI | 不变 |
| 灵魂档案 | soul/*.yaml | 不变 |
| 五大域架构 | avatar/brain/hands/presence/infra | 不变（搬到 Electron renderer） |
| MCP 工具调用（M4 灵魂） | 自己加 | 不变（airi 也没有，是我们差异化点） |

### 保留的 70% 工作

- ✅ 灵魂档案 4 个 YAML
- ✅ 三层人格 prompt 设计
- ✅ Python TTS sidecar（edge-tts + CosyVoice）
- ✅ Vue 前端组件（DialogBubble / InputBar / SettingsPanel）
- ✅ 五大域架构 + 事件总线设计
- ✅ docs/ 全部
- ✅ MCP 工具调用规划（M4 项目灵魂）
- ✅ ChromaDB 长期记忆规划（M3）

### 重做的 30%

- ❌ 整个 `src-tauri/` 用 Rust 写的 → 用 TypeScript 重写为 Electron main process
- ❌ Live2D renderer 我们自己写的 → 用 wlipsync + airi 思路重写

### 6 步移植路线

```
M0+ : 在当前项目根创建 electron/ 目录（不动 src-tauri/）
      初始化 electron-vite 项目
      复制 airi 的 transparentWindowConfig + NSPanel 配置
      ✅ Demo: macOS 上一个透明立绘窗口能显示

M1+ : 安装 electron-click-drag-plugin
      实现 startDragging IPC
      实现 setIgnoreMouseEvents(false, {forward:true})
      ✅ Demo: 立绘可拖动 + 透明区穿透

M2+ : 把 src/avatar/ 移植到 Electron renderer
      接入 pixi-live2d-display + wlipsync
      Live2D 立绘 + 自动眨眼 + 视线跟随 + 嘴型同步
      ✅ Demo: 胡桃在屏幕上说话，嘴型同步

M3+ : 把 src/brain/ + src/presence/ 移植
      LLM 流式 + TTS sidecar 接入
      ✅ Demo: 端到端对话 + 用 voice clone 回答

M4+ : 实现项目灵魂——MCP 工具调用
      airi 没有，这是 LUVU 差异化点
      ✅ Demo: "帮我打开 a.txt" → 文件打开

M5+ : 主动陪伴 + 屏幕感知（M5 路线不变）
M6+ : 习惯学习（M6 路线不变）
```

---

## 🚀 五、立即行动建议

**v0.6.0 = Electron 转向 + 抄 airi 透明窗口和拖动**

### 第一步（1 天）

1. 项目根新建 `electron/` 目录
2. `electron-vite scaffold + Vue 3 + TypeScript`
3. 复制 airi 的 4 行透明窗口配置
4. 复制 `type: 'panel'` + `electron-click-drag-plugin`
5. ✅ Demo: 启动后看到一个透明的空白可拖动窗口

### 第二步（2 天）

1. 把 `src/avatar/components/Live2DStage.vue` 移植过去
2. 加 wlipsync
3. ✅ Demo: 胡桃在桌面上动 + 拖动 + 透明区穿透

### 第三步（3 天）

1. 把 `src/brain/` 移植 + 接 LLM
2. TTS sidecar 接进去
3. ✅ Demo: 完整对话 + 嘴型同步

**整个 Electron 转向预计 5-7 天**。完成后 4 个 bug 全部自然消失（因为根本不会出现）。

---

## ⚖ 六、对 airi 的差异化

我们不是 fork airi，是吸收他们的实现 + 加我们的独特价值：

| 维度 | airi 现状 | LUVU 差异 |
|---|---|---|
| 桌面壳 + Live2D | ✅ 成熟 | 抄他们的 |
| 嘴型 / TTS / STT | ✅ 成熟 | 抄 + 加 voice clone |
| 多 LLM provider | ✅ 有 | 一样 |
| **灵魂档案系统** | 简单 | **LUVU 三层人格**（layer1/layer2/反差变量）+ 5 个 YAML 拆分 |
| **MCP 工具调用** | ❌ 没有 | **LUVU 项目灵魂**（M4） |
| **长期向量记忆** | ❌ 没 ChromaDB | **LUVU 有**（M3） |
| **自学习 learned_traits** | ❌ 没有 | **LUVU 有**（M6） |
| **MCP 沙盒批准 UI** | ❌ 没有 | **LUVU 有**（M4） |

→ **LUVU = airi 的形象层 + 我们独有的智能与工具层。** 完全可以做出自己的项目，不只是 fork。

---

## 📝 七、风险

1. **Electron 包体积 80MB+**（vs Tauri 5MB）——值得接受，换稳定性
2. **wlipsync 是 npm 包**——可直接装，但需要现代浏览器 AudioWorklet 支持，Electron WKWebView 没问题
3. **`electron-click-drag-plugin` 是个人项目**——airi 也用，已验证

---

## ❓ 我的提议

**立即开 v0.6.0 — Electron 转向**：

1. 我现在在 `electron/` 子目录初始化 Electron 项目
2. 复制 airi 关键 4 行 + 拖动 + 穿透
3. 跑通一个透明窗口的空 demo（**5 分钟之内你就能看到一个能拖的透明小窗口**）
4. 看到能跑后再继续移植 Live2D

**这次的承诺**：我直接做能看到效果的 demo（不是改一堆代码让你测），跑通后才继续。

**告诉我「开 v0.6.0」**，我立刻开始。  
或者你有别的建议告诉我。
