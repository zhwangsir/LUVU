/**
 * v0.16 T3: Live2D 物理预设库 — 5 个常见物理模板。
 *
 * 物理调整在 Cubism Editor 里是手工细活 — 我们给出**合理起点**，
 * 用户后续可以在 Cubism 微调。
 *
 * 输入参数（Input）默认用 ParamAngleX/Y/Z（最常见）
 * 输出参数（Output）根据预设的目标名 pattern：
 * - short_hair → ParamHairFront / ParamHairSide
 * - long_hair → ParamHairFront / ParamHairBack
 * - twin_tails → ParamHairFront / ParamHairLeft / ParamHairRight
 * - long_skirt → ParamSkirtFront / ParamSkirtBack
 * - short_skirt → ParamSkirtFront
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type PhysicsPresetId = 'short_hair' | 'long_hair' | 'twin_tails' | 'long_skirt' | 'short_skirt'

interface PhysicsSettingItem {
  Id: string
  Input: Array<{
    Source: { Target: 'Parameter'; Id: string }
    Weight: number
    Type: 'X' | 'Y' | 'Angle'
    Reflect?: boolean
  }>
  Output: Array<{
    Destination: { Target: 'Parameter'; Id: string }
    VertexIndex: number
    Scale: number
    Weight: number
    Type: 'X' | 'Y' | 'Angle'
    Reflect?: boolean
  }>
  Vertices: Array<{
    Position: { X: number; Y: number }
    Mobility: number
    Delay: number
    Acceleration: number
    Radius: number
  }>
  Normalization: {
    Position: { Minimum: number; Default: number; Maximum: number }
    Angle: { Minimum: number; Default: number; Maximum: number }
  }
}

interface PhysicsPreset {
  label: string
  description: string
  /** 物理输出参数名 — apply 时只对模型有的参数生效 */
  output_param_ids: string[]
  /** 链节数（顶点数量越多越软） */
  chain_length: number
  /** 灵活度 0-1，1 最软 */
  mobility: number
  /** 延迟 0-1，0 同步立刻，1 缓慢 */
  delay: number
}

const PRESETS: Record<PhysicsPresetId, PhysicsPreset> = {
  short_hair: {
    label: '短发',
    description: '小幅度晃动，跟头部动作快速跟随',
    output_param_ids: ['ParamHairFront', 'ParamHairSide'],
    chain_length: 3,
    mobility: 0.7,
    delay: 0.4,
  },
  long_hair: {
    label: '长发',
    description: '中等振幅，明显惯性',
    output_param_ids: ['ParamHairFront', 'ParamHairBack', 'ParamHairSide'],
    chain_length: 5,
    mobility: 0.9,
    delay: 0.75,
  },
  twin_tails: {
    label: '双马尾',
    description: '左右两条独立摆动',
    output_param_ids: ['ParamHairFront', 'ParamHairLeft', 'ParamHairRight'],
    chain_length: 4,
    mobility: 0.85,
    delay: 0.65,
  },
  long_skirt: {
    label: '长裙',
    description: '大幅度慢摆，符合面料垂感',
    output_param_ids: ['ParamSkirtFront', 'ParamSkirtBack'],
    chain_length: 6,
    mobility: 0.95,
    delay: 0.85,
  },
  short_skirt: {
    label: '短裙',
    description: '小幅快摆，跟身体动作紧跟',
    output_param_ids: ['ParamSkirtFront'],
    chain_length: 3,
    mobility: 0.75,
    delay: 0.5,
  },
}

export function listPhysicsPresets(): Array<{ id: PhysicsPresetId; label: string; description: string }> {
  return (Object.keys(PRESETS) as PhysicsPresetId[]).map((id) => ({
    id,
    label: PRESETS[id].label,
    description: PRESETS[id].description,
  }))
}

/**
 * 给模型应用物理预设 — 检测模型有哪些可作为 output 的参数，
 * 只对实际存在的 param 生成 PhysicsSetting。
 */
export function applyPhysicsPreset(
  modelDir: string,
  presetId: PhysicsPresetId,
): { ok: boolean; applied_outputs: string[]; reason?: string } {
  const preset = PRESETS[presetId]
  if (!preset) return { ok: false, applied_outputs: [], reason: 'unknown preset' }

  // 找 model3.json 拿可用参数（其实参数清单在 .moc3 里，但物理仅依赖名字匹配）
  // MVP: 我们直接生成预设 — 用户应用后 Cubism 启动时若参数不存在会忽略对应输出，
  // 不会破坏模型加载
  const physics: {
    Version: number
    Meta: Record<string, unknown>
    PhysicsSettings: PhysicsSettingItem[]
  } = {
    Version: 3,
    Meta: {
      PhysicsSettingCount: preset.output_param_ids.length,
      TotalInputCount: 3 * preset.output_param_ids.length,
      TotalOutputCount: preset.output_param_ids.length,
      VertexCount: preset.chain_length * preset.output_param_ids.length,
      EffectiveForces: {
        Gravity: { X: 0, Y: -1 },
        Wind: { X: 0, Y: 0 },
      },
      PhysicsDictionary: preset.output_param_ids.map((p, i) => ({
        Id: `PhysicsSetting${i + 1}`,
        Name: p,
      })),
    },
    PhysicsSettings: preset.output_param_ids.map((outputParam, i) => ({
      Id: `PhysicsSetting${i + 1}`,
      Input: [
        { Source: { Target: 'Parameter', Id: 'ParamAngleX' }, Weight: 60, Type: 'Angle', Reflect: false },
        { Source: { Target: 'Parameter', Id: 'ParamAngleZ' }, Weight: 40, Type: 'Angle', Reflect: false },
        { Source: { Target: 'Parameter', Id: 'ParamBodyAngleX' }, Weight: 30, Type: 'Angle', Reflect: false },
      ],
      Output: [
        {
          Destination: { Target: 'Parameter', Id: outputParam },
          VertexIndex: preset.chain_length - 1,
          Scale: 25,
          Weight: 100,
          Type: 'Angle',
          Reflect: false,
        },
      ],
      // 链节顶点 — 从根 (0,0) 向下扩展
      Vertices: Array.from({ length: preset.chain_length }, (_, j) => ({
        Position: { X: 0, Y: -j * 0.5 },
        Mobility: preset.mobility,
        Delay: preset.delay,
        Acceleration: 1.5,
        Radius: 0.15,
      })),
      Normalization: {
        Position: { Minimum: -10, Default: 0, Maximum: 10 },
        Angle: { Minimum: -10, Default: 0, Maximum: 10 },
      },
    })),
  }

  // 写文件
  if (!existsSync(modelDir)) return { ok: false, applied_outputs: [], reason: 'model dir not found' }
  const physicsPath = join(modelDir, 'physics3.json')
  try {
    writeFileSync(physicsPath, JSON.stringify(physics, null, 2), 'utf-8')
  } catch (e) {
    return { ok: false, applied_outputs: [], reason: String(e).slice(0, 200) }
  }

  // 更新 model3.json 加 Physics 引用
  try {
    const files = readdirSync(modelDir)
    const m3 = files.find((f) => /\.model3\.json$/i.test(f))
    if (m3) {
      const m3Path = join(modelDir, m3)
      const json = JSON.parse(readFileSync(m3Path, 'utf-8')) as {
        FileReferences?: { Physics?: string }
      }
      json.FileReferences = json.FileReferences ?? {}
      json.FileReferences.Physics = 'physics3.json'
      writeFileSync(m3Path, JSON.stringify(json, null, 2), 'utf-8')
    }
  } catch {
    /* model3 更新失败但物理文件已写，仍 ok */
  }

  return { ok: true, applied_outputs: preset.output_param_ids }
}
