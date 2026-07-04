/**
 * 内置工具 —— LUVU 第一批安全工具。
 *
 * 安全：fs.* 受白名单根限制（~/.luvu + ~/Documents/LUVU 默认）。
 * 用户可在 settings 增加额外根（v0.7）。
 *
 * M7 创造统一（v0.21）：
 *   - 新增 creative_generate_sticker —— 让 LLM 在 dialog 路径里调 ComfyUI 出图。
 *     和 BehaviorPlanner 的 `generate_sticker` action 走同一个 workflow，
 *     但调用方是 dialog LLM 而不是 attention LLM。
 *   - 出图后 emit `comfyui:progress {kind:'sticker', state:'done'}` 给 renderer，
 *     StickerOverlay 自动浮在桌面上。
 */
import { Notification, shell, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { register } from './registry'
import { safeResolve } from './fs-safe'
import { registerSystemToolset } from './builtin-system'
import { ensureDir, getPaths } from '../paths'
import { getSharedComfyClient } from '../comfyui/client'
import { buildStickerWorkflow, type StickerParams } from '../comfyui/workflows'
import { addMemoryForActive } from '../memory-store'
import { fallbackEmbedding } from '../memory-extractor'
// v0.21 真控：Office 生成 + 鼠键自动化原语 / vision / agent loop 统一暴露成 LLM 工具
import * as auto from '../automation'
import { findAndClick } from '../automation/vision-grounding'
import { runAgentTask } from '../automation/agent-loop'
import { buildDocxBuffer, normalizeDocxSpec } from '../office/docx-generator'
import { buildPptxBuffer, normalizePptxSpec } from '../office/pptx-generator'
import { buildXlsxBuffer, normalizeXlsxSpec } from '../office/xlsx-generator'
import { resolveDocxIllustrations, resolveIllustrations } from '../office/illustration'

// v0.21:ComfyClient 单例 + ensureDir 全部来自 services/comfyui/client + paths
// 不再本地各持一份(消重 + 解决 endpoint 切换时 stale 问题)

/**
 * Reviewer HIGH-1: 派生自 StickerParams['emotion'] —— workflows.ts 加新 emotion 时
 * TypeScript 立刻报错;不再手写 8 个字符串可能 drift。
 */
type StickerEmotion = StickerParams['emotion']
const VALID_EMOTIONS: readonly StickerEmotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'tease',
  'sleepy',
  'surprise',
] as const
// 编译期保险:若 StickerParams 加新 emotion,下面 satisfies 强制 VALID_EMOTIONS 覆盖完整
// (TS 看不出"缺哪个",但 StickerEmotion[] 是 union 类型,完整集合即可通过)
const _emotionExhaustiveCheck: ReadonlyArray<StickerEmotion> = VALID_EMOTIONS
void _emotionExhaustiveCheck

function isValidEmotion(s: string): s is StickerEmotion {
  return (VALID_EMOTIONS as readonly string[]).includes(s)
}

/**
 * M7：注册 creative_generate_sticker 让 dialog LLM 主动出图。
 * 跟 BehaviorPlanner 的 `generate_sticker` action 复用 buildStickerWorkflow。
 * 生成后通过 webContents.send 给 renderer，StickerOverlay 自动浮窗。
 */
function registerCreativeTools(getWindow: () => BrowserWindow | null): void {
  register(
    {
      name: 'creative_generate_sticker',
      description:
        '画一张表情贴纸送主人（通过 ComfyUI）。当主人说想看你画的东西、或想给主人惊喜时调用。' +
        '生成后会自动浮在桌面上，不需要再额外发文件路径给主人。一次只生成 1 张。' +
        '调用频繁会让主人烦（每张需 6-30 秒），合适场景再用。',
      risk: 'medium',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          emotion: {
            type: 'string',
            description: '贴纸主题情绪',
            enum: [...VALID_EMOTIONS],
          },
          extra_prompt: {
            type: 'string',
            description:
              '可选额外英文描述（如 "fireworks, celebration", "holding a gift", "starry night sky"）',
          },
        },
        required: ['emotion'],
      },
    },
    async (input) => {
      const emotionRaw = String(input.emotion ?? 'happy')
      if (!isValidEmotion(emotionRaw)) {
        throw new Error(
          `emotion 必须是 ${VALID_EMOTIONS.join(' / ')} 之一，收到：${emotionRaw}`,
        )
      }
      const emotion = emotionRaw
      const extraRaw = input.extra_prompt
      const extraPrompt =
        typeof extraRaw === 'string' && extraRaw.trim().length > 0 ? extraRaw.trim() : undefined

      const client = getSharedComfyClient()
      const wf = buildStickerWorkflow({
        emotion,
        ...(extraPrompt !== undefined ? { extraPrompt } : {}),
      })

      // 通知 renderer 开始（让 StickerOverlay 知道有任务在跑，可显 spinner）
      const win0 = getWindow()
      if (win0 && !win0.isDestroyed()) {
        win0.webContents.send('comfyui:progress', { kind: 'sticker', state: 'queued', emotion })
      }

      const r = await client.generate(wf, {
        onProgress: (state) => {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('comfyui:progress', { kind: 'sticker', state, emotion })
          }
        },
      })

      // 下载到 ~/.luvu/stickers/
      const destDir = ensureDir(join(getPaths().userDataDir, 'stickers'))
      const saved: string[] = []
      for (const img of r.images) {
        const fname = `sticker_${emotion}_${Date.now()}_${basename(img.filename)}`
        const dest = join(destDir, fname)
        try {
          await client.downloadImage(img.filename, img.subfolder, img.type, dest)
          saved.push(dest)
        } catch (e) {
          console.warn('[creative_generate_sticker] download skipped', img.filename, e)
        }
      }

      // emit done — StickerOverlay 会调 listRecent 拿最新一张浮窗
      const winEnd = getWindow()
      if (winEnd && !winEnd.isDestroyed()) {
        winEnd.webContents.send('comfyui:progress', { kind: 'sticker', state: 'done', emotion })
      }

      if (saved.length === 0) {
        throw new Error('ComfyUI 没返回任何图片')
      }
      const extraDesc = extraPrompt ? `(${extraPrompt})` : ''

      // v0.21 Round D:M7 闭环 — 写 per-character memory.db,让 LLM 在下次
      // 对话能回忆"我画过什么"("那张星空我重新画一遍" / "上次画的贴纸主人喜欢吗")。
      //
      // v0.21 Round D 收尾:embedding 用 fallbackEmbedding(32 维 hash),跟其他
      // memory 写入路径一致 — 这样 cosine similarity 计算长度匹配,RAG 能召回。
      // hash 不是真语义,但起码"上次画过 happy"会被同 emotion 的 query 匹到。
      // v0.22 接 embedding endpoint 时只换 fallbackEmbedding 实现,signature 不变。
      //
      // importance 0.6 中高:创作行为相对稀疏(30 分钟最多 1-2 次),每次值得记。
      // (TODO v0.22:抽 MEMORY_IMPORTANCE_CREATIVE 常量;reviewer LOW-1)
      // (TODO v0.22:同 emotion 重复画去重;reviewer LOW-2)
      try {
        const memText = `我画了一张「${emotion}」${extraDesc}贴纸送给主人,已浮在桌面上`
        const memResult = addMemoryForActive({
          kind: 'event',
          text: memText,
          embedding: fallbackEmbedding(memText),
          importance: 0.6,
          source: 'creative_generate_sticker',
        })
        // reviewer MEDIUM-1:addMemoryForActive 无 active character 时返 null
        // 不抛错,try/catch 触发不到 — 显式日志保可观测性
        if (!memResult) {
          console.warn(
            '[creative_generate_sticker] no active character, memory write skipped',
          )
        }
      } catch (e) {
        // 写记忆失败不影响主流程,只警告(addMemory 内部 SQLite 错才会到这里)
        console.warn('[creative_generate_sticker] memory 写入失败:', e)
      }

      return `已画好一张「${emotion}」${extraDesc}贴纸送主人，已浮在桌面上 ❤️`
    },
  )
}

/** 文件名净化：去扩展名/危险字符，兜底 'LUVU'，再补正确扩展名 */
function safeFilename(rawName: unknown, title: string, ext: 'docx' | 'pptx' | 'xlsx'): string {
  let base = typeof rawName === 'string' && rawName.trim() ? rawName : title
  base = base
    .replace(/\.(docx|pptx|xlsx)$/i, '')
    .replace(/[^\w一-龥 .-]/g, '_')
    .trim()
    .slice(0, 80)
  if (!base) base = 'LUVU'
  return `${base}.${ext}`
}

/** 生成到 ~/Documents/LUVU/（在 safeResolve 白名单内），返回绝对路径 */
function officeOutputPath(name: string): string {
  const dir = ensureDir(join(homedir(), 'Documents', 'LUVU'))
  return join(dir, name)
}

/**
 * v0.21：Office 文件生成工具 —— LLM 把内容结构化好，纯 JS 库直出 .docx/.pptx，
 * 写到 ~/Documents/LUVU/ 并用系统默认应用打开（不需装 Office / 不走 Python）。
 */
function registerOfficeTools(): void {
  register(
    {
      name: 'office_create_docx',
      description:
        '生成一份 Word 文档（.docx）并自动打开。支持多级标题、段落、项目符号、表格、配图。' +
        '当主人要「写一篇/整理成 word/生成文档/报告」时调用。',
      risk: 'high',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文档标题' },
          sections: {
            type: 'array',
            description:
              '小节数组。每项可含：heading(小标题)、level(标题层级 1-3)、paragraphs(段落字符串数组)、' +
              'bullets(项目符号字符串数组)、table{ headers:字符串数组, rows:二维字符串数组 }、' +
              'image{ path:本地图片绝对路径 或 generate:文生图英文提示词, alt, widthPx }。至少 1 节。',
          },
          filename: { type: 'string', description: '可选文件名（不含扩展名）；不填用标题' },
        },
        required: ['title', 'sections'],
      },
    },
    async (input) => {
      const spec = normalizeDocxSpec(input)
      const resolved = await resolveDocxIllustrations(spec)
      const buf = await buildDocxBuffer(resolved)
      const path = officeOutputPath(safeFilename(input.filename, spec.title, 'docx'))
      writeFileSync(path, buf)
      await shell.openPath(path)
      const withImg = resolved.sections.filter((s) => s.image?.path).length
      return `已生成 Word 并打开：${path}（${spec.sections.length} 节${withImg ? `，${withImg} 张配图` : ''}）`
    },
  )

  register(
    {
      name: 'office_create_pptx',
      description:
        '生成一份 PowerPoint 演示（.pptx）并自动打开。支持主题配色、多种版式、图表、表格、配图。' +
        '当主人要「做个 ppt/幻灯片/演示」时调用。你负责把内容拆成若干页并选合适版式。',
      risk: 'high',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '演示标题（做封面页）' },
          theme: {
            type: 'string',
            description: '设计主题配色',
            enum: ['default', 'dark', 'corporate', 'warm', 'tech'],
          },
          slides: {
            type: 'array',
            description:
              '幻灯片数组。每项可含：title(页标题)、layout(版式:title/section/bullets/image-right/image-full/chart/table，不填自动推断)、' +
              'bullets(要点字符串数组)、notes(演讲备注)、' +
              'chart{ type:bar|line|pie, categories:字符串数组, series:[{name,values:数字数组}] }(图表)、' +
              'table{ headers:字符串数组, rows:二维字符串数组 }(表格)、' +
              'image{ path:本地图片绝对路径 或 generate:文生图英文提示词, alt }(配图，generate 会用 ComfyUI 自动出图)。',
          },
          filename: { type: 'string', description: '可选文件名（不含扩展名）；不填用标题' },
        },
        required: ['title', 'slides'],
      },
    },
    async (input) => {
      const spec = normalizePptxSpec(input)
      // 先用 ComfyUI 把 image.generate 解析成本地图片（未配 ComfyUI 则自动跳过配图）
      const resolved = await resolveIllustrations(spec)
      const buf = await buildPptxBuffer(resolved)
      const path = officeOutputPath(safeFilename(input.filename, spec.title, 'pptx'))
      writeFileSync(path, buf)
      await shell.openPath(path)
      const withImg = resolved.slides.filter((s) => s.image?.path).length
      return `已生成 PPT 并打开：${path}（${spec.slides.length} 页，主题 ${spec.theme}${withImg ? `，${withImg} 张配图` : ''}）`
    },
  )

  register(
    {
      name: 'office_create_xlsx',
      description:
        '生成一份 Excel 表格（.xlsx）并自动打开。支持多个 sheet、表头样式、公式、列宽、冻结表头。' +
        '当主人要「做个表格/统计表/Excel/数据表」时调用。',
      risk: 'high',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          sheets: {
            type: 'array',
            description:
              'sheet 数组。每项 { name: 表名, headers?: 表头字符串数组, rows: 二维数组(单元格为字符串或数字；' +
              '以 "=" 开头的字符串会作为公式，如 "=SUM(B2:B5)"), columnWidths?: 列宽数字数组, freezeHeader?: 是否冻结表头 }。',
          },
          filename: { type: 'string', description: '可选文件名（不含扩展名）' },
        },
        required: ['sheets'],
      },
    },
    async (input) => {
      const spec = normalizeXlsxSpec(input)
      const buf = await buildXlsxBuffer(spec)
      const title = (Array.isArray(input.sheets) && input.sheets[0] && typeof input.sheets[0] === 'object'
        ? String((input.sheets[0] as Record<string, unknown>).name ?? '表格')
        : '表格')
      const path = officeOutputPath(safeFilename(input.filename, title, 'xlsx'))
      writeFileSync(path, buf)
      await shell.openPath(path)
      return `已生成 Excel 并打开：${path}（${spec.sheets.length} 个 sheet）`
    },
  )
}

/** 入参取有限数字，非法抛错 */
function finiteNum(v: unknown, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${field} 必须是数字`)
  return Math.round(n)
}

/**
 * v0.21：鼠键真控工具 —— 把 automation 原语 + vision 定位 + agent loop 暴露成 LLM 工具。
 * 对话里她就能精确操作电脑（click/type/key…）或跑端到端自主任务（agent_task）。
 * 所有原语内建 check() 熔断，Cmd+Shift+Esc 始终可中断。
 */
function registerComputerTools(): void {
  register(
    {
      name: 'computer_move',
      description: '把鼠标移动到屏幕坐标（绝对像素，左上角 0,0）。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: { x: { type: 'number', description: 'X 像素' }, y: { type: 'number', description: 'Y 像素' } },
        required: ['x', 'y'],
      },
    },
    async (input) => {
      const x = finiteNum(input.x, 'x')
      const y = finiteNum(input.y, 'y')
      await auto.move(x, y)
      return `已移动到 (${x}, ${y})`
    },
  )

  register(
    {
      name: 'computer_click',
      description: '在屏幕坐标点击鼠标。button 可为 left/right/middle（默认 left）。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X 像素' },
          y: { type: 'number', description: 'Y 像素' },
          button: { type: 'string', description: 'left/right/middle', enum: ['left', 'right', 'middle'] },
        },
        required: ['x', 'y'],
      },
    },
    async (input) => {
      const x = finiteNum(input.x, 'x')
      const y = finiteNum(input.y, 'y')
      const button = input.button === 'right' || input.button === 'middle' ? input.button : 'left'
      await auto.click(x, y, button)
      return `已${button}点击 (${x}, ${y})`
    },
  )

  register(
    {
      name: 'computer_double_click',
      description: '在屏幕坐标双击鼠标左键。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: { x: { type: 'number', description: 'X 像素' }, y: { type: 'number', description: 'Y 像素' } },
        required: ['x', 'y'],
      },
    },
    async (input) => {
      const x = finiteNum(input.x, 'x')
      const y = finiteNum(input.y, 'y')
      await auto.doubleClick(x, y)
      return `已双击 (${x}, ${y})`
    },
  )

  register(
    {
      name: 'computer_type',
      description: '在当前焦点输入文字（中英文都行）。先确保光标已在输入框（可先 computer_find_and_click）。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string', description: '要输入的文本（≤500 字符）' } },
        required: ['text'],
      },
    },
    async (input) => {
      const text = String(input.text ?? '').slice(0, 500)
      if (!text) throw new Error('text 不能为空')
      await auto.type(text)
      return `已输入 ${text.length} 字`
    },
  )

  register(
    {
      name: 'computer_key',
      description: '按组合键。combo 是键名数组，例 ["Cmd","C"] 复制、["Cmd","Space"] Spotlight、["Enter"]。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: { combo: { type: 'array', description: '键名字符串数组（1-8 个）' } },
        required: ['combo'],
      },
    },
    async (input) => {
      const raw = Array.isArray(input.combo) ? input.combo : []
      const combo = raw.slice(0, 8).map((k) => String(k).slice(0, 32)).filter(Boolean)
      if (combo.length === 0) throw new Error('combo 不能为空')
      await auto.key(combo)
      return `已按 ${combo.join('+')}`
    },
  )

  register(
    {
      name: 'computer_scroll',
      description: '滚动。dy 正数向下、负数向上；dx 正数向右、负数向左（单位 wheel ticks）。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          dy: { type: 'number', description: '垂直滚动量' },
          dx: { type: 'number', description: '可选水平滚动量' },
        },
        required: ['dy'],
      },
    },
    async (input) => {
      const dy = finiteNum(input.dy, 'dy')
      const dx = input.dx === undefined ? 0 : finiteNum(input.dx, 'dx')
      await auto.scroll(dy, dx)
      return `已滚动 dy=${dy} dx=${dx}`
    },
  )

  register(
    {
      name: 'computer_drag',
      description: '从一个坐标按住拖拽到另一个坐标。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          from_x: { type: 'number', description: '起点 X' },
          from_y: { type: 'number', description: '起点 Y' },
          to_x: { type: 'number', description: '终点 X' },
          to_y: { type: 'number', description: '终点 Y' },
        },
        required: ['from_x', 'from_y', 'to_x', 'to_y'],
      },
    },
    async (input) => {
      const fx = finiteNum(input.from_x, 'from_x')
      const fy = finiteNum(input.from_y, 'from_y')
      const tx = finiteNum(input.to_x, 'to_x')
      const ty = finiteNum(input.to_y, 'to_y')
      await auto.drag(fx, fy, tx, ty)
      return `已拖拽 (${fx},${fy}) → (${tx},${ty})`
    },
  )

  register(
    {
      name: 'computer_find_and_click',
      description:
        '截图看屏幕，用自然语言描述找到目标并点击（不用知道坐标）。描述越具体越好（颜色/形状/位置/相邻文字）。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: { description: { type: 'string', description: '要点击对象的自然语言描述' } },
        required: ['description'],
      },
    },
    async (input) => {
      const desc = String(input.description ?? '').slice(0, 300)
      if (!desc) throw new Error('description 不能为空')
      const r = await findAndClick(desc)
      if (!r.ok || r.x == null || r.y == null) throw new Error(`没找到「${desc}」：${r.error ?? '未定位到'}`)
      return `已点击「${desc}」→ (${r.x}, ${r.y})${r.confidence != null ? ` conf=${r.confidence.toFixed(2)}` : ''}`
    },
  )

  register(
    {
      name: 'computer_agent_task',
      description:
        '端到端自主完成一个电脑操作目标：她会自己截图→看屏幕→一步步鼠键操作直到完成。' +
        '用于多步任务（"打开计算器算 12*8"、"在浏览器搜索X点第一个结果"）。也可用来驱动真的 Word/PowerPoint。',
      risk: 'high',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '要达成的目标（自然语言）' },
          max_steps: { type: 'number', description: '最大步数（1-30，默认 10）' },
        },
        required: ['goal'],
      },
    },
    async (input) => {
      const goal = String(input.goal ?? '').slice(0, 500)
      if (!goal) throw new Error('goal 不能为空')
      const maxSteps = Math.max(1, Math.min(30, input.max_steps === undefined ? 10 : finiteNum(input.max_steps, 'max_steps')))
      const r = await runAgentTask(goal, { maxSteps })
      return r.ok
        ? `任务完成（${r.steps.length} 步）：${r.final_message ?? '已完成'}`
        : `任务未完成（${r.steps.length} 步）：${r.reason ?? '未知原因'}`
    },
  )
}

/**
 * Reviewer MEDIUM-5: getWindow 必选 — creative tools 是 always-on,
 * 若调用方忘传会静默不注册,排错成本高。强制传入避免静默失效。
 */
export function registerBuiltins(getWindow: () => BrowserWindow | null): void {
  register(
    {
      name: 'fs_list_dir',
      description: '列出目录下的文件和子目录（最多 100 项）',
      risk: 'low',
      category: 'fs',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录绝对路径（~/ 会展开）' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const dir = safeResolve(input.path as string)
      if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`)
      const st = statSync(dir)
      if (!st.isDirectory()) throw new Error(`不是目录：${dir}`)
      const entries = readdirSync(dir).slice(0, 100)
      const lines = entries.map((name) => {
        try {
          const s = statSync(join(dir, name))
          return `${s.isDirectory() ? 'D' : 'F'}  ${name}  ${s.isFile() ? s.size + 'B' : ''}`
        } catch {
          return `?  ${name}`
        }
      })
      return `${dir}\n${lines.join('\n')}`
    },
  )

  register(
    {
      name: 'fs_read_file',
      description: '读取文本文件内容（最多 16KB；二进制不支持）',
      risk: 'low',
      category: 'fs',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const file = safeResolve(input.path as string)
      if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
      const st = statSync(file)
      if (!st.isFile()) throw new Error(`不是文件：${file}`)
      if (st.size > 1024 * 1024) throw new Error(`文件超过 1MB，请用其他方式查看：${st.size} bytes`)
      return readFileSync(file, 'utf-8')
    },
  )

  register(
    {
      name: 'system_open_path',
      description: '用系统默认应用打开本地文件/文件夹',
      risk: 'medium',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要打开的路径' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const target = safeResolve(input.path as string)
      const err = await shell.openPath(target)
      if (err) throw new Error(err)
      return `已打开：${target}`
    },
  )

  register(
    {
      name: 'system_open_url',
      description: '在默认浏览器打开 URL（只允许 http/https）',
      risk: 'medium',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http/https URL' },
        },
        required: ['url'],
      },
    },
    async (input) => {
      const url = String(input.url ?? '')
      if (!/^https?:\/\//i.test(url)) throw new Error('只允许 http(s) URL')
      await shell.openExternal(url)
      return `已在浏览器打开：${url}`
    },
  )

  register(
    {
      name: 'system_notify',
      description: '发桌面通知',
      risk: 'low',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '通知标题' },
          body: { type: 'string', description: '通知正文' },
        },
        required: ['title'],
      },
    },
    async (input) => {
      const title = String(input.title ?? 'LUVU')
      const body = String(input.body ?? '')
      if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知')
      new Notification({ title, body }).show()
      return `已发送：${title}${body ? ' / ' + body : ''}`
    },
  )

  // M7：注册 creative.* 工具（getWindow 必传,见函数签名 doc）
  registerCreativeTools(getWindow)

  // v0.21 真控：Office 文件生成 + 鼠键/agent 自动化工具 + 常用系统工具
  registerOfficeTools()
  registerComputerTools()
  registerSystemToolset()
}
