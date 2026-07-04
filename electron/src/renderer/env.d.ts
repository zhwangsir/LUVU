/// <reference types="vite/client" />

import type { LuvuApi } from '../shared/api'

declare global {
  interface Window {
    api: LuvuApi
    /** Safari / 旧版 Chromium 的 AudioContext 前缀实现 */
    webkitAudioContext?: typeof AudioContext
  }

  interface File {
    /** Electron renderer 在 contextIsolation=false 时附加的文件系统路径 */
    readonly path?: string
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}
