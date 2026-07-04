/**
 * Pinia store —— runtime config + 模型列表 + soul 加载。
 */
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import type { ModelInfo, RuntimeConfig, SoulConfig } from '@shared/types'
import { bus } from '../eventbus'
import { toFriendlyError } from '../friendly-error'

/**
 * Electron IPC 用 V8 结构化克隆，对 Vue reactive Proxy 不友好。
 * 在跨进程之前必须 unwrap 成纯 JS 对象。
 */
function toPlain<T>(v: T): T {
  // toRaw 拿到 Proxy 背后的 target；JSON 一遍确保深层不带 Proxy / Symbol / Function
  return JSON.parse(JSON.stringify(toRaw(v as object))) as T
}

export interface ModelInfoExt extends ModelInfo {
  file_url: string
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<RuntimeConfig | null>(null)
  const soul = ref<SoulConfig | null>(null)
  const systemPrompt = ref<string>('')
  const models = ref<ModelInfoExt[]>([])
  const version = ref<string>('')
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<{ ok: boolean; message: string } | null>(null)

  async function bootstrap(): Promise<void> {
    try {
      const [cfg, ver, soulRes, prompt, ms] = await Promise.all([
        window.api.config.load(),
        window.api.system.version(),
        window.api.soul.load(),
        window.api.soul.systemPrompt(),
        window.api.models.scan(),
      ])
      config.value = cfg
      version.value = ver
      soul.value = soulRes.config
      systemPrompt.value = prompt
      models.value = ms
      bus.emit('infra:soul-reloaded')
    } catch (e) {
      console.error('[config] bootstrap failed', e)
    }
    window.api.config.onChanged((cfg) => {
      config.value = cfg
      bus.emit('infra:config-changed')
    })
  }

  async function save(dto: RuntimeConfig): Promise<void> {
    saving.value = true
    try {
      config.value = await window.api.config.save(toPlain(dto))
    } finally {
      saving.value = false
    }
  }

  async function rescanModels(): Promise<void> {
    models.value = await window.api.models.scan()
  }

  async function reloadSoul(): Promise<void> {
    const res = await window.api.soul.load()
    soul.value = res.config
    systemPrompt.value = await window.api.soul.systemPrompt()
    bus.emit('infra:soul-reloaded')
  }

  async function saveAvatar(avatar: Partial<NonNullable<typeof soul.value>['avatar']>): Promise<boolean> {
    const result = await window.api.soul.saveAvatar(toPlain(avatar))
    if (result.ok) await reloadSoul()
    return result.ok
  }

  async function testLlm(dto: RuntimeConfig): Promise<void> {
    testing.value = true
    testResult.value = null
    try {
      // 字面量字段 → 已是 plain，无需 toPlain，但保险起见过一遍
      const r = await window.api.llm.test(
        toPlain({
          provider: dto.llm_provider,
          endpoint: dto.llm_endpoint,
          api_key: dto.llm_api_key,
          model: dto.llm_model,
        }),
      )
      // R61: 失败 message 走 friendly-error 翻译, 让用户能看懂操作建议
      if (r.ok) {
        testResult.value = r
        // R91: 显式 emit service:status, 让 ServiceStatusPill 即时反映 manual test 成功
        bus.emit('service:status', { service: 'llm', status: 'ok' })
      } else {
        const fe = toFriendlyError(r.message, 'llm')
        testResult.value = { ok: false, message: `${fe.title}：${fe.detail}` }
        bus.emit('service:status', {
          service: 'llm',
          status: 'down',
          reason: fe.title,
        })
      }
    } catch (e) {
      const fe = toFriendlyError(e, 'llm')
      testResult.value = { ok: false, message: `${fe.title}：${fe.detail}` }
      bus.emit('service:status', {
        service: 'llm',
        status: 'down',
        reason: fe.title,
      })
    } finally {
      testing.value = false
    }
  }

  return {
    config,
    soul,
    systemPrompt,
    models,
    version,
    saving,
    testing,
    testResult,
    bootstrap,
    save,
    rescanModels,
    reloadSoul,
    saveAvatar,
    testLlm,
  }
})
