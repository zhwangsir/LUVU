/**
 * URL 安全校验 — 防 SSRF (审计 H2)。
 *
 * 用户可在设置面板填 sidecar / LLM endpoint / vision endpoint 等 URL，
 * 这些 URL 由 main 进程 fetch。如果用户填了恶意 URL（被诱导粘贴或 XSS 改 config）
 * 就可能 SSRF 云元数据 / 内网管理界面。
 *
 * 策略：
 * - 协议白名单：仅 http / https
 * - 主机黑名单：云元数据 IP + DNS 名（AWS / GCP / Azure / OCI / Alibaba / DO）
 * - **不拦 RFC1918 内网** — LUVU sidecar 设计就在 127.0.0.1 / 192.168.x.x，
 *   拦内网会把正常用例打死。用户主动配的内网 URL = 信任。
 *
 * 这是 defense-in-depth：用户**主动**配的恶意 URL 还是过；
 * 仅防"被诱导粘贴元数据 URL"或"renderer XSS 改 config" 的攻击路径。
 */

/** 云元数据服务的硬编码 IP + DNS 名 */
const METADATA_HOSTS = new Set<string>([
  // AWS / Alibaba / Tencent / OCI etc 都用这个 link-local 地址
  '169.254.169.254',
  '169.254.170.2', // ECS task metadata
  '[fd00:ec2::254]',
  'fd00:ec2::254',
  // GCP / GKE
  'metadata.google.internal',
  'metadata',
  // Azure IMDS
  '169.254.169.254', // 跟 AWS 同 IP，已含
  // DigitalOcean
  '169.254.169.254', // 同 IP
])

/** 允许的协议 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export interface UrlGuardResult {
  ok: boolean
  reason?: string
}

/**
 * 校验 sidecar URL — fetch 前调一次。
 * @param raw 用户配置的原始 URL 字符串
 */
export function validateSidecarUrl(raw: string): UrlGuardResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, reason: 'URL 为空' }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: `URL 解析失败: ${raw.slice(0, 80)}` }
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `协议 ${parsed.protocol} 不允许（仅 http/https）` }
  }
  // hostname 已 lowercased + 去 IPv6 方括号 — URL 标准化过
  const host = parsed.hostname.toLowerCase()
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: `主机 ${host} 是云元数据服务，已拦截 SSRF` }
  }
  // IPv6 link-local (fe80::/10) — metadata 用 fe80 段
  if (host.startsWith('fe80:') || host.startsWith('[fe80:')) {
    return { ok: false, reason: 'IPv6 link-local 地址已拦截' }
  }
  return { ok: true }
}
