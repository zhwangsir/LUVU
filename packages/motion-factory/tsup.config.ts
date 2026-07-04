import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types.ts',
    'src/encoder.ts',
    'src/validator.ts',
    'src/scorer.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // 纯函数包 — 零运行时依赖
  external: [],
})
