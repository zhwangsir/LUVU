/**
 * mcp-client 纯函数测试 — 覆盖审计 C1 防 RCE 的 validateMcpServerSpec。
 *
 * 不测 spawn 路径（要 mock child_process），仅守门 spec 输入校验逻辑。
 */
import { describe, it, expect } from 'vitest'
import { validateMcpServerSpec } from './mcp-client'

describe('validateMcpServerSpec', () => {
  describe('合法 spec', () => {
    it('最小合法 spec (id + name + command)', () => {
      const r = validateMcpServerSpec({ id: 'fs', name: 'Filesystem', command: 'npx' })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.spec.id).toBe('fs')
        expect(r.spec.args).toBeUndefined()
      }
    })

    it('含 args 数组', () => {
      const r = validateMcpServerSpec({
        id: 'fs',
        name: 'FS',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.spec.args).toHaveLength(3)
    })

    it('含 env (无黑名单键)', () => {
      const r = validateMcpServerSpec({
        id: 'fs', name: 'FS', command: 'npx',
        env: { MCP_LOG_LEVEL: 'debug' },
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.spec.env).toEqual({ MCP_LOG_LEVEL: 'debug' })
    })

    it('command 含路径 (./local/bin/server)', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: './local/bin/server' })
      expect(r.ok).toBe(true)
    })

    it('id 两端有空白会被 trim', () => {
      const r = validateMcpServerSpec({ id: '  fs  ', name: 'FS', command: 'npx' })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.spec.id).toBe('fs')
    })
  })

  describe('C1 防御：command 注入', () => {
    it('command 含分号拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: 'npx; rm -rf /' })
      expect(r.ok).toBe(false)
    })

    it('command 含管道拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: 'curl | sh' })
      expect(r.ok).toBe(false)
    })

    it('command 含空格拒绝（防 shell 解析）', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: '/bin/sh -c' })
      expect(r.ok).toBe(false)
    })

    it('command 含反引号拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: 'echo `whoami`' })
      expect(r.ok).toBe(false)
    })

    it('command 含 $() 拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: 'echo $(id)' })
      expect(r.ok).toBe(false)
    })

    it('command 含 newline 拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: 'npx\nrm -rf /' })
      expect(r.ok).toBe(false)
    })

    it('command 空字符串拒绝', () => {
      const r = validateMcpServerSpec({ id: 'x', name: 'X', command: '' })
      expect(r.ok).toBe(false)
    })
  })

  describe('C1 防御：env 动态库注入', () => {
    it('LD_PRELOAD 拒绝', () => {
      const r = validateMcpServerSpec({
        id: 'x', name: 'X', command: 'ls',
        env: { LD_PRELOAD: '/tmp/evil.so' },
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('LD_PRELOAD')
    })

    it('DYLD_INSERT_LIBRARIES 拒绝', () => {
      const r = validateMcpServerSpec({
        id: 'x', name: 'X', command: 'ls',
        env: { DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' },
      })
      expect(r.ok).toBe(false)
    })

    it('DYLD_LIBRARY_PATH 拒绝', () => {
      const r = validateMcpServerSpec({
        id: 'x', name: 'X', command: 'ls',
        env: { DYLD_LIBRARY_PATH: '/tmp' },
      })
      expect(r.ok).toBe(false)
    })

    it('env 值非 string 拒绝', () => {
      const r = validateMcpServerSpec({
        id: 'x', name: 'X', command: 'ls',
        env: { FOO: 123 as unknown as string },
      })
      expect(r.ok).toBe(false)
    })
  })

  describe('结构校验', () => {
    it('null 拒绝', () => {
      expect(validateMcpServerSpec(null).ok).toBe(false)
    })

    it('非 object 拒绝', () => {
      expect(validateMcpServerSpec('hello').ok).toBe(false)
    })

    it('id 非 string 拒绝', () => {
      expect(validateMcpServerSpec({ id: 1, name: 'x', command: 'ls' }).ok).toBe(false)
    })

    it('args 非数组拒绝', () => {
      expect(
        validateMcpServerSpec({ id: 'x', name: 'X', command: 'ls', args: 'not-array' }).ok,
      ).toBe(false)
    })

    it('args 含非 string 拒绝', () => {
      expect(
        validateMcpServerSpec({ id: 'x', name: 'X', command: 'ls', args: ['ok', 123] }).ok,
      ).toBe(false)
    })

    it('id 空白字符串拒绝', () => {
      expect(validateMcpServerSpec({ id: '   ', name: 'X', command: 'ls' }).ok).toBe(false)
    })
  })
})
