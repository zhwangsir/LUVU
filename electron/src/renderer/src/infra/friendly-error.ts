/**
 * UX R22: 把粗糙的 LLM/TTS/网络错误翻译成用户能看懂 + 知道怎么办的中文提示。
 *
 * 原则:
 *   - 信息密度高于优雅 — 告诉用户"问题在哪 + 下一步做什么"
 *   - 不吞原始错误 — friendly 字段 + raw 保留，方便日志和上报
 *   - 纯函数 — 无副作用，可单测
 */

export interface FriendlyError {
  /** 用户看的中文标题 */
  title: string
  /** 用户看的中文说明 — 含可操作建议 */
  detail: string
  /** 原始 raw 错误（截断 200 字符），点击 "详情" 可看 */
  raw: string
  /** 推荐打开的设置 tab（如有）；UI 可基于此渲染 "去设置" 按钮 */
  goto?: 'llm' | 'tts' | 'vision' | 'memory'
}

/** R22 fix: domain — 调用方明确告诉错误属于哪个服务，避免文本误判（如 LLM 提到 "tts" 字样被 TTS 规则截获） */
export type ErrorDomain = 'llm' | 'tts' | 'vision' | 'memory' | 'network' | 'unknown'

interface ErrorRule {
  match: RegExp
  /** 推断的服务类型 — 用于挑 friendly 模板；同时和 onlyDomain 配合使用 */
  service?: ErrorDomain
  /** 若设置，此规则只在传入 domain 匹配时生效，避免跨域误判 */
  onlyDomain?: ErrorDomain[]
  title: string
  detail: string
  goto?: FriendlyError['goto']
}

/**
 * 顺序匹配 — 第一个命中即返。
 * 越具体的规则放越前。
 */
const RULES: ErrorRule[] = [
  // —— 网络层（最常见，先匹配） ——
  {
    match: /ECONNREFUSED|connection refused|fetch failed.*ECONNREFUSED/i,
    service: 'network',
    title: '服务连不上',
    detail: '本机服务（Ollama / LM Studio / sidecar）可能没启动。检查终端里 server 是否在跑。',
    goto: 'llm',
  },
  {
    match: /ETIMEDOUT|timeout|timed out|abort.*signal|abort.*timeout/i,
    title: '响应太慢，超时了',
    detail: '可能：模型太大 / 第一次加载冷启动 / endpoint 不通。试试更小的模型或重启 server。',
    goto: 'llm',
  },
  {
    match: /ENOTFOUND|getaddrinfo|DNS|name not resolved/i,
    title: 'DNS 解析失败',
    detail: 'endpoint 地址有误，或本机网络断开。检查 URL 拼写。',
    goto: 'llm',
  },
  {
    match: /ECONNRESET|socket hang up|premature close/i,
    title: '连接被服务方断开',
    detail: '通常是服务崩了或主动 kill 了 stream。看 server 日志确认。',
    goto: 'llm',
  },
  // —— HTTP 状态码 ——
  {
    match: /\b401\b|unauthor[iz]/i,
    title: 'API Key 没通过',
    detail: '检查 settings 里 LLM API Key 是不是填错了 / 过期了。本地端点通常留空。',
    goto: 'llm',
  },
  {
    match: /\b403\b|forbidden/i,
    title: '没权限访问该模型',
    detail: 'API Key 没权限调这个 model。换个 model 或申请权限。',
    goto: 'llm',
  },
  {
    match: /\b404\b.*model|model.*not.*found|model_not_found/i,
    title: '模型不存在',
    detail: 'endpoint 上找不到这个 model id。检查拼写，或在 LM Studio / Ollama 先加载。',
    goto: 'llm',
  },
  {
    match: /\b404\b/i,
    title: 'endpoint 路径错了',
    detail: 'URL 后面应该是 /v1（OpenAI-compat）。检查 endpoint 拼写。',
    goto: 'llm',
  },
  {
    match: /\b429\b|rate.?limit|too many requests/i,
    title: 'API 速率超限',
    detail: '请求太密，等一下再试。本地服务出 429 通常是 LM Studio 配置 concurrency 太低。',
    goto: 'llm',
  },
  {
    match: /\b502\b|bad gateway/i,
    title: 'LLM 服务网关异常',
    detail: '后端崩了。重启 ollama / LM Studio server 试试。',
    goto: 'llm',
  },
  {
    match: /\b503\b|service unavailable/i,
    title: 'LLM 服务不可用',
    detail: '后端忙不过来或模型正在加载。等一下再试。',
    goto: 'llm',
  },
  {
    match: /\b500\b|internal server error/i,
    title: 'LLM 服务报错',
    detail: '后端返 500 — 看 server 日志找具体原因。常见是 prompt 触发了模型 bug。',
    goto: 'llm',
  },
  // —— LLM 行为类 ——
  {
    match: /context.?length|too many tokens|maximum context|token.*limit/i,
    title: '上下文长度超了',
    detail: '历史太长。试试 /clear 清空对话，或换 context 更大的模型。',
    goto: 'llm',
  },
  // R68: provider-specific 配额 / API key 错误细化
  {
    match: /insufficient_quota|quota.*exceeded|billing|out of credits/i,
    title: 'API 配额用完了',
    detail: '账户余额或本月用量已耗尽。去 provider 控制台充值或升级套餐。',
    goto: 'llm',
  },
  {
    match: /invalid_api_key|invalid.*key|incorrect.*api.?key/i,
    title: 'API Key 不正确',
    detail: 'key 拼写错或已撤销。重新从 provider 控制台复制一个粘进设置。',
    goto: 'llm',
  },
  {
    match: /model.*overloaded|server.*busy|capacity.*exceeded/i,
    title: '模型暂时过载',
    detail: '后端忙不过来。等 10-30 秒再试，或临时换个模型。',
    goto: 'llm',
  },
  {
    match: /stream.*closed|stream.*ended|unexpected end.*stream|incomplete.*response/i,
    title: '流式响应被中断',
    detail: '网络抖动或服务方关流。重试这条 (DialogBubble 🔄 按钮) 通常能恢复。',
    goto: 'llm',
  },
  {
    match: /content.*policy|safety.*filter|moderation|harmful|inappropriate/i,
    title: '内容被安全策略拦截',
    detail: 'provider (尤其商业 API) 的内容审核拒绝了请求。本地模型 (Ollama) 通常无此限制。',
    goto: 'llm',
  },
  {
    match: /tool.*not.*found|unknown tool|invalid tool/i,
    title: '工具调用失败',
    detail: 'LLM 想用一个不存在的工具。MCP server 可能没正常注册，或拼写问题。',
    goto: 'llm',
  },
  // —— Vision ——
  {
    match: /vision|mmproj|GGML_ASSERT|image.*too.?small|nh > 0|nw > 0/i,
    service: 'vision',
    title: 'Vision 模型炸了',
    detail:
      'llama.cpp 类引擎要求图像至少 2×2 像素。截图可能太小，或模型 mmproj 不完整。换个模型或重启。',
    goto: 'vision',
  },
  // —— TTS / sidecar — 仅 tts domain 时启用（避免 LLM 错误里的 "tts" 字样误中） ——
  {
    match: /tts|sidecar/i,
    service: 'tts',
    onlyDomain: ['tts', 'unknown'],
    title: 'TTS 服务异常',
    detail:
      'Python sidecar 可能没启动。终端跑 `bash sidecar/install.sh` 装好，然后 uvicorn 启动。',
    goto: 'tts',
  },
  // —— Memory / SQLite ——
  {
    match: /sqlite|SQLITE_|database is locked/i,
    service: 'memory',
    title: '记忆库 IO 异常',
    detail: 'SQLite 文件可能被其他进程占用。重启 LUVU 试试。',
    goto: 'memory',
  },
  // —— JSON 解析（LLM 返非标准 JSON） ——
  {
    match: /unexpected token.*JSON|JSON.parse|invalid json/i,
    title: 'LLM 返回格式不对',
    detail: '模型可能没遵循 JSON 格式（小模型常见）。换个能力更强的模型试试。',
    goto: 'llm',
  },
]

/**
 * 把 raw error 翻译成 friendly 三件套。无匹配 → 原样回退。
 *
 * @param raw - 任意错误对象 / 字符串
 * @param domain - 调用方明确的服务域，让 onlyDomain 规则按域过滤
 *                 默认 'unknown' 保留旧行为
 */
export function toFriendlyError(
  raw: unknown,
  domain: ErrorDomain = 'unknown',
): FriendlyError {
  const text = stringify(raw).slice(0, 800)
  const trunc = text.slice(0, 200)
  for (const rule of RULES) {
    // R22 fix: 若规则限定 onlyDomain，必须命中
    if (rule.onlyDomain && !rule.onlyDomain.includes(domain)) continue
    if (rule.match.test(text)) {
      return {
        title: rule.title,
        detail: rule.detail,
        raw: trunc,
        ...(rule.goto !== undefined && { goto: rule.goto }),
      }
    }
  }
  // 没匹配 → 标题用 raw 头一段
  const firstLine = trunc.split('\n')[0]?.trim() ?? trunc
  return {
    title: '出错了',
    detail: firstLine.length > 0 ? firstLine : '未知错误，看主进程日志可能有更多信息',
    raw: trunc,
  }
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack ?? v.message
  if (v === null || v === undefined) return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
