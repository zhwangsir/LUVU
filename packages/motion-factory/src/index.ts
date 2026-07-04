/**
 * @luvu/motion-factory — Live2D Cubism 4 motion3.json 编码 / 校验 / 评分纯函数包。
 *
 * 不依赖 fs / electron — Node + browser + deno 通用。
 *
 * 使用:
 *   import { draftToMotion3Json, validateMotionDraft, scoreMotionDraft } from '@luvu/motion-factory'
 *
 * 反哺 airi / openai-cli / 任何 Live2D 项目都能用，
 * 不需要装整个 LUVU Electron app。
 */
export type { KeyframeTrack, MotionDraft, ParamInfo, ModelMotionSummary } from './types'
export { draftToMotion3Json, trackToSegments } from './encoder'
export * from './validator'
export * from './scorer'
