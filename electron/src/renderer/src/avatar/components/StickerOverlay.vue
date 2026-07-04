<script setup lang="ts">
/**
 * StickerOverlay — 创作工坊生成完后，把图/视频「飘」到 Live2D 旁边
 *
 * 监听 window.api.comfyui.onProgress 的 done 事件 → 调 listRecent 拿最新一张 →
 * 浮窗显示 + 自动淡出 + 可拖、可点保留。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

type StickerStyle = 'card' | 'polaroid' | 'minimal' | 'bubble' | 'sticky'
const STYLES: StickerStyle[] = ['card', 'polaroid', 'minimal', 'bubble', 'sticky']
const STYLE_LABELS: Record<StickerStyle, string> = {
  card: '🪪 卡片',
  polaroid: '📷 拍立得',
  minimal: '⭕ 圆形',
  bubble: '💬 气泡',
  sticky: '🗒 便签',
}
// 给 bubble / sticky 用：LUVU 给主人的轻语
const BUBBLE_TEXTS = [
  '主人，看 ~',
  '画给你 💕',
  '送你一张',
  '主人喜欢吗？',
  '嘿嘿——',
  '给你画的哦',
]

interface FloatingSticker {
  id: string
  path: string
  kind: string
  isVideo: boolean
  x: number
  y: number
  spawnedAt: number
  pinned: boolean
  style: StickerStyle
  /** 仅 bubble / sticky 使用：随机选的一句话 */
  bubbleText: string
  /** 仅 polaroid 使用：拍立得的随机倾斜角 */
  tilt: number
}

function randomStyle(): StickerStyle {
  return STYLES[Math.floor(Math.random() * STYLES.length)]!
}
function randomBubbleText(): string {
  return BUBBLE_TEXTS[Math.floor(Math.random() * BUBBLE_TEXTS.length)]!
}

const stickers = ref<FloatingSticker[]>([])
const AUTO_HIDE_MS = 8000
let progressOff: (() => void) | null = null
let hideTimer: ReturnType<typeof setInterval> | null = null

function isVideoPath(p: string): boolean {
  return /\.(mp4|mov|webm|webp)$/i.test(p)
}

function fileUrl(p: string): string {
  // H1: 走自定义协议 luvu-asset://，main 端 handler 校验路径白名单
  return `luvu-asset://${encodeURI(p)}`
}

function spawnPosition(): { x: number; y: number } {
  // 随机散落在屏幕右上 1/3 区域，避开 Live2D 立绘（屏幕中心）
  const margin = 40
  const w = window.innerWidth
  const h = window.innerHeight
  const x = w - 280 - Math.random() * 200 - margin
  const y = margin + Math.random() * (h / 3)
  return { x: Math.max(margin, x), y: Math.max(margin, y) }
}

async function onGenerationDone(kind: string): Promise<void> {
  try {
    const recent = await window.api.comfyui.listRecent('all')
    const newest = recent[0]
    if (!newest) return
    // 防止同一张连续弹（500ms 内）
    if (stickers.value.some((s) => s.path === newest.path)) return
    const pos = spawnPosition()
    stickers.value.push({
      id: `${newest.mtime}-${Math.random().toString(36).slice(2, 8)}`,
      path: newest.path,
      kind: kind || newest.kind,
      isVideo: isVideoPath(newest.path),
      x: pos.x,
      y: pos.y,
      spawnedAt: Date.now(),
      pinned: false,
      style: randomStyle(),
      bubbleText: randomBubbleText(),
      tilt: (Math.random() - 0.5) * 6, // ±3deg
    })
    // 上限：同时最多 4 个浮窗，旧的让出
    while (stickers.value.length > 4) stickers.value.shift()
  } catch (e) {
    console.warn('[sticker-overlay] fetch recent failed', e)
  }
}

function dismiss(id: string): void {
  stickers.value = stickers.value.filter((s) => s.id !== id)
}

function togglePin(s: FloatingSticker): void {
  s.pinned = !s.pinned
}

function cycleStyle(s: FloatingSticker): void {
  const idx = STYLES.indexOf(s.style)
  s.style = STYLES[(idx + 1) % STYLES.length]!
  if (s.style === 'bubble' || s.style === 'sticky') s.bubbleText = randomBubbleText()
  if (s.style === 'polaroid') s.tilt = (Math.random() - 0.5) * 6
}

// 拖拽位置
function startDrag(s: FloatingSticker, e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY
  const baseX = s.x
  const baseY = s.y
  const onMove = (ev: MouseEvent): void => {
    s.x = Math.max(0, Math.min(window.innerWidth - 100, baseX + (ev.clientX - startX)))
    s.y = Math.max(0, Math.min(window.innerHeight - 80, baseY + (ev.clientY - startY)))
  }
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

onMounted(() => {
  progressOff = window.api.comfyui.onProgress((p) => {
    if (p.state === 'done') {
      // 给 main 端文件写盘留点时间
      setTimeout(() => void onGenerationDone(String(p.kind)), 600)
    }
  })
  // 周期清理过期
  hideTimer = setInterval(() => {
    const now = Date.now()
    stickers.value = stickers.value.filter((s) => s.pinned || now - s.spawnedAt < AUTO_HIDE_MS)
  }, 1000)
})

onBeforeUnmount(() => {
  progressOff?.()
  if (hideTimer) clearInterval(hideTimer)
})
</script>

<template>
  <div class="sticker-layer">
    <transition-group name="pop">
      <div
        v-for="s in stickers"
        :key="s.id"
        class="sticker"
        :class="[
          `style-${s.style}`,
          { pinned: s.pinned, video: s.isVideo },
        ]"
        :style="{
          left: `${s.x}px`,
          top: `${s.y}px`,
          ...(s.style === 'polaroid' ? { transform: `rotate(${s.tilt}deg)` } : {}),
        }"
        @mousedown="startDrag(s, $event)"
      >
        <!-- 气泡风格：上方写 LUVU 的话 + 三角箭头指向 Live2D -->
        <div v-if="s.style === 'bubble'" class="bubble-head">{{ s.bubbleText }}</div>

        <!-- 便签风格：上方手写体 -->
        <div v-if="s.style === 'sticky'" class="sticky-head">{{ s.bubbleText }}</div>

        <div class="kind-tag">{{ s.kind }}</div>

        <div class="media-wrap">
          <video
            v-if="s.isVideo"
            :src="fileUrl(s.path)"
            autoplay
            loop
            muted
            playsinline
            class="media"
          />
          <img v-else :src="fileUrl(s.path)" class="media" />
        </div>

        <!-- polaroid 风格：底部写日期 -->
        <div v-if="s.style === 'polaroid'" class="polaroid-caption">
          {{ new Date(s.spawnedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
        </div>

        <!-- 气泡指向 Live2D 的三角 -->
        <div v-if="s.style === 'bubble'" class="bubble-tail" />

        <div class="controls">
          <button class="ctl cycle" @click.stop="cycleStyle(s)" :title="`换风格 (当前: ${STYLE_LABELS[s.style]})`">🎨</button>
          <button class="ctl pin" :class="{ on: s.pinned }" @click.stop="togglePin(s)" :title="s.pinned ? '取消固定' : '固定'">
            {{ s.pinned ? '📌' : '📍' }}
          </button>
          <button class="ctl close" @click.stop="dismiss(s.id)" title="关闭">✕</button>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.sticker-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 800;
}

.sticker {
  position: absolute;
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  transition: box-shadow 0.2s;
}
.sticker:active { cursor: grabbing; }

.media-wrap { display: block; line-height: 0; }
.media {
  width: 100%;
  height: auto;
  max-height: 280px;
  object-fit: contain;
  background: #000;
  display: block;
}

.kind-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: rgba(96, 165, 250, 0.85);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  pointer-events: none;
}

.controls {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  z-index: 3;
  opacity: 0;
  transition: opacity 0.15s;
}
.sticker:hover .controls,
.sticker.pinned .controls { opacity: 1; }
.ctl {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: white;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  backdrop-filter: blur(4px);
  transition: background 0.15s, transform 0.15s;
}
.ctl:hover { background: rgba(0, 0, 0, 0.9); transform: scale(1.1); }
.ctl.close:hover { background: #dc2626; }
.ctl.pin.on { background: #fbbf24; color: #1f2937; }
.ctl.cycle:hover { background: #7c3aed; }

/* ============ 1. card (默认暗色磨砂) ============ */
.style-card {
  width: 220px;
  background: rgba(15, 17, 23, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.style-card:hover { box-shadow: 0 16px 48px rgba(96, 165, 250, 0.3); }
.style-card.video { width: 300px; }
.style-card.pinned { border-color: #fbbf24; box-shadow: 0 12px 36px rgba(251, 191, 36, 0.25); }

/* ============ 2. polaroid (拍立得) ============ */
.style-polaroid {
  width: 240px;
  background: #fafafa;
  padding: 14px 14px 4px;
  border-radius: 3px;
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.06),
    0 10px 28px rgba(0, 0, 0, 0.4),
    0 16px 48px rgba(0, 0, 0, 0.25);
  transition: transform 0.3s, box-shadow 0.2s;
}
.style-polaroid:hover {
  transform: rotate(0deg) scale(1.03) !important;
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.06),
    0 16px 48px rgba(0, 0, 0, 0.5),
    0 0 0 2px rgba(96, 165, 250, 0.4);
}
.style-polaroid .kind-tag {
  background: rgba(0, 0, 0, 0.6);
}
.style-polaroid .media-wrap {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.polaroid-caption {
  font-family: 'Caveat', 'Marker Felt', 'Comic Sans MS', cursive;
  text-align: center;
  font-size: 18px;
  color: #1f2937;
  padding: 14px 0 8px;
  letter-spacing: 0.5px;
}

/* ============ 3. minimal (圆形头像) ============ */
.style-minimal {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    0 0 0 4px rgba(255, 255, 255, 0.85),
    0 10px 30px rgba(0, 0, 0, 0.45);
  transition: transform 0.2s, box-shadow 0.2s;
}
.style-minimal:hover {
  transform: scale(1.08);
  box-shadow:
    0 0 0 4px #60a5fa,
    0 14px 40px rgba(96, 165, 250, 0.4);
}
.style-minimal.pinned {
  box-shadow:
    0 0 0 4px #fbbf24,
    0 10px 30px rgba(251, 191, 36, 0.4);
}
.style-minimal .kind-tag { display: none; }
.style-minimal .media-wrap,
.style-minimal .media {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  max-height: none;
}
.style-minimal .controls {
  top: auto;
  bottom: 4px;
  right: 50%;
  transform: translateX(50%);
  flex-direction: row;
  gap: 2px;
}
.style-minimal .ctl { width: 22px; height: 22px; font-size: 10px; }

/* ============ 4. bubble (聊天气泡) ============ */
.style-bubble {
  width: 240px;
  background: linear-gradient(135deg, #f0fdfa, #ddf4ff);
  border-radius: 18px 18px 18px 4px;
  padding: 10px;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(96, 165, 250, 0.2);
  position: absolute;
}
.bubble-head {
  font-size: 14px;
  color: #1e3a8a;
  margin-bottom: 8px;
  padding: 2px 8px;
  font-weight: 500;
  display: inline-block;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.15);
}
.style-bubble .media-wrap {
  border-radius: 14px 14px 14px 2px;
  overflow: hidden;
  background: #000;
}
.style-bubble .kind-tag {
  display: none;
}
.bubble-tail {
  position: absolute;
  bottom: -10px;
  left: 14px;
  width: 0;
  height: 0;
  border-left: 14px solid transparent;
  border-top: 16px solid #ddf4ff;
  border-right: 0;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1));
}

/* ============ 5. sticky (黄色便签) ============ */
.style-sticky {
  width: 220px;
  background: linear-gradient(180deg, #fef3c7, #fde68a);
  padding: 12px;
  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.08),
    0 10px 24px rgba(0, 0, 0, 0.3),
    0 14px 40px rgba(180, 130, 0, 0.18);
  transform: rotate(-2deg);
  transition: transform 0.2s;
  border-radius: 2px;
  position: relative;
}
.style-sticky::before {
  /* 顶部胶带 */
  content: '';
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%) rotate(-1deg);
  width: 80px;
  height: 18px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px dashed rgba(0, 0, 0, 0.1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}
.style-sticky:hover {
  transform: rotate(0deg) scale(1.03);
}
.sticky-head {
  font-family: 'Caveat', 'Marker Felt', 'Comic Sans MS', cursive;
  font-size: 20px;
  color: #92400e;
  text-align: center;
  margin: 4px 0 8px;
  letter-spacing: 0.5px;
}
.style-sticky .kind-tag { background: rgba(146, 64, 14, 0.85); }

/* === 出场 / 淡出 === */
.pop-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s;
}
.pop-leave-active {
  transition: transform 0.4s, opacity 0.4s;
}
.pop-enter-from {
  opacity: 0;
  transform: translateY(-30px) scale(0.7);
}
.pop-leave-to {
  opacity: 0;
  transform: translateY(15px) scale(0.92);
}
</style>
