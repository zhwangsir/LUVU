/**
 * PowerPoint (.pptx) 生成器 —— 纯函数，接结构化 spec → pptx Buffer。
 * 用 `pptxgenjs`（纯 JS，无需装 Office）。
 *
 * v0.21 富化：主题配色 + 多种版式 + 图表(柱/折线/饼) + 表格 + 配图(本地路径)。
 * ComfyUI 出图的副作用不在这里 —— 工具层（builtin.ts office_create_pptx）先把
 * slide.image.generate（提示词）解析成本地 path，再调本纯生成器（保持可单测）。
 */
import pptxgen from 'pptxgenjs'

export type PptxThemeName = 'default' | 'dark' | 'corporate' | 'warm' | 'tech'
export type PptxLayout =
  | 'title'
  | 'section'
  | 'bullets'
  | 'image-right'
  | 'image-full'
  | 'chart'
  | 'table'

export interface PptxChart {
  type: 'bar' | 'line' | 'pie'
  categories: string[]
  series: Array<{ name: string; values: number[] }>
}
export interface PptxTable {
  headers: string[]
  rows: string[][]
}
export interface PptxImage {
  /** 本地图片绝对路径（工具层已解析）。 */
  path?: string
  /** 提示词 —— 工具层用 ComfyUI 生成后填回 path；纯生成器忽略此字段。 */
  generate?: string
  alt?: string
}
export interface PptxSlide {
  layout?: PptxLayout
  title?: string
  bullets?: string[]
  chart?: PptxChart
  table?: PptxTable
  image?: PptxImage
  notes?: string
}
export interface PptxSpec {
  title: string
  theme: PptxThemeName
  slides: PptxSlide[]
}

interface Theme {
  bg: string
  coverBg: string
  coverText: string
  title: string
  text: string
  accent: string
  tableHeaderFill: string
  tableHeaderText: string
  chartColors: string[]
  font: string
}

const THEMES: Record<PptxThemeName, Theme> = {
  default: {
    bg: 'FFFFFF', coverBg: '1F2937', coverText: 'FFFFFF', title: '1F2937', text: '374151',
    accent: '2563EB', tableHeaderFill: '2563EB', tableHeaderText: 'FFFFFF',
    chartColors: ['2563EB', '10B981', 'F59E0B', 'EF4444', '8B5CF6', '06B6D4'], font: 'Arial',
  },
  dark: {
    bg: '111827', coverBg: '000000', coverText: 'F9FAFB', title: 'F9FAFB', text: 'D1D5DB',
    accent: '60A5FA', tableHeaderFill: '374151', tableHeaderText: 'F9FAFB',
    chartColors: ['60A5FA', '34D399', 'FBBF24', 'F87171', 'A78BFA', '22D3EE'], font: 'Arial',
  },
  corporate: {
    bg: 'FFFFFF', coverBg: '0F172A', coverText: 'F8FAFC', title: '0F172A', text: '334155',
    accent: '0EA5E9', tableHeaderFill: '0F172A', tableHeaderText: 'FFFFFF',
    chartColors: ['0EA5E9', '14B8A6', '6366F1', 'F59E0B', 'EF4444', '84CC16'], font: 'Calibri',
  },
  warm: {
    bg: 'FFFBEB', coverBg: '7C2D12', coverText: 'FFF7ED', title: '7C2D12', text: '78350F',
    accent: 'EA580C', tableHeaderFill: 'EA580C', tableHeaderText: 'FFFFFF',
    chartColors: ['EA580C', 'D97706', 'CA8A04', 'DC2626', 'B45309', '92400E'], font: 'Georgia',
  },
  tech: {
    bg: '0B1220', coverBg: '020617', coverText: '22D3EE', title: '22D3EE', text: 'CBD5E1',
    accent: '22D3EE', tableHeaderFill: '0E7490', tableHeaderText: 'E0F2FE',
    chartColors: ['22D3EE', '38BDF8', '818CF8', '34D399', 'FB7185', 'FACC15'], font: 'Consolas',
  },
}

const MAX_SLIDES = 100
const MAX_BULLETS = 30
const MAX_TABLE_ROWS = 60
const MAX_TABLE_COLS = 12
const MAX_TEXT = 5_000
const VALID_THEMES: PptxThemeName[] = ['default', 'dark', 'corporate', 'warm', 'tech']
const VALID_LAYOUTS: PptxLayout[] = ['title', 'section', 'bullets', 'image-right', 'image-full', 'chart', 'table']

function clampText(v: unknown, fallback = ''): string {
  const s = typeof v === 'string' ? v : v == null ? fallback : String(v)
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s
}
function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeChart(raw: unknown): PptxChart | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const type = c.type === 'line' || c.type === 'pie' ? c.type : 'bar'
  const categories = Array.isArray(c.categories) ? c.categories.slice(0, 50).map((x) => clampText(x)) : []
  const seriesRaw = Array.isArray(c.series) ? c.series.slice(0, 10) : []
  const series = seriesRaw.map((s) => {
    const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    return {
      name: clampText(so.name, '系列'),
      values: Array.isArray(so.values) ? so.values.slice(0, 50).map(toNum) : [],
    }
  })
  if (categories.length === 0 || series.length === 0) return undefined
  return { type, categories, series }
}

function normalizeTable(raw: unknown): PptxTable | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Record<string, unknown>
  const headers = Array.isArray(t.headers) ? t.headers.slice(0, MAX_TABLE_COLS).map((x) => clampText(x)) : []
  const rows = Array.isArray(t.rows)
    ? t.rows.slice(0, MAX_TABLE_ROWS).map((r) =>
        Array.isArray(r) ? r.slice(0, MAX_TABLE_COLS).map((x) => clampText(x)) : [clampText(r)],
      )
    : []
  if (headers.length === 0 && rows.length === 0) return undefined
  return { headers, rows }
}

function normalizeImage(raw: unknown): PptxImage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const i = raw as Record<string, unknown>
  const path = typeof i.path === 'string' ? i.path : undefined
  const generate = typeof i.generate === 'string' ? clampText(i.generate) : undefined
  const alt = typeof i.alt === 'string' ? clampText(i.alt) : undefined
  if (!path && !generate) return undefined
  return { ...(path ? { path } : {}), ...(generate ? { generate } : {}), ...(alt ? { alt } : {}) }
}

/** 未显式给 layout 时按内容推断一个合适版式 */
function inferLayout(s: PptxSlide): PptxLayout {
  if (s.chart) return 'chart'
  if (s.table) return 'table'
  if (s.image && s.bullets && s.bullets.length > 0) return 'image-right'
  if (s.image) return 'image-full'
  return 'bullets'
}

/** 把不可信的工具入参防御性归一成 PptxSpec。纯函数。 */
export function normalizePptxSpec(raw: unknown): PptxSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = clampText(obj.title, '未命名演示').trim() || '未命名演示'
  const theme = VALID_THEMES.includes(obj.theme as PptxThemeName) ? (obj.theme as PptxThemeName) : 'default'
  const rawSlides = Array.isArray(obj.slides) ? obj.slides.slice(0, MAX_SLIDES) : []
  const slides: PptxSlide[] = rawSlides.map((s) => {
    const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    const bullets = Array.isArray(so.bullets)
      ? so.bullets.slice(0, MAX_BULLETS).map((b) => clampText(b))
      : typeof so.bullets === 'string'
        ? [clampText(so.bullets)]
        : []
    const slide: PptxSlide = { bullets }
    if (typeof so.title === 'string') slide.title = clampText(so.title)
    if (typeof so.notes === 'string') slide.notes = clampText(so.notes)
    const chart = normalizeChart(so.chart)
    if (chart) slide.chart = chart
    const table = normalizeTable(so.table)
    if (table) slide.table = table
    const image = normalizeImage(so.image)
    if (image) slide.image = image
    slide.layout = VALID_LAYOUTS.includes(so.layout as PptxLayout) ? (so.layout as PptxLayout) : inferLayout(slide)
    return slide
  })
  if (slides.length === 0) slides.push({ bullets: [], layout: 'bullets' })
  return { title, theme, slides }
}

type Slide = ReturnType<pptxgen['addSlide']>

function addTitleText(slide: Slide, text: string, th: Theme): void {
  slide.addText(text, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: th.title, fontFace: th.font })
}

function addBullets(slide: Slide, bullets: string[], th: Theme, x: number, y: number, w: number, h: number): void {
  if (bullets.length === 0) return
  slide.addText(
    bullets.map((b) => ({ text: b, options: { bullet: true, color: th.text } })),
    { x, y, w, h, fontSize: 18, color: th.text, fontFace: th.font, valign: 'top', lineSpacingMultiple: 1.3 },
  )
}

function renderChart(slide: Slide, chart: PptxChart, th: Theme): void {
  const data = chart.series.map((s) => ({ name: s.name, labels: chart.categories, values: s.values }))
  slide.addChart(chart.type, data, {
    x: 0.6, y: 1.4, w: 12.1, h: 4.6,
    chartColors: th.chartColors,
    showLegend: chart.series.length > 1 || chart.type === 'pie',
    legendPos: 'b',
    showTitle: false,
    ...(chart.type === 'pie' ? { showPercent: true } : {}),
  })
}

function renderTable(slide: Slide, table: PptxTable, th: Theme): void {
  const headerRow = table.headers.map((hcell) => ({
    text: hcell,
    options: { bold: true, color: th.tableHeaderText, fill: { color: th.tableHeaderFill } },
  }))
  const bodyRows = table.rows.map((r) => r.map((cell) => ({ text: cell, options: { color: th.text } })))
  const rows = table.headers.length > 0 ? [headerRow, ...bodyRows] : bodyRows
  if (rows.length === 0) return
  slide.addTable(rows, {
    x: 0.5, y: 1.4, w: 12.3,
    border: { type: 'solid', pt: 1, color: 'D1D5DB' },
    fontSize: 14, fontFace: th.font, valign: 'middle', autoPage: true,
  })
}

function renderImage(slide: Slide, image: PptxImage, box: { x: number; y: number; w: number; h: number }): void {
  if (!image.path) return
  slide.addImage({ path: image.path, sizing: { type: 'contain', w: box.w, h: box.h }, ...box })
}

/** 由 PptxSpec 构建 .pptx 二进制。返回 Buffer（.pptx 本质是 zip，首字节 'PK'）。 */
export async function buildPptxBuffer(spec: PptxSpec): Promise<Buffer> {
  const th = THEMES[spec.theme]
  const pptx = new pptxgen()
  pptx.title = spec.title
  pptx.layout = 'LAYOUT_WIDE'

  // 封面页
  const cover = pptx.addSlide()
  cover.background = { color: th.coverBg }
  cover.addText(spec.title, {
    x: 0.5, y: 2.4, w: 12.3, h: 1.6, fontSize: 40, bold: true, color: th.coverText, align: 'center', fontFace: th.font,
  })

  for (const s of spec.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: th.bg }
    const layout = s.layout ?? inferLayout(s)

    if (layout === 'section') {
      slide.background = { color: th.coverBg }
      slide.addText(s.title ?? '', { x: 0.5, y: 2.6, w: 12.3, h: 1.2, fontSize: 34, bold: true, color: th.coverText, align: 'center', fontFace: th.font })
      if (s.notes) slide.addNotes(s.notes)
      continue
    }

    if (s.title) addTitleText(slide, s.title, th)

    switch (layout) {
      case 'chart':
        if (s.chart) renderChart(slide, s.chart, th)
        addBullets(slide, s.bullets ?? [], th, 0.6, 6.2, 12.1, 1.0)
        break
      case 'table':
        if (s.table) renderTable(slide, s.table, th)
        break
      case 'image-full':
        renderImage(slide, s.image ?? {}, { x: 0.5, y: s.title ? 1.3 : 0.4, w: 12.3, h: s.title ? 5.7 : 6.7 })
        break
      case 'image-right':
        addBullets(slide, s.bullets ?? [], th, 0.6, 1.5, 6.0, 4.8)
        renderImage(slide, s.image ?? {}, { x: 6.9, y: 1.5, w: 5.9, h: 4.8 })
        break
      case 'bullets':
      default:
        addBullets(slide, s.bullets ?? [], th, 0.7, 1.5, 11.9, 4.8)
        break
    }
    if (s.notes) slide.addNotes(s.notes)
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
