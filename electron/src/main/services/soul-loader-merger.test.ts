import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUL, mergeSoulPartials, mergeWithDefaults } from '@luvu/soul-loader'

describe('mergeSoulPartials', () => {
  it('空输入回退到 DEFAULT_SOUL', () => {
    const out = mergeSoulPartials({})
    expect(out.name).toBe(DEFAULT_SOUL.name)
    expect(out.master).toBe(DEFAULT_SOUL.master)
    expect(out.flip_probability).toBe(DEFAULT_SOUL.flip_probability)
    expect(out.speech_style.catchphrases).toEqual(DEFAULT_SOUL.speech_style.catchphrases)
  })

  it('identity 顶层字段覆盖 DEFAULT_SOUL', () => {
    const out = mergeSoulPartials({
      identity: {
        name: 'Aria',
        master: '震宇',
        call_master_as: '哥哥',
      },
    })
    expect(out.name).toBe('Aria')
    expect(out.master).toBe('震宇')
    expect(out.call_master_as).toBe('哥哥')
    // 没传的字段仍 fallback default
    expect(out.layer1_core).toBe(DEFAULT_SOUL.layer1_core)
  })

  it('personality.layer1_core 嵌套形式应被识别', () => {
    const out = mergeSoulPartials({
      personality: {
        layer1_core: '新底色',
        layer2_surface: '新表层',
      },
    })
    expect(out.layer1_core).toBe('新底色')
    expect(out.layer2_surface).toBe('新表层')
  })

  it('顶层 layer1_core 优先于 personality 嵌套', () => {
    const out = mergeSoulPartials({
      identity: { layer1_core: '顶层赢' },
      personality: { layer1_core: '嵌套输' },
    })
    expect(out.layer1_core).toBe('顶层赢')
  })

  it('speech_style 部分字段覆盖，其余保留 default', () => {
    const out = mergeSoulPartials({
      personality: {
        speech_style: {
          catchphrases: ['新口头禅'],
        },
      },
    })
    expect(out.speech_style.catchphrases).toEqual(['新口头禅'])
    expect(out.speech_style.speech_tics).toEqual(DEFAULT_SOUL.speech_style.speech_tics)
    expect(out.speech_style.forbidden_words).toEqual(DEFAULT_SOUL.speech_style.forbidden_words)
  })

  it('avatar 部分字段覆盖', () => {
    const out = mergeSoulPartials({
      identity: {
        avatar: { model_dir: 'Aria-Live2D', scale: 0.5 },
      },
    })
    expect(out.avatar.model_dir).toBe('Aria-Live2D')
    expect(out.avatar.scale).toBe(0.5)
    // 没动的保留 default
    expect(out.avatar.model_file).toBe(DEFAULT_SOUL.avatar.model_file)
    expect(out.avatar.offset_y).toBe(DEFAULT_SOUL.avatar.offset_y)
  })

  it('example_dialogues 数组应被注入', () => {
    const dialogues = [
      { user: '你好', assistant: { text: '主人~', emotion: 'happy', intensity: 0.8 } },
    ]
    const out = mergeSoulPartials({
      learnedTraits: { example_dialogues: dialogues },
    })
    expect(out.example_dialogues).toEqual(dialogues)
  })

  it('不修改原 DEFAULT_SOUL（不变性）', () => {
    const snapshot = JSON.stringify(DEFAULT_SOUL)
    mergeSoulPartials({
      identity: { name: 'X' },
      personality: { speech_style: { catchphrases: ['Y'] } },
    })
    expect(JSON.stringify(DEFAULT_SOUL)).toBe(snapshot)
  })

  it('多 partial 合并顺序: identity > personality > learnedTraits > coreMemories', () => {
    const out = mergeSoulPartials({
      coreMemories: { name: 'A' },
      learnedTraits: { name: 'B' },
      personality: { name: 'C' },
      identity: { name: 'D' },
    })
    expect(out.name).toBe('D')
  })
})

describe('mergeWithDefaults', () => {
  it('单一对象合并行为应与 mergeSoulPartials 一致', () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_SOUL))
    const src = { name: 'TestName', master: 'TestMaster' }
    const out = mergeWithDefaults(base, src)
    expect(out.name).toBe('TestName')
    expect(out.master).toBe('TestMaster')
  })

  it('null 字段不应覆盖（兼容旧 yaml）', () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_SOUL))
    const out = mergeWithDefaults(base, { name: null as unknown as string })
    expect(out.name).toBe(DEFAULT_SOUL.name)
  })

  it('undefined 字段不应覆盖', () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_SOUL))
    const out = mergeWithDefaults(base, { name: undefined })
    expect(out.name).toBe(DEFAULT_SOUL.name)
  })
})
