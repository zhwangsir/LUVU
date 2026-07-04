/**
 * 跨进程通用格式化 utility (v0.13)。
 *
 * 这些函数同时在 main / preload / renderer 用到，
 * 因此放 shared/ 而不是某个域内部。
 */

/** 把字节数格式化成人类可读字符串 (B / KB / MB / GB)。负数 / NaN 当 0 处理。 */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return '0 B'
  if (b < 1024) return `${Math.round(b)} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 把毫秒数格式化成人类可读时长 (500ms / 3.5s / 45m / 2h)。负数 / NaN → "0ms"。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = s / 60
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  return `${h.toFixed(1)}h`
}
