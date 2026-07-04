/**
 * Character store (v0.14 + v0.21 Round M) — 当前 active character + 列表 + 切换 action。
 *
 * Round M:加 mounted state(M8 灵魂社会前置)。"mounted" 跟 active 区分:
 *   - active = GUI 焦点单选(立绘渲染哪个/对话历史用哪个 db)
 *   - mounted = 代码层并行存活集合(每个有独立 planner / memory)
 * mounted 总含 active(后端自动补)。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Character, CreateCharacterInput } from '@shared/character'
import { bus } from '../eventbus'

export const useCharacterStore = defineStore('character', () => {
  const active = ref<Character | null>(null)
  const all = ref<Character[]>([])
  const switching = ref(false)

  /** Round M:mounted 状态(M8 灵魂社会 UI 层入口) */
  const mounted = ref<Character[]>([])
  const mountedIds = computed(() => mounted.value.map((c) => c.id))
  /**
   * Round M(reviewer MEDIUM-3): toggle 进行中的 id,防止 sub-30ms 双击造成
   * stale-snapshot 竞争(两个 IPC 请求基于相同 pre-mutation 基线构造 next 集合)。
   * 对齐既有 `switching` 模式。
   */
  const toggleMounting = ref<string | null>(null)

  /**
   * Round R(M8 闭环可视化最小版):每个 mounted character 听到过的
   * cross-character event 计数。Round N 写入,Round U IPC 拉。
   * 用 Record 避免 Map 在 Vue reactive 里需 markRaw 之类的麻烦。
   * 数据 stale 一点点没关系(下次 picker open + bootstrap 都会刷)。
   */
  const mountedEventCounts = ref<Record<string, number>>({})

  async function bootstrap(): Promise<void> {
    try {
      const [a, list, mountedList] = await Promise.all([
        window.api.characters.active(),
        window.api.characters.list(),
        window.api.characters.listMounted(),
      ])
      active.value = a
      all.value = list
      mounted.value = mountedList
      // Round R:第一次 mounted 拿到后即刷 event counts(picker 一打开就有徽标)
      void refreshMountedEventCounts()
    } catch (e) {
      console.error('[character] bootstrap failed', e)
    }
    // 监听主进程切角色通知
    window.api.characters.onSwitched((c) => {
      active.value = c
      bus.emit('character:switched', { character: c })
      // active 切换时 mounted 后端会自动补 active 到首位,前端同步刷
      void refreshMounted()
    })
    // 监听对话结束 → 刷新当前 character (拿最新 intimacy / last_chat_at)
    bus.on('brain:reply-end', () => {
      void refreshActive()
    })
  }

  async function refreshActive(): Promise<void> {
    try {
      const a = await window.api.characters.active()
      if (a) active.value = a
    } catch {
      /* skip */
    }
  }

  async function refreshMounted(): Promise<void> {
    try {
      mounted.value = await window.api.characters.listMounted()
      // Round R:mounted 变了之后,刷计数(新 mount 的可能没听过,unmount 的应该不再显示)
      void refreshMountedEventCounts()
    } catch (e) {
      console.warn('[character] refreshMounted failed', e)
    }
  }

  /**
   * Round R(M8 闭环可视化):为每个 mounted character 拉它 memory.db 里
   * 的 cross-character event 数。失败静默 fall through 到 0,UI 也只显示
   * count > 0 的徽标,所以失败 → 不显示而非显示错的数字。
   *
   * 并发 Promise.all 不串行(N 个 IPC,N 通常 ≤ 5,毫秒级)。
   */
  async function refreshMountedEventCounts(): Promise<void> {
    const ids = mounted.value.map((c) => c.id)
    if (ids.length === 0) {
      mountedEventCounts.value = {}
      return
    }
    try {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const events = await window.api.memory.listCrossCharacter({
              characterId: id,
              limit: 100, // 数到 100 够用,实际显示 capped 在 99+
            })
            return [id, events.length] as const
          } catch {
            return [id, 0] as const
          }
        }),
      )
      mountedEventCounts.value = Object.fromEntries(entries)
    } catch (e) {
      console.warn('[character] refreshMountedEventCounts failed', e)
    }
  }

  /** Round R helper:取某 character 的 event count(没记录则 0) */
  function getEventCount(characterId: string): number {
    return mountedEventCounts.value[characterId] ?? 0
  }

  async function refresh(): Promise<void> {
    try {
      all.value = await window.api.characters.list()
      active.value = await window.api.characters.active()
      await refreshMounted()
    } catch (e) {
      console.warn('[character] refresh failed', e)
    }
  }

  async function switchTo(id: string): Promise<{ ok: boolean; reason?: string }> {
    if (switching.value) return { ok: false, reason: 'already-switching' }
    switching.value = true
    try {
      const r = await window.api.characters.switch(id)
      if (r.ok && r.character) {
        active.value = r.character
        await refresh()
      }
      return r
    } finally {
      switching.value = false
    }
  }

  async function create(input: CreateCharacterInput): Promise<
    { ok: true; character: Character } | { ok: false; reason: string }
  > {
    const r = await window.api.characters.create(input)
    if (r.ok) await refresh()
    return r
  }

  async function remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await window.api.characters.delete(id)
    if (r.ok) await refresh()
    return r
  }

  async function clone(
    sourceId: string,
    newName?: string,
  ): Promise<{ ok: boolean; character?: Character; reason?: string }> {
    const r = await window.api.characters.clone({
      source_id: sourceId,
      ...(newName ? { new_name: newName } : {}),
    })
    if (r.ok) await refresh()
    return r
  }

  /**
   * Round M:切换 mount 状态。
   * - active 不能 unmount(backend 也会自动补回,前端先拒掉给好的 toast)
   * - 后端做去重 + 自动补 active + 16 个上限,前端只透传
   * - reviewer MEDIUM-3:in-flight 锁防 sub-30ms 多卡片连击 stale 竞争
   */
  async function toggleMount(
    id: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (toggleMounting.value) {
      return { ok: false, reason: 'busy' }
    }
    const isCurrentlyMounted = mountedIds.value.includes(id)
    if (id === active.value?.id && isCurrentlyMounted) {
      return { ok: false, reason: 'cannot_unmount_active' }
    }
    const cur = new Set(mountedIds.value)
    if (isCurrentlyMounted) cur.delete(id)
    else cur.add(id)
    const next = Array.from(cur)
    toggleMounting.value = id
    try {
      const r = await window.api.characters.setMounted(next)
      if (r.ok) {
        mounted.value = r.mounted
        // Round R:新 mount 进来的 character 可能已经有 cross-char history
        //(之前 mounted 时听过的话还在 db),刷计数让徽标立刻可见。
        void refreshMountedEventCounts()
        return { ok: true }
      }
      return { ok: false, reason: r.reason }
    } catch (e) {
      console.warn('[character] toggleMount failed', e)
      return { ok: false, reason: String(e).slice(0, 200) }
    } finally {
      toggleMounting.value = null
    }
  }

  function isMounted(id: string): boolean {
    return mountedIds.value.includes(id)
  }

  return {
    active,
    all,
    switching,
    mounted,
    mountedIds,
    toggleMounting,
    mountedEventCounts,
    bootstrap,
    refresh,
    refreshMounted,
    refreshMountedEventCounts,
    switchTo,
    create,
    remove,
    clone,
    toggleMount,
    isMounted,
    getEventCount,
  }
})
