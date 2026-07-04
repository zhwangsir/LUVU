# LUVU v0.16 — Live2D 模型完整度工坊

> 发布日期：2026-05-18
> Tag: v0.16.0

**v0.16 主题**：解释清楚 Live2D 是什么 + 我能做什么 + 把 1389 模型「填完整」。

---

## 🎯 Why v0.16

之前 master 问：「为什么你不能直接帮我设计完整 Live2D 立绘？」

**核心答案**：
- Live2D 是 2D 网格变形动画（不是 3D 建模），核心 `.moc3` 是闭源二进制
- 创建 `.moc3` 必须用 Cubism Editor（无 API/CLI 让 AI 控制）
- 原画 PSD + 图层切割 + mesh 绑定 + 物理调试 全是**人工创作**

**我能做的**：让现有模型变完整。

详细解释：[docs/RELEASE_v0.16.md 末尾的「Live2D 技术解释」](#-live2d-是什么)

---

## 🛠️ 5 个新工坊能力

### T1 — motion-factory 增强：auto-fill 接真 LLM 生成
- 之前 `models:auto-fill` 用 placeholder（眨眼参数轻摆）
- 现在调 `motion-factory.generateMotion` 让 LLM 输出有意义的 motion
- 9 种 group 名映射（idle / tap / talk / shy / angry / happy / sad / nod / shake）
  → 翻译成 LLM prompt：「idle = 自然待机 1-2 秒微呼吸」
- LLM 失败时 fallback 占位（保证不破模型）

### T2 — 8 标准 expression 一键模板
新 service `expression-pack.ts`：
- 8 个表情按 Live2D Cubism 行业参数命名（ParamMouthForm / EyeLOpen / BrowLY / Cheek...）
- neutral / happy / sad / angry / surprise / shy / tease / sleepy
- Blend='Add' 不冲突 motion / breath / lipsync
- 一键给一个模型加全 8 套，已存在不覆盖

### T3 — 物理预设库（5 模板）
新 service `physics-presets.ts`：
- 🦱 短发 / 💁 长发 / 👯 双马尾 / 👗 长裙 / 🩱 短裙
- 每预设含 chain_length + mobility + delay 调好的常见物理参数
- 生成完整 `physics3.json`（Version 3 schema）+ 更新 model3.json
- 设计：模型若没对应 output param，Cubism runtime 静默忽略，不破模型

### T4 — 参数命名标准化检测
新 service `param-naming.ts`：
- **⚠️ 真 rename 不可行**（参数名在 .moc3 二进制里，改 motion3 引用会失效）
- 所以只做检测 + 报告：
  - 扫所有 motion3/exp3 实际使用的参数
  - 对比 35 个标准 Live2D 参数名（STANDARD_PARAM_NAMES）
  - 识别非标准：Param01-99 / 蛇形大写 / 单字母 / 含中文 / 不以 Param 开头
  - 启发式建议名（基于观察到的值范围）：
    - 0-1 范围 → 可能是 EyeOpen / MouthOpenY
    - -1~1 → 可能是 MouthForm / BrowForm
    - ±30 → 可能是 AngleX/Y/Z

### T5 — 🔬 模型完整度仪表盘
新组件 `ModelHealthDashboard.vue` (~430 行)：
- **5 维统计**：总数 / 平均评分 / 缺 motion / 缺 expression / 缺 physics
- **Grade 分布**：A/B/C/D 4 个 pill，点击 filter
- **🪄 批量补全所有 D 级模型** — 逐个 auto-fill，progress 实时显示
- **Filter tabs**：全部 / 缺 motion / 缺 exp / 缺 physics
- **模型列表**：每行 grade 徽章 + 名字 + 评分 + 第一条 hint
- **详情面板**：选中模型时展开
  - 🎭 一键加 8 expression
  - 💨 一键应用长发/短发物理

入口：ControlDock 加「🔬 模型健康」按钮（✓ 圆圈 icon）

---

## 🎓 Live2D 是什么（技术解释）

### 不是 3D，是 2D 网格变形

一张原画被画师**切成几十~几百个图层**（眼/眉/嘴/头发每股/裙摆每段...），每个图层**贴到一个三角网格 (mesh)** 上，通过移动 mesh 顶点让图层变形。

### 文件结构

```
.moc3              ← 二进制网格 + 参数定义 (闭源黑盒)
*.png              ← 各图层纹理
*.model3.json      ← 入口（引用 moc3 + 纹理 + motion）
*.motion3.json     ← 动画 = keyframe 序列
*.exp3.json        ← 表情 = 参数固定值组合
*.physics3.json    ← 头发/裙摆物理参数
```

### 参数系统

```
ParamAngleX     头水平转 (-30 ~ 30)
ParamEyeLOpen   左眼开度 (0 ~ 1)
ParamMouthForm  嘴型 (-1 ~ 1, 笑 vs 撇嘴)
ParamBreath     呼吸（自动循环）
...
```

每个参数控制 mesh 顶点位置的插值 — 画师在 Cubism Editor 里手画：「`ParamAngleX = 0` 时眼睛在这里，`= 30` 时眼睛在那里」，中间值线性插值。

### 我能做和不能做

| 项 | 我能做 | 必须 Cubism Editor |
|-----|--------|---------------------|
| 学习模型结构 | ✅ | |
| 评分完整度 | ✅ | |
| 生成 .motion3.json | ✅（LLM 写 keyframe） | |
| 生成 .exp3.json | ✅（模板填值） | |
| 生成 .physics3.json | ✅（合理起点） | 真调感觉 |
| 修改 model3.json | ✅ | |
| **创建 .moc3** | ❌ | ✅（人画 mesh + 绑参数） |
| **修改原画图层** | ❌ | ✅（画师重绘 PSD） |
| **真 rename 参数** | ❌ | ✅（重新导出 .moc3） |

---

## 📥 下载

| 文件 | 适用 |
|------|------|
| `LUVU-0.16.0-arm64.dmg` | Apple Silicon |
| `LUVU-0.16.0.dmg` | Intel Mac |

**首次打开**：右键 → 打开。详见 [INSTALL.md](../INSTALL.md)。

---

## 🚦 从 v0.15 升级

完全无缝。重启即可享受新仪表盘 + 工坊能力。

---

## 🛣️ 路线图

- ✅ M0-M10 v0.4-v0.15
- ✅ **M11 v0.16**: 模型完整度工坊
- ⏳ v0.16.1: 接 AI 原画生成（SD/NovelAI）+ 图层切割
- ⏳ v0.17: 外部 MCP server discovery + RPA

---

## 📜 License

[MIT](../LICENSE)
