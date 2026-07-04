/**
 * v0.13 (audit): shared/format-utils 单元测试。
 */
import { describe, it, expect } from 'vitest'
import { formatBytes, formatDuration } from './format-utils'

describe('formatBytes', () => {
  it('0 → "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('< 1024 B', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('KB 范围 (1 位小数)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024)).toBe('10.0 KB')
  })

  it('MB 范围 (1 位小数)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('GB 范围 (2 位小数)', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatBytes(17 * 1024 * 1024 * 1024)).toBe('17.00 GB')
    expect(formatBytes(5.4 * 1024 * 1024 * 1024)).toBe('5.40 GB')
  })

  it('负数 → "0 B"', () => {
    expect(formatBytes(-100)).toBe('0 B')
  })

  it('NaN → "0 B"', () => {
    expect(formatBytes(NaN)).toBe('0 B')
  })

  it('Infinity → "0 B"', () => {
    expect(formatBytes(Infinity)).toBe('0 B')
  })

  it('小数 byte 应该 round', () => {
    expect(formatBytes(512.7)).toBe('513 B')
  })
})

describe('formatDuration', () => {
  it('ms 范围', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('s 范围 (1 位小数)', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(3500)).toBe('3.5s')
    expect(formatDuration(59 * 1000)).toBe('59.0s')
  })

  it('m 范围 (整数)', () => {
    expect(formatDuration(60 * 1000)).toBe('1m')
    expect(formatDuration(45 * 60 * 1000)).toBe('45m')
  })

  it('h 范围 (1 位小数)', () => {
    expect(formatDuration(60 * 60 * 1000)).toBe('1.0h')
    expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe('2.5h')
  })

  it('负数 / NaN → "0ms" (fallback)', () => {
    // 不抛错；走 < 1000 分支
    expect(formatDuration(-100)).toBe('0ms')
    expect(formatDuration(NaN)).toBe('0ms')
  })
})
