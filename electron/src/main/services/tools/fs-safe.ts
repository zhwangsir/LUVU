/**
 * 工具文件访问白名单 —— builtin.ts 与 builtin-system.ts 共用（避免循环 import）。
 *
 * 所有工具写/读/删路径都过 safeResolve：必须落在白名单根下
 * （~/.luvu + ~/Documents/LUVU + 项目根），否则拒绝。
 */
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { getPaths } from '../paths'

export function allowedRoots(): string[] {
  const home = homedir()
  return [getPaths().userDataDir, join(home, 'Documents', 'LUVU'), getPaths().projectRoot]
}

/** 把任意 path 解析为绝对 + 标准化，然后必须落在某个 allowed root 下 */
export function safeResolve(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path 必须是非空字符串')
  }
  let expanded = input
  if (expanded.startsWith('~/')) expanded = join(homedir(), expanded.slice(2))
  const abs = isAbsolute(expanded) ? expanded : resolve(expanded)
  const normalized = normalize(abs)
  const roots = allowedRoots()
  const ok = roots.some((r) => normalized === r || normalized.startsWith(r + sep))
  if (!ok) {
    throw new Error(`拒绝访问：path 必须在以下根目录之一：\n${roots.join('\n')}`)
  }
  return normalized
}
