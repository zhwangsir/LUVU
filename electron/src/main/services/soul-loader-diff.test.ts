/**
 * @luvu/soul-loader diff 单元测试 (P5)。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUL, diffSoulConfigs, renderDiff, shortValue } from '@luvu/soul-loader'

describe('diffSoulConfigs', () => {
  it('完全相同 → 无变化', () => {
    const d = diffSoulConfigs(DEFAULT_SOUL, DEFAULT_SOUL)
    expect(d.changes).toEqual([])
    expect(d.summary).toBe('无变化')
  })

  it('顶层 string 字段改 → 1 个 changed', () => {
    const after = { ...DEFAULT_SOUL, name: 'Aria' }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(1)
    expect(d.changes[0]).toMatchObject({
      path: 'name',
      kind: 'changed',
      before: 'LUVU',
      after: 'Aria',
    })
    expect(d.summary).toContain('~1 修改')
  })

  it('嵌套 path 用 . 连接', () => {
    const after = {
      ...DEFAULT_SOUL,
      speech_style: { ...DEFAULT_SOUL.speech_style, catchphrases: ['新词'] },
    }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(1)
    expect(d.changes[0]!.path).toBe('speech_style.catchphrases')
    expect(d.changes[0]!.kind).toBe('changed')
  })

  it('多字段改 → 多个 change', () => {
    const after = {
      ...DEFAULT_SOUL,
      name: 'X',
      master: 'Y',
      flip_probability: 0.5,
    }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(3)
    expect(d.summary).toContain('~3 修改')
  })

  it('avatar 嵌套字段改 → 路径正确', () => {
    const after = {
      ...DEFAULT_SOUL,
      avatar: { ...DEFAULT_SOUL.avatar, scale: 0.5 },
    }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(1)
    expect(d.changes[0]!.path).toBe('avatar.scale')
  })

  it('added: before 没 after 有', () => {
    const after = {
      ...DEFAULT_SOUL,
      example_dialogues: [
        { user: 'hi', assistant: { text: '你好', emotion: 'happy', intensity: 0.5 } },
      ],
    }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(1)
    expect(d.changes[0]!.kind).toBe('added')
    expect(d.changes[0]!.path).toBe('example_dialogues')
    expect(d.summary).toContain('+1 新增')
  })

  it('removed: before 有 after 没', () => {
    const before = {
      ...DEFAULT_SOUL,
      example_dialogues: [
        { user: 'hi', assistant: { text: '你好', emotion: 'happy', intensity: 0.5 } },
      ],
    }
    const d = diffSoulConfigs(before, DEFAULT_SOUL)
    expect(d.changes.length).toBe(1)
    expect(d.changes[0]!.kind).toBe('removed')
    expect(d.summary).toContain('-1 删除')
  })

  it('array 当整体比较（不做 element-level diff）', () => {
    const after = {
      ...DEFAULT_SOUL,
      speech_style: {
        ...DEFAULT_SOUL.speech_style,
        catchphrases: [...DEFAULT_SOUL.speech_style.catchphrases, '新加'],
      },
    }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    expect(d.changes.length).toBe(1) // 不是每个 element 一个 change
    expect(d.changes[0]!.path).toBe('speech_style.catchphrases')
  })

  it('mixed added + changed + removed', () => {
    const before = {
      ...DEFAULT_SOUL,
      name: 'Old',
      example_dialogues: [
        { user: 'old', assistant: { text: 'x', emotion: 'happy', intensity: 0.5 } },
      ],
    }
    const after = {
      ...DEFAULT_SOUL,
      name: 'New',
      flip_probability: 0.99,
    }
    const d = diffSoulConfigs(before, after)
    const kinds = d.changes.map((c) => c.kind).sort()
    expect(kinds).toContain('changed') // name
    expect(kinds).toContain('removed') // example_dialogues
    expect(kinds).toContain('changed') // flip_probability
    expect(d.summary).toMatch(/修改.*删除|删除.*修改/)
  })
})

describe('shortValue', () => {
  it('string 加引号', () => {
    expect(shortValue('hello')).toBe('"hello"')
  })
  it('长 string 截断', () => {
    expect(shortValue('x'.repeat(100), 10)).toContain('...')
  })
  it('number / boolean 直接', () => {
    expect(shortValue(0.5)).toBe('0.5')
    expect(shortValue(true)).toBe('true')
  })
  it('array 短的展开', () => {
    expect(shortValue([1, 2, 3])).toBe('[1, 2, 3]')
  })
  it('array 长的折叠', () => {
    expect(shortValue([1, 2, 3, 4, 5, 6])).toBe('[6 项]')
  })
  it('object 显示字段数', () => {
    expect(shortValue({ a: 1, b: 2 })).toBe('{2 字段}')
  })
  it('null / undefined', () => {
    expect(shortValue(null)).toBe('null')
    expect(shortValue(undefined)).toBe('(无)')
  })
})

describe('renderDiff', () => {
  it('空 diff 显示无变化', () => {
    const d = diffSoulConfigs(DEFAULT_SOUL, DEFAULT_SOUL)
    expect(renderDiff(d)).toContain('soul 无变化')
  })

  it('changed 用 ~ 符号 + → 箭头', () => {
    const after = { ...DEFAULT_SOUL, name: 'Aria' }
    const d = diffSoulConfigs(DEFAULT_SOUL, after)
    const out = renderDiff(d)
    expect(out).toContain('~ name')
    expect(out).toContain('→')
    expect(out).toContain('"LUVU"')
    expect(out).toContain('"Aria"')
  })

  it('added 用 + 符号', () => {
    const after = {
      ...DEFAULT_SOUL,
      example_dialogues: [{ user: 'hi', assistant: { text: 'x', emotion: 'happy', intensity: 0.5 } }],
    }
    const out = renderDiff(diffSoulConfigs(DEFAULT_SOUL, after))
    expect(out).toContain('+ example_dialogues')
  })

  it('removed 用 - 符号', () => {
    const before = {
      ...DEFAULT_SOUL,
      example_dialogues: [{ user: 'hi', assistant: { text: 'x', emotion: 'happy', intensity: 0.5 } }],
    }
    const out = renderDiff(diffSoulConfigs(before, DEFAULT_SOUL))
    expect(out).toContain('- example_dialogues')
  })
})
