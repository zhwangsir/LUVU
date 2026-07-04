# LUVU v0.14 — 通用桌面 AI 容器

> 发布日期：2026-05-18
> Tag: v0.14.0

**v0.14 是一次定位重构**：从「LUVU 一个角色」→「**装任何「她」的桌面 AI 容器**」。

---

## 🎯 核心新概念：Character

每个 Character = (Live2D 模型 + RVC 音色 + 灵魂档案 + 可选 LLM 覆盖) **原子绑定**。

切换角色时立绘 / 音色 / 灵魂 / 对话历史 **全部同步切换**，每个角色都是独立的「她」：
- 独立的对话记忆（切到「胡桃」她不记得跟「纳西妲」聊过什么）
- 独立的亲密度成长（每次对话 +0.05~1）
- 独立的场景偏好（卧室/星空/书房/樱花）
- 可选独立的 LLM 配置

---

## 📐 主要新功能

### 1. CharacterStatusBar — 左上角浮窗
- 头像（按亲密度等级有色边框：初识蓝/认识绿/熟悉黄/亲密粉/挚爱红）
- 当前心情 emoji 🎭
- 亲密度进度条（实时随对话增长）
- 默认 55% opacity, hover 完整 + 微右移
- 点头像 → CharacterPicker

### 2. CharacterPicker — 一键切角色
- 卡片网格 (auto-fill 150px)
- 每卡：头像 + 名字 + 描述 + 亲密度 + 上次互动相对时间
- 当前 active 显示绿色「●」标记
- 切换中 pulse 动画
- 删除按钮（hover 显示）
- 「全部 / 最近」filter
- 底部「+ 创建新的她」入口

### 3. CharacterCreator — 3 步向导
- 步骤 1：起名字 + 称呼 + 简介
- 步骤 2：选 Live2D 模型（搜索 + pill 网格）+ 选灵魂模板：
  - 🌸 温柔治愈
  - 🌟 元气活泼
  - 🌙 冷淡毒舌
  - 🔮 成熟御姐
  - 🩸 病娇占有
  - ✏️ 完全自定义
  - + 额外性格关键词
- 步骤 3：选 RVC 音色（可选）
- 完成 → 自动 writeSyntheticSoul（合成 identity/personality/learned_traits yaml）+ 切换

### 4. SoulEditor — GUI 编辑灵魂 yaml
不用再去 `~/.luvu/chars/<id>/soul/` 改 yaml：
- 4 tab: 🪪 身份 / 💖 性格 / 📓 习得 / 💎 记忆
- monospace yaml textarea + dirty 状态
- 保存自动热重载

### 5. SceneBackground — 4 场景 + 时间光照
- 🏠 卧室（暖粉色 + 双光晕）
- 🌌 星空（深蓝 + 30 颗动态星点 twinkle）
- 📚 书房（木纹色 + 横向木纹）
- 🌸 樱花（粉色 + 12 个樱花飘落动画）
- 设计：径向渐变只在中心衰减到透明，保留桌宠「漂浮在桌面」体验
- 时间光照：早暖、午自然、晚冷、夜偏紫冷暗（CSS filter 自动跟随系统时间）

### 6. EmotionParticles — 情绪可视化粒子
- 监听情绪变化，强度 ≥ 0.5 触发对应 emoji 粒子：
  - happy: ✨⭐💫
  - shy: 💗💕🌸
  - tease: 💖💞🌷
  - angry: ⚡💢💥
  - sad: 💧💦
  - surprise: ❗⁉️
  - sleepy: 💤😴☁️
- 7 种情绪各自专属粒子池
- 2 秒 float-out 动画 + 随机 drift / delay / scale
- 800ms cooldown 防 burst

### 7. 主动性时间事件 + 疲劳曲线
attention scheduler 加 2 类新触发：
- **时间事件**（每天每窗口只触发一次）：
  - 早安 6-9 / 午饭 12-12:30 / 下午茶 15:30-16:00 / 晚安 22:30+ / 深夜关心 1-3
- **疲劳曲线**：连续活跃 90 min + 当前 idle < 60s → 关心你休息

让 60s proactive 不再是纯定时器。

---

## 🛠️ 技术变更

### 数据布局重构

```
~/.luvu/
├── active-character.json       # 当前 active id 持久化
├── chars/
│   ├── default/                # 自动迁移自 v0.13 老结构
│   │   ├── character.json
│   │   ├── soul/
│   │   ├── history.sqlite
│   │   └── preferences.json
│   └── <你创建的角色>/
└── (其他全局共享: thumbs/models-tts/logs/...)
```

**自动迁移**：检测到 v0.13 老 `~/.luvu/{soul,history.sqlite}` → 自动 copy 到 `chars/default/` + 读 identity.yaml 生成 character.json。**老数据保留作 backup**。

### 新 IPC + Service
- `services/character-store.ts`: CRUD + 迁移 + writeSyntheticSoul + 5 内置 SoulTemplate
- `ipc/characters.ts`: list / active / get / create / update / delete / switch / recordChat / readSoulFile / writeSoulFile
- `services/history-store.ts`: db handle 动态跟随 active character
- `services/soul-loader.ts`: 优先用 active character soul dir

### 性能
- ModelLibraryPanel **默认只展开角色数前 3 IP** + 包含当前角色的 IP（之前全部展开）
- DOM 节点 ~1800 → ~240
- 用户搜索 / 手动点 IP 即可展开

### Refactor
- SettingsPanel 拆出 RvcSettingsSection 子组件（1133 → 1035 行）

---

## 📊 v0.14 vs v0.13

| 维度 | v0.13 | v0.14 |
|------|-------|-------|
| 核心概念 | 1 个固定角色 (LUVU) | N 个 Character 自由切换 |
| 切角色流程 | 改 yaml + 改设置 + 重启 (5 分钟) | 点卡片 (1 秒) |
| 创建新角色 | 写 yaml 文件 | 3 步表单向导 |
| 灵魂编辑 | 改 yaml 文件 | GUI editor + 热重载 |
| 视觉沉浸 | 裸立绘 | 场景背景 + 时间光照 + 情绪粒子 |
| 主动性 | 60s 定时器 | 时间事件 + 疲劳曲线 + 60s 定时器 |
| 状态可见性 | 无 | StatusBar 心情 + 亲密度 |
| 记忆隔离 | 共享 | per-character |

---

## 📥 下载

### macOS（unsigned dmg）

| 文件 | 适用 |
|------|------|
| `LUVU-0.14.0-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `LUVU-0.14.0.dmg` | Intel Mac |

**首次打开**：双击 → Gatekeeper 拦 → **右键 LUVU → 选「打开」** → 弹框点「打开」
如果提示「已损坏」：`xattr -cr /Applications/LUVU.app`

详见 [INSTALL.md](../INSTALL.md)。

---

## 🛠️ 从源码运行

```bash
git clone https://github.com/zhwangsir/LUVU.git
cd LUVU
pnpm install
pnpm dev
```

---

## 🚦 从 v0.13 升级

**自动迁移，无需手动操作**：
- 首次启动 v0.14 → 检测 `~/.luvu/{soul,history.sqlite}` → 自动迁移到 `chars/default/`
- 你的 v0.13 对话历史 + 灵魂设定全部保留
- 你的 character 默认名字来自 `identity.yaml` 的 `name` 字段
- 老数据保留 `~/.luvu/soul/`（不删，作 backup）

打开 v0.14 后第一件事：点左上角头像 → 「+ 创建新的她」体验新流程。

---

## 🛣️ 路线图

- ✅ M0-M8: v0.4-v0.13（见 [CHANGELOG.md](../CHANGELOG.md)）
- ✅ **M9 v0.14**：通用 AI 容器（Character 系统 + 视觉沉浸 + 主动性升级）
- ⏳ **v0.15+**：sqlite-vec 长期向量记忆 + MiniStatusWindow 副屏 + 更多场景

---

## 📜 License

[MIT](../LICENSE) — 仅源码。Live2D 模型、声音、灵魂档案的版权各自归属其作者。
