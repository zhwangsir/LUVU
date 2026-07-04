/**
 * dialog-export 单测 (UX R87)。
 */
import { describe, expect, it } from 'vitest'
import { exportTurnsToMarkdown, type ExportTurn } from './dialog-export'

const TS = 1747832520000 // 固定 ts 便于断言: 2025-05-21 之类 (具体取决于时区)

describe('exportTurnsToMarkdown', () => {
  it('空 turns → header + 占位', () => {
    const out = exportTurnsToMarkdown([], '心心')
    expect(out).toContain('# LUVU 对话 · 心心')
    expect(out).toContain('暂无对话历史')
  })

  it('user + assistant 基本流程', () => {
    const turns: ExportTurn[] = [
      { role: 'user', text: '在吗', ts: TS },
      { role: 'assistant', text: '在的', ts: TS, emotion: 'happy', intensity: 0.8 },
    ]
    const out = exportTurnsToMarkdown(turns, '心心')
    expect(out).toContain('🧑 主人')
    expect(out).toContain('🤖 心心')
    expect(out).toContain('在吗')
    expect(out).toContain('在的')
    expect(out).toContain('情绪 happy 80%')
  })

  it('system 角色不导出', () => {
    const turns: ExportTurn[] = [
      { role: 'system', text: '系统提示', ts: TS },
      { role: 'user', text: '你好', ts: TS },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).not.toContain('系统提示')
    expect(out).toContain('你好')
  })

  it('neutral emotion 不显示情绪行', () => {
    const turns: ExportTurn[] = [
      { role: 'assistant', text: 'hi', ts: TS, emotion: 'neutral' },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).not.toContain('情绪')
  })

  it('error turn 标记失败', () => {
    const turns: ExportTurn[] = [
      { role: 'assistant', text: '', ts: TS, error: 'timeout' },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('❌ 失败')
  })

  it('空 text 显示占位', () => {
    const turns: ExportTurn[] = [
      { role: 'user', text: '', ts: TS },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('（空）')
  })

  it('header 含日期', () => {
    const out = exportTurnsToMarkdown([], 'x')
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('R92-fix: 行首 # 转义防破坏 H1', () => {
    const turns: ExportTurn[] = [
      { role: 'user', text: '# 我的标题\n说话', ts: TS },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('\\# 我的标题')
  })

  it('R92-fix: 行首 --- 转义防破坏 hr', () => {
    const turns: ExportTurn[] = [
      { role: 'user', text: 'hello\n---', ts: TS },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('\\---')
  })

  it('R92-fix: inline **bold** / `code` 不转义 (允许用户用 markdown)', () => {
    const turns: ExportTurn[] = [
      { role: 'user', text: '我说 **重点** 和 `代码`', ts: TS },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('**重点**')
    expect(out).toContain('`代码`')
  })

  it('intensity 缺失时不带百分比', () => {
    const turns: ExportTurn[] = [
      { role: 'assistant', text: 'hi', ts: TS, emotion: 'happy' },
    ]
    const out = exportTurnsToMarkdown(turns, 'x')
    expect(out).toContain('情绪 happy')
    expect(out).not.toMatch(/情绪 happy \d+%/)
  })
})
