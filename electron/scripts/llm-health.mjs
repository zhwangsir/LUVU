#!/usr/bin/env node
/**
 * 独立 LLM 健康检查 — 不需要启动 Electron
 *
 * 用法:
 *   node scripts/llm-health.mjs <endpoint> <model> [--vision]
 *
 * 示例:
 *   node scripts/llm-health.mjs http://127.0.0.1:1234 qwen3.5-397b-a17b
 *   node scripts/llm-health.mjs http://127.0.0.1:1234 qwen3.5-397b-a17b --vision
 */

import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

const args = process.argv.slice(2)
const endpoint = args[0] || 'http://localhost:1234'
const model = args[1] || ''
const testVision = args.includes('--vision')

if (!model) {
  console.error('Usage: node scripts/llm-health.mjs <endpoint> <model> [--vision]')
  process.exit(1)
}

// llama.cpp vision projector 要求图像 >= 2x2 (GGML_ASSERT)。
// 1x1 PNG 会让模型 abort → LM Studio reload → API 报 "Model reloaded"。
// 生成 16x16 灰色 PNG。
function makeTinyPngBase64(w, h) {
  const tab = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tab[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = (tab[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length, 0)
    const ty = Buffer.from(t, 'ascii')
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([ty, d])), 0)
    return Buffer.concat([len, ty, d, cr])
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const stride = 1 + w * 3
  const raw = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3
      raw[o] = 128; raw[o + 1] = 128; raw[o + 2] = 128
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const TINY_PNG = makeTinyPngBase64(16, 16)

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
}

function pass(name, detail = '') {
  console.log(`  ${c.green}✓${c.reset} ${name}  ${c.dim}${detail}${c.reset}`)
}
function fail(name, detail = '') {
  console.log(`  ${c.red}✗${c.reset} ${name}  ${c.dim}${detail}${c.reset}`)
}
function warn(name, detail = '') {
  console.log(`  ${c.yellow}⚠${c.reset} ${name}  ${c.dim}${detail}${c.reset}`)
}
function header(s) {
  console.log(`\n${c.blue}━━━ ${s} ━━━${c.reset}`)
}

const recommendations = []
let allOk = true

// ============ 1. 连通 ============
header('1. 连通 GET /v1/models')
let modelsList = []
try {
  const t0 = Date.now()
  const r = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(10000) })
  const dt = Date.now() - t0
  if (!r.ok) {
    fail('HTTP', `${r.status} ${r.statusText}`)
    allOk = false
  } else {
    const json = await r.json()
    modelsList = (json.data || []).map((m) => m.id)
    pass('HTTP 200', `${dt}ms, ${modelsList.length} 个模型`)
  }
} catch (e) {
  fail('连接失败', e.message)
  console.error('\n→ 检查 LM Studio 是否在跑 / 防火墙 / IP+端口')
  process.exit(1)
}

// ============ 2. 模型存在 ============
header('2. 模型清单')
if (modelsList.length === 0) {
  fail('清单为空', 'LM Studio 内未 load 任何模型')
  console.error('\n→ 打开 LM Studio → Local Server tab → Load 一个模型')
  recommendations.push('打开 LM Studio Load 模型')
  allOk = false
} else if (modelsList.includes(model)) {
  pass(`找到 "${model}"`, `共 ${modelsList.length} 个: ${modelsList.join(', ')}`)
} else {
  fail(`未找到 "${model}"`, `可用: ${modelsList.join(', ')}`)
  recommendations.push(`改 model 为可用项之一`)
  allOk = false
}

if (!allOk) {
  console.log('\n基础检查失败，跳过后续测试。')
  process.exit(1)
}

// ============ 3. 基础 chat ============
header('3. 基础 chat (非流式, max_tokens=8000)')
let isThinking = false
try {
  const t0 = Date.now()
  const r = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '回复一个字: 好' }],
      max_tokens: 8000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(180000),
  })
  const dt = Date.now() - t0
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    fail('HTTP ' + r.status, text.slice(0, 200))
    allOk = false
  } else {
    const json = await r.json()
    if (json.error?.message) {
      fail('model 错误', json.error.message)
      allOk = false
    } else {
      const choice = json.choices?.[0]
      const content = choice?.message?.content ?? ''
      const reasoning = choice?.message?.reasoning_content ?? ''
      isThinking = reasoning.length > 50
      if (!content) {
        fail('空 content', `reasoning 长度 ${reasoning.length}, finish=${choice?.finish_reason}`)
        allOk = false
      } else {
        pass(
          `content="${content.trim().slice(0, 40)}"`,
          `${dt}ms ${isThinking ? `[thinking ${reasoning.length}字符]` : ''}`,
        )
        if (isThinking) {
          warn('Thinking 模型', '需要 max_tokens >= 4000 才有 content')
          recommendations.push('LUVU 已自动调 max_tokens=8000 适配 thinking 模型')
        }
      }
    }
  }
} catch (e) {
  fail('调用失败', e.message)
  allOk = false
}

// ============ 4. Streaming ============
header('4. Streaming (delta 流)')
try {
  const t0 = Date.now()
  const r = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '回复: ok' }],
      max_tokens: 8000,
      stream: true,
    }),
    signal: AbortSignal.timeout(180000),
  })
  if (!r.ok) {
    fail('HTTP', r.status)
    allOk = false
  } else {
    let sawContent = false
    let sawReasoning = false
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i = buf.indexOf('\n\n')
      while (i !== -1) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(i + 2)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const ev = JSON.parse(data)
              const d = ev.choices?.[0]?.delta
              if (d?.content) sawContent = true
              if (d?.reasoning_content) sawReasoning = true
            } catch {}
          }
        }
        i = buf.indexOf('\n\n')
      }
    }
    const dt = Date.now() - t0
    if (sawContent) {
      pass(`delta.content 收到`, `${dt}ms ${sawReasoning ? '+ thinking chunks' : ''}`)
    } else if (sawReasoning) {
      fail('只有 reasoning，无 content', 'max_tokens 不够 thinking 完成')
      allOk = false
    } else {
      fail('无 delta', '空流')
      allOk = false
    }
  }
} catch (e) {
  fail('Streaming 失败', e.message)
  allOk = false
}

// ============ 5. Vision (可选) ============
if (testVision) {
  header('5. Vision 支持 (16x16 PNG)')
  try {
    const t0 = Date.now()
    const r = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what color is this image' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
            ],
          },
        ],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(120000),
    })
    const dt = Date.now() - t0
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      fail(`HTTP ${r.status}`, text.slice(0, 200))
      recommendations.push('此模型不支持 vision — 需要单独配 VL 模型 endpoint')
    } else {
      const json = await r.json()
      if (json.error?.message) {
        const msg = json.error.message
        const isCrash = /crashed|exit code/i.test(msg)
        fail(
          isCrash ? '模型 crash（不支持 vision）' : 'model 错误',
          msg.slice(0, 200),
        )
        recommendations.push(
          '此模型不支持 vision — 视觉感知必须配独立 endpoint（如 Qwen2.5-VL）',
        )
      } else {
        const content = json.choices?.[0]?.message?.content ?? ''
        if (content) pass('Vision OK', `${dt}ms: ${content.slice(0, 60)}`)
        else warn('空响应', '不确定是否支持 vision')
      }
    }
  } catch (e) {
    fail('Vision 失败', e.message)
  }
}

// ============ 总结 ============
header(allOk ? '✓ 总体可用' : '✗ 存在问题')
if (recommendations.length > 0) {
  console.log(`\n${c.yellow}建议:${c.reset}`)
  recommendations.forEach((r) => console.log(`  • ${r}`))
}
console.log('')
process.exit(allOk ? 0 : 1)
