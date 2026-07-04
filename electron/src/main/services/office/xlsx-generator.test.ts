import { describe, expect, it } from 'vitest'
import { buildXlsxBuffer, normalizeXlsxSpec } from './xlsx-generator'

describe('normalizeXlsxSpec', () => {
  it('缺字段兜底：无 sheets → 至少 1 个', () => {
    const spec = normalizeXlsxSpec({})
    expect(spec.sheets).toHaveLength(1)
    expect(spec.sheets[0]!.name).toBe('Sheet1')
  })

  it('sheet 名非法字符净化 + 长度限制', () => {
    const spec = normalizeXlsxSpec({ sheets: [{ name: 'a/b:c*[x]', rows: [] }] })
    expect(spec.sheets[0]!.name).not.toMatch(/[\\/*?:[\]]/)
    expect(spec.sheets[0]!.name.length).toBeLessThanOrEqual(31)
  })

  it('单元格保留数字，其它转字符串', () => {
    const spec = normalizeXlsxSpec({ sheets: [{ name: 'S', rows: [[1, 'x', '=SUM(A1:A2)']] }] })
    expect(spec.sheets[0]!.rows[0]).toEqual([1, 'x', '=SUM(A1:A2)'])
  })

  it('超量截断：sheets/rows/cols', () => {
    const spec = normalizeXlsxSpec({
      sheets: Array.from({ length: 99 }, () => ({ name: 'S', rows: Array.from({ length: 9999 }, () => [1, 2]) })),
    })
    expect(spec.sheets.length).toBeLessThanOrEqual(30)
    expect(spec.sheets[0]!.rows.length).toBeLessThanOrEqual(5000)
  })
})

describe('buildXlsxBuffer', () => {
  it('多 sheet + 表头 + 公式 产出合法 zip（首字节 PK）', async () => {
    const buf = await buildXlsxBuffer(
      normalizeXlsxSpec({
        sheets: [
          {
            name: '销售',
            headers: ['月份', '金额'],
            rows: [['1月', 100], ['2月', 200], ['合计', '=SUM(B2:B3)']],
            columnWidths: [12, 16],
            freezeHeader: true,
          },
          { name: '备注', rows: [['说明', '示例数据']] },
        ],
      }),
    )
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
