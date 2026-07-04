/**
 * Excel (.xlsx) 生成器 —— 接结构化 spec → xlsx Buffer。用 `exceljs`（纯 JS，无需装 Office）。
 *
 * 支持：多 sheet、表头样式、公式（cell 以 '=' 开头）、列宽、冻结表头、数字保留。
 * normalizeXlsxSpec 纯函数（可单测）；buildXlsxBuffer 用 exceljs 组装。
 *
 * 注：exceljs 写入不支持内嵌图表（库限制）；数据图表请用 office_create_pptx 的 chart。
 */
import ExcelJS from 'exceljs'

export type XlsxCell = string | number
export interface XlsxSheet {
  name: string
  headers?: string[]
  rows: XlsxCell[][]
  columnWidths?: number[]
  freezeHeader?: boolean
}
export interface XlsxSpec {
  sheets: XlsxSheet[]
}

const MAX_SHEETS = 30
const MAX_ROWS = 5_000
const MAX_COLS = 50
const MAX_TEXT = 5_000

function clampText(v: unknown, fallback = ''): string {
  const s = typeof v === 'string' ? v : v == null ? fallback : String(v)
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s
}
function toCell(v: unknown): XlsxCell {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return clampText(v)
}

/** 把不可信的工具入参防御性归一成 XlsxSpec。纯函数。 */
export function normalizeXlsxSpec(raw: unknown): XlsxSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawSheets = Array.isArray(obj.sheets) ? obj.sheets.slice(0, MAX_SHEETS) : []
  const sheets: XlsxSheet[] = rawSheets.map((s, idx) => {
    const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    const name = clampText(so.name, `Sheet${idx + 1}`).slice(0, 31).replace(/[\\/*?:[\]]/g, '_') || `Sheet${idx + 1}`
    const headers = Array.isArray(so.headers) ? so.headers.slice(0, MAX_COLS).map((h) => clampText(h)) : undefined
    const rows = Array.isArray(so.rows)
      ? so.rows.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map(toCell) : [toCell(r)]))
      : []
    const columnWidths = Array.isArray(so.columnWidths)
      ? so.columnWidths.slice(0, MAX_COLS).map((w) => Number(w) || 0)
      : undefined
    const sheet: XlsxSheet = { name, rows }
    if (headers && headers.length > 0) sheet.headers = headers
    if (columnWidths) sheet.columnWidths = columnWidths
    if (so.freezeHeader === true) sheet.freezeHeader = true
    return sheet
  })
  if (sheets.length === 0) sheets.push({ name: 'Sheet1', rows: [] })
  return { sheets }
}

/** 由 XlsxSpec 构建 .xlsx 二进制。返回 Buffer（.xlsx 本质是 zip，首字节 'PK'）。 */
export async function buildXlsxBuffer(spec: XlsxSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LUVU'
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name)
    if (sheet.headers && sheet.headers.length > 0) {
      ws.addRow(sheet.headers)
      const hr = ws.getRow(1)
      hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      hr.alignment = { vertical: 'middle' }
    }
    for (const row of sheet.rows) {
      // 以 '=' 开头的字符串 → 公式
      const cells = row.map((c) => (typeof c === 'string' && c.startsWith('=') ? { formula: c.slice(1) } : c))
      ws.addRow(cells)
    }
    if (sheet.columnWidths) {
      sheet.columnWidths.forEach((w, i) => {
        if (w > 0) ws.getColumn(i + 1).width = w
      })
    }
    if (sheet.freezeHeader && sheet.headers && sheet.headers.length > 0) {
      ws.views = [{ state: 'frozen', ySplit: 1 }]
    }
  }
  const out = await wb.xlsx.writeBuffer()
  return out as unknown as Buffer
}
