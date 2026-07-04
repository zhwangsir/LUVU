/**
 * Word (.docx) 生成器 —— 接结构化 spec → docx Buffer。用 `docx` 库（纯 JS，无需装 Office）。
 *
 * v0.21 富化：多级标题 + 段落 + 项目符号列表 + 表格 + 配图。
 * normalizeDocxSpec 纯函数（可单测）；buildDocxBuffer 会读本地图片文件（image.path）嵌入。
 * ComfyUI 出图（image.generate → path）在工具层 illustration.resolveDocxIllustrations 里做。
 */
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

export interface DocxTable {
  headers: string[]
  rows: string[][]
}
export interface DocxImage {
  path?: string
  generate?: string
  alt?: string
  widthPx?: number
}
export interface DocxSection {
  heading?: string
  /** 标题层级 1-3；不填默认 1 */
  level?: number
  paragraphs?: string[]
  bullets?: string[]
  table?: DocxTable
  image?: DocxImage
}
export interface DocxSpec {
  title: string
  sections: DocxSection[]
}

const MAX_SECTIONS = 200
const MAX_ITEMS = 200
const MAX_TABLE_ROWS = 200
const MAX_TABLE_COLS = 20
const MAX_TEXT = 20_000

function clampText(v: unknown, fallback = ''): string {
  const s = typeof v === 'string' ? v : v == null ? fallback : String(v)
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s
}

function normalizeTable(raw: unknown): DocxTable | undefined {
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

function normalizeImage(raw: unknown): DocxImage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const i = raw as Record<string, unknown>
  const path = typeof i.path === 'string' ? i.path : undefined
  const generate = typeof i.generate === 'string' ? clampText(i.generate) : undefined
  const alt = typeof i.alt === 'string' ? clampText(i.alt) : undefined
  const widthPx = Number.isFinite(Number(i.widthPx)) ? Number(i.widthPx) : undefined
  if (!path && !generate) return undefined
  return {
    ...(path ? { path } : {}),
    ...(generate ? { generate } : {}),
    ...(alt ? { alt } : {}),
    ...(widthPx ? { widthPx } : {}),
  }
}

/** 把不可信的工具入参防御性归一成 DocxSpec。纯函数。 */
export function normalizeDocxSpec(raw: unknown): DocxSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = clampText(obj.title, '未命名文档').trim() || '未命名文档'
  const rawSections = Array.isArray(obj.sections) ? obj.sections.slice(0, MAX_SECTIONS) : []
  const sections: DocxSection[] = rawSections.map((s) => {
    const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    const paragraphs = Array.isArray(so.paragraphs)
      ? so.paragraphs.slice(0, MAX_ITEMS).map((p) => clampText(p))
      : typeof so.paragraphs === 'string'
        ? [clampText(so.paragraphs)]
        : []
    const bullets = Array.isArray(so.bullets) ? so.bullets.slice(0, MAX_ITEMS).map((b) => clampText(b)) : []
    const sec: DocxSection = { paragraphs, bullets }
    if (typeof so.heading === 'string') sec.heading = clampText(so.heading)
    const lvl = Number(so.level)
    if (Number.isFinite(lvl) && lvl >= 1 && lvl <= 3) sec.level = Math.round(lvl)
    const table = normalizeTable(so.table)
    if (table) sec.table = table
    const image = normalizeImage(so.image)
    if (image) sec.image = image
    return sec
  })
  if (sections.length === 0) sections.push({ paragraphs: [''], bullets: [] })
  return { title, sections }
}

const HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
}

function imageType(path: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg'
  if (ext === '.gif') return 'gif'
  if (ext === '.bmp') return 'bmp'
  return 'png'
}

function buildTable(t: DocxTable): Table {
  const rows: TableRow[] = []
  if (t.headers.length > 0) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: t.headers.map(
          (h) =>
            new TableCell({
              shading: { fill: 'E5E7EB' },
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            }),
        ),
      }),
    )
  }
  for (const r of t.rows) {
    rows.push(
      new TableRow({
        children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })),
      }),
    )
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

/** 由 DocxSpec 构建 .docx 二进制。返回 Buffer（.docx 本质是 zip，首字节 'PK'）。 */
export function buildDocxBuffer(spec: DocxSpec): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }),
  ]
  for (const sec of spec.sections) {
    if (sec.heading) {
      children.push(new Paragraph({ text: sec.heading, heading: HEADING_BY_LEVEL[sec.level ?? 1] ?? HeadingLevel.HEADING_1 }))
    }
    for (const p of sec.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(p)] }))
    }
    for (const b of sec.bullets ?? []) {
      children.push(new Paragraph({ text: b, bullet: { level: 0 } }))
    }
    if (sec.table) children.push(buildTable(sec.table))
    if (sec.image?.path) {
      try {
        const data = readFileSync(sec.image.path)
        const w = sec.image.widthPx && sec.image.widthPx > 0 ? Math.min(600, sec.image.widthPx) : 480
        const h = Math.round(w * 0.75)
        children.push(
          new Paragraph({
            children: [new ImageRun({ type: imageType(sec.image.path), data, transformation: { width: w, height: h } })],
          }),
        )
      } catch (e) {
        console.warn('[docx] 图片读取失败，跳过:', sec.image.path, e instanceof Error ? e.message : e)
      }
    }
  }
  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBuffer(doc)
}
