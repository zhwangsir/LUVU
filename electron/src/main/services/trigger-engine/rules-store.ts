/**
 * 触发规则存储 ~/.luvu/trigger-rules.yaml
 *
 * 默认规则随包内置；用户可编辑覆盖。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { TriggerRule } from '@shared/trigger'
import { getPaths } from '../paths'

const DEFAULT_RULES: TriggerRule[] = [
  {
    id: 'reply_happy_strong',
    display_name_zh: '回复时高兴反应',
    when: { emotion: 'happy', min_intensity: 0.6, context: 'conversation_reply' },
    pick: { source: 'engine', order_by: 'scorer_score', limit: 3, randomize: true },
    cooldown_seconds: 6,
    priority: 10,
    enabled: true,
  },
  {
    id: 'reply_happy_normal',
    display_name_zh: '回复时一般高兴',
    when: { emotion: 'happy', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['nod_gentle', 'tease_smile'], randomize: true },
    cooldown_seconds: 4,
    priority: 5,
    enabled: true,
  },
  {
    id: 'reply_shy',
    display_name_zh: '害羞反应',
    when: { emotion: 'shy', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['shy_avert'], randomize: false },
    cooldown_seconds: 5,
    priority: 8,
    enabled: true,
  },
  {
    id: 'reply_sad',
    display_name_zh: '难过反应',
    when: { emotion: 'sad', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['sad_lower'], randomize: false },
    cooldown_seconds: 8,
    priority: 8,
    enabled: true,
  },
  {
    id: 'reply_angry',
    display_name_zh: '生气反应',
    when: { emotion: 'angry', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['angry_puff', 'shake_no'], randomize: true },
    cooldown_seconds: 6,
    priority: 8,
    enabled: true,
  },
  {
    id: 'reply_surprise',
    display_name_zh: '惊讶反应',
    when: { emotion: 'surprise', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['surprise_quick'], randomize: false },
    cooldown_seconds: 4,
    priority: 9,
    enabled: true,
  },
  {
    id: 'reply_tease',
    display_name_zh: '调皮反应',
    when: { emotion: 'tease', context: 'conversation_reply' },
    pick: { source: 'library', template_ids: ['tease_smile'], randomize: false },
    cooldown_seconds: 5,
    priority: 7,
    enabled: true,
  },
  {
    id: 'user_typing_listen',
    display_name_zh: '用户打字时倾听',
    when: { context: 'user_typing' },
    pick: { source: 'library', template_ids: ['listen_attentive', 'thinking'], randomize: true },
    cooldown_seconds: 8,
    priority: 3,
    enabled: true,
  },
  {
    id: 'idle_long_loop',
    display_name_zh: '长 idle filler',
    when: { context: 'idle_long' },
    pick: {
      source: 'library',
      template_ids: ['look_around', 'hair_touch', 'idle_breath'],
      randomize: true,
    },
    cooldown_seconds: 15,
    priority: 1,
    enabled: true,
  },
  {
    id: 'sleepy_idle',
    display_name_zh: '困倦时打哈欠',
    when: { emotion: 'sleepy', context: ['idle_long', 'idle_short'] },
    pick: { source: 'library', template_ids: ['sleepy_yawn'], randomize: false },
    cooldown_seconds: 30,
    priority: 6,
    enabled: true,
  },
  {
    id: 'greeting',
    display_name_zh: '打招呼',
    when: { context: 'greeting' },
    pick: { source: 'library', template_ids: ['greeting_wave'], randomize: false },
    cooldown_seconds: 10,
    priority: 9,
    enabled: true,
  },
]

function rulesPath(): string {
  const dir = getPaths().userDataDir
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'trigger-rules.yaml')
}

let cache: TriggerRule[] | null = null

export function load(): TriggerRule[] {
  if (cache) return cache
  const p = rulesPath()
  if (existsSync(p)) {
    try {
      // v0.13 security: JSON_SCHEMA 防 !!js/* 注入
      const parsed = yaml.load(readFileSync(p, 'utf-8'), { schema: yaml.JSON_SCHEMA }) as { rules?: TriggerRule[] }
      if (parsed && Array.isArray(parsed.rules)) {
        cache = parsed.rules
        return cache
      }
    } catch (e) {
      console.warn('[trigger-engine] rules parse failed:', e)
    }
  }
  cache = [...DEFAULT_RULES]
  save(cache)
  return cache
}

export function save(rules: TriggerRule[]): void {
  cache = rules
  try {
    writeFileSync(rulesPath(), yaml.dump({ rules }, { lineWidth: 100 }), 'utf-8')
  } catch (e) {
    console.warn('[trigger-engine] save failed:', e)
  }
}

export function resetToDefaults(): TriggerRule[] {
  cache = [...DEFAULT_RULES]
  save(cache)
  return cache
}
