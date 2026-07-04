/**
 * @luvu/soul-loader migrate 单元测试 (P5)。
 * 放 electron 端因 vitest 已配 @shared / 包链接。
 */
import { describe, expect, it } from 'vitest'
import {
  isLegacyV01Schema,
  migrateV01ToV2,
  mergeSoulPartials,
  DEFAULT_SOUL,
} from '@luvu/soul-loader'

describe('isLegacyV01Schema', () => {
  it('schema_version 2.x → false', () => {
    expect(isLegacyV01Schema({ schema_version: '2.0' })).toBe(false)
    expect(isLegacyV01Schema({ schema_version: '2.1' })).toBe(false)
  })

  it('schema_version 缺失 + 有 v0.1 特征字段 → true', () => {
    expect(
      isLegacyV01Schema({
        personality: { layer3_volatility: { flip_probability: 0.15 } },
      }),
    ).toBe(true)
    expect(isLegacyV01Schema({ appearance: { anchor: { scale: 0.35 } } })).toBe(true)
    expect(isLegacyV01Schema({ speech_style: { signature_lines: ['啧'] } })).toBe(true)
  })

  it('schema_version 1.0 + 无特征字段 → false', () => {
    expect(isLegacyV01Schema({ schema_version: '1.0', name: 'X' })).toBe(false)
  })

  it('完全 v2 风格 (无 schema_version 但用 layer3_volatility_prompt 字符串) → false', () => {
    expect(
      isLegacyV01Schema({
        personality: { layer3_volatility_prompt: '反差描述' },
      }),
    ).toBe(false)
  })

  it('null / 非对象 → false', () => {
    expect(isLegacyV01Schema(null as unknown as Record<string, unknown>)).toBe(false)
    expect(isLegacyV01Schema({} as Record<string, unknown>)).toBe(false)
  })
})

describe('migrateV01ToV2', () => {
  it('完整 v0.1 yaml → MergeInput', () => {
    const legacy = {
      schema_version: '1.0',
      identity: { name: 'Legacy', master: 'OldM', birthday: '2026-01-01' },
      appearance: {
        live2d_model_dir: 'Hu Tao',
        model_file: 'hu.model3.json',
        anchor: { scale: 0.4, y_offset: 0.5 },
      },
      personality: {
        layer1_core: '粘人底色',
        layer2_surface: '俏皮表层',
        layer3_volatility: {
          flip_probability: 0.2,
          flip_modes: ['突然害羞', '突然冷漠'],
        },
      },
      speech_style: {
        call_master_as: '大人',
        signature_lines: ['啧', '害', '麻了', '你欺负我', '主人', '嘿嘿', '~诶?'],
      },
    }
    const m = migrateV01ToV2(legacy)
    expect(m.identity).toBeDefined()
    expect(m.identity!.name).toBe('Legacy')
    expect(m.identity!.master).toBe('OldM')
    expect(m.identity!.call_master_as).toBe('大人')
    expect(m.identity!.avatar).toMatchObject({
      model_dir: 'Hu Tao',
      model_file: 'hu.model3.json',
      scale: 0.4,
      offset_y: 50, // 0.5 * 100 (归一化推断)
    })
    expect(m.personality).toBeDefined()
    expect(m.personality!.layer1_core).toBe('粘人底色')
    expect(m.personality!.layer2_surface).toBe('俏皮表层')
    expect(m.personality!.flip_probability).toBe(0.2)
    expect(m.personality!.layer3_volatility_prompt).toContain('20%')
    expect(m.personality!.layer3_volatility_prompt).toContain('突然害羞')
    expect(m.personality!.layer3_volatility_prompt).toContain('突然冷漠')
    const ss = m.personality!.speech_style as { catchphrases: string[] }
    expect(ss.catchphrases.length).toBeLessThanOrEqual(10)
    expect(ss.catchphrases).toContain('啧')
  })

  it('y_offset 像素值不被归一化 (abs >= 1)', () => {
    const m = migrateV01ToV2({
      appearance: { anchor: { y_offset: 75 } },
    })
    expect((m.identity!.avatar as { offset_y: number }).offset_y).toBe(75)
  })

  it('y_offset 负归一化也处理', () => {
    const m = migrateV01ToV2({
      appearance: { anchor: { y_offset: -0.3 } },
    })
    expect((m.identity!.avatar as { offset_y: number }).offset_y).toBe(-30)
  })

  it('完全空 → 返回空 MergeInput', () => {
    const m = migrateV01ToV2({})
    expect(m.identity).toBeUndefined()
    expect(m.personality).toBeUndefined()
  })

  it('只有部分字段也能产 partial MergeInput', () => {
    const m = migrateV01ToV2({ identity: { name: 'OnlyName' } })
    expect(m.identity!.name).toBe('OnlyName')
    expect(m.personality).toBeUndefined()
  })
})

describe('集成: migrate + merge → SoulConfig (端到端 v0.1 → v2.0 → DEFAULT 合并)', () => {
  it('完整 v0.1 → mergeSoulPartials → 有效 SoulConfig', () => {
    const legacy = {
      identity: { name: 'Aria', master: '震宇' },
      personality: {
        layer1_core: '新底色',
        layer3_volatility: { flip_probability: 0.25, flip_modes: ['突然认真'] },
      },
      speech_style: { signature_lines: ['好的吧', '嗯哼'] },
    }
    const partials = migrateV01ToV2(legacy)
    const soul = mergeSoulPartials(partials)
    // 老的迁移
    expect(soul.name).toBe('Aria')
    expect(soul.master).toBe('震宇')
    expect(soul.layer1_core).toBe('新底色')
    expect(soul.flip_probability).toBe(0.25)
    expect(soul.layer3_volatility_prompt).toContain('25%')
    expect(soul.speech_style.catchphrases).toEqual(['好的吧', '嗯哼'])
    // DEFAULT 兜底
    expect(soul.layer2_surface).toBe(DEFAULT_SOUL.layer2_surface)
    expect(soul.speech_style.speech_tics).toEqual(DEFAULT_SOUL.speech_style.speech_tics)
    expect(soul.output_protocol).toEqual(DEFAULT_SOUL.output_protocol)
  })
})
