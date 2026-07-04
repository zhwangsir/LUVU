import { describe, expect, it } from 'vitest'
import { buildDocxBuffer, normalizeDocxSpec } from './docx-generator'

describe('normalizeDocxSpec', () => {
  it('缺字段兜底：无 title / 无 sections', () => {
    const spec = normalizeDocxSpec({})
    expect(spec.title).toBe('未命名文档')
    expect(spec.sections).toHaveLength(1)
  })

  it('paragraphs 字符串包成数组；bullets 保留', () => {
    const spec = normalizeDocxSpec({ title: 'T', sections: [{ heading: 'H', paragraphs: '一段话', bullets: ['甲', '乙'] }] })
    expect(spec.sections[0]!.heading).toBe('H')
    expect(spec.sections[0]!.paragraphs).toEqual(['一段话'])
    expect(spec.sections[0]!.bullets).toEqual(['甲', '乙'])
  })

  it('level 仅 1-3 有效，越界丢弃', () => {
    expect(normalizeDocxSpec({ title: 'T', sections: [{ heading: 'H', level: 2 }] }).sections[0]!.level).toBe(2)
    expect(normalizeDocxSpec({ title: 'T', sections: [{ heading: 'H', level: 9 }] }).sections[0]!.level).toBeUndefined()
  })

  it('解析 table / image，非法子结构丢弃', () => {
    const spec = normalizeDocxSpec({
      title: 'T',
      sections: [
        { heading: '表', table: { headers: ['a', 'b'], rows: [['1', '2']] } },
        { heading: '图', image: { generate: 'a red car' } },
        { heading: '空表', table: {} },
      ],
    })
    expect(spec.sections[0]!.table?.headers).toEqual(['a', 'b'])
    expect(spec.sections[1]!.image?.generate).toBe('a red car')
    expect(spec.sections[2]!.table).toBeUndefined()
  })

  it('非对象/非数组入参不崩', () => {
    expect(() => normalizeDocxSpec(null)).not.toThrow()
    expect(normalizeDocxSpec({ title: 'A', sections: 'nope' }).sections).toHaveLength(1)
  })
})

describe('buildDocxBuffer', () => {
  it('含标题/段落/项目符号/表格的 .docx 产出合法 zip（首字节 PK）', async () => {
    const buf = await buildDocxBuffer(
      normalizeDocxSpec({
        title: '测试文档',
        sections: [
          { heading: '概述', level: 1, paragraphs: ['第一段'], bullets: ['要点一', '要点二'] },
          { heading: '数据', level: 2, table: { headers: ['名', '值'], rows: [['a', '1'], ['b', '2']] } },
        ],
      }),
    )
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
