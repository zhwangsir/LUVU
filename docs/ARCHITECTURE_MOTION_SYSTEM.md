# LUVU 动作系统长期工业化架构

> 设计目标：支撑商业级 Live2D 动作创作流水线。每个模块都为「未来 10× 复杂度」预留扩展点。
> 不是 MVP，是基建。

---

## 1. 设计哲学

- **数据驱动**：所有动作都有元数据 + 版本历史 + 评分；越用越好
- **可插拔**：生成策略 / 评分器 / 触发规则 / 输出格式都是接口，可替换
- **跨模型**：不绑死参数名；语义层映射到任意第三方模型
- **跨引擎**：当前 Cubism 4，未来可扩 Cubism 5 / 自定义引擎
- **AI 与人协同**：AI 给草稿，人在 TimelineEditor 微调；微调结果反哺 LLM prompt

## 2. 6+2 模块总览

```
┌────────────────────────────────────────────────────────────────┐
│                      触发应用层 (Phase 4)                       │
│  ┌────────────────┐    ┌────────────────────┐                  │
│  │ TriggerEngine  │←───│ EmotionFSM / 上下文 │                 │
│  └────────┬───────┘    └────────────────────┘                  │
│           │ 选择动作                                            │
└───────────│────────────────────────────────────────────────────┘
            │
┌───────────▼────────────────────────────────────────────────────┐
│                      创作工具层 (Phase 3)                       │
│  ┌─────────────────┐    ┌──────────────────┐                   │
│  │ TimelineEditor  │    │ MotionRecorder   │                   │
│  │ (可视化时间轴)  │    │ (实时录制)       │                   │
│  └─────────────────┘    └──────────────────┘                   │
└─────────────────────────┬──────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│                      生成与验证层 (Phase 1+2)                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            StrategyRegistry (Phase 1.D)                  │  │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────┐         │  │
│  │  │ DirectLLM  │ │ PlanRefine │ │ TemplateBased│         │  │
│  │  └────────────┘ └────────────┘ └──────────────┘         │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│  ┌──────────────────▼─────────────┐  ┌────────────────────┐    │
│  │ MotionValidator (Phase 2.A)    │  │ MotionScorer (2.B) │    │
│  │ 平滑度/冲突/loop/时长检查      │  │ AI/启发式自动打分  │    │
│  └──────────────────┬─────────────┘  └────────┬───────────┘    │
└─────────────────────│──────────────────────────│──────────────┘
                      ▼                          │
┌────────────────────────────────────────────────▼──────────────┐
│                    数据与领域层 (Phase 1)                     │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────┐  │
│  │ MotionEngine     │  │ ParameterIntrospect│  │ MotionLib│  │
│  │ (元数据/版本/    │  │ (语义识别 + 跨模型 │  │ (50+ 模板│  │
│  │  CRUD/查询)      │  │  映射)             │  │  )       │  │
│  └──────────────────┘  └────────────────────┘  └──────────┘  │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. 各模块详细设计

### 3.1 ParameterIntrospector （Phase 1.A）

**职责**：给定模型，识别每个参数的「语义」，不再依赖参数名硬编码。

**问题**：第三方模型参数名千奇百怪
- 标准 Cubism: `ParamAngleX`, `ParamMouthOpenY`, ...
- 旧约定: `PARAM_ANGLE_X`, `PARAM_MOUTH_OPEN_Y`, ...
- 中文 / 拼音: `头部角度X`, `zui_kai`
- 自定义编号: `P00`, `P12`

**输入**：模型的所有 motion3.json + 可选模型自带的 cdi3.json

**输出**：参数语义图
```ts
interface ParameterSemantics {
  param_id: string
  /** 标准化语义标签 */
  semantic: 'head_yaw' | 'head_pitch' | 'head_roll' | 'body_yaw' | 'body_pitch'
           | 'eye_left_x' | 'eye_left_y' | 'eye_right_x' | 'eye_right_y'
           | 'eye_left_open' | 'eye_right_open' | 'eye_smile'
           | 'brow_left_y' | 'brow_right_y'
           | 'mouth_open' | 'mouth_form' | 'mouth_smile'
           | 'breath' | 'cheek' | 'unknown'
  /** 置信度 0~1 */
  confidence: number
  /** 推断依据 */
  evidence: 'cdi3_metadata' | 'name_match' | 'cooccurrence_analysis' | 'range_pattern'
  /** 观察到的值域 */
  range: { min: number; max: number }
  /** 在已有动作中与其它参数协同变化的相关性（用于推断头/眼/嘴等组） */
  cooccurs_with: string[]
}
```

**算法分 3 层**：
1. **命名规则匹配**（高置信）：正则覆盖常见英文/中文/拼音命名
2. **cdi3.json 元数据**（最高置信）：Cubism 自带的参数描述文件
3. **协同分析**（fallback）：在 motion3.json 中分析哪些参数同时变化，归组（头部组 / 眼睛组 / 嘴部组）；range 模式（一般 head_yaw ±30, mouth_open 0~1）匹配

### 3.2 MotionLibrary （Phase 1.B）

**职责**：内置 50+ 动作模板，用「语义参数」描述，跨模型可复用。

**模板示例**（`templates/nod_gentle.yaml`）：
```yaml
name: nod_gentle
display_name_zh: 温柔点头
duration: 2.5
loop: false
tags: [agreement, calm, conversational]
description: 缓慢柔和地点 1-2 下头，眼神略微下垂
tracks:
  - semantic: head_pitch
    keyframes:
      - { t: 0, v: 0 }
      - { t: 0.6, v: -8 }   # 低头
      - { t: 1.2, v: 0 }    # 回正
      - { t: 1.8, v: -4 }   # 第二次小点头
      - { t: 2.5, v: 0 }
    easing: ease-in-out
  - semantic: eye_left_y
    keyframes:
      - { t: 0, v: 0 }
      - { t: 0.6, v: -0.3 }
      - { t: 1.2, v: 0 }
  - semantic: eye_right_y
    keyframes:  # 同 left
      - { t: 0, v: 0 }
      - { t: 0.6, v: -0.3 }
      - { t: 1.2, v: 0 }
```

**应用流程**：
1. 选模板（如 `nod_gentle`）
2. 查 ParameterIntrospector 得到模型的语义图
3. `TemplateRenderer.apply(template, semantics)` 把语义 track 映射为该模型的真实 param id
4. 检查值范围（rescale 到模型实际 min/max）
5. 输出 MotionDraft 写入

**模板分类**：
- 情绪类：happy, sad, angry, shy, surprise, sleepy, tease（×3 强度 = 21 个）
- 互动类：nod, shake, wave, point, bow, thinking, listening, applause（×2 风格 = 16 个）
- Idle 类：breath, blink_variant, look_around, stretch, hair_touch（5 个）
- 反应类：startled, confused, embarrassed, proud（4 个）
- **总计 46+ 模板，v1.0 目标 100+**

### 3.3 MotionEngine （Phase 1.C）— 核心

**职责**：所有 motion 的生命周期管理；SQLite 持久化；CRUD + 查询。

**数据模型**：
```sql
CREATE TABLE motion_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_dir TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,              -- 相对 model 根的 motion 文件路径
  group_name TEXT NOT NULL DEFAULT '',  -- model3.json 里的 Motions group
  -- 来源
  source TEXT NOT NULL,                 -- 'imported' | 'library' | 'llm' | 'manual' | 'recorded'
  strategy TEXT,                        -- 'direct_llm' | 'plan_refine' | 'template:nod_gentle' | ...
  prompt TEXT,                          -- 生成时的描述
  llm_provider TEXT,
  llm_model TEXT,
  -- 元数据
  duration_ms INTEGER,
  loop_flag INTEGER,
  param_count INTEGER,
  -- 评分
  validator_score REAL,                 -- 0~1, MotionValidator 输出
  scorer_score REAL,                    -- 0~1, MotionScorer 输出
  user_rating INTEGER,                  -- -1 (👎) / 0 / 1 (👍)
  play_count INTEGER DEFAULT 0,
  -- 关联
  parent_entry_id INTEGER,              -- 如果是 fork/iterate 自另一个
  -- 触发用
  emotion_tags TEXT,                    -- JSON array: ["happy", "shy"]
  context_tags TEXT,                    -- JSON array: ["idle", "greeting"]
  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_entry_id) REFERENCES motion_entries(id)
);

CREATE INDEX idx_motion_model ON motion_entries(model_dir);
CREATE INDEX idx_motion_emotion ON motion_entries(emotion_tags);

CREATE TABLE motion_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,          -- 完整 motion3.json 内容
  edited_by TEXT,                       -- 'user' | 'llm:refine' | 'auto:smooth'
  created_at INTEGER NOT NULL,
  UNIQUE(entry_id, version_no),
  FOREIGN KEY (entry_id) REFERENCES motion_entries(id)
);
```

**API**：
```ts
class MotionEngine {
  // CRUD
  list(filter?: { model_dir?: string; source?: string; min_score?: number }): MotionEntry[]
  get(id: number): MotionEntry | null
  create(input: CreateMotionInput): MotionEntry
  update(id: number, patch: Partial<MotionEntry>): MotionEntry
  delete(id: number): void

  // 版本控制
  saveVersion(id: number, snapshot: object, editedBy: string): MotionVersion
  listVersions(id: number): MotionVersion[]
  revertToVersion(id: number, versionNo: number): MotionEntry

  // 查询
  findByEmotion(model_dir: string, emotion: string): MotionEntry[]
  findByContext(model_dir: string, context: string): MotionEntry[]
  topRated(model_dir: string, n: number): MotionEntry[]

  // 使用统计
  recordPlay(id: number): void
  setRating(id: number, rating: -1 | 0 | 1): void

  // 同步
  syncFromDisk(model_dir: string): SyncReport  // 扫磁盘 + 比对 DB，找出新增/删除/外部修改
}
```

### 3.4 StrategyRegistry （Phase 1.D）

**职责**：多种生成策略可插拔；并发跑多个 → MotionScorer 选最优。

**接口**：
```ts
interface IGenerationStrategy {
  readonly id: string
  readonly display_name: string
  readonly description: string
  readonly cost_estimate: 'low' | 'medium' | 'high'  // LLM token 量
  generate(ctx: GenerationContext): Promise<MotionDraft>
}

interface GenerationContext {
  model_summary: ModelMotionSummary
  semantics: ParameterSemantics[]      // 来自 ParameterIntrospector
  description: string
  style?: string
  library?: MotionLibrary
  llm: LlmProvider                     // 当前用户配的 provider
}
```

**3 种内置策略**：

| ID | 描述 | LLM cost | 质量预期 |
|---|---|---|---|
| `direct_llm` | 当前 MVP 那种：一次性输出 JSON | 低 | 中等（不稳定） |
| `plan_refine` | 1 调 LLM 输出 outline（时间轴 + phases）；2 调 LLM 给每 phase 出 keyframes | 中等 | 高 |
| `template_based` | 从 library 选最匹配模板 → LLM 微调 duration/数值 | 低 | 高（基础设定稳） |
| `ensemble` | 跑 plan_refine + template_based + direct_llm → 用 scorer 选 | 高 | 最高 |

**用户在 UI 选策略 + 「我想要多少质量」**：
- 快速：direct_llm
- 推荐：template_based
- 精品：ensemble

### 3.5 MotionValidator （Phase 2.A）

**职责**：每个 draft 写入前先验证；不合格直接 reject。

**检查项**：
- **曲线平滑度**：相邻 keyframe 速度变化是否过激（防"颤抖"）
- **参数冲突**：互斥参数同时朝相反方向变化（如 ParamAngleX 同时正负）
- **Loop 跳变**：loop=true 时首末 keyframe 值差 > 阈值
- **时长合理**：< 0.5s 或 > 10s 警告
- **Keyframe 密度**：< 2 个 keyframe 或 > 100 个 keyframe 警告
- **值越界**：超过该参数 min/max 1.2 倍

输出：`{ valid: boolean; warnings: ValidationWarning[]; errors: ValidationError[] }`

### 3.6 MotionScorer （Phase 2.B）

**职责**：自动评分；多版本生成时取最优。

**评分维度**（每项 0~1，加权）：
- `smoothness` 0.25 — 二阶差分平均值（越小越平滑）
- `param_diversity` 0.15 — 用了多少不同参数（越多越生动）
- `description_match` 0.30 — LLM 二次调用：「这个动作匹配描述吗」
- `range_usage` 0.10 — 参数用了多少 range（极小 = 没动；接近边界 = 戏剧化）
- `loop_compatibility` 0.10 — 如果 loop=true，首末差异有多小
- `style_match` 0.10 — 与已有 motion 风格距离（避免突兀）

总分 = Σ(weight × score)

### 3.7 TimelineEditor （Phase 3.A）— 创作工具

**职责**：可视化时间轴；用户在 LLM 草稿上拖关键帧微调。

**UI 组件**：
- 横轴：时间（秒）
- 纵轴：参数列表（折叠组：头部 / 眼部 / 嘴部 / 身体 / 其它）
- 每个参数一行曲线，关键帧可拖拽
- 实时 preview：拖动时立刻在立绘上播放当前时刻参数
- 撤销/重做（CRDT 风格）
- 导出/导入：原始 motion3.json / 简化 keyframe yaml

技术：Canvas 2D 或 WebGL；Vue 3 reactive

### 3.8 MotionRecorder （Phase 3.B）

**职责**：用户在立绘上手动拖参数（例如用鼠标拖头部角度），录制成 motion。

UI：
- 右键菜单加「开始录制」/「停止录制」
- 录制时鼠标位置 → 实时驱动头部参数 + 自动捕获其它参数
- 停止后给个 timeline 让用户裁剪 + 命名 + 保存

### 3.9 TriggerEngine （Phase 4）

**职责**：根据情绪 + 上下文 + 时间，自动选合适 motion 播放。

**规则示例**：
```yaml
- when: emotion=shy AND context=conversation_reply
  pick: from MotionEngine.findByEmotion('shy') ORDER BY scorer_score DESC LIMIT 3
  randomize: true
  cooldown_seconds: 8

- when: emotion=happy AND intensity>0.7
  pick: ensemble_strategy('兴奋反应')  # 没有现成的 → 即时生成
  cache: true                            # 生成后存库
```

---

## 4. 实施优先级与时间表

| Phase | 模块 | 工作量 | 优先级 |
|---|---|---|---|
| 1.A | ParameterIntrospector | 1-2 天 | 🔴 P0 |
| 1.B | MotionLibrary（基础 20 模板） | 2-3 天 | 🔴 P0 |
| 1.C | MotionEngine + SQLite | 2-3 天 | 🔴 P0 |
| 1.D | StrategyRegistry + 3 策略 | 3-5 天 | 🔴 P0 |
| 2.A | MotionValidator | 1-2 天 | 🟠 P1 |
| 2.B | MotionScorer | 2-3 天 | 🟠 P1 |
| 3.A | TimelineEditor | 5-7 天 | 🟡 P2 |
| 3.B | MotionRecorder | 3-5 天 | 🟡 P2 |
| 4 | TriggerEngine + 规则配置 | 3-5 天 | 🔵 P3 |

**总计 ~22-37 天工程量。**

阶段产出节点：
- **第 1 周末**：Phase 1 完成。用户能选策略生成 motion，存到 SQLite，跨模型语义复用
- **第 2 周末**：Phase 2 完成。生成的 motion 都被打分，差的自动 reject
- **第 3-4 周**：Phase 3。Editor + Recorder，用户可视化创作
- **第 5 周**：Phase 4。情绪触发自动播放

---

## 5. 相邻系统扩展（同设计哲学）

| 系统 | 共享的设计 |
|---|---|
| **表情系统**（exp3.json） | ExpressionEngine + ExpressionLibrary + ExpressionScorer |
| **物理系统**（physics3.json） | PhysicsEngine + 模板（头发/裙摆/胸/耳） |
| **原画系统**（PSD） | PsdGenerator + LayerSemantics（每层语义识别）+ CubismExporter |
| **触发系统**（情绪→动作） | TriggerEngine 复用，规则引擎统一 |

整个 LUVU 后续都按这个模式：**数据驱动 + 可插拔策略 + 跨模型语义 + 工具协同**。

---

## 6. 当前实施位置

- ✅ MVP（v0.7.1）已 commit
- 🔧 修了 generate 错误显示（v0.7.1.1）
- 🚧 **Phase 1.A ParameterIntrospector** ← 下一步
- ⏳ Phase 1.B / 1.C / 1.D
- ⏳ Phase 2-4

---

最后更新：v0.7.2 起按本文件实施
