/**
 * v0.13 (audit): brain/parser 单元测试 — 解析 LLM 输出协议。
 * 纯函数无 Vue 依赖，vitest node env 直接跑。
 */
import { describe, it, expect } from 'vitest'
import { parseReply, parsePartialText } from './parser'

describe('parseReply — 完整 JSON', () => {
  it('标准 JSON {text, emotion, intensity}', () => {
    const raw = '{"text": "你好主人", "emotion": "shy", "intensity": 0.7}'
    const r = parseReply(raw)
    expect(r.text).toBe('你好主人')
    expect(r.emotion).toBe('shy')
    expect(r.intensity).toBe(0.7)
  })

  it('JSON 在 ```json fence 内', () => {
    const raw = '```json\n{"text": "嗯嗯", "emotion": "happy", "intensity": 0.9}\n```'
    const r = parseReply(raw)
    expect(r.text).toBe('嗯嗯')
    expect(r.emotion).toBe('happy')
  })

  it('JSON 前后带闲话也能抽出来', () => {
    const raw = '好的，这是回复：{"text": "在的", "emotion": "neutral", "intensity": 0.5} 完毕'
    const r = parseReply(raw)
    expect(r.text).toBe('在的')
  })

  it('intensity 超 1 应 clamp 到 1', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":99}')
    expect(r.intensity).toBe(1)
  })

  it('intensity 负数应 clamp 到 0', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":-5}')
    expect(r.intensity).toBe(0)
  })

  it('intensity 非数字应 fallback 0.5', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":"abc"}')
    expect(r.intensity).toBe(0.5)
  })

  it('未知 emotion 应 fallback neutral', () => {
    const r = parseReply('{"text":"x","emotion":"existential_dread","intensity":0.5}')
    expect(r.emotion).toBe('neutral')
  })

  it('emotion 大小写不敏感', () => {
    const r = parseReply('{"text":"x","emotion":"SHY","intensity":0.5}')
    expect(r.emotion).toBe('shy')
  })
})

describe('parseReply — fallback', () => {
  it('完全不是 JSON 应作为 text 返回', () => {
    const r = parseReply('就直接说话呗')
    expect(r.text).toBe('就直接说话呗')
    expect(r.emotion).toBe('neutral')
    expect(r.intensity).toBe(0.5)
  })

  it('text 字段缺失应走 fallback', () => {
    const r = parseReply('{"emotion":"happy","intensity":0.5}')
    expect(r.emotion).toBe('neutral') // fallback 不读那个 JSON
  })
})

describe('parseReply — stripInlineDescriptions', () => {
  it('删除 text 内的 (动作描述)', () => {
    const r = parseReply('{"text":"主人 (微笑着) 我在","emotion":"happy","intensity":0.5}')
    expect(r.text).not.toContain('微笑着')
    expect(r.text).toContain('主人')
    expect(r.text).toContain('我在')
  })

  it('删除 text 内的【动作】', () => {
    const r = parseReply('{"text":"主人【撒娇】我在","emotion":"happy","intensity":0.5}')
    expect(r.text).not.toContain('撒娇')
  })

  it('删除 *emote*', () => {
    const r = parseReply('{"text":"主人 *害羞* 嗯","emotion":"shy","intensity":0.5}')
    expect(r.text).not.toContain('害羞')
  })

  it('不删除长内容（>30 字符可能是正文）', () => {
    const longText = '主人这是一段很长的描述真的非常长不应该被删掉因为可能是正文内容'
    const r = parseReply(`{"text":"(${longText})","emotion":"neutral","intensity":0.5}`)
    expect(r.text).toContain(longText)
  })
})

describe('parseReply — actions 数组', () => {
  it('change_emotion action', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":0.5,"actions":[{"type":"change_emotion","emotion":"shy","intensity":0.8}]}')
    expect(r.actions).toBeDefined()
    expect(r.actions).toHaveLength(1)
    expect(r.actions![0]).toMatchObject({ type: 'change_emotion', emotion: 'shy', intensity: 0.8 })
  })

  it('glance_at_screen 必须有 screen_x + screen_y', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":0.5,"actions":[{"type":"glance_at_screen","screen_x":100,"screen_y":200,"duration_ms":2000}]}')
    expect(r.actions).toHaveLength(1)
    expect(r.actions![0]).toMatchObject({ type: 'glance_at_screen', screen_x: 100, screen_y: 200 })
  })

  it('glance_at_screen 缺坐标应被丢弃', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":0.5,"actions":[{"type":"glance_at_screen","duration_ms":2000}]}')
    expect(r.actions).toBeUndefined()
  })

  it('未知 action type 应被丢弃', () => {
    const r = parseReply('{"text":"x","emotion":"happy","intensity":0.5,"actions":[{"type":"hack_into_kernel"}]}')
    expect(r.actions).toBeUndefined()
  })

  it('最多保留 3 个 action（防止 LLM 给一长串）', () => {
    const actions = Array.from({ length: 10 }, () => ({ type: 'look_back_to_master' }))
    const r = parseReply(`{"text":"x","emotion":"happy","intensity":0.5,"actions":${JSON.stringify(actions)}}`)
    expect(r.actions).toHaveLength(3)
  })
})

describe('parsePartialText — 流式增量', () => {
  it('完整 text 字段提取', () => {
    expect(parsePartialText('{"text":"你好主人","emotion":"shy"}')).toBe('你好主人')
  })

  it('未闭合 text 也能提取已收到部分', () => {
    expect(parsePartialText('{"text":"你好')).toBe('你好')
  })

  it('escape 字符 \\n 转换', () => {
    expect(parsePartialText('{"text":"第一行\\n第二行')).toBe('第一行\n第二行')
  })

  it('escape \\"  转换', () => {
    expect(parsePartialText('{"text":"他说\\"嗨\\"')).toBe('他说"嗨"')
  })

  it('没 text 字段返空', () => {
    expect(parsePartialText('{"emotion":"shy"}')).toBe('')
  })
})
