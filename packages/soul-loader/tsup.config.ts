import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types.ts',
    'src/merger.ts',
    'src/system-prompt.ts',
    'src/migrate.ts',
    'src/diff.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [],
})
