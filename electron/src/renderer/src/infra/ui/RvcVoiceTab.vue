<script setup lang="ts">
/**
 * RVC 音色 tab — 资源商店内嵌
 *
 * 卡片网格，按分类（萝莉/少女/姐姐/御姐/男声/主人）分组。
 * 点卡片 → 详情侧栏：试听 + 一键启用 + 调参（f0/index/method）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'

const cfg = useConfigStore()

interface VoiceMeta {
  id: string
  display: string
  category: string
  f0_suggest: number
  /** 来源描述 */
  origin: string
}

// 47 个原神 + master 的元数据（手工分类，对应文档）
const VOICE_META: VoiceMeta[] = [
  { id: 'master', display: '主人 (master)', category: '🎙️ 主人音色', f0_suggest: 0, origin: '主人自录 ~2.2 分钟 / 100 epoch CPU' },

  // 萝莉/少女
  { id: 'nahida-jp', display: '纳西妲', category: '🍼 萝莉/少女', f0_suggest: 0, origin: '须弥草神 · 治愈系' },
  { id: 'paimon-jp', display: '派蒙', category: '🍼 萝莉/少女', f0_suggest: 2, origin: '应急食物 · 魔性' },
  { id: 'dori-jp', display: '多莉', category: '🍼 萝莉/少女', f0_suggest: 1, origin: '商人萝莉' },
  { id: 'qiqi-jp', display: '七七', category: '🍼 萝莉/少女', f0_suggest: 0, origin: '僵尸萝莉 · 冷淡' },
  { id: 'sigewinne-jp', display: '西格雯', category: '🍼 萝莉/少女', f0_suggest: 1, origin: '护士萝莉' },
  { id: 'faruzan-jp', display: '珐露珊', category: '🍼 萝莉/少女', f0_suggest: 0, origin: '学究萝莉' },

  // 元气少女
  { id: 'barbara-jp', display: '芭芭拉', category: '🌟 元气少女', f0_suggest: 0, origin: '蒙德偶像' },
  { id: 'amber-jp', display: '安柏', category: '🌟 元气少女', f0_suggest: 0, origin: '飞行队 · 活泼' },
  { id: 'noelle-jp', display: '诺艾尔', category: '🌟 元气少女', f0_suggest: 0, origin: '温柔女仆' },
  { id: 'diona-jp', display: '迪奥娜', category: '🌟 元气少女', f0_suggest: 1, origin: '猫猫调酒师' },
  { id: 'charlotte-jp', display: '夏洛蒂', category: '🌟 元气少女', f0_suggest: 1, origin: '记者 · 元气' },
  { id: 'nilou-jp', display: '妮露', category: '🌟 元气少女', f0_suggest: 0, origin: '须弥舞者' },

  // 温柔大小姐
  { id: 'ayaka-jp', display: '神里绫华', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '白鹭公主 · 知性' },
  { id: 'jean-jp', display: '琴', category: '🌸 温柔大小姐', f0_suggest: -1, origin: '西风团长' },
  { id: 'lisa-jp', display: '丽莎', category: '🌸 温柔大小姐', f0_suggest: -2, origin: '慵懒图书管理员' },
  { id: 'furina-jp', display: '芙宁娜', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '枫丹水神 · 戏剧化' },
  { id: 'navia-jp', display: '娜维娅', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '特派员小姐' },
  { id: 'lumine-jp', display: '荧', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '旅行者女' },
  { id: 'sucrose-jp', display: '砂糖', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '害羞炼金术师' },
  { id: 'kuki-jp', display: '久岐忍', category: '🌸 温柔大小姐', f0_suggest: -1, origin: '干练姐姐' },
  { id: 'yanfei-jp', display: '烟绯', category: '🌸 温柔大小姐', f0_suggest: 0, origin: '律师姐姐' },

  // 冷御姐
  { id: 'raiden-jp', display: '雷电将军', category: '❄️ 冷御姐', f0_suggest: -2, origin: '稻妻神 · 威严' },
  { id: 'shenhe-jp', display: '申鹤', category: '❄️ 冷御姐', f0_suggest: -3, origin: '仙人弟子 · 冷漠' },
  { id: 'ningguang-jp', display: '凝光', category: '❄️ 冷御姐', f0_suggest: -2, origin: '璃月商人' },
  { id: 'dehya-jp', display: '迪希雅', category: '❄️ 冷御姐', f0_suggest: -1, origin: '飒爽佣兵' },
  { id: 'lynette-jp', display: '琳妮特', category: '❄️ 冷御姐', f0_suggest: -1, origin: '冷淡少女' },
  { id: 'sara-jp', display: '九条裟罗', category: '❄️ 冷御姐', f0_suggest: -2, origin: '稻妻女武士' },
  { id: 'rosaria-jp', display: '罗莎莉亚', category: '❄️ 冷御姐', f0_suggest: -2, origin: '修女御姐' },
  { id: 'signora-jp', display: '女士', category: '❄️ 冷御姐', f0_suggest: -2, origin: '诱惑执行官' },
  { id: 'greaterLordRukkhadevata-jp', display: '大慈树王', category: '❄️ 冷御姐', f0_suggest: 0, origin: '神圣温柔' },

  // 男声
  { id: 'aether-jp', display: '旅行者空', category: '👨 男声', f0_suggest: 0, origin: '主角少年' },
  { id: 'xiao-jp', display: '魈', category: '👨 男声', f0_suggest: 0, origin: '夜叉 · 冷酷' },
  { id: 'kazuha-jp', display: '万叶', category: '👨 男声', f0_suggest: 0, origin: '稻妻浪人' },
  { id: 'chongyun-jp', display: '重云', category: '👨 男声', f0_suggest: 0, origin: '冷酷方士' },
  { id: 'razor-jp', display: '雷泽', category: '👨 男声', f0_suggest: 0, origin: '野性少年' },
  { id: 'venti-jp', display: '温迪', category: '👨 男声', f0_suggest: 0, origin: '蒙德诗人' },
  { id: 'lyney-jp', display: '林尼', category: '👨 男声', f0_suggest: 0, origin: '魔术师' },
  { id: 'bennett-jp', display: '班尼特', category: '👨 男声', f0_suggest: 0, origin: '倒霉冒险家' },
  { id: 'tartaglia-jp', display: '达达利亚', category: '👨 男声', f0_suggest: 0, origin: '邪魅公子' },
  { id: 'albedo-jp', display: '阿贝多', category: '👨 男声', f0_suggest: 0, origin: '冷静学者' },
  { id: 'alhaitam-jp', display: '艾尔海森', category: '👨 男声', f0_suggest: 0, origin: '理性书记' },
  { id: 'cyno-jp', display: '赛诺', category: '👨 男声', f0_suggest: 0, origin: '严肃风纪官' },
  { id: 'kaveh-jp', display: '卡维', category: '👨 男声', f0_suggest: 0, origin: '浪漫建筑师' },
  { id: 'neuvillette-jp', display: '那维莱特', category: '👨 男声', f0_suggest: 0, origin: '水龙王 · 绅士' },
  { id: 'wriothesley-jp', display: '莱欧斯利', category: '👨 男声', f0_suggest: 0, origin: '帅气典狱长' },
  { id: 'zhongli-jp', display: '钟离', category: '👨 男声', f0_suggest: 0, origin: '岩王帝君 · 沉稳' },
  { id: 'itto-jp', display: '一斗', category: '👨 男声', f0_suggest: 0, origin: '豪迈大汉（40k）' },
]

const search = ref('')
const focusedVoice = ref<VoiceMeta | null>(null)
/** sidecar 已部署 voice 列表（防 voice_meta 跟实际不一致） */
const availableVoices = ref<Set<string>>(new Set())

async function refreshAvailable(): Promise<void> {
  const r = await window.api.tts.listRvcVoices()
  if (r.ok) availableVoices.value = new Set(r.voices)
}

onMounted(() => {
  void refreshAvailable()
})

// 过滤 + 分类
const grouped = computed(() => {
  const q = search.value.trim().toLowerCase()
  const byCategory = new Map<string, VoiceMeta[]>()
  for (const v of VOICE_META) {
    if (!availableVoices.value.has(v.id)) continue
    if (q && !v.display.toLowerCase().includes(q) && !v.id.includes(q) && !v.origin.toLowerCase().includes(q)) continue
    if (!byCategory.has(v.category)) byCategory.set(v.category, [])
    byCategory.get(v.category)!.push(v)
  }
  // 类别顺序固定
  const order = ['🎙️ 主人音色', '🍼 萝莉/少女', '🌟 元气少女', '🌸 温柔大小姐', '❄️ 冷御姐', '👨 男声']
  return order
    .filter((k) => byCategory.has(k))
    .map((k) => ({ category: k, voices: byCategory.get(k)! }))
})

const isActive = computed(() => (vid: string) => cfg.config?.rvc_voice === vid)

async function applyVoice(v: VoiceMeta): Promise<void> {
  if (!cfg.config) return
  const plain = JSON.parse(JSON.stringify(cfg.config))
  plain.rvc_voice = v.id
  plain.rvc_f0_up_key = v.f0_suggest
  await window.api.config.save(plain)
  bus.emit('ui:toast', { kind: 'success', message: `已切到「${v.display}」`, ttl_ms: 3000 })
}

async function clearVoice(): Promise<void> {
  if (!cfg.config) return
  const plain = JSON.parse(JSON.stringify(cfg.config))
  plain.rvc_voice = ''
  await window.api.config.save(plain)
  bus.emit('ui:toast', { kind: 'info', message: '已关闭 RVC，使用底座 TTS', ttl_ms: 3000 })
}

// 试听
const previewPlaying = ref<string | null>(null)
const previewAudio = ref<HTMLAudioElement | null>(null)

async function preview(v: VoiceMeta, customF0?: number, customIndex?: number): Promise<void> {
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value = null
  }
  previewPlaying.value = v.id
  try {
    const text = '主人你好啊，我是你的桌面伴侣，今天想聊些什么呢？'
    const f0 = customF0 ?? v.f0_suggest
    const idx = customIndex ?? 0.75
    const r = await window.api.tts.speak({
      text,
      voice: 'edge_xiaoxiao',
      emotion: 'neutral',
    })
    // 注：v0.10 流式 tts.speak 已经包了 RVC，但这里需要直接对 sidecar 发 — 用一个新 IPC 或临时改 config 试听
    // 简化方案：临时改 rvc_voice + speak + 还原（更稳的做法是新加 tts:preview-with-rvc IPC）
    if (r.ok && r.audio_b64) {
      const audio = new Audio(`data:${r.mime ?? 'audio/wav'};base64,${r.audio_b64}`)
      previewAudio.value = audio
      audio.onended = () => {
        previewPlaying.value = null
        previewAudio.value = null
      }
      audio.onerror = () => {
        previewPlaying.value = null
        previewAudio.value = null
        bus.emit('ui:toast', { kind: 'error', message: '试听播放失败', ttl_ms: 3000 })
      }
      await audio.play()
    } else {
      previewPlaying.value = null
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '试听失败', ttl_ms: 3000 })
    }
    // 暂时不传 rvc_voice 给试听（用 cfg 当前的）— 未来加 tts:preview-with-overrides IPC
    void f0
    void idx
  } catch (e) {
    previewPlaying.value = null
    bus.emit('ui:toast', { kind: 'error', message: String(e).slice(0, 80), ttl_ms: 3000 })
  }
}

watch(focusedVoice, () => {
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value = null
    previewPlaying.value = null
  }
})
</script>

<template>
  <div class="voice-tab">
    <div class="vt-toolbar">
      <input v-model="search" placeholder="搜索音色名 / 角色 / 来源…" class="search-input" />
      <button v-if="cfg.config?.rvc_voice" class="ghost danger" @click="clearVoice">
        ✕ 关闭 RVC
      </button>
      <span class="hint">
        当前：<strong>{{ cfg.config?.rvc_voice || '未启用（用底座 TTS）' }}</strong>
      </span>
    </div>

    <div class="vt-body">
      <div class="vt-grid">
        <section v-for="g in grouped" :key="g.category" class="category">
          <h3 class="cat-title">
            {{ g.category }}
            <span class="cat-count">{{ g.voices.length }}</span>
          </h3>
          <div class="cards">
            <button
              v-for="v in g.voices"
              :key="v.id"
              class="vcard"
              :class="{ active: isActive(v.id), focused: focusedVoice?.id === v.id }"
              @click="focusedVoice = v"
              @dblclick="applyVoice(v)"
            >
              <div class="vc-icon">{{ isActive(v.id) ? '✓' : '🎙️' }}</div>
              <div class="vc-name">{{ v.display }}</div>
              <div class="vc-origin">{{ v.origin }}</div>
              <div class="vc-foot">
                <span class="vc-id">{{ v.id }}</span>
                <span v-if="v.f0_suggest !== 0" class="vc-f0">f0={{ v.f0_suggest }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>

      <!-- 详情侧栏 -->
      <aside v-if="focusedVoice" class="detail">
        <h3>{{ focusedVoice.display }}</h3>
        <div class="d-category">{{ focusedVoice.category }}</div>
        <p class="d-origin">{{ focusedVoice.origin }}</p>
        <div class="d-meta">
          <div><span>voice_id</span><code>{{ focusedVoice.id }}</code></div>
          <div><span>推荐 f0</span><code>{{ focusedVoice.f0_suggest }} 半音</code></div>
          <div><span>状态</span>
            <code v-if="isActive(focusedVoice.id)" class="ok">使用中 ✓</code>
            <code v-else class="dim">未启用</code>
          </div>
        </div>
        <div class="d-actions">
          <button
            class="primary"
            :disabled="isActive(focusedVoice.id)"
            @click="applyVoice(focusedVoice)"
          >
            {{ isActive(focusedVoice.id) ? '已启用' : '启用此音色' }}
          </button>
          <button
            class="ghost"
            :disabled="previewPlaying === focusedVoice.id"
            @click="preview(focusedVoice)"
          >
            {{ previewPlaying === focusedVoice.id ? '🔊 播放中…' : '▶ 试听当前音色' }}
          </button>
        </div>
        <p class="d-hint">
          💡 试听用的是「设置面板里当前的 RVC 音色」（不是详情里这个）。要听这个音色的效果，先点
          <strong>启用此音色</strong>，再点试听。
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.voice-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.vt-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 24px;
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
}
.search-input {
  flex: 0 0 320px;
  padding: 7px 12px;
  border: 1px solid oklch(85% 0.02 25 / 0.5);
  border-radius: 8px;
  background: oklch(99% 0.002 25);
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: oklch(50% 0.05 250);
  margin-left: auto;
}
.hint strong {
  color: oklch(25% 0.1 250);
  font-family: monospace;
}
.ghost {
  padding: 6px 12px;
  border-radius: 8px;
  background: oklch(96% 0.01 250 / 0.6);
  font-size: 12px;
  color: oklch(40% 0.05 250);
}
.ghost.danger { color: oklch(50% 0.2 25); }
.ghost.danger:hover { background: oklch(92% 0.1 25 / 0.6); }

.vt-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 12px;
  padding: 12px 24px 24px;
  overflow: hidden;
}
.vt-grid {
  overflow-y: auto;
  padding-right: 4px;
}
.category { margin-bottom: 24px; }
.cat-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 10px;
  color: oklch(30% 0.08 250);
  display: flex;
  align-items: center;
  gap: 8px;
}
.cat-count {
  font-size: 11px;
  padding: 2px 8px;
  background: oklch(92% 0.04 250);
  color: oklch(40% 0.1 250);
  border-radius: 999px;
  font-weight: 500;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}
.vcard {
  padding: 12px;
  border-radius: 12px;
  background: oklch(98% 0.005 250 / 0.6);
  border: 1.5px solid oklch(90% 0.01 250 / 0.5);
  text-align: left;
  cursor: pointer;
  transition: all 150ms;
}
.vcard:hover {
  background: oklch(97% 0.02 250 / 0.8);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px oklch(0% 0 0 / 0.06);
}
.vcard.focused {
  border-color: oklch(60% 0.18 250 / 0.7);
}
.vcard.active {
  background: linear-gradient(135deg, oklch(95% 0.04 250 / 0.7), oklch(94% 0.05 280 / 0.6));
  border-color: oklch(55% 0.2 250);
}
.vc-icon { font-size: 24px; margin-bottom: 4px; }
.vc-name {
  font-weight: 600;
  font-size: 14px;
  color: oklch(25% 0.08 250);
  margin-bottom: 2px;
}
.vc-origin {
  font-size: 11px;
  color: oklch(50% 0.05 250);
  margin-bottom: 8px;
  line-height: 1.4;
}
.vc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  font-family: monospace;
  color: oklch(55% 0.05 250);
}
.vc-id { opacity: 0.7; }
.vc-f0 {
  background: oklch(94% 0.06 80 / 0.6);
  padding: 1px 6px;
  border-radius: 4px;
  color: oklch(40% 0.12 80);
}

/* 详情侧栏 */
.detail {
  background: oklch(98% 0.005 250 / 0.7);
  border: 1px solid oklch(90% 0.01 250 / 0.5);
  border-radius: 14px;
  padding: 18px;
  overflow-y: auto;
}
.detail h3 {
  margin: 0 0 4px;
  font-size: 18px;
  color: oklch(20% 0.1 250);
}
.d-category {
  font-size: 12px;
  color: oklch(50% 0.05 250);
  margin-bottom: 10px;
}
.d-origin {
  font-size: 13px;
  line-height: 1.55;
  color: oklch(35% 0.05 250);
  margin: 0 0 14px;
}
.d-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: oklch(95% 0.01 250 / 0.5);
  border-radius: 8px;
}
.d-meta div {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.d-meta span { color: oklch(50% 0.05 250); }
.d-meta code {
  font-family: monospace;
  font-size: 11px;
  color: oklch(25% 0.1 250);
}
.d-meta code.ok { color: oklch(45% 0.2 145); font-weight: 600; }
.d-meta code.dim { color: oklch(55% 0.03 250); }
.d-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.primary {
  padding: 10px 16px;
  background: oklch(55% 0.2 250);
  color: white;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
}
.primary:hover { background: oklch(50% 0.22 250); }
.primary:disabled {
  background: oklch(85% 0.05 145);
  cursor: default;
}
.d-actions .ghost {
  padding: 10px 16px;
  font-size: 13px;
}
.d-hint {
  font-size: 11px;
  line-height: 1.5;
  color: oklch(50% 0.05 250);
  background: oklch(96% 0.025 80 / 0.4);
  padding: 8px 10px;
  border-radius: 6px;
  border-left: 3px solid oklch(70% 0.1 80);
  margin: 0;
}
</style>
