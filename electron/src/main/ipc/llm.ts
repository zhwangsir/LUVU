/**
 * LLM IPC handler —— 流式对话。
 *
 * 渲染层调用 `window.api.llm.chatStream({ stream_id, messages, options })`，
 * 主进程通过 webContents.send('llm:chunk', { streamId, delta | done | error }) 回推。
 */
import type { BrowserWindow } from 'electron'
import type { IpcStreamChunk } from '@shared/types'
import { llmAbort, llmChatStream, llmHealthCheck, llmTest } from '@shared/channels/llm'
import { llmAutoDetect } from '@shared/channels/llm-auto-detect'
import { handleInvoke } from './channel-helpers'
import { buildProvider } from '../services/llm'
import { autoDetectLlm } from '../services/llm/auto-detect'
import { loadConfig } from '../services/config-store'
import { runHealthCheck } from '../services/llm/health-check'

const aborts = new Map<string, AbortController>()

export function registerLlmIpc(getWindow: () => BrowserWindow | null): void {
  // Phase 1 试点: 走 type-safe channel — payload + 返回值类型从 llmChatStream 自动推
  handleInvoke(llmChatStream, async (payload) => {
      const cfg = loadConfig()
      const provider = payload.provider_override?.provider ?? cfg.llm_provider
      const endpoint = payload.provider_override?.endpoint ?? cfg.llm_endpoint
      const apiKey = payload.provider_override?.api_key ?? cfg.llm_api_key
      const model = payload.options?.model ?? payload.provider_override?.model ?? cfg.llm_model

      const impl = buildProvider(provider, endpoint, apiKey)
      const abort = new AbortController()
      aborts.set(payload.streamId, abort)
      // v0.17 D-3：从长期记忆做 RAG 检索，把相关记忆 prepend 到 messages
      // fallback embedding + cosine similarity，不依赖外部 embedding 服务
      try {
        const { buildRagContext } = await import('../services/memory-extractor')
        const lastUser = [...payload.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        if (lastUser) {
          const rag = buildRagContext(lastUser, 5)
          if (rag) {
            payload.messages = [{ role: 'system', content: rag }, ...payload.messages]
            console.log(`[llm] RAG injected: ${rag.split('\n').length - 1} memories`)
          }
        }
      } catch (e) {
        console.warn('[llm] RAG inject failed (non-fatal):', e)
      }
      console.log(
        `[llm] chat-stream start streamId=${payload.streamId} provider=${provider} endpoint=${endpoint} model=${model} msgs=${payload.messages.length} hasTools=${!!payload.tools?.length}`,
      )
      const t0 = Date.now()

      let fullText = ''
      let firstChunkAt = 0
      let chunkCount = 0
      const send = (msg: IpcStreamChunk): void => {
        const win = getWindow()
        if (!win || win.isDestroyed()) return
        win.webContents.send('llm:chunk', msg)
      }

      try {
        await impl.chatStream(
          payload.messages,
          {
            model,
            temperature: payload.options?.temperature ?? 0.7,
            ...(payload.options?.max_tokens !== undefined && { max_tokens: payload.options.max_tokens }),
          },
          (evt) => {
            if (evt.delta) {
              fullText += evt.delta
              chunkCount++
              if (!firstChunkAt) {
                firstChunkAt = Date.now() - t0
                console.log(`[llm] first delta @ ${firstChunkAt}ms streamId=${payload.streamId}`)
              }
              send({ streamId: payload.streamId, delta: evt.delta })
            }
            if (evt.tool_use) {
              send({ streamId: payload.streamId, tool_use: evt.tool_use })
            }
            if (evt.needs_tools) {
              send({ streamId: payload.streamId, needs_tools: true })
            }
            if (evt.error) {
              console.error(`[llm] error streamId=${payload.streamId}: ${evt.error}`)
              // SEC R20-fix: 截断 IPC 错误体，避免 rogue server 返巨大 error body 灌爆 renderer
              send({ streamId: payload.streamId, error: String(evt.error).slice(0, 500) })
            }
            if (evt.done) {
              console.log(
                `[llm] done streamId=${payload.streamId} total=${Date.now() - t0}ms chunks=${chunkCount} len=${fullText.length}`,
              )
              send({ streamId: payload.streamId, done: true, full_text: fullText })
            }
          },
          abort.signal,
          {
            ...(payload.tools !== undefined && { tools: payload.tools }),
            ...(payload.tool_results !== undefined && { tool_results: payload.tool_results }),
          },
        )
        return { ok: true }
      } catch (e) {
        send({ streamId: payload.streamId, error: String(e), done: true, full_text: fullText })
        return { ok: false, reason: String(e) }
      } finally {
        aborts.delete(payload.streamId)
      }
    })

  handleInvoke(llmAbort, (streamId) => {
    const c = aborts.get(streamId)
    if (c) {
      c.abort()
      aborts.delete(streamId)
      return { ok: true }
    }
    return { ok: false }
  })

  handleInvoke(llmTest, async (payload) => {
    const impl = buildProvider(payload.provider, payload.endpoint, payload.api_key)
    try {
      let captured = ''
      await impl.chatStream(
        [
          { role: 'system', content: '你是 LUVU 测试机。回复一句 ok。' },
          { role: 'user', content: 'ping' },
        ],
        { model: payload.model, temperature: 0.2, max_tokens: 32 },
        (evt) => {
          if (evt.delta) captured += evt.delta
        },
      )
      return { ok: true, message: captured.trim() || '(empty response)' }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  })

  // v0.8.1: 完整健康自检 (5 项测试)
  handleInvoke(llmHealthCheck, async (payload) => {
    const cfg = loadConfig()
    return runHealthCheck(
      {
        llm_provider: payload?.provider ?? cfg.llm_provider,
        llm_endpoint: payload?.endpoint ?? cfg.llm_endpoint,
        llm_model: payload?.model ?? cfg.llm_model,
        llm_api_key: payload?.api_key ?? cfg.llm_api_key,
      },
      { test_vision: payload?.test_vision ?? false },
    )
  })

  // UX R20: 一键自动检测本机 LLM endpoint + 拉可用模型列表
  handleInvoke(llmAutoDetect, async (payload) => {
    return autoDetectLlm(payload?.customEndpoint)
  })
}
