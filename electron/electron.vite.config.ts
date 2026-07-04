import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // workspace 包 bundle 进 out/ — 否则 electron-builder asar 阶段会因
    // packages/* 在 electron/ 外抱怨 "must be under electron/"
    plugins: [
      externalizeDepsPlugin({
        // pptxgenjs 4.x 的 externalize 会误解析到 ESM build（pptxgen.es.js）→ 在 CJS main
        // 里 require 报 "Cannot use import statement outside a module"。bundle 进 main 让
        // rollup 构建期处理 ESM → 运行期不再 require ESM 文件。
        exclude: ['@luvu/motion-factory', '@luvu/soul-loader', 'pptxgenjs'],
      }),
    ],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    // reviewer M-3:preload 实际不 import @luvu/* workspace 包,exclude 是冗余
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      // Electron 33 内置 Chromium 130 — 允许 top-level await（wlipsync@1.3.0 用到）
      target: 'chrome130',
      // Pixi + pixi-live2d-display 占 ~1MB，单 chunk 触发 500kb 警告
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          manualChunks(id): string | undefined {
            if (id.includes('node_modules')) {
              if (id.includes('pixi.js') || id.includes('@pixi')) return 'vendor-pixi'
              if (id.includes('pixi-live2d-display')) return 'vendor-live2d'
              if (id.includes('/vue/') || id.includes('@vue/') || id.includes('pinia') || id.includes('mitt')) {
                return 'vendor-vue'
              }
              return 'vendor-misc'
            }
            return undefined
          }
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    server: {
      port: 5173
    },
    plugins: [vue()],
    // dev 模式下 vite 也需要支持 top-level await（renderer.build.target 只管 build）
    optimizeDeps: {
      esbuildOptions: {
        target: 'chrome130'
      }
    },
    esbuild: {
      target: 'chrome130'
    }
  }
})
