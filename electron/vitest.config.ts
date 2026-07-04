/**
 * v0.13 (audit architecture HIGH): 第一批单元测试配置。
 *
 * 范围：纯函数（无 Electron API 依赖）— 当前覆盖
 *   - motion-factory/parser.ts: 编解码 motion3.json
 *   - services/disk-usage.ts: formatBytes（如果加）
 *   - services/logger.ts: redactSensitive
 *
 * 不覆盖：IPC handler / renderer Vue 组件（后续需要 electron-mock + @vue/test-utils）
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
    coverage: {
      thresholds: {
        lines: 30,
        branches: 20,
        functions: 25,
      },
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/preload/**', 'src/renderer/**'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
