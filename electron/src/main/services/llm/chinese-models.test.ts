/**
 * Phase 1 I: 国产 LLM 检测 + 中文增强单测。
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import {
  detectChineseModelFamily,
  enhanceMessagesForChineseModel,
  getChineseFamilyHint,
} from './chinese-models'

describe('detectChineseModelFamily', () => {
  it('Qwen 各种变体', () => {
    expect(detectChineseModelFamily('qwen2.5-7b-instruct')).toBe('qwen')
    expect(detectChineseModelFamily('Qwen3-32B-Q4_K_M')).toBe('qwen')
    expect(detectChineseModelFamily('qwen/qwen3.6-35b-a3b')).toBe('qwen')
    expect(detectChineseModelFamily('QwQ-32B-Preview')).toBe('qwen')
    expect(detectChineseModelFamily('通义千问')).toBe('qwen')
  })

  it('DeepSeek 各种变体', () => {
    expect(detectChineseModelFamily('deepseek-chat')).toBe('deepseek')
    expect(detectChineseModelFamily('deepseek-r1-distill-llama-8b')).toBe('deepseek')
    expect(detectChineseModelFamily('DeepSeek-V3')).toBe('deepseek')
    expect(detectChineseModelFamily('deep-seek-coder')).toBe('deepseek')
  })

  it('Kimi / Moonshot', () => {
    expect(detectChineseModelFamily('moonshot-v1-8k')).toBe('kimi')
    expect(detectChineseModelFamily('kimi-k2-instruct')).toBe('kimi')
    expect(detectChineseModelFamily('moonshotai/Kimi-K2.6')).toBe('kimi')
  })

  it('GLM', () => {
    expect(detectChineseModelFamily('glm-4.6-flash')).toBe('glm')
    expect(detectChineseModelFamily('glm-4.6v-flash')).toBe('glm')
    expect(detectChineseModelFamily('chatglm3-6b')).toBe('glm')
    expect(detectChineseModelFamily('zhipuai/glm-4.6')).toBe('glm')
    expect(detectChineseModelFamily('智谱清言')).toBe('glm')
  })

  it('Yi', () => {
    expect(detectChineseModelFamily('Yi-Lightning')).toBe('yi')
    expect(detectChineseModelFamily('yi-vl-34b')).toBe('yi')
    expect(detectChineseModelFamily('01-ai/Yi-9B')).toBe('yi')
    expect(detectChineseModelFamily('Yi')).toBe('yi')
  })

  it('Hunyuan', () => {
    expect(detectChineseModelFamily('hunyuan-pro')).toBe('hunyuan')
    expect(detectChineseModelFamily('tencent/hunyuan-large')).toBe('hunyuan')
  })

  it('Doubao', () => {
    expect(detectChineseModelFamily('doubao-pro-32k')).toBe('doubao')
    expect(detectChineseModelFamily('bytedance/doubao-1.5')).toBe('doubao')
    expect(detectChineseModelFamily('豆包')).toBe('doubao')
  })

  it('非国产模型应返回 null', () => {
    expect(detectChineseModelFamily('gpt-4o')).toBeNull()
    expect(detectChineseModelFamily('claude-opus-4-7')).toBeNull()
    expect(detectChineseModelFamily('llama3-70b-instruct')).toBeNull()
    expect(detectChineseModelFamily('gemini-2.0-flash')).toBeNull()
    expect(detectChineseModelFamily('mistral-large')).toBeNull()
  })

  it('空字符串 / null safe', () => {
    expect(detectChineseModelFamily('')).toBeNull()
  })

  it('部分匹配但应跳过的（避免误判）', () => {
    // "Aurora-yi" 不算 Yi 家族（不在 ^yi 或 yi-xxx 模式）
    expect(detectChineseModelFamily('Aurora-yi')).toBeNull()
    // "qiwen" / "queen" 没有 \bqwen\b
    expect(detectChineseModelFamily('queen-classic')).toBeNull()
  })
})

describe('enhanceMessagesForChineseModel', () => {
  const base: ChatMessage[] = [
    { role: 'system', content: '你是 LUVU。' },
    { role: 'user', content: '你好' },
  ]

  it('非国产模型应原样返回', () => {
    const out = enhanceMessagesForChineseModel(base, 'gpt-4o')
    expect(out).toBe(base) // reference equality 也行
  })

  it('Qwen 应注入到 system 末尾', () => {
    const out = enhanceMessagesForChineseModel(base, 'qwen3-32b')
    expect(out).not.toBe(base) // 新数组
    expect(out[0]!.role).toBe('system')
    expect(out[0]!.content).toContain('你是 LUVU。')
    expect(out[0]!.content).toContain('不是 AI 助手')
    expect(out[0]!.content).toContain('思考')
    expect(out[1]).toBe(base[1]) // user 消息引用不变
  })

  it('DeepSeek 注入 reasoning 控制提示', () => {
    const out = enhanceMessagesForChineseModel(base, 'deepseek-r1')
    expect(out[0]!.content).toContain('维持角色')
    expect(out[0]!.content).toContain('<think>')
  })

  it('Kimi 注入长上下文提示', () => {
    const out = enhanceMessagesForChineseModel(base, 'moonshotai/Kimi-K2.6')
    expect(out[0]!.content).toContain('长上下文')
    expect(out[0]!.content).toContain('简短俏皮')
  })

  it('GLM 注入图像/检索系统警告', () => {
    const out = enhanceMessagesForChineseModel(base, 'glm-4.6v-flash')
    expect(out[0]!.content).toContain('真实的角色')
    expect(out[0]!.content).toContain('识图')
  })

  it('Yi 强调纯中文不夹英文', () => {
    const out = enhanceMessagesForChineseModel(base, 'Yi-Lightning')
    expect(out[0]!.content).toContain('纯中文')
    expect(out[0]!.content).toContain('中英夹杂')
  })

  it('Hunyuan 去客服腔', () => {
    const out = enhanceMessagesForChineseModel(base, 'hunyuan-pro')
    expect(out[0]!.content).toContain('客服腔')
    expect(out[0]!.content).toContain('请问您')
  })

  it('Doubao 去客服开场', () => {
    const out = enhanceMessagesForChineseModel(base, 'doubao-pro-32k')
    expect(out[0]!.content).toContain('客服开场')
  })

  it('无 system message 时不注入（不创造）', () => {
    const noSystem: ChatMessage[] = [{ role: 'user', content: '你好' }]
    const out = enhanceMessagesForChineseModel(noSystem, 'qwen3')
    expect(out).toEqual(noSystem)
  })

  it('多个 system message 时只追加到最后一条', () => {
    const multi: ChatMessage[] = [
      { role: 'system', content: 'A' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'hi2' },
    ]
    const out = enhanceMessagesForChineseModel(multi, 'qwen3')
    expect(out[0]!.content).toBe('A') // 不变
    expect(out[2]!.content).toContain('B')
    expect(out[2]!.content).toContain('不是 AI 助手')
  })

  it('不修改原 messages（不变性）', () => {
    const snapshot = JSON.stringify(base)
    enhanceMessagesForChineseModel(base, 'qwen3')
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})

describe('getChineseFamilyHint', () => {
  it('每个家族都有非空 hint', () => {
    const families = ['qwen', 'deepseek', 'kimi', 'glm', 'yi', 'hunyuan', 'doubao'] as const
    for (const f of families) {
      const h = getChineseFamilyHint(f)
      expect(h).toBeTruthy()
      expect(h.length).toBeGreaterThan(50)
    }
  })
})
