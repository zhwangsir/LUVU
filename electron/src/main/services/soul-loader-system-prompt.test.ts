import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUL, buildSystemPrompt } from '@luvu/soul-loader'

describe('buildSystemPrompt', () => {
  it('包含身份段、layer1/2/3、speech_style、output_protocol', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL)
    expect(out).toContain('你的身份')
    expect(out).toContain(DEFAULT_SOUL.name)
    expect(out).toContain(DEFAULT_SOUL.master)
    expect(out).toContain(DEFAULT_SOUL.call_master_as)
    expect(out).toContain('灵魂底色')
    expect(out).toContain('表层风格')
    expect(out).toContain('反差波动')
    expect(out).toContain('口头禅')
    expect(out).toContain('输出协议')
    expect(out).toContain(DEFAULT_SOUL.output_protocol.example)
  })

  it('应警告 LLM 不要在 text 字段写情感括号（TTS 会念）', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL)
    expect(out).toContain('情感括号')
    expect(out).toContain('TTS')
  })

  it('example_dialogues 为空时不渲染示范段', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL)
    expect(out).not.toContain('学习这些示范')
  })

  it('example_dialogues 非空时渲染 few-shot', () => {
    const soul = {
      ...DEFAULT_SOUL,
      example_dialogues: [
        { user: '今天累吗', assistant: { text: '主人陪我撒娇就不累', emotion: 'shy', intensity: 0.7 } },
        { user: '吃饭了吗', assistant: { text: '主人不在我不吃', emotion: 'sad', intensity: 0.5 } },
      ],
    }
    const out = buildSystemPrompt(soul)
    expect(out).toContain('学习这些示范')
    expect(out).toContain('今天累吗')
    expect(out).toContain('主人陪我撒娇就不累')
    expect(out).toContain('吃饭了吗')
    expect(out).toContain('"emotion":"sad"')
  })

  it('toolsDescription 注入到末尾', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL, { toolsDescription: '# 工具区\n可用工具：foo, bar' })
    expect(out).toContain('# 工具区')
    expect(out).toContain('foo, bar')
  })

  it('ragContext 注入并加引导提示', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL, { ragContext: '主人养了只英短叫汤圆' })
    expect(out).toContain('你记得的关于')
    expect(out).toContain('主人养了只英短叫汤圆')
  })

  it('空 toolsDescription/ragContext 不应渲染段', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL, { toolsDescription: '', ragContext: '   ' })
    expect(out).not.toContain('# 工具')
    expect(out).not.toContain('你记得的关于')
  })

  it('speech_style 字段被拼到 prompt 中', () => {
    const out = buildSystemPrompt(DEFAULT_SOUL)
    expect(out).toContain(DEFAULT_SOUL.speech_style.catchphrases[0])
    expect(out).toContain(DEFAULT_SOUL.speech_style.speech_tics[0])
    expect(out).toContain(DEFAULT_SOUL.speech_style.forbidden_words[0])
  })
})
