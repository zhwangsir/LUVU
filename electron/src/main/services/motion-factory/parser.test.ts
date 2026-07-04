/**
 * v0.13 (audit): motion-factory/parser 单元测试 — 第一批 starter tests。
 */
import { describe, it, expect } from 'vitest'
import { draftToMotion3Json } from './parser'
import type { MotionDraft } from '@shared/motion'

describe('draftToMotion3Json', () => {
  it('编码空 keyframes 应返回有效 motion3 结构', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: false,
      name: 'test',
      tracks: [],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as Record<string, unknown>
    expect(json).toMatchObject({
      Version: 3,
      Meta: expect.objectContaining({
        Duration: 1.0,
        Loop: false,
        CurveCount: 0,
      }),
      Curves: [],
    })
  })

  it('单 track 单 keyframe 应包含起点 + 0 段', () => {
    const draft: MotionDraft = {
      duration: 0.5,
      loop: false,
      name: 'test',
      tracks: [
        { param: 'ParamAngleX', keyframes: [[0.0, 10.0]] },
      ],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as {
      Curves: Array<{ Id: string; Segments: number[] }>
    }
    expect(json.Curves).toHaveLength(1)
    expect(json.Curves[0]!.Id).toBe('ParamAngleX')
    // 单点：[time, value] = [0, 10]
    expect(json.Curves[0]!.Segments).toEqual([0, 10])
  })

  it('多 keyframes 应生成 Linear segments (type=0)', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: true,
      name: 'test',
      tracks: [
        { param: 'ParamMouthOpenY', keyframes: [[0, 0], [0.5, 1], [1, 0]] },
      ],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as {
      Curves: Array<{ Segments: number[] }>
      Meta: { TotalSegmentCount: number; TotalPointCount: number }
    }
    // 起点 [0,0] + 段 [type=0, 0.5, 1] + 段 [type=0, 1, 0] = 8 数字
    expect(json.Curves[0]!.Segments).toEqual([0, 0, 0, 0.5, 1, 0, 1, 0])
    expect(json.Meta.TotalSegmentCount).toBe(2)
    expect(json.Meta.TotalPointCount).toBe(3)
  })

  it('未排序的 keyframes 应按 time 排序', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: false,
      name: 'test',
      tracks: [
        { param: 'X', keyframes: [[0.5, 5], [0, 0], [1, 10]] },
      ],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as {
      Curves: Array<{ Segments: number[] }>
    }
    // 起点应是 time=0 那个
    expect(json.Curves[0]!.Segments.slice(0, 2)).toEqual([0, 0])
  })

  it('description 写入 UserData', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: false,
      name: 'test',
      description: '撒娇的小动作',
      tracks: [],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as {
      UserData?: Array<{ Time: number; Value: string }>
      Meta: { UserDataCount: number; TotalUserDataSize: number }
    }
    expect(json.UserData).toEqual([{ Time: 0, Value: '撒娇的小动作' }])
    expect(json.Meta.UserDataCount).toBe(1)
    expect(json.Meta.TotalUserDataSize).toBe('撒娇的小动作'.length)
  })

  it('无 description 不应有 UserData 字段', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: false,
      name: 'test',
      tracks: [],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as Record<string, unknown>
    expect(json).not.toHaveProperty('UserData')
  })

  it('AreBeziersRestricted 应为 true（我们全 Linear）', () => {
    const draft: MotionDraft = {
      duration: 1.0,
      loop: false,
      name: 'test',
      tracks: [],
    }
    const json = JSON.parse(draftToMotion3Json(draft)) as {
      Meta: { AreBeziersRestricted: boolean }
    }
    expect(json.Meta.AreBeziersRestricted).toBe(true)
  })
})
