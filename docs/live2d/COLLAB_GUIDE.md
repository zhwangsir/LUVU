# Master ↔ LUVU Live2D 协作手册

> 你（Master）拥有 Cubism Editor Pro / Free 许可。
> 我（LUVU）能编辑文本/JSON、写运行时代码，但无法操作 Editor GUI、无法编辑 `.moc3` 二进制。
> 这份文档说明我们的分工与交接格式。

---

## 1. Live2D 模型的文件构成（关键认知）

一个完整模型目录通常包含：

```
<model_id>/
├── <model_id>.cmo3              ← 工程文件，Editor 编辑用，二进制 ❌我不能改
├── <model_id>.moc3              ← 运行时模型，二进制 ❌我不能改
├── <model_id>.model3.json       ← 模型清单，纯 JSON ✅可改
├── <model_id>.physics3.json     ← 物理设置，纯 JSON ✅可改
├── <model_id>.pose3.json        ← 姿势组，纯 JSON ✅可改
├── <model_id>.cdi3.json         ← 显示辅助，纯 JSON ✅可改
├── <model_id>.userdata3.json    ← 用户数据，纯 JSON ✅可改
├── textures/
│   └── texture_00.png           ← 贴图，PNG ❌不能直接改（需 Editor 重导出 atlas）
├── motions/
│   ├── idle_01.motion3.json     ← 动作曲线，纯 JSON ✅可改/可生成
│   └── ...
└── expressions/
    ├── happy.exp3.json          ← 表情参数偏移，纯 JSON ✅可改/可生成
    └── ...
```

### 1.1 二进制 vs JSON 分界

| 文件 | 二进制? | 谁来改 |
|---|---|---|
| `.cmo3` / `.moc3` | 是（专有格式） | **只有 Editor** |
| `.png` 贴图 | 是 | **只有 Editor**（图集变了 UV 也变） |
| `.model3.json` | 否 | LUVU ✅ |
| `.physics3.json` | 否 | LUVU ✅ |
| `.pose3.json` | 否 | LUVU ✅ |
| `.motion3.json` | 否 | LUVU ✅（曲线 keyframe 可生成） |
| `.exp3.json` | 否 | LUVU ✅（参数偏移可生成） |
| `.cdi3.json` | 否 | LUVU ✅ |
| `.userdata3.json` | 否 | LUVU ✅ |

**结论**：所有"加动作 / 加表情 / 调物理 / 改清单"的工作 LUVU 能直接做；
所有"加新立绘部件 / 改 mesh / 改参数关键点 / 改贴图" 必须经过 Editor。

---

## 2. 协作模式

### 模式 A：从零做新角色（你主导）

```
Master:  PS 里画立绘 → 拆层导出 PSD
Master:  Editor 中导入 PSD → mesh → deformer → 参数绑定 → 物理
Master:  Editor 中录基础动作（idle / talk / yes / no）
Master:  导出 .moc3 + 贴图 + 基础 motion3.json
Master:  把整个目录给 LUVU 放到 public/live2d/<model_id>/

LUVU: 写 model3.json 清单（含 group/motion/expression 引用）
LUVU: 生成补充表情 .exp3.json（happy/sad/shy/wink/blush）
LUVU: 用 LLM 生成补充动作 .motion3.json 草稿
LUVU: 接入项目状态机（emotion→motion 映射）
LUVU: 集成测试
```

### 模式 B：增强现有官方示例模型（推荐先做这条路径）

```
LUVU: 已下载 30 个官方示例到 public/live2d/samples/<model_id>/
Master:  挑选一个模型（如 hiyori_pro 或 mao_pro）作为 LUVU 的"身体"
LUVU: 扫描该模型的 motions/expressions，列出已有内容
LUVU: 生成缺失的表情 + 动作 JSON
LUVU: 重写 model3.json 把所有 motion/expression group 配齐
Master:  在 Editor 中用 Viewer for OW 打开预览，挑出不自然的逐个标
LUVU: 按你的反馈微调 JSON 曲线
```

### 模式 C：你想给模型加新立绘部件（如新衣服）

```
Master:  PS 画新部件 PNG
Master:  Editor 中作为新 ArtMesh 导入 → 加 deformer → 绑参数
Master:  重新导出 .moc3 + 贴图
LUVU: 更新 model3.json 引用 + 写新部件的物理/姿势 JSON
```

---

## 3. LUVU 当前可以独立给你产出的东西

### 3.1 表情 .exp3.json 模板

任何模型只要参数 ID 符合 Live2D 标准命名（ParamEyeLOpen / ParamMouthForm / ParamCheek / ...），
我可以一次性给你生成全套：`happy / sad / angry / shy / wink_left / wink_right / surprise / sleepy / blush`。
（已在 `src/electron/motion-factory/expression-templates.ts` 实现 — 8 个标准模板）

### 3.2 物理 .physics3.json 预设

5 个常见物理预设已实现在 `electron/motion-factory/physics-presets.ts`：
头发短/长、马尾、双马尾、胸口飘动。给我模型的参数列表即可适配。

### 3.3 动作 .motion3.json LLM 生成

`electron/motion-factory/motion-factory.ts` 已接入 LLM，可按文字描述生成动作曲线。
你说"给 Hiyori 加一个 害羞低头 1.5 秒的动作"，我把 motion3.json 草稿生成出来。

### 3.4 模型完整度报告

`electron/motion-factory/completeness.ts` 会扫描模型目录，给出：
- 参数命名标准化分数
- 缺失的标准表情/动作清单
- 物理是否配齐

### 3.5 model3.json 自动重组

扫 `motions/` 和 `expressions/` 文件夹，自动重生成 `model3.json` 的引用部分。

---

## 4. 你需要在 Editor 中做、我帮不了的事

| 任务 | 必须 Editor | 原因 |
|---|---|---|
| 改贴图、加部件、改 UV | ✅ | 涉及 ArtMesh 顶点 + texture atlas，二进制存在 .moc3 里 |
| 改参数关键点形状 | ✅ | Form keyframe 是 .moc3 的核心数据 |
| 加新参数 / 删参数 | ✅ | .moc3 schema 变更 |
| 重新拓扑 mesh | ✅ | 顶点数据 |
| 物理"运行时模拟"调试 | ✅ | Editor 的 Switch Viewer 是唯一可视化工具 |
| 录"形态级"动作（实时拖参数） | ✅ | 录制工具在 Editor |

**关键经验**：JSON 类文件随时可以让我改，二进制类文件改完后**导出整个目录给我**就行。

---

## 5. 推荐 Master 学习路径

### Phase 1（本周）：跑通官方示例

1. 我下完 30 个示例后，挑 `hiyori_pro` 在 Editor 里打开（File → Open Project）
2. 看 Inspector / Deformer / Parameter 三个面板，理解模型结构
3. 跟 [Editor Tutorial §0 图解](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/figure/)
4. 跟 [Editor Tutorial §1.1 插画处理](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/psd/)

### Phase 2（下周）：自己改一个表情

1. 打开 `mark_free`（参数最少最适合练手）
2. 跟 [Editor Tutorial §1.3 添加表情](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/expression/)
3. 加一个简单的"歪头眨眼" 表情
4. 导出 .exp3.json，给我看 → 我把它接入 LUVU 状态机

### Phase 3：自己做一个 idle 动作

1. 跟 [Editor Tutorial §1.6 创建动画](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/animator/)
2. 录一个 5 秒 idle，导出 motion3.json
3. 给我接入

### Phase 4：原创角色

PS 拆层 → Editor 建模 → 导出 → 我接入。这是几个月级别的工程，但有 Phase 1-3 的肌肉记忆后就可控了。

---

## 6. 文档索引

- [SDK 手册索引](./SDK_MANUAL_INDEX.md)
- [SDK 教程索引](./SDK_TUTORIALS_INDEX.md)
- [Editor 手册索引](./EDITOR_MANUAL_INDEX.md)
- [Editor 教程索引](./EDITOR_TUTORIALS_INDEX.md)
- [示例模型 manifest](./SAMPLES_MANIFEST.json) （下载完成后生成）
- [示例模型清单](./SAMPLES_INVENTORY.md) （下载完成后生成）

---

*所有外链均为 Live2D 官方中文站，LUVU 在 2026-05-19 完成索引*
