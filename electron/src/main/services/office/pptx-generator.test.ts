import { describe, expect, it } from 'vitest'
import { buildPptxBuffer, normalizePptxSpec } from './pptx-generator'

describe('normalizePptxSpec', () => {
  it('缺字段兜底：无 title / 无 slides / 默认主题', () => {
    const spec = normalizePptxSpec({})
    expect(spec.title).toBe('未命名演示')
    expect(spec.theme).toBe('default')
    expect(spec.slides).toHaveLength(1)
  })

  it('非法 theme 回退 default，合法 theme 保留', () => {
    expect(normalizePptxSpec({ title: 'T', slides: [], theme: 'nope' }).theme).toBe('default')
    expect(normalizePptxSpec({ title: 'T', slides: [], theme: 'tech' }).theme).toBe('tech')
  })

  it('bullets 字符串包成数组；notes 保留', () => {
    const spec = normalizePptxSpec({ title: 'T', slides: [{ title: 'P1', bullets: '要点', notes: '备注' }] })
    expect(spec.slides[0]!.bullets).toEqual(['要点'])
    expect(spec.slides[0]!.notes).toBe('备注')
  })

  it('解析并保留 chart / table / image，非法子结构丢弃', () => {
    const spec = normalizePptxSpec({
      title: 'T',
      slides: [
        { title: '图表', chart: { type: 'bar', categories: ['Q1', 'Q2'], series: [{ name: '收入', values: [10, 20] }] } },
        { title: '表格', table: { headers: ['名', '值'], rows: [['a', '1']] } },
        { title: '配图', image: { generate: 'a blue mountain' }, bullets: ['左侧要点'] },
        { title: '空图表', chart: { type: 'bar' } },
      ],
    })
    expect(spec.slides[0]!.chart?.type).toBe('bar')
    expect(spec.slides[0]!.layout).toBe('chart') // 自动推断
    expect(spec.slides[1]!.table?.headers).toEqual(['名', '值'])
    expect(spec.slides[1]!.layout).toBe('table')
    expect(spec.slides[2]!.image?.generate).toBe('a blue mountain')
    expect(spec.slides[2]!.layout).toBe('image-right') // 有图有要点
    expect(spec.slides[3]!.chart).toBeUndefined() // 缺 categories/series → 丢弃
  })

  it('显式 layout 优先于推断；非法 layout 回退推断', () => {
    expect(normalizePptxSpec({ title: 'T', slides: [{ layout: 'section', title: 'S' }] }).slides[0]!.layout).toBe('section')
    expect(normalizePptxSpec({ title: 'T', slides: [{ layout: 'bogus', bullets: ['x'] }] }).slides[0]!.layout).toBe('bullets')
  })

  it('超量截断：slides/bullets/table 有上限', () => {
    const many = Array.from({ length: 500 }, () => ({ bullets: Array.from({ length: 99 }, () => 'b') }))
    const spec = normalizePptxSpec({ title: 'T', slides: many })
    expect(spec.slides.length).toBeLessThanOrEqual(100)
    expect(spec.slides[0]!.bullets!.length).toBeLessThanOrEqual(30)
  })
})

describe('buildPptxBuffer', () => {
  it('纯文字 PPT 产出合法 zip（首字节 PK）', async () => {
    const buf = await buildPptxBuffer(
      normalizePptxSpec({ title: '季度总结', slides: [{ title: '收入', bullets: ['同比+20%'], notes: '强调增长' }] }),
    )
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('含图表+表格+主题的 PPT 也能构建', async () => {
    const buf = await buildPptxBuffer(
      normalizePptxSpec({
        title: '工程报告',
        theme: 'tech',
        slides: [
          { layout: 'section', title: '第一章' },
          { title: '趋势', chart: { type: 'line', categories: ['1月', '2月', '3月'], series: [{ name: '负载', values: [30, 45, 60] }] } },
          { title: '指标', table: { headers: ['模块', '延迟'], rows: [['A', '12ms'], ['B', '8ms']] } },
        ],
      }),
    )
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
