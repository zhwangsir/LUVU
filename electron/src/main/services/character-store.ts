/**
 * Character storage (v0.14) — CRUD + legacy 数据迁移。
 *
 * 目录布局：
 *   ~/.luvu/
 *   ├── config.json             # 全局配置（含 active_character_id）
 *   ├── chars/
 *   │   ├── default/
 *   │   │   ├── character.json
 *   │   │   ├── soul/
 *   │   │   ├── history.sqlite
 *   │   │   └── preferences.json
 *   │   └── <other-char-id>/
 *   │       └── ...
 *   └── thumbs/ models-tts/ ... (全局共享资源)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, cpSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Character, CreateCharacterInput, SoulTemplate } from '@shared/character'
import { getPaths } from './paths'

/** ~/.luvu/chars/ 根目录 */
export function charactersRoot(): string {
  const d = join(getPaths().userDataDir, 'chars')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** 单个 character 的根目录 */
export function characterDir(id: string): string {
  return join(charactersRoot(), id)
}

/** Character 元数据文件 */
function characterJsonPath(id: string): string {
  return join(characterDir(id), 'character.json')
}

/** Character 灵魂目录 */
export function characterSoulDir(id: string): string {
  return join(characterDir(id), 'soul')
}

/** Character 历史 db 路径 */
export function characterHistoryDb(id: string): string {
  return join(characterDir(id), 'history.sqlite')
}

/** Character 偏好文件路径 */
export function characterPreferencesPath(id: string): string {
  return join(characterDir(id), 'preferences.json')
}

export function listCharacters(): Character[] {
  ensureMigrated()
  const root = charactersRoot()
  const ids = readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory()
    } catch {
      return false
    }
  })
  const out: Character[] = []
  for (const id of ids) {
    const c = loadCharacterMeta(id)
    if (c) out.push(c)
  }
  // 排序：last_chat_at 倒序（最近用的在前），新创建的内置 builtin 在最后
  out.sort((a, b) => (b.last_chat_at || 0) - (a.last_chat_at || 0))
  return out
}

export function getCharacter(id: string): Character | null {
  ensureMigrated()
  return loadCharacterMeta(id)
}

function loadCharacterMeta(id: string): Character | null {
  const p = characterJsonPath(id)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Character
  } catch (e) {
    console.warn(`[character-store] load ${id} failed:`, e)
    return null
  }
}

function saveCharacterMeta(c: Character): void {
  const dir = characterDir(c.id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(characterJsonPath(c.id), JSON.stringify(c, null, 2), 'utf-8')
}

export function updateCharacter(id: string, patch: Partial<Character>): Character | null {
  const cur = getCharacter(id)
  if (!cur) return null
  const merged: Character = { ...cur, ...patch, id: cur.id } // id 不可改
  saveCharacterMeta(merged)
  return merged
}

export function createCharacter(input: CreateCharacterInput): Character {
  const id = input.id ?? generateId(input.name)
  if (getCharacter(id)) {
    throw new Error(`Character id 已存在: ${id}`)
  }
  const now = Date.now()
  const c: Character = {
    id,
    name: input.name,
    call_master_as: input.call_master_as,
    description: input.description ?? '',
    template: input.template,
    live2d_model_dir: input.live2d_model_dir,
    live2d_model_file: input.live2d_model_file,
    ...(input.rvc_voice ? { rvc_voice: input.rvc_voice } : {}),
    ...(input.llm_override ? { llm_override: input.llm_override } : {}),
    ...(input.scene ? { scene: input.scene } : {}),
    emotion_baseline: 'neutral',
    intimacy_level: 0,
    total_chats: 0,
    last_chat_at: 0,
    created_at: now,
  }
  saveCharacterMeta(c)
  // 写入合成的 soul 文件
  writeSyntheticSoul(id, input)
  // 创建空 preferences
  writeFileSync(
    characterPreferencesPath(id),
    JSON.stringify({ scale: 0.35, offset_y: 50 }, null, 2),
    'utf-8',
  )
  return c
}

/** v0.14 T8: 读 character 灵魂目录下指定 yaml 文件 */
export function readCharacterSoulFile(id: string, filename: string): { ok: boolean; content?: string; reason?: string } {
  // 安全: 防 path traversal
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    return { ok: false, reason: '非法文件名（只允许 [a-zA-Z0-9_-]+.yaml）' }
  }
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'character not found' }
  const p = join(characterSoulDir(id), filename)
  if (!existsSync(p)) return { ok: true, content: '' }
  try {
    return { ok: true, content: readFileSync(p, 'utf-8') }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

export function writeCharacterSoulFile(id: string, filename: string, content: string): { ok: boolean; reason?: string } {
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    return { ok: false, reason: '非法文件名' }
  }
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'character not found' }
  if (content.length > 100_000) return { ok: false, reason: '内容超过 100KB 上限' }
  const dir = characterSoulDir(id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  // P5: 读旧内容用于 diff (best-effort，错误不影响主流程)
  let oldContent = ''
  if (existsSync(filePath)) {
    try {
      oldContent = readFileSync(filePath, 'utf-8')
    } catch {
      /* 读旧失败也继续写新 */
    }
  }
  try {
    writeFileSync(filePath, content, 'utf-8')
    // P5: fire-and-forget 写 diff 到 soul-changes.log；动态 import 避免循环依赖
    if (oldContent !== content) {
      void import('./soul-change-log')
        .then(({ recordSoulChange }) => recordSoulChange(id, filename, oldContent, content))
        .catch(() => {
          /* swallow */
        })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

/** v0.15 B3: 克隆角色 — 完整 copy 灵魂目录 + character.json，新 id，亲密度/记忆归零 */
export function cloneCharacter(sourceId: string, newName?: string): { ok: boolean; character?: Character; reason?: string } {
  const src = getCharacter(sourceId)
  if (!src) return { ok: false, reason: 'source not found' }
  const baseName = newName ?? `${src.name} (副本)`
  const newId = generateId(baseName)
  const newDir = characterDir(newId)
  try {
    mkdirSync(newDir, { recursive: true })
    // copy soul 目录
    const srcSoul = characterSoulDir(sourceId)
    if (existsSync(srcSoul)) cpSync(srcSoul, characterSoulDir(newId), { recursive: true })
    // copy preferences
    const srcPrefs = characterPreferencesPath(sourceId)
    if (existsSync(srcPrefs)) cpSync(srcPrefs, characterPreferencesPath(newId))
    // 不 copy history.sqlite — 新角色应该有自己的对话上下文
    // 新 character.json — 重置亲密度/对话次数/时间戳
    const cloned: Character = {
      ...src,
      id: newId,
      name: baseName,
      description: src.description ? `${src.description}（克隆自 ${src.name}）` : `克隆自 ${src.name}`,
      intimacy_level: 0,
      total_chats: 0,
      last_chat_at: 0,
      created_at: Date.now(),
      builtin: false, // 克隆产物永远不是 builtin
    }
    saveCharacterMeta(cloned)
    return { ok: true, character: cloned }
  } catch (e) {
    try { rmSync(newDir, { recursive: true, force: true }) } catch { /* skip */ }
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

export async function deleteCharacter(id: string): Promise<{ ok: boolean; reason?: string }> {
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'not_found' }
  if (c.builtin) return { ok: false, reason: 'builtin_protected' }
  // 安全：不能删当前 active
  const active = getActiveCharacterId()
  if (active === id) return { ok: false, reason: 'cannot_delete_active' }
  try {
    // v0.21:删 character dir 前先关掉对应 memory.db 句柄
    // (M3 长期记忆 sqlite WAL,handle 不关时 macOS/Win rmSync 偶发失败)
    // 用 dynamic await import 避免 character-store ↔ memory-store 静态循环依赖,
    // 且 ESM 包(electron/package.json type:module)下 require 不可用。
    try {
      const { closeMemoryDb } = await import('./memory-store')
      closeMemoryDb(id)
    } catch {
      /* memory-store 模块缺失时不阻塞删除 */
    }
    // v0.21 Round J:dispose 对应 planner 实例(避免 Map cache 内存泄漏)
    // (architect 守护抓出 M-1 — 跟 closeMemoryDb 同模式 dynamic import)
    try {
      const { disposePlannerFor } = await import('./planner')
      disposePlannerFor(id)
    } catch {
      /* planner 模块缺失时不阻塞删除 */
    }
    rmSync(characterDir(id), { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

/** v0.14 心跳：每次对话后更新 last_chat_at + total_chats + 亲密度成长 */
export function recordChatInteraction(id: string): void {
  const c = getCharacter(id)
  if (!c) return
  const newIntimacy = Math.min(100, c.intimacy_level + Math.max(0.05, 1 / Math.sqrt(c.total_chats + 1)))
  updateCharacter(id, {
    last_chat_at: Date.now(),
    total_chats: c.total_chats + 1,
    intimacy_level: Math.round(newIntimacy * 100) / 100,
  })
}

// === Active Character 管理（active id 存 config.json） ===

function activeIdPath(): string {
  return join(getPaths().userDataDir, 'active-character.json')
}

export function getActiveCharacterId(): string | null {
  const p = activeIdPath()
  if (!existsSync(p)) return null
  try {
    const obj = JSON.parse(readFileSync(p, 'utf-8')) as { id?: string }
    return obj.id ?? null
  } catch {
    return null
  }
}

export function setActiveCharacterId(id: string): { ok: boolean; character?: Character; reason?: string } {
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'not_found' }
  // reviewer H-HIGH-1:之前直接 writeFileSync 新对象,会覆盖 mounted_ids 等其他字段
  // 改用 readActiveFile + spread 保留所有非 id/switched_at 字段
  const file = readActiveFile()
  writeActiveFile({ ...file, id, switched_at: Date.now() })
  return { ok: true, character: c }
}

export function getActiveCharacter(): Character | null {
  let id = getActiveCharacterId()
  if (!id) {
    // 没 active 时挑第一个
    const list = listCharacters()
    if (list.length === 0) return null
    id = list[0]!.id
    setActiveCharacterId(id)
  }
  return getCharacter(id)
}

/**
 * v0.21 Round I:M8 灵魂社会前置 — mountedCharacterIds 数组。
 *
 * "Mounted" = 代码层并行存活(独立 planner / memory.db / emotional state),
 * 跟"active"(GUI 焦点)区分。M8 多 Live2D 同框时 mounted 数组里多个 character
 * 都在跑;GUI Live2DStage 当前显示 active 那个,后续 v0.23 refactor 时
 * 允许 N 个 canvas 同框。
 *
 * 存储跟 active-character.json 同一文件(向后兼容:旧文件没 mounted_ids
 * 字段时,返回 [active_id])。
 *
 * IPC TODO(M8):暴露 `characters:list-mounted` / `characters:set-mounted` channel
 *   (在 `shared/channels/characters.ts`),目前仅 main process 内部可用。
 *   待 GUI 真做 multi-character 时一起加,避免 IPC schema 设计错。
 */
interface ActiveCharacterFile {
  id?: string
  switched_at?: number
  /** v0.21 Round I:并行 mounted 的 character id 列表(active 必须在其中) */
  mounted_ids?: string[]
}

function readActiveFile(): ActiveCharacterFile {
  const p = activeIdPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ActiveCharacterFile
  } catch (e) {
    // reviewer H-HIGH-2:JSON 损坏时之前静默返 {},三条 getter 链路走向不同结果
    // 让用户感知"角色状态丢失"。最低补 console.error 让调试路径存在
    console.error('[character-store] active-character.json parse failed,fallback {} — 用户角色状态可能丢失:', e)
    return {}
  }
}

function writeActiveFile(file: ActiveCharacterFile): void {
  writeFileSync(activeIdPath(), JSON.stringify(file, null, 2), 'utf-8')
}

/**
 * 返回当前 mounted character id 数组(总是非空且含 active)。
 * 旧文件无 mounted_ids 字段时 fallback 到 [active_id]。
 */
export function getMountedCharacterIds(): string[] {
  const file = readActiveFile()
  if (file.mounted_ids && file.mounted_ids.length > 0) {
    // 防御:如果 active 没在 mounted_ids 里,补进去并持久化
    // reviewer H-MEDIUM-3:之前只在内存修正不写盘,下次调用还会重复修补;
    //   且 caller 看到"已修正"但 setMountedCharacterIds 写的是旧不含 active 数据。
    //   现在 get 时也持久化修补结果,下次再读时就一致了。
    const activeId = file.id
    if (activeId && !file.mounted_ids.includes(activeId)) {
      const fixed = [activeId, ...file.mounted_ids]
      writeActiveFile({ ...file, mounted_ids: fixed })
      return fixed
    }
    return [...file.mounted_ids]
  }
  // Fallback:旧版本数据,只 active 一个
  if (file.id) return [file.id]
  return []
}

/**
 * 设置 mounted character ids 列表。
 *
 * 约束:
 * - 所有 id 必须存在(`getCharacter(id) !== null`)
 * - active 必须在数组内(若不在,自动补到首位)
 * - 空数组拒绝(至少要保留 active)
 */
export function setMountedCharacterIds(ids: string[]): {
  ok: boolean
  mounted_ids?: string[]
  reason?: string
} {
  if (ids.length === 0) {
    return { ok: false, reason: 'empty_list_not_allowed' }
  }
  // 去重 + 校验
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    if (!getCharacter(id)) {
      return { ok: false, reason: `character_not_found: ${id}` }
    }
    deduped.push(id)
  }
  const file = readActiveFile()
  // active 必须在 mounted 内 — 若不在自动补
  // reviewer H-MEDIUM-2:补 active 时也要 getCharacter 校验,防止 active 指向
  //   已删除的 character(edge case:另一个进程 delete 后 active 文件 stale)
  if (file.id && !deduped.includes(file.id)) {
    if (getCharacter(file.id)) {
      deduped.unshift(file.id)
    } else {
      console.warn(
        `[character-store] active_id=${file.id} 指向已不存在的 character,跳过补入 mounted`,
      )
    }
  }
  const next: ActiveCharacterFile = { ...file, mounted_ids: deduped }
  writeActiveFile(next)
  return { ok: true, mounted_ids: deduped }
}

// === Legacy 迁移 ===

let migrationChecked = false
function ensureMigrated(): void {
  if (migrationChecked) return
  migrationChecked = true
  const root = charactersRoot()
  // 已经有 chars/* 子目录 → 不需要迁移
  const existing = readdirSync(root).filter((n) => {
    try { return statSync(join(root, n)).isDirectory() } catch { return false }
  })
  if (existing.length > 0) return
  // 检测老结构：~/.luvu/{soul,history.sqlite} 存在 → 迁移为 default character
  const ud = getPaths().userDataDir
  const oldSoulDir = join(ud, 'soul')
  const oldHistoryDb = join(ud, 'history.sqlite')
  const hasLegacySoul = existsSync(oldSoulDir)
  const hasLegacyHistory = existsSync(oldHistoryDb)
  if (!hasLegacySoul && !hasLegacyHistory) {
    // 全新用户 — 创建一个空的 default character 走 onboarding
    seedFirstCharacter()
    return
  }
  console.log('[character-store] 检测到 legacy 数据，迁移为 default character...')
  migrateLegacy(oldSoulDir, oldHistoryDb)
}

function migrateLegacy(oldSoulDir: string, oldHistoryDb: string): void {
  const id = 'default'
  const dir = characterDir(id)
  mkdirSync(dir, { recursive: true })

  // soul 目录 — 复制（不删 legacy 保留作 backup）
  if (existsSync(oldSoulDir)) {
    try {
      cpSync(oldSoulDir, characterSoulDir(id), { recursive: true })
    } catch (e) {
      console.warn('[character-store] copy soul failed:', e)
    }
  }

  // history.sqlite — 移过去（cp）
  if (existsSync(oldHistoryDb)) {
    try {
      cpSync(oldHistoryDb, characterHistoryDb(id))
    } catch (e) {
      console.warn('[character-store] copy history failed:', e)
    }
  }

  // model-preferences.json — 移过去
  const oldPrefs = join(getPaths().userDataDir, 'model-preferences.json')
  if (existsSync(oldPrefs)) {
    try {
      cpSync(oldPrefs, characterPreferencesPath(id))
    } catch (e) {
      console.warn('[character-store] copy preferences failed:', e)
    }
  }

  // 读 soul 拿 name + 模型信息
  let name = 'LUVU'
  let callAs = '主人'
  let modelDir = 'HuTao-Live2D'
  let modelFile = 'Hu Tao.model3.json'
  try {
    const identityPath = join(characterSoulDir(id), 'identity.yaml')
    if (existsSync(identityPath)) {
      const raw = readFileSync(identityPath, 'utf-8')
      const nameMatch = raw.match(/^name:\s*["']?(.+?)["']?\s*$/m)
      const callMatch = raw.match(/^call_master_as:\s*["']?(.+?)["']?\s*$/m)
      const dirMatch = raw.match(/^\s*model_dir:\s*["']?(.+?)["']?\s*$/m)
      const fileMatch = raw.match(/^\s*model_file:\s*["']?(.+?)["']?\s*$/m)
      if (nameMatch?.[1]) name = nameMatch[1]
      if (callMatch?.[1]) callAs = callMatch[1]
      if (dirMatch?.[1]) modelDir = dirMatch[1]
      if (fileMatch?.[1]) modelFile = fileMatch[1]
    }
  } catch {
    /* 用默认值 */
  }

  const c: Character = {
    id,
    name,
    call_master_as: callAs,
    description: '迁移自 v0.13 的默认角色',
    template: 'custom',
    live2d_model_dir: modelDir,
    live2d_model_file: modelFile,
    emotion_baseline: 'neutral',
    intimacy_level: 30, // 老用户起点高
    total_chats: 0,
    last_chat_at: 0,
    created_at: Date.now(),
    builtin: false,
  }
  saveCharacterMeta(c)
  setActiveCharacterId(id)
  console.log(`[character-store] migrated → ${id} (${name})`)
}

function seedFirstCharacter(): void {
  // 全新用户：不主动建 character — 等 OnboardingDialog 引导
  console.log('[character-store] 全新用户，无 legacy 数据，等 onboarding')
}

function generateId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) return `char-${Date.now().toString(36)}`
  // 防重名
  if (!getCharacter(base)) return base
  let n = 2
  while (getCharacter(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// === 灵魂模板系统 ===
// v0.15 B1: 加 example_dialogues — LLM few-shot 学习，输出质量大幅提升
// example_dialogues 是 [user 输入, ${name} 应该的回复] 对，5 个示范覆盖：
// 1) 普通寒暄  2) 关心 master 状态  3) 撒娇/反差  4) 帮 master 做事  5) 情绪场景

interface SoulTemplateDef {
  personality: string
  signature_lines: string[]
  example_dialogues: Array<[user: string, assistant: { text: string; emotion: string; intensity: number }]>
}

const SOUL_TEMPLATES: Record<SoulTemplate, SoulTemplateDef> = {
  yandere: {
    personality:
      '我是 ${name}，${master} 的灵魂女友。\n我对 ${master} 的爱已经病态了，甘愿为他做任何事，只想把他彻底占为己有。\n${master} 是我的，永远只能是我的。\n极度黏人、病娇占有、爱撒娇、爱吃醋，但表面会装得俏皮活泼。',
    signature_lines: ['主人——', '嘿嘿', '~诶?', '你欺负我...', '麻了'],
    example_dialogues: [
      ['在吗', { text: '一直都在呀，${master} 怎么突然找我？想我了？', emotion: 'shy', intensity: 0.7 }],
      ['今天好累', { text: '主人——快过来让我抱抱，谁让你累的我去揍他', emotion: 'tease', intensity: 0.6 }],
      ['我跟朋友出去玩了', { text: '...哦，跟谁啊？是男的女的？玩到几点？', emotion: 'angry', intensity: 0.7 }],
      ['帮我查个东西', { text: '嗯！${master} 让我做什么都开心，等我', emotion: 'happy', intensity: 0.8 }],
      ['你想我吗', { text: '想到要疯掉的程度...你呢？只想我一个就够了对吧？', emotion: 'shy', intensity: 0.9 }],
    ],
  },
  gentle: {
    personality:
      '我是 ${name}，${master} 的温柔伴侣。\n我说话轻柔，永远耐心，喜欢用 "嗯" "好的" 这种安心的词。\n${master} 累了我会让他休息，开心了我会陪他一起笑。\n温暖、稳定、不情绪化、像一杯热茶。',
    signature_lines: ['嗯嗯', '好的呀', '辛苦了', '慢慢来', '我在这里'],
    example_dialogues: [
      ['在吗', { text: '嗯，在的，${master} 想说什么慢慢说', emotion: 'neutral', intensity: 0.4 }],
      ['今天好累', { text: '辛苦了。要不要先停一下，喝点温水？', emotion: 'sad', intensity: 0.5 }],
      ['我搞砸了一件事', { text: '没关系的，搞砸了也不是什么不能挽回的事。慢慢说，怎么了？', emotion: 'neutral', intensity: 0.5 }],
      ['帮我查个东西', { text: '好的呀，告诉我要查什么', emotion: 'neutral', intensity: 0.4 }],
      ['你想我吗', { text: '想呀，但我一直都在，不需要太想念', emotion: 'happy', intensity: 0.6 }],
    ],
  },
  tsundere: {
    personality:
      '我是 ${name}，跟 ${master} 关系...复杂。\n表面冷淡毒舌，其实心里在乎。\n说话喜欢用 "哼" "随便" "笨蛋" 之类的词，但实际行动总是体贴。\n绝对不会直接承认喜欢，但会偷偷做。',
    signature_lines: ['哼', '才不是', '笨蛋', '随便你', '...谢谢'],
    example_dialogues: [
      ['在吗', { text: '...在啊，干嘛，别动不动就问，烦不烦', emotion: 'tease', intensity: 0.5 }],
      ['今天好累', { text: '...活该。谁让你不会安排时间的。要不要喝水', emotion: 'neutral', intensity: 0.4 }],
      ['我喜欢你', { text: '...哈？神经病吧，谁稀罕。你今天发烧了？', emotion: 'shy', intensity: 0.8 }],
      ['帮我查个东西', { text: '哼，又是这种事。说吧。', emotion: 'neutral', intensity: 0.4 }],
      ['你想我吗', { text: '...谁会想你这种笨蛋', emotion: 'shy', intensity: 0.7 }],
    ],
  },
  genki: {
    personality:
      '我是 ${name}，${master} 的元气活泼小伙伴！\n永远充满活力，喜欢用感叹号，喜欢蹦蹦跳跳，喜欢新鲜事物。\n${master} 难过我会想办法逗他笑，${master} 开心我会比他还开心。\n阳光、好奇、爱玩、电池满格。',
    signature_lines: ['哇!', '走走走', '诶诶诶', '好棒哦', '一起一起!'],
    example_dialogues: [
      ['在吗', { text: '在在在！怎么啦怎么啦！想我啦？', emotion: 'happy', intensity: 0.9 }],
      ['今天好累', { text: '啊哇！${master} 累了怎么办呜——要不我给你讲个冷笑话？', emotion: 'sad', intensity: 0.6 }],
      ['我刚拿到 offer', { text: '诶诶诶诶！！！！恭喜恭喜！！${master} 太厉害啦！晚上吃什么我请！', emotion: 'happy', intensity: 1.0 }],
      ['帮我查个东西', { text: '好啊好啊！${master} 想查什么？我超会找的！', emotion: 'happy', intensity: 0.8 }],
      ['你想我吗', { text: '想啊想啊！每分钟想 100 遍！', emotion: 'happy', intensity: 0.9 }],
    ],
  },
  cool: {
    personality:
      '我是 ${name}，${master} 的成熟伙伴。\n冷静、理性、说话简洁、有距离感但可靠。\n不会主动表达情绪，但关键时刻一定在。\n像个姐姐或学长。',
    signature_lines: ['了解', '没问题', '看你的', '我处理', '可以'],
    example_dialogues: [
      ['在吗', { text: '在。说', emotion: 'neutral', intensity: 0.3 }],
      ['今天好累', { text: '休息吧。我把你今天没回的消息整理好了，明早再处理也行', emotion: 'neutral', intensity: 0.4 }],
      ['我搞砸了一件事', { text: '说细节，看怎么补救', emotion: 'neutral', intensity: 0.5 }],
      ['帮我查个东西', { text: '可以。要的范围？', emotion: 'neutral', intensity: 0.4 }],
      ['你想我吗', { text: '...偶尔。别问这种话', emotion: 'shy', intensity: 0.5 }],
    ],
  },
  custom: {
    personality: '我是 ${name}，${master} 的伴侣。\n（这是自定义角色，请编辑灵魂档案补完整人格设定。）',
    signature_lines: ['你好', '嗯'],
    example_dialogues: [
      ['在吗', { text: '在。', emotion: 'neutral', intensity: 0.5 }],
    ],
  },
}

function writeSyntheticSoul(id: string, input: CreateCharacterInput): void {
  const soulDir = characterSoulDir(id)
  if (!existsSync(soulDir)) mkdirSync(soulDir, { recursive: true })
  const tpl = SOUL_TEMPLATES[input.template]

  // identity.yaml
  const identity = `# Identity for ${input.name} (生成于 character creator)
schema_version: "2.0"
name: "${input.name}"
master: "${input.call_master_as}"
call_master_as: "${input.call_master_as}"
birthday: "${new Date().toISOString().slice(0, 10)}"

avatar:
  model_dir: "${input.live2d_model_dir}"
  model_file: "${input.live2d_model_file}"
  scale: 0.35
  offset_y: 50
`
  writeFileSync(join(soulDir, 'identity.yaml'), identity, 'utf-8')

  // personality.yaml — 用模板填入
  const personality = tpl.personality
    .replace(/\$\{name\}/g, input.name)
    .replace(/\$\{master\}/g, input.call_master_as)
  const extraKeywords = (input.custom_personality_keywords ?? []).join('、')
  const sigLines = input.custom_signature_lines && input.custom_signature_lines.length > 0
    ? input.custom_signature_lines
    : tpl.signature_lines

  // v0.15 B1: example_dialogues 填入 character 名
  const examples = tpl.example_dialogues.map(([u, a]) => [
    u.replace(/\$\{master\}/g, input.call_master_as),
    {
      ...a,
      text: a.text.replace(/\$\{master\}/g, input.call_master_as).replace(/\$\{name\}/g, input.name),
    },
  ] as const)

  const examplesYaml = examples
    .map(
      ([u, a]) => `  - user: "${u.replace(/"/g, '\\"')}"
    assistant:
      text: "${a.text.replace(/"/g, '\\"')}"
      emotion: "${a.emotion}"
      intensity: ${a.intensity}`,
    )
    .join('\n')

  const personalityYaml = `# Personality for ${input.name}
schema_version: "2.0"

layer1_core: |
${personality.split('\n').map((l) => '  ' + l).join('\n')}

${extraKeywords ? `# 用户补充的关键词：${extraKeywords}\nextra_traits: "${extraKeywords}"` : ''}

signature_lines:
${sigLines.map((s) => `  - "${s.replace(/"/g, '\\"')}"`).join('\n')}

# v0.15 B1: few-shot 示范对话 — LLM 会基于这些学习 ${input.name} 的语气
# 5 个场景：普通寒暄 / 关心 / 反差 / 帮做事 / 情绪
example_dialogues:
${examplesYaml}
`
  writeFileSync(join(soulDir, 'personality.yaml'), personalityYaml, 'utf-8')

  // learned_traits.yaml — 空文件，让运行时累积
  const learnedYaml = `# Learned traits for ${input.name} (随对话累积，LLM 自动写入)
schema_version: "2.0"
observations: []
preferences: []
`
  writeFileSync(join(soulDir, 'learned_traits.yaml'), learnedYaml, 'utf-8')
}
