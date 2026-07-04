/**
 * 常用系统工具 —— 文件操作 / 网络 / 剪贴板 / 系统 / shell。
 *
 * 安全：
 *   - 所有 fs 路径经 safeResolve 限制在白名单根（~/.luvu + ~/Documents/LUVU + 项目根）。
 *   - 不可逆动作（fs_delete / fs_move / system_run_shell）标 risk:'high' 且列入 DANGEROUS_TOOLS，
 *     信任模式下仍走审批（除非用户关掉 agent_confirm_dangerous）。见 ipc/tools.ts。
 */
import { clipboard } from 'electron'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { arch, cpus, freemem, hostname, platform, totalmem, uptime } from 'node:os'
import { basename, dirname, join } from 'node:path'
import AdmZip from 'adm-zip'
import { register } from './registry'
import { allowedRoots, safeResolve } from './fs-safe'
import { ensureDir, getPaths } from '../paths'
import { screenshot } from '../automation'

const execAsync = promisify(exec)
const MAX_OUT = 16 * 1024

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${field} 必须是非空字符串`)
  return v
}

// ============ 文件操作 ============

function registerFsTools(): void {
  register(
    {
      name: 'fs_write_file',
      description: '写文本文件（覆盖已有内容，限白名单目录）。父目录不存在会自动创建。',
      risk: 'medium', category: 'fs',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    async (i) => {
      const p = safeResolve(str(i.path, 'path'))
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, String(i.content ?? ''), 'utf-8')
      return `已写入：${p}（${String(i.content ?? '').length} 字符）`
    },
  )

  register(
    {
      name: 'fs_append_file',
      description: '在文本文件末尾追加内容（限白名单目录）。',
      risk: 'medium', category: 'fs',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    async (i) => {
      const p = safeResolve(str(i.path, 'path'))
      mkdirSync(dirname(p), { recursive: true })
      appendFileSync(p, String(i.content ?? ''), 'utf-8')
      return `已追加到：${p}`
    },
  )

  register(
    {
      name: 'fs_delete',
      description: '删除文件或文件夹（递归，限白名单目录）。⚠️ 不可逆。',
      risk: 'high', category: 'fs',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    async (i) => {
      const p = safeResolve(str(i.path, 'path'))
      if (!existsSync(p)) throw new Error(`路径不存在：${p}`)
      rmSync(p, { recursive: true, force: true })
      return `已删除：${p}`
    },
  )

  register(
    {
      name: 'fs_move',
      description: '移动/重命名文件或文件夹（限白名单目录）。⚠️ 会覆盖同名目标。',
      risk: 'high', category: 'fs',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
    async (i) => {
      const from = safeResolve(str(i.from, 'from'))
      const to = safeResolve(str(i.to, 'to'))
      mkdirSync(dirname(to), { recursive: true })
      renameSync(from, to)
      return `已移动：${from} → ${to}`
    },
  )

  register(
    {
      name: 'fs_copy',
      description: '复制文件或文件夹（递归，限白名单目录）。',
      risk: 'medium', category: 'fs',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
    async (i) => {
      const from = safeResolve(str(i.from, 'from'))
      const to = safeResolve(str(i.to, 'to'))
      cpSync(from, to, { recursive: true })
      return `已复制：${from} → ${to}`
    },
  )

  register(
    {
      name: 'fs_mkdir',
      description: '创建目录（递归，限白名单目录）。',
      risk: 'low', category: 'fs',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    async (i) => {
      const p = safeResolve(str(i.path, 'path'))
      mkdirSync(p, { recursive: true })
      return `已创建目录：${p}`
    },
  )

  register(
    {
      name: 'fs_search',
      description: '在目录下递归按文件名关键词查找（限白名单，最多返回 200 条，深度 6）。',
      risk: 'low', category: 'fs',
      input_schema: { type: 'object', properties: { dir: { type: 'string' }, pattern: { type: 'string', description: '文件名包含的关键词（不区分大小写）' } }, required: ['dir', 'pattern'] },
    },
    async (i) => {
      const dir = safeResolve(str(i.dir, 'dir'))
      const pat = str(i.pattern, 'pattern').toLowerCase()
      const out: string[] = []
      const walk = (d: string, depth: number): void => {
        if (depth > 6 || out.length >= 200) return
        let names: string[]
        try { names = readdirSync(d) } catch { return }
        for (const name of names) {
          if (out.length >= 200) break
          const full = join(d, name)
          let st
          try { st = statSync(full) } catch { continue }
          if (name.toLowerCase().includes(pat)) out.push(full)
          if (st.isDirectory()) walk(full, depth + 1)
        }
      }
      walk(dir, 0)
      return out.length ? out.join('\n') : `没找到含「${i.pattern}」的文件`
    },
  )

  register(
    {
      name: 'fs_zip',
      description: '把文件/文件夹打包成 zip（限白名单目录）。',
      risk: 'medium', category: 'fs',
      input_schema: { type: 'object', properties: { paths: { type: 'array', description: '要打包的路径数组' }, dest: { type: 'string', description: '输出 .zip 路径' } }, required: ['paths', 'dest'] },
    },
    async (i) => {
      const paths = Array.isArray(i.paths) ? i.paths : []
      if (paths.length === 0) throw new Error('paths 不能为空')
      const zip = new AdmZip()
      for (const raw of paths.slice(0, 500)) {
        const p = safeResolve(String(raw))
        if (!existsSync(p)) continue
        if (statSync(p).isDirectory()) zip.addLocalFolder(p, basename(p))
        else zip.addLocalFile(p)
      }
      const dest = safeResolve(str(i.dest, 'dest'))
      mkdirSync(dirname(dest), { recursive: true })
      zip.writeZip(dest)
      return `已打包：${dest}`
    },
  )

  register(
    {
      name: 'fs_unzip',
      description: '解压 zip 到目录（限白名单目录）。',
      risk: 'medium', category: 'fs',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: '.zip 路径' }, dest: { type: 'string', description: '解压到的目录' } }, required: ['path', 'dest'] },
    },
    async (i) => {
      const p = safeResolve(str(i.path, 'path'))
      const dest = safeResolve(str(i.dest, 'dest'))
      new AdmZip(p).extractAllTo(dest, true)
      return `已解压到：${dest}`
    },
  )
}

// ============ 网络 ============

function registerWebTools(): void {
  register(
    {
      name: 'web_fetch',
      description: '抓取一个网页/接口内容（GET，仅 http/https），返回文本（最多 16KB）。',
      risk: 'medium', category: 'other',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
    async (i) => {
      const url = str(i.url, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('只允许 http/https URL')
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20_000)
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        const text = await res.text()
        return `[HTTP ${res.status}]\n${text.slice(0, MAX_OUT)}`
      } finally {
        clearTimeout(timer)
      }
    },
  )

  register(
    {
      name: 'web_download',
      description: '下载一个文件到白名单目录（仅 http/https，最多 30MB）。',
      risk: 'medium', category: 'other',
      input_schema: { type: 'object', properties: { url: { type: 'string' }, dest: { type: 'string', description: '保存到的本地路径' } }, required: ['url', 'dest'] },
    },
    async (i) => {
      const url = str(i.url, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('只允许 http/https URL')
      const dest = safeResolve(str(i.dest, 'dest'))
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 60_000)
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 30 * 1024 * 1024) throw new Error('文件超过 30MB')
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, buf)
        return `已下载到：${dest}（${(buf.length / 1024).toFixed(0)} KB）`
      } finally {
        clearTimeout(timer)
      }
    },
  )
}

// ============ 剪贴板 ============

function registerClipboardTools(): void {
  register(
    { name: 'clipboard_read', description: '读取系统剪贴板的文本内容。', risk: 'medium', category: 'system', input_schema: { type: 'object', properties: {} } },
    async () => clipboard.readText() || '(剪贴板为空)',
  )
  register(
    { name: 'clipboard_write', description: '把文本写入系统剪贴板。', risk: 'low', category: 'system', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    async (i) => { clipboard.writeText(String(i.text ?? '')); return '已复制到剪贴板' },
  )
}

// ============ 系统 / shell ============

function registerSystemTools(): void {
  register(
    {
      name: 'system_screenshot',
      description: '截取当前屏幕并保存为 PNG（默认存到 ~/Documents/LUVU/screenshots/）。',
      risk: 'medium', category: 'system',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: '可选保存路径' } } },
    },
    async (i) => {
      const b64 = (await screenshot()).base64.replace(/^data:image\/\w+;base64,/, '')
      const dest = i.path
        ? safeResolve(String(i.path))
        : join(ensureDir(join(allowedRoots()[1] ?? getPaths().userDataDir, 'screenshots')), `shot_${Date.now()}.png`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(b64, 'base64'))
      return `已截图：${dest}`
    },
  )

  register(
    {
      name: 'system_run_shell',
      description: '执行一条 shell 命令并返回输出（超时 20s，输出上限 16KB）。⚠️ 高危：可运行任意命令。',
      risk: 'high', category: 'shell',
      input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
    async (i) => {
      const command = str(i.command, 'command')
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
        const out = `${stdout ?? ''}${stderr ? `\n[stderr] ${stderr}` : ''}`.trim()
        return (out || '(命令执行完成，无输出)').slice(0, MAX_OUT)
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message || String(e)
        throw new Error(detail.slice(0, MAX_OUT))
      }
    },
  )

  register(
    {
      name: 'system_open_app',
      description: '打开/切换到一个应用（如「计算器」「Safari」「微信」）。',
      risk: 'medium', category: 'system',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    async (i) => {
      const name = str(i.name, 'name')
      if (process.platform === 'darwin') {
        await execAsync(`open -a ${JSON.stringify(name)}`)
      } else if (process.platform === 'win32') {
        await execAsync(`start "" ${JSON.stringify(name)}`)
      } else {
        await execAsync(`${JSON.stringify(name)} &`)
      }
      return `已打开应用：${name}`
    },
  )

  register(
    {
      name: 'system_info',
      description: '返回系统信息（平台/CPU/内存/主机名/开机时长）。',
      risk: 'low', category: 'system',
      input_schema: { type: 'object', properties: {} },
    },
    async () => {
      const gb = (n: number): string => (n / 1024 / 1024 / 1024).toFixed(1)
      return [
        `平台：${platform()} ${arch()}`,
        `主机：${hostname()}`,
        `CPU：${cpus().length} 核（${cpus()[0]?.model ?? '?'}）`,
        `内存：${gb(totalmem() - freemem())} / ${gb(totalmem())} GB 已用`,
        `开机时长：${(uptime() / 3600).toFixed(1)} 小时`,
      ].join('\n')
    },
  )
}

/** 注册全部常用系统工具 */
export function registerSystemToolset(): void {
  registerFsTools()
  registerWebTools()
  registerClipboardTools()
  registerSystemTools()
}
