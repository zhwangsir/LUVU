/**
 * url-guard 测试 — 覆盖审计 H2 SSRF 防御。
 *
 * 不拦 RFC1918 内网（sidecar 本来就在局域网），只拦云元数据 IP / 非 http(s) 协议。
 */
import { describe, it, expect } from 'vitest'
import { validateSidecarUrl } from './url-guard'

describe('validateSidecarUrl', () => {
  describe('允许的 URL', () => {
    it('正常 sidecar 127.0.0.1', () => {
      expect(validateSidecarUrl('http://127.0.0.1:8765').ok).toBe(true)
    })
    it('正常 sidecar localhost', () => {
      expect(validateSidecarUrl('http://localhost:8765').ok).toBe(true)
    })
    it('正常 sidecar RFC1918 192.168.x', () => {
      expect(validateSidecarUrl('http://192.168.1.100:8765').ok).toBe(true)
    })
    it('正常 sidecar RFC1918 10.x.x.x', () => {
      expect(validateSidecarUrl('http://10.0.0.5:8765').ok).toBe(true)
    })
    it('远程 https sidecar', () => {
      expect(validateSidecarUrl('https://tts.example.com/').ok).toBe(true)
    })
    it('带 path 的 URL', () => {
      expect(validateSidecarUrl('http://127.0.0.1:8765/api/v1').ok).toBe(true)
    })
  })

  describe('H2 SSRF 防御', () => {
    it('AWS/GCP metadata 169.254.169.254 拒绝', () => {
      const r = validateSidecarUrl('http://169.254.169.254/latest/meta-data/')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('元数据')
    })

    it('AWS ECS metadata 169.254.170.2 拒绝', () => {
      expect(validateSidecarUrl('http://169.254.170.2/v2/credentials/').ok).toBe(false)
    })

    it('GCP metadata.google.internal 拒绝', () => {
      expect(validateSidecarUrl('http://metadata.google.internal/').ok).toBe(false)
    })

    it('GCP short metadata hostname 拒绝', () => {
      expect(validateSidecarUrl('http://metadata/').ok).toBe(false)
    })
  })

  describe('协议白名单', () => {
    it('file:// 拒绝', () => {
      const r = validateSidecarUrl('file:///etc/passwd')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('协议')
    })
    it('gopher:// 拒绝', () => {
      expect(validateSidecarUrl('gopher://attacker.com/_GET%20/').ok).toBe(false)
    })
    it('ftp:// 拒绝', () => {
      expect(validateSidecarUrl('ftp://internal/').ok).toBe(false)
    })
    it('data: 拒绝', () => {
      expect(validateSidecarUrl('data:text/plain;base64,SGVsbG8=').ok).toBe(false)
    })
    it('javascript: 拒绝', () => {
      expect(validateSidecarUrl('javascript:alert(1)').ok).toBe(false)
    })
  })

  describe('输入校验', () => {
    it('空字符串拒绝', () => {
      expect(validateSidecarUrl('').ok).toBe(false)
    })
    it('纯空白拒绝', () => {
      expect(validateSidecarUrl('   ').ok).toBe(false)
    })
    it('非 URL 拒绝', () => {
      expect(validateSidecarUrl('not a url').ok).toBe(false)
    })
    it('非 string 类型拒绝', () => {
      expect(validateSidecarUrl(null as unknown as string).ok).toBe(false)
      expect(validateSidecarUrl(123 as unknown as string).ok).toBe(false)
    })
  })
})
