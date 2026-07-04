# Cubism Editor Tutorials 索引（中文版）

> 来源：https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/top/
> 抓取日期：2026-05-19
> 用途：Master 学习 Cubism Editor 的实操路径。**强烈建议按下面 §1 → §3 → §5 的顺序通读**。

---

## 0. 开始前

- [Live2D 术语表](https://docs.live2d.com/zh-CHS/cubism-editor-manual/glossary/) ⭐
- [图解 Live2D](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/figure/) ⭐ ← 强烈推荐先看一遍图解

## 1. 基础教程（6 课，必修）⭐⭐⭐

按顺序学习：

1. [插画处理](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/psd/) — 在 PS 里把立绘拆层（眼/嘴/头发/身体...）
2. [让插画准备好动起来](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/import/) — PSD 导入 Editor、绘制顺序、Mesh
3. [添加表情](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/expression/) — 眨眼、张嘴、A/I/U/E/O 等参数关键点
4. [添加身体动作](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/deformer/) — Warp/Rotation 变形器，身体摇摆
5. [添加脸部 XY 动作](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/xy/) — 头部转动的"3D 假象"
6. [创建动画](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/animator/) — Animation Mode 时间轴录制动作

## 2. 模板教程

- [使用模板轻松建模](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/template/) ⭐ ← Master 第一次建模强烈推荐用模板套现有模型

## 3. 参数控制器（4 课）⭐

1. [控制器设置](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/controller-settings/)
2. [目标跟踪设置](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/target-tracking-settings/)
3. [使用控制器创建动画](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/animation-using-controller/)
4. [使用指南 / 技巧](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/parameter-controller-tips/)

## 4. 混合模式 & 离屏绘制

- [增强表现力](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/blendmode-offscreendrawing/) — 发光、阴影、玻璃质感

## 5. 运行时 / 导出教程（6 课）⭐⭐⭐ ← 给 LUVU 用必修

1. [模型准备](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/preparing-the-model/) — 命名、检查、清理
2. [物理设置](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/physical-calculation-settings/) ⭐ — 头发/胸口/耳朵跟着头摇摆
3. [动作和表情](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/prepare-motions-and-expressions/) ⭐ — motion3.json / exp3.json
4. [导出数据](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/exporting-data-for-embedding/) ⭐⭐ — 导出 moc3 + 贴图 + JSON
5. [Viewer 操作（OW）](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/operation-of-viewer-original-workflow-version/) — Cubism Viewer 中配 motion/expression/pose 组
6. [Viewer 操作（Unity）](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/operation-of-the-viewer-unity-version/)

## 6. 提升品质

- [动作质量技巧](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/motion-hint/) ⭐
- [Natori 制作示例视频](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/natori_making/) ⭐

## 7. 便捷功能

- [功能介绍](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/function/)

## 8. AE 插件

- [跟踪功能](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/cubism-ae-plugin-tracking/)
- [模型介绍视频](https://docs.live2d.com/zh-CHS/cubism-editor-tutorials/model-introduction/)

---

## 给 Master 的学习路径建议

**Week 1（入门）**：§0 图解 + §1.1–§1.2（PSD 拆层 + 导入）
**Week 2（建模）**：§1.3–§1.5（表情 + 变形器 + XY 头部）
**Week 3（动作）**：§1.6（创建动画） + §6 动作质量技巧
**Week 4（出包）**：§5 全 6 课（物理 → 动作配组 → 导出 → Viewer）

**学完以后**：Master 给我一份 PSD 或现有 model3 目录，我可以辅助你：
- 标准化命名、检查文件结构完整性
- 写/改 .physics3.json、.exp3.json、.model3.json（这些都是 JSON）
- 用 LLM 生成 .motion3.json 草稿（再由你在 Editor 里精修）
- 把成品接到 LUVU 渲染管线
