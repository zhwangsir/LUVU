/**
 * preload 进程全局类型扩展。
 * contextIsolation=false fallback 时需要向 window 挂 api，
 * 在此声明让 tsc (node tsconfig) 知道该字段合法。
 */
import type { LuvuApi } from '../shared/api'

declare global {
  interface Window {
    api: LuvuApi
  }
}
