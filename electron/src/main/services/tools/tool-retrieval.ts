/**
 * 工具按需检索（语义 + 常驻核心）—— 解决工具膨胀让 LLM 选择变差的问题。
 *
 * 每轮对话不再把全部工具塞给 LLM，而是：
 *   相关工具 = 常驻核心 ∪ 语义 top-K（embedding cosine） ∪ 关键词命中兜底
 * 只把这十几个发给 LLM → 选得准、省 token、可扩到几百个工具。
 *
 * embedding 复用 services/embeddings（真 endpoint 优先，hash 兜底）。
 * 任何异常/退化都回退到「返回全部工具」，绝不因检索失败而丢工具。
 */
import type { ToolDefinition } from '@shared/tools'
import { list as listTools } from './registry'
import { cosineSim, embedText } from '../embeddings'

/** 常驻核心：对话助手里跨意图常用、低风险 —— 无论说什么都挂着 */
const CORE_TOOLS = new Set(['clipboard_read', 'clipboard_write', 'system_notify', 'web_fetch'])

/** 关键词兜底：即使 embedding 弱（hash 兜底）也保证常见意图能召回对应工具 */
const KEYWORD_MAP: Array<[RegExp, string[]]> = [
  [/ppt|幻灯|演示|slide/i, ['office_create_pptx']],
  [/word|文档|报告|doc\b/i, ['office_create_docx']],
  [/excel|表格|统计|xlsx|spreadsheet/i, ['office_create_xlsx']],
  [/截图|截屏|screenshot/i, ['system_screenshot']],
  [/剪贴板|clipboard|复制|粘贴/i, ['clipboard_read', 'clipboard_write']],
  [/命令|shell|终端|terminal|执行/i, ['system_run_shell']],
  [/网页|网址|http|下载|download|链接/i, ['web_fetch', 'web_download']],
  [/删除|删掉|delete\b|\brm\b/i, ['fs_delete']],
  [/压缩|打包|zip|解压|unzip/i, ['fs_zip', 'fs_unzip']],
  [/写文件|保存到|存成|write file/i, ['fs_write_file', 'fs_append_file']],
  [/移动|重命名|move|rename/i, ['fs_move']],
  [/复制文件|拷贝|copy/i, ['fs_copy']],
  [/查找|搜索文件|find file|search/i, ['fs_search']],
  [/点击|双击|拖拽|输入|按键|操作电脑|自动完成|帮我点/i, ['computer_find_and_click', 'computer_agent_task', 'computer_click', 'computer_type']],
  [/画|贴纸|sticker|生成图|插图/i, ['creative_generate_sticker']],
  [/打开应用|启动|open app/i, ['system_open_app']],
  [/系统信息|内存|cpu|电量|system info/i, ['system_info']],
]

interface Cached {
  hash: string
  vec: number[]
}
const embedCache = new Map<string, Cached>()

/** 简单字符串 hash，用于判断工具描述是否变了（变了要重算 embedding） */
function hashOf(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

function keyText(t: ToolDefinition): string {
  return `${t.name}: ${t.description}`
}

/** 确保给定工具都有最新 embedding（缺失或描述变了才算，复用缓存） */
async function ensureEmbeddings(tools: ToolDefinition[]): Promise<void> {
  const todo = tools.filter((t) => {
    const key = keyText(t)
    const c = embedCache.get(t.name)
    return !c || c.hash !== hashOf(key)
  })
  if (todo.length === 0) return
  await Promise.all(
    todo.map(async (t) => {
      const key = keyText(t)
      const vec = await embedText(key)
      embedCache.set(t.name, { hash: hashOf(key), vec })
    }),
  )
}

function keywordHits(query: string, names: Set<string>): string[] {
  const out: string[] = []
  for (const [re, tools] of KEYWORD_MAP) {
    if (re.test(query)) for (const n of tools) if (names.has(n)) out.push(n)
  }
  return out
}

/**
 * 返回与 query 相关的工具子集（常驻核心 ∪ 语义 top-K ∪ 关键词兜底）。
 * 工具总数不多、或检索完全退化时 → 直接返回全部（安全）。
 */
export async function selectRelevantTools(query: string, k = 12): Promise<ToolDefinition[]> {
  const all = listTools()
  const names = new Set(all.map((t) => t.name))
  // 工具本来就不多，没必要检索
  if (all.length <= k + CORE_TOOLS.size) return all

  try {
    await ensureEmbeddings(all)
    const qv = await embedText(query)
    const scored = all
      .map((t) => ({ t, score: cosineSim(qv, embedCache.get(t.name)?.vec ?? []) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    const topK = scored.slice(0, k).map((s) => s.t.name)
    const kw = keywordHits(query, names)

    // 语义完全失效（无正分）且无关键词命中 → 保守返回全部，绝不丢工具
    if (topK.length === 0 && kw.length === 0) return all

    const picked = new Set<string>([...CORE_TOOLS, ...topK, ...kw])
    return all.filter((t) => picked.has(t.name))
  } catch (e) {
    console.warn('[tool-retrieval] 失败，返回全部工具:', e instanceof Error ? e.message : e)
    return all
  }
}
