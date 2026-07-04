/**
 * Character Pack — 打包 / 解包单个 character 完整数据 (P5)。
 *
 * Pack 内容（zip 结构）:
 *   meta.json                     pack 版本 + 来源 character info
 *   soul/identity.yaml            身份
 *   soul/personality.yaml         三层人格
 *   soul/learned_traits.yaml      [可选] 学习的偏好
 *   soul/core_memories.yaml       [可选] 关键回忆
 *   preferences.json              UI 偏好 (scale / offset_y)
 *   emotional-state.json          [可选] 情感状态 (含 topic_imprints / mood_history)
 *   thumb.webp                    [可选] 缩略图
 *
 * 不包含: history.sqlite (隐私敏感 — 用户隐式同意才能含；当前默认不含)
 *
 * 用例:
 *   - 用户分享自己调教好的 character 给朋友
 *   - 跨机器迁移 character (备份恢复)
 *   - 角色市场分发（社区分享 soul + 美化好的 emotional baseline）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import yaml from 'js-yaml'
import type { Character } from '@shared/character'
import {
  charactersRoot,
  characterDir,
  characterSoulDir,
  characterPreferencesPath,
  createCharacter,
  getCharacter,
  getMountedCharacterIds,
  setMountedCharacterIds,
} from './character-store'

export const CHARACTER_PACK_VERSION = '1.0'

// P0 SEC (security review C2): zip 输入 / 解压上限，防 zip bomb
const MAX_ZIP_INPUT_BYTES = 50 * 1024 * 1024 // 50 MB 压缩 zip 上限
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024 // 200 MB 总解压
// P0 SEC (M2/M3): 名字 / 路径字符上限防 DoS
const MAX_IMPORT_NAME_LEN = 64

// 文件 magic byte (H1)
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary')
const WEBP_RIFF_HEAD = Buffer.from('RIFF', 'ascii')
const WEBP_TYPE_TAG = Buffer.from('WEBP', 'ascii')

function isValidSqlite(buf: Buffer): boolean {
  if (buf.length < SQLITE_MAGIC.length) return false
  return buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
}

function isValidWebp(buf: Buffer): boolean {
  // WebP: 'RIFF' xxxx 'WEBP'
  if (buf.length < 12) return false
  if (!buf.subarray(0, 4).equals(WEBP_RIFF_HEAD)) return false
  if (!buf.subarray(8, 12).equals(WEBP_TYPE_TAG)) return false
  return true
}

/**
 * P0 SEC (C1): 防 zip path traversal — 拒绝 entry name 解析后逃出目标目录。
 * resolve(baseDir, entryName) 必须以 baseDir + sep 开头。
 * ts-reviewer M2: 移除等值分支死码 (空 entry name 会被上游 filename regex 先 reject)
 */
function isSafeZipPath(baseDir: string, entryName: string): boolean {
  const absBase = resolve(baseDir)
  const absTarget = resolve(absBase, entryName)
  return absTarget.startsWith(absBase + sep)
}

export interface CharacterPackMeta {
  version: string
  exported_at: number
  source_id: string
  source_name: string
  /** 创建时的 LUVU 版本，便于将来兼容性判断 */
  app_version?: string
  /** 包含的可选模块 */
  contents: {
    soul: boolean
    preferences: boolean
    emotional: boolean
    thumb: boolean
    /** memory.db (隐私敏感 — 含主人对话提取的 fact/preference/event 嵌入) */
    memory?: boolean
  }
}

export interface ExportOptions {
  /** 是否含 emotional state (默认 true) */
  includeEmotional?: boolean
  /** 是否含 thumb (默认 true) */
  includeThumb?: boolean
  /**
   * 是否含 memory.db (默认 false — 隐私敏感)
   * 跨机器自己迁移建议开；分享给朋友建议关。
   */
  includeMemory?: boolean
  appVersion?: string
}

export interface ExportResult {
  ok: boolean
  buffer?: Buffer
  meta?: CharacterPackMeta
  reason?: string
}

export interface ImportOptions {
  /** 新 character 名 (覆盖 pack 中的 source_name) */
  newName?: string
  /** 是否导入 emotional state (默认 true) */
  includeEmotional?: boolean
  /** 是否导入 memory.db (默认 true — 若 pack 含的话) */
  includeMemory?: boolean
}

export interface ImportResult {
  ok: boolean
  character?: Character
  reason?: string
}

/** 打包指定 character → Buffer (zip) */
export function exportCharacterPack(
  characterId: string,
  opts: ExportOptions = {},
): ExportResult {
  const c = getCharacter(characterId)
  if (!c) return { ok: false, reason: 'character not found' }

  const dir = characterDir(characterId)
  if (!existsSync(dir)) return { ok: false, reason: 'character dir missing' }

  const zip = new AdmZip()

  // 1. soul/*.yaml
  let soulIncluded = false
  const soulDir = characterSoulDir(characterId)
  if (existsSync(soulDir)) {
    for (const f of readdirSync(soulDir)) {
      if (!/\.ya?ml$/i.test(f)) continue
      const buf = readFileSync(join(soulDir, f))
      zip.addFile(`soul/${f}`, buf)
      soulIncluded = true
    }
  }

  // 2. preferences.json
  let prefsIncluded = false
  const prefsPath = characterPreferencesPath(characterId)
  if (existsSync(prefsPath)) {
    zip.addFile('preferences.json', readFileSync(prefsPath))
    prefsIncluded = true
  }

  // 3. emotional-state.json (可选)
  let emotionalIncluded = false
  if (opts.includeEmotional !== false) {
    const esPath = join(dir, 'emotional-state.json')
    if (existsSync(esPath)) {
      zip.addFile('emotional-state.json', readFileSync(esPath))
      emotionalIncluded = true
    }
  }

  // 4. thumb (可选) — 缩略图在 thumbs 目录而非 character dir
  let thumbIncluded = false
  if (opts.includeThumb !== false) {
    // 缩略图位置见 thumb-store: ~/.luvu/thumbs/<character_id>.webp
    const thumbPath = join(charactersRoot(), '..', 'thumbs', `${characterId}.webp`)
    if (existsSync(thumbPath)) {
      zip.addFile('thumb.webp', readFileSync(thumbPath))
      thumbIncluded = true
    }
  }

  // 5. memory.db (可选，隐私敏感，默认关)
  let memoryIncluded = false
  if (opts.includeMemory === true) {
    const memPath = join(dir, 'memory.db')
    if (existsSync(memPath)) {
      zip.addFile('memory.db', readFileSync(memPath))
      memoryIncluded = true
    }
  }

  // 6. meta.json
  const meta: CharacterPackMeta = {
    version: CHARACTER_PACK_VERSION,
    exported_at: Date.now(),
    source_id: characterId,
    source_name: c.name,
    ...(opts.appVersion ? { app_version: opts.appVersion } : {}),
    contents: {
      soul: soulIncluded,
      preferences: prefsIncluded,
      emotional: emotionalIncluded,
      thumb: thumbIncluded,
      memory: memoryIncluded,
    },
  }
  zip.addFile('meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'))

  return { ok: true, buffer: zip.toBuffer(), meta }
}

/** 解包 → 创建新 character */
export function importCharacterPack(
  buffer: Buffer,
  opts: ImportOptions = {},
): ImportResult {
  // P0 SEC (C2): 输入 zip 大小上限
  if (!buffer || buffer.length === 0) {
    return { ok: false, reason: '空文件' }
  }
  if (buffer.length > MAX_ZIP_INPUT_BYTES) {
    return {
      ok: false,
      reason: `pack 文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)} MB > ${MAX_ZIP_INPUT_BYTES / 1024 / 1024} MB)`,
    }
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch (e) {
    return { ok: false, reason: `不是有效的 zip: ${e instanceof Error ? e.message : String(e)}` }
  }

  // P0 SEC (C2): 总解压大小上限（zip bomb 防御）
  let totalUncompressed = 0
  for (const entry of zip.getEntries()) {
    totalUncompressed += entry.header.size
    if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        reason: `解压总大小超限 (${MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024} MB) — 可能是 zip bomb`,
      }
    }
  }

  // 1. 读 meta.json
  const metaEntry = zip.getEntry('meta.json')
  if (!metaEntry) return { ok: false, reason: 'meta.json 缺失（不是 character pack）' }
  let meta: CharacterPackMeta
  try {
    meta = JSON.parse(metaEntry.getData().toString('utf-8'))
  } catch (e) {
    return { ok: false, reason: `meta.json 解析失败: ${e}` }
  }
  if (!meta.version || !meta.source_name) {
    return { ok: false, reason: 'meta 缺 version 或 source_name' }
  }
  // P0 SEC (M3): meta.source_name 长度截断
  meta.source_name = String(meta.source_name).slice(0, MAX_IMPORT_NAME_LEN)

  // 2. 读 soul/identity.yaml 拿 live2d 配置
  const identityEntry = zip.getEntry('soul/identity.yaml')
  if (!identityEntry) {
    return { ok: false, reason: 'soul/identity.yaml 缺失（无法确定 live2d 模型）' }
  }
  const identityRaw = identityEntry.getData().toString('utf-8')
  // code-reviewer M3: 用 js-yaml.load 正确解析 (regex 对含空格 / block scalar 路径会截断)
  // JSON_SCHEMA 阻断 !!js/* 标签注入
  let identityObj: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(identityRaw, { schema: yaml.JSON_SCHEMA })
    if (parsed && typeof parsed === 'object') {
      identityObj = parsed as Record<string, unknown>
    }
  } catch {
    /* 解析失败 fallback 到默认值 */
  }
  const avatarObj =
    identityObj.avatar && typeof identityObj.avatar === 'object'
      ? (identityObj.avatar as Record<string, unknown>)
      : {}
  const modelDir = typeof avatarObj.model_dir === 'string' ? avatarObj.model_dir : ''
  const modelFile = typeof avatarObj.model_file === 'string' ? avatarObj.model_file : ''
  const callMaster =
    typeof identityObj.call_master_as === 'string' ? identityObj.call_master_as : ''

  // 3. 创建新 character (自动生成新 id 避免与现有冲突)
  // P0 SEC (M2): newName 长度截断防 DoS
  const newName = (opts.newName ?? meta.source_name).slice(0, MAX_IMPORT_NAME_LEN)
  let created: Character
  try {
    created = createCharacter({
      name: newName,
      call_master_as: (callMaster || '主人').slice(0, MAX_IMPORT_NAME_LEN),
      live2d_model_dir: (modelDir || 'HuTao-Live2D').slice(0, 200),
      live2d_model_file: (modelFile || 'Hu Tao.model3.json').slice(0, 200),
      template: 'custom',
    })
  } catch (e) {
    return { ok: false, reason: `创建 character 失败: ${e}` }
  }

  // 4. 写 soul/*.yaml (覆盖 createCharacter 写入的合成 soul)
  // P0 SEC (C1): 每个 entry name 必须解析后仍在 soulDir 内 (防 ../../etc/passwd)
  const soulDir = characterSoulDir(created.id)
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith('soul/') && /\.ya?ml$/i.test(entry.entryName)) {
      const filename = entry.entryName.slice('soul/'.length)
      // 额外限制 filename 只能是 [a-zA-Z0-9_-]+.yaml (跟 writeCharacterSoulFile 一致)
      if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
        console.warn(`[character-pack] skip 非法 soul filename: ${filename}`)
        continue
      }
      // 双保险：path traversal 检查
      if (!isSafeZipPath(soulDir, filename)) {
        console.warn(`[character-pack] skip 路径穿越 entry: ${entry.entryName}`)
        continue
      }
      writeFileSync(join(soulDir, filename), entry.getData())
    }
  }

  // 5. 写 preferences.json (覆盖默认)
  // security-reviewer LOW: parse + reserialize 确保是合法 JSON (拒绝写损坏数据)
  const prefsEntry = zip.getEntry('preferences.json')
  if (prefsEntry) {
    try {
      const parsed = JSON.parse(prefsEntry.getData().toString('utf-8'))
      writeFileSync(
        characterPreferencesPath(created.id),
        JSON.stringify(parsed, null, 2),
        'utf-8',
      )
    } catch (e) {
      console.warn('[character-pack] preferences.json 损坏，跳过:', e)
    }
  }

  // 6. 写 emotional-state.json (可选)
  if (opts.includeEmotional !== false) {
    const esEntry = zip.getEntry('emotional-state.json')
    if (esEntry) {
      try {
        // 反序列化 + 重写 character_id（防 source id 残留）
        const es = JSON.parse(esEntry.getData().toString('utf-8'))
        es.character_id = created.id
        writeFileSync(
          join(characterDir(created.id), 'emotional-state.json'),
          JSON.stringify(es, null, 2),
        )
      } catch (e) {
        console.warn('[character-pack] emotional-state import failed (skipped):', e)
      }
    }
  }

  // 7. thumb (可选 — 写到 thumbs 目录)
  // P0 SEC (H1): magic byte 校验 — 拒绝伪装成 .webp 的其他格式
  const thumbEntry = zip.getEntry('thumb.webp')
  if (thumbEntry) {
    const thumbData = thumbEntry.getData()
    if (isValidWebp(thumbData)) {
      const thumbDir = join(charactersRoot(), '..', 'thumbs')
      try {
        // ts-reviewer M1: 用 static import (mkdirSync 已在文件顶部 import)
        mkdirSync(thumbDir, { recursive: true })
        writeFileSync(join(thumbDir, `${created.id}.webp`), thumbData)
      } catch (e) {
        console.warn('[character-pack] thumb write failed (skipped):', e)
      }
    } else {
      console.warn('[character-pack] thumb.webp magic byte 校验失败，已拒绝')
    }
  }

  // 8. memory.db (可选 — 默认 true 若 pack 含)
  // P0 SEC (H1): SQLite magic byte 校验
  if (opts.includeMemory !== false) {
    const memEntry = zip.getEntry('memory.db')
    if (memEntry) {
      const memData = memEntry.getData()
      if (isValidSqlite(memData)) {
        try {
          writeFileSync(join(characterDir(created.id), 'memory.db'), memData)
        } catch (e) {
          console.warn('[character-pack] memory.db write failed (skipped):', e)
        }
      } else {
        console.warn('[character-pack] memory.db SQLite magic byte 校验失败，已拒绝')
      }
    }
  }

  // v0.21 Round L:M8 灵魂社会 — import 完自动 mount 新 character。
  // architect H-1 提议:跟 createCharacter 后 user 期望"她活着"的语义对齐,
  // 否则 mounted 列表始终只有 active,M8 多灵魂特性形同虚设。
  // 失败不阻断 import(已成功 createCharacter),只警告。
  try {
    const current = getMountedCharacterIds()
    if (!current.includes(created.id)) {
      const r = setMountedCharacterIds([...current, created.id])
      if (!r.ok) {
        console.warn(
          `[character-pack] import 成功但 mount 失败: ${r.reason} (character id=${created.id})`,
        )
      }
    }
  } catch (e) {
    console.warn('[character-pack] import 成功但 mount 抛错:', e)
  }

  return { ok: true, character: created }
}
