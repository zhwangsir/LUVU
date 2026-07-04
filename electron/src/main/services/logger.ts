/**
 * v0.13: electron-log 统一日志（audit M2）。
 *
 * 接管 console.* → 自动同时输出到控制台 + 写文件到 ~/.luvu/logs/main.log。
 * 业务代码完全不需要改，所有现有 console.log/warn/error 立即获得文件持久化。
 *
 * 文件轮转：单文件 10 MB 上限，超过自动归档到 main.old.log。
 */
import log from 'electron-log/main'
import { join } from 'node:path'
import { getPaths } from './paths'

let initialized = false

/**
 * v0.13 security: 写文件前过滤敏感信息。
 * 防止 api_key / Bearer token / 完整内网 IP+端口被写到日志文件 = 用户给 maintainer
 * 看日志时不必担心泄露 endpoint 凭据。
 *
 * 替换规则（保守 — 只替换明显敏感字段，不过度匹配）：
 *   - "api_key": "xxxx"        → "api_key": "[REDACTED]"
 *   - "Bearer abc123..."        → "Bearer [REDACTED]"
 *   - "sk-xxx" / "sk-proj-xxx"  → "[REDACTED]"
 *   - 10.x.x.x:port / 192.168.x.x:port / 172.16-31.x.x:port  → 内网 IP 部分留 host:port
 *     不脱敏（这些是用户配的 endpoint，调试需要），只脱敏 query string 里的 token
 *
 * NOTE: 这是 best-effort 防御，不是绝对安全。日志文件本身权限 644
 *       (用户级访问)，密钥仍有泄露风险 — 真要彻底安全用 Electron safeStorage。
 */
// 顺序很重要：最具体的 pattern 必须放前面，否则 sk-* 会先匹配吃掉 sk-proj- / sk-ant- 的前缀
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  // JSON / yaml api_key 字段
  [/"api_?key"\s*:\s*"[^"]+"/gi, '"api_key": "[REDACTED]"'],
  [/"x-api-key"\s*:\s*"[^"]+"/gi, '"x-api-key": "[REDACTED]"'],
  // HTTP Authorization header
  [/Bearer\s+[A-Za-z0-9._\-+/]{8,}/g, 'Bearer [REDACTED]'],
  // Anthropic 风格 sk-ant token (最具体)
  [/sk-ant-[A-Za-z0-9_\-]{16,}/g, 'sk-ant-[REDACTED]'],
  // OpenAI Project 风格 sk-proj-
  [/sk-proj-[A-Za-z0-9_\-]{16,}/g, 'sk-proj-[REDACTED]'],
  // OpenAI 风格 sk- token (最宽泛，最后兜底)
  [/sk-[A-Za-z0-9_\-]{16,}/g, 'sk-[REDACTED]'],
  // E4 (audit): 内网 endpoint URL — 暴露用户家/局域网拓扑给日志读者
  //   注意：放 sk- 后避免 sk-xxx 中的数字段误匹配
  // localhost / loopback / 0.0.0.0 归 LOCAL
  [/https?:\/\/(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)(:\d+)?/g, 'http://[REDACTED-LOCAL]'],
  // RFC1918 局域网归 LAN
  [/https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/g, 'http://[REDACTED-LAN]'],
  [/https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?/g, 'http://[REDACTED-LAN]'],
  [/https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?/g, 'http://[REDACTED-LAN]'],
]

/** v0.13: 暴露为 export 便于单元测试（也允许其他模块手动 redact 自己的 log） */
export function redactSensitive(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input)
  for (const [re, replace] of SENSITIVE_PATTERNS) {
    s = s.replace(re, replace)
  }
  return s
}

export function initializeLogger(): void {
  if (initialized) return
  initialized = true

  // 1. 让 electron-log 启用所有进程接管（main + renderer）
  log.initialize({ preload: true })

  // 2. 文件路径：~/.luvu/logs/main.log
  const logDir = join(getPaths().userDataDir, 'logs')
  log.transports.file.resolvePathFn = () => join(logDir, 'main.log')
  log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  // 3. v0.13 security: 写文件前 redact 敏感字段。
  // log.hooks 是全局 hook（对所有 transport 生效，console + file 都会被 redact）。
  // 类型由 electron-log 在运行时 typed，TS strict 下用 unknown 兼容。
  type LogHook = (typeof log.hooks)[number]
  const redactHook: LogHook = (message) => {
    message.data = message.data.map((d: unknown) => redactSensitive(d))
    return message
  }
  log.hooks.push(redactHook)

  // 4. 控制台保持现有格式（开发体验不变）
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}'

  // 5. 关键：把 console.* 接管 → 所有现有 console.log/warn/error 自动写文件
  Object.assign(console, log.functions)

  log.info('[logger] initialized — file:', logDir)
}

/** 显式 logger 实例，新代码可以直接 import 用 */
export const logger = log
