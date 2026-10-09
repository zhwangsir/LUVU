/**
 * 类型补齐(augmentation):pixi-live2d-display 的 types/index.d.ts 没有声明
 * CubismShader_WebGL,但 ES 构建(cubism4.es.js)运行时确实导出它
 * (v0.22 同框多 context 修复依赖;见 avatar/render/cubism-multi-context.ts)。
 * 文件末尾 export {} 使本文件成为模块 → declare module 为「增强」而非「覆盖」。
 */
declare module 'pixi-live2d-display/cubism4' {
  export class CubismShader_WebGL {
    static getInstance(): CubismShader_WebGL
    static deleteInstance(): void
    gl: WebGLRenderingContext | null
    _shaderSets: unknown[]
    setGl(gl: WebGLRenderingContext): void
    releaseShaderProgram(): void
    generateShaders(): void
  }
}

export {}
