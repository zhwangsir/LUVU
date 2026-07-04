/**
 * 动作工坊 IPC handlers — type-safe channels (Phase 1 G).
 *
 * 涵盖：解析 / 语义识别 / LLM 生成 / 写盘 / 模板库 / 校验 / 评分 / 历史
 */
import { ipcMain, type BrowserWindow } from 'electron'
import {
  libraryApply,
  libraryGet,
  libraryList,
  libraryReload,
  librarySummary,
  motionGenerate,
  motionIntrospect,
  motionSummarize,
  motionWrite,
} from '@shared/channels/motion-factory'
import { summarizeModelMotions } from '../services/motion-factory/parser'
import { generateMotion } from '../services/motion-factory/llm-generate'
import { writeMotion } from '../services/motion-factory/writer'
import { introspect } from '../services/motion-factory/parameter-introspector'
import { dumpIntrospection } from '../services/motion-factory/parameter-introspector.test-runner'
import * as library from '../services/motion-factory/library-loader'
import { renderTemplateToDraft } from '../services/motion-factory/template-renderer'
import { handleInvoke } from './channel-helpers'

export function registerMotionFactoryIpc(getWindow: () => BrowserWindow | null): void {
  // === 解析 ===
  handleInvoke(motionSummarize, (modelDir) => summarizeModelMotions(modelDir))

  // === 语义识别 ===
  handleInvoke(motionIntrospect, (modelDir) => introspect(modelDir))

  // E5 (audit): debug-only IPC — 仅在 LUVU_DEBUG=1 / MAIN_APP_DEBUG=1 时注册，
  // 不在 prod 暴露调试工具到 IPC 面
  if (process.env.LUVU_DEBUG === '1' || process.env.MAIN_APP_DEBUG === '1') {
    ipcMain.handle('motion:introspect-debug', (_evt, modelDir: string): string => {
      return dumpIntrospection(modelDir)
    })
  }

  // === LLM 生成 ===
  handleInvoke(motionGenerate, async (payload) => {
    try {
      const summary = summarizeModelMotions(payload.model_dir)
      if (summary.params.length === 0) {
        return {
          ok: false,
          reason:
            '该模型还没有任何动作可供参考（无法学习参数范围）；请先用 Editor 做 1-2 个示例动作',
        }
      }
      const draft = await generateMotion({
        summary,
        description: payload.description,
        ...(payload.style !== undefined && { style: payload.style }),
        ...(payload.examples !== undefined && { examples: payload.examples }),
        ...(payload.strategy !== undefined && { strategy: payload.strategy }),
      })
      return { ok: true, draft, strategy_used: payload.strategy ?? 'direct_llm' }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  // === 写盘 ===
  handleInvoke(motionWrite, (payload) => {
    const result = writeMotion(payload.model_json_path, payload.draft, payload.group)
    if (result.ok) {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('motion:written', {
          model_json_path: payload.model_json_path,
          motion_relative: result.motion_relative,
        })
      }
    }
    return result
  })

  // === MotionLibrary 模板库 ===
  handleInvoke(librarySummary, () => library.summary())
  handleInvoke(libraryList, () => library.list())
  handleInvoke(libraryGet, (id) => library.get(id))
  handleInvoke(libraryReload, () => {
    library.reload()
    return library.summary()
  })
  handleInvoke(libraryApply, (payload) => {
    const tmpl = library.get(payload.template_id)
    if (!tmpl) return { ok: false, reason: `模板未找到：${payload.template_id}` }
    return renderTemplateToDraft(tmpl, payload.model_dir, {
      ...(payload.speed_scale !== undefined && { speed_scale: payload.speed_scale }),
      ...(payload.intensity_scale !== undefined && { intensity_scale: payload.intensity_scale }),
      ...(payload.name_suffix !== undefined && { name_suffix: payload.name_suffix }),
    })
  })
}
