/**
 * Round B M7:openai-compat tool_calls 流式支持测试
 *
 * 覆盖:
 *   1. toOpenAITool 转换 ToolDefinition → OpenAI function-calling 格式
 *   2. SSE tool_calls 累积逻辑(同一 tool_call 跨多 chunk arguments)
 *   3. emit tool_use event + needs_tools(finish_reason='tool_calls' 时)
 *
 * mock 策略:mock global.fetch 返回 SSE ReadableStream
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ToolDefinition } from '@shared/tools'
import { OpenAiCompatProvider, toOpenAITool } from './openai-compat'
import type { ChatStreamEvent } from './types'

// mock loadConfig + chinese-models 让 chatStream 不卡 enhance
vi.mock('../config-store', () => ({
  loadConfig: vi.fn(() => ({
    openai_compat_merge_system: true,
    chinese_llm_enhance: false,
  })),
}))

vi.mock('./chinese-models', () => ({
  enhanceMessagesForChineseModel: vi.fn((m: unknown) => m),
}))

describe('toOpenAITool 转换', () => {
  it('ToolDefinition → OpenAI function 格式', () => {
    const def: ToolDefinition = {
      name: 'creative_generate_sticker',
      description: '画一张贴纸',
      risk: 'medium',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          emotion: { type: 'string', enum: ['happy', 'sad'] },
        },
        required: ['emotion'],
      },
    }
    const out = toOpenAITool(def)
    expect(out.type).toBe('function')
    expect(out.function.name).toBe('creative_generate_sticker')
    expect(out.function.description).toBe('画一张贴纸')
    expect(out.function.parameters.type).toBe('object')
    expect(out.function.parameters.required).toEqual(['emotion'])
  })
})

describe('OpenAiCompatProvider tool_calls 流式累积', () => {
  let originalFetch: typeof fetch
  let events: ChatStreamEvent[]
  let provider: OpenAiCompatProvider

  beforeEach(() => {
    originalFetch = global.fetch
    events = []
    provider = new OpenAiCompatProvider('http://test:1234', '')
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  /** 把一组 SSE event JSON 拼成 ReadableStream 喂给 fetch */
  function makeSseResponse(eventJsons: object[]): Response {
    const lines = eventJsons
      .map((j) => `data: ${JSON.stringify(j)}\n\n`)
      .concat(['data: [DONE]\n\n'])
      .join('')
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(lines))
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  it('单 tool_call 完整累积 → emit tool_use + needs_tools', async () => {
    const sseChunks = [
      // 第 1 chunk:id + function.name(arguments 空)
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'creative_generate_sticker', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // 第 2 chunk:arguments partial JSON
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"emotion":"' } }],
            },
            finish_reason: null,
          },
        ],
      },
      // 第 3 chunk:arguments 剩余
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: 'happy"}' } }] },
            finish_reason: null,
          },
        ],
      },
      // 第 4 chunk:finish_reason='tool_calls' 表示对话因 tool 暂停
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      },
    ]

    global.fetch = vi.fn().mockResolvedValue(makeSseResponse(sseChunks))

    await provider.chatStream(
      [{ role: 'user', content: '画一张开心的' }],
      { model: 'test-model', temperature: 0.8 },
      (evt) => events.push(evt),
      undefined,
      { tools: [] }, // 触发 tools 路径
    )

    const toolUseEvts = events.filter((e) => e.tool_use)
    expect(toolUseEvts.length).toBe(1)
    expect(toolUseEvts[0]!.tool_use!.id).toBe('call_abc')
    expect(toolUseEvts[0]!.tool_use!.name).toBe('creative_generate_sticker')
    expect(toolUseEvts[0]!.tool_use!.input).toEqual({ emotion: 'happy' })

    const needsToolsEvts = events.filter((e) => e.needs_tools)
    expect(needsToolsEvts.length).toBe(1)
  })

  it('content + tool_calls 混合 → 都 emit', async () => {
    const sseChunks = [
      // content delta 先到
      {
        choices: [{ delta: { content: '好的我画给你看。' }, finish_reason: null }],
      },
      // 然后 tool_call
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_xyz',
                  function: { name: 'creative_generate_sticker', arguments: '{"emotion":"shy"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]

    global.fetch = vi.fn().mockResolvedValue(makeSseResponse(sseChunks))

    await provider.chatStream(
      [{ role: 'user', content: '画给我' }],
      { model: 'test-model', temperature: 0.8 },
      (evt) => events.push(evt),
      undefined,
      { tools: [] },
    )

    const deltas = events.filter((e) => e.delta).map((e) => e.delta)
    expect(deltas).toContain('好的我画给你看。')

    const toolUse = events.find((e) => e.tool_use)?.tool_use
    expect(toolUse?.input).toEqual({ emotion: 'shy' })
  })

  it('arguments 是 invalid JSON → emit tool_use with empty input(不 crash)', async () => {
    const sseChunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_bad',
                  function: { name: 'fs_read_file', arguments: 'not-json!' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]

    global.fetch = vi.fn().mockResolvedValue(makeSseResponse(sseChunks))

    await provider.chatStream(
      [{ role: 'user', content: '读文件' }],
      { model: 'test-model', temperature: 0.8 },
      (evt) => events.push(evt),
      undefined,
      { tools: [] },
    )

    const toolUse = events.find((e) => e.tool_use)?.tool_use
    expect(toolUse?.name).toBe('fs_read_file')
    expect(toolUse?.input).toEqual({}) // invalid JSON 降级为空对象
  })

  it('没传 tools → body 不含 tools 字段(回归)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { content: '普通回复' }, finish_reason: 'stop' }] },
      ]),
    )
    global.fetch = fetchMock

    await provider.chatStream(
      [{ role: 'user', content: '你好' }],
      { model: 'test-model', temperature: 0.8 },
      (evt) => events.push(evt),
      undefined,
      undefined, // 不传 extra
    )

    const bodyStr = fetchMock.mock.calls[0]![1]!.body as string
    const body = JSON.parse(bodyStr) as Record<string, unknown>
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })
})
