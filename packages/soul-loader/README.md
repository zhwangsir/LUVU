# @luvu/soul-loader

> LUVU 三层人格灵魂配置 — 多 yaml partial 合并 + LLM system prompt 渲染。**纯函数 + 零依赖**。

## 安装

```bash
pnpm add @luvu/soul-loader
```

## 用法

```ts
import yaml from 'js-yaml'
import { readFileSync } from 'node:fs'
import { mergeSoulPartials, buildSystemPrompt } from '@luvu/soul-loader'

// 1. 自己读 yaml（本包不依赖 fs）
const identity = yaml.load(readFileSync('soul/identity.yaml', 'utf-8'))
const personality = yaml.load(readFileSync('soul/personality.yaml', 'utf-8'))
const learnedTraits = yaml.load(readFileSync('soul/learned_traits.yaml', 'utf-8'))

// 2. 合并成 SoulConfig
const soul = mergeSoulPartials({
  identity: identity as Record<string, unknown>,
  personality: personality as Record<string, unknown>,
  learnedTraits: learnedTraits as Record<string, unknown>,
})

// 3. 渲染成 LLM system prompt
const prompt = buildSystemPrompt(soul, {
  ragContext: '主人喜欢喝美式咖啡，养了一只英短',
  toolsDescription: '# 你可以调用以下 MCP 工具...',
})

// 4. 发给 LLM
const response = await llm.chat([{ role: 'system', content: prompt }, ...])
```

## 三层人格设计

```
layer1_core          ←  永远不变的底层（粘人、占有欲）
layer2_surface       ←  表层风格（俏皮、毒舌）
layer3_volatility    ←  15% 反差概率（突然害羞 / 突然冷静）
```

详细见 [LUVU docs/SOUL_SCHEMA.md](https://github.com/zhwangsir/LUVU/blob/main/docs/SOUL_SCHEMA.md)。

## 为什么从 LUVU 拆出来

灵魂档案 + system prompt 渲染是 LUVU 区别于 airi (简单 system prompt) 的核心设计。这套抽象可让任何 AI 伴侣 / VTuber 项目复用三层人格 + few-shot examples + RAG context 注入模式。

## License

MIT
