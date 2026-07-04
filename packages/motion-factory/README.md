# @luvu/motion-factory

> Live2D Cubism 4 motion3.json encoder + validator + scorer — pure functions, runtime-agnostic.

提取自 [LUVU](https://github.com/zhwangsir/LUVU) 的纯函数 motion-factory 子集。**零依赖**（不依赖 fs / electron / pixi）— Node + 浏览器 + Deno 通用。

## 安装

```bash
pnpm add @luvu/motion-factory
```

## 用法

### 编码 MotionDraft → motion3.json

```ts
import { draftToMotion3Json, type MotionDraft } from '@luvu/motion-factory'

const draft: MotionDraft = {
  name: 'wave_hand',
  duration: 2.0,
  loop: false,
  tracks: [
    { param: 'ParamAngleX', keyframes: [[0, 0], [1, 30], [2, 0]] },
    { param: 'ParamArmRA', keyframes: [[0, 0], [0.5, 90], [1.5, 90], [2, 0]] },
  ],
  description: '挥手打招呼',
}

const motion3 = draftToMotion3Json(draft)
// → 直接写盘 + 让 Live2D Cubism 4 SDK 加载
```

### 校验 MotionDraft

```ts
import { validateMotionDraft } from '@luvu/motion-factory'

const result = validateMotionDraft(draft, modelSummary)
// → { ok: true } 或 { ok: false, errors: [...], warnings: [...] }
```

### 评分 MotionDraft

```ts
import { scoreMotionDraft } from '@luvu/motion-factory'

const score = scoreMotionDraft(draft, modelSummary)
// → 0-100 分（自然度 + 多样性 + 参数覆盖）
```

## 设计理念

LLM 友好的高层抽象：**KeyframeTrack** = `[time, value][]` 序列，不暴露 Cubism bezier 控制点数学。编码器自动转 motion3 segments (全 Linear, type=0)。

## 为什么从 LUVU 拆出来

LUVU 在 v0.16 做了「Live2D 模型完整度工坊」— LLM 自动生成 motion3 给破损模型补全。这套 encoder/validator/scorer 是其中纯函数核心，airi / character.ai 等 VTuber 项目都能复用。

## License

MIT
