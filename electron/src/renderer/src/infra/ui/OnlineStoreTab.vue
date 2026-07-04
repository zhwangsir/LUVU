<script setup lang="ts">
/**
 * 在线资源商店 tab（v0.12）
 *
 * 上层：子 tab [🎙️ 音色] [🎭 立绘]
 * 中层：推荐 repo 列表（按 kind 过滤）
 * 选中 repo → 右侧详情：可装资源列表 + [安装] / [已装 ✓] / [进度条] 按钮
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { bus } from '../eventbus'
import type {
  OnlineAsset,
  OnlineInstallDone,
  OnlineInstallProgress,
  RecommendedRepo,
} from '@shared/api'

const subTab = ref<'rvc' | 'live2d'>('rvc')
const repos = ref<RecommendedRepo[]>([])
const selectedRepoIdx = ref<number | null>(null)
const assets = ref<OnlineAsset[]>([])
const assetsLoading = ref(false)

/** install_id → progress */
const installProgress = reactive<Record<string, OnlineInstallProgress>>({})
/** asset_path → installed bool（缓存） */
const installedCache = reactive<Record<string, boolean>>({})

let unbindProgress: (() => void) | null = null
let unbindDone: (() => void) | null = null

onMounted(async () => {
  repos.value = await window.api.online.listRecommended()
  // 自动选 sub-tab 第一个 repo
  selectRepoFromSubTab()
  // 监听安装进度
  unbindProgress = window.api.online.onInstallProgress((p) => {
    installProgress[p.install_id] = p
  })
  unbindDone = window.api.online.onInstallDone((p) => {
    if (p.ok) {
      bus.emit('ui:toast', {
        kind: 'success',
        message: p.voice_id ? `✓ 安装 ${p.voice_id}` : '✓ 安装完成',
        ttl_ms: 4000,
      })
    } else {
      bus.emit('ui:toast', {
        kind: 'error',
        message: `安装失败：${p.reason ?? 'unknown'}`,
        ttl_ms: 6000,
      })
    }
    // 清进度，刷新已装缓存
    delete installProgress[p.install_id]
    void refreshInstalledForCurrent()
  })
})

onBeforeUnmount(() => {
  unbindProgress?.()
  unbindDone?.()
})

const filteredRepos = computed(() => repos.value.filter((r) => r.kind === subTab.value))

function selectRepoFromSubTab(): void {
  const list = filteredRepos.value
  if (list.length > 0) {
    selectedRepoIdx.value = repos.value.indexOf(list[0]!)
    void loadAssets()
  } else {
    selectedRepoIdx.value = null
    assets.value = []
  }
}

function switchSubTab(t: 'rvc' | 'live2d'): void {
  subTab.value = t
  selectRepoFromSubTab()
}

async function selectRepo(idx: number): Promise<void> {
  selectedRepoIdx.value = idx
  await loadAssets()
}

const selectedRepo = computed(() =>
  selectedRepoIdx.value !== null ? repos.value[selectedRepoIdx.value] : null,
)

async function loadAssets(): Promise<void> {
  if (!selectedRepo.value) return
  assetsLoading.value = true
  assets.value = []
  try {
    const list = await window.api.online.listAssets({
      repo_id: selectedRepo.value.id,
      ...(selectedRepo.value.asset_path !== undefined ? { sub_path: selectedRepo.value.asset_path } : {}),
    })
    // 只保留 file 类型 + 大小 > 1MB（过滤 README）
    assets.value = list
      .filter((a) => a.type === 'file' && a.size > 1_000_000)
      .sort((a, b) => a.size - b.size)
    void refreshInstalledForCurrent()
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `加载列表失败：${String(e).slice(0, 80)}`,
      ttl_ms: 5000,
    })
  } finally {
    assetsLoading.value = false
  }
}

async function refreshInstalledForCurrent(): Promise<void> {
  if (!selectedRepo.value) return
  // 并发查每个 asset 是否已装
  for (const a of assets.value) {
    if (selectedRepo.value.kind === 'rvc') {
      const voiceId = (a.path.split('/').pop() ?? '').replace(/\.zip$/i, '').split(/\s+/)[0] ?? ''
      const r = await window.api.online.checkInstalled({
        kind: 'rvc',
        ...(voiceId ? { voice_id: voiceId } : {}),
      })
      installedCache[a.path] = r.installed
    } else {
      const r = await window.api.online.checkInstalled({
        kind: 'live2d',
        repo_slug: selectedRepo.value.id.replace('/', '__'),
        asset_name: a.path.split('/').pop() ?? '',
      })
      installedCache[a.path] = r.installed
    }
  }
}

function progressForAsset(assetPath: string): OnlineInstallProgress | null {
  if (!selectedRepo.value) return null
  const id = `${selectedRepo.value.id}/${assetPath}`
  return installProgress[id] ?? null
}

async function installOne(asset: OnlineAsset): Promise<void> {
  if (!selectedRepo.value) return
  await window.api.online.install({
    repo_id: selectedRepo.value.id,
    asset_path: asset.path,
    kind: selectedRepo.value.kind,
  })
  bus.emit('ui:toast', { kind: 'info', message: `开始下载 ${displayName(asset)}`, ttl_ms: 3000 })
}

async function cancelInstall(assetPath: string): Promise<void> {
  if (!selectedRepo.value) return
  const id = `${selectedRepo.value.id}/${assetPath}`
  await window.api.online.cancelInstall(id)
}

// 自定义 URL 安装
const customUrl = ref('')
const customInstalling = ref(false)
async function installCustom(): Promise<void> {
  const u = customUrl.value.trim()
  if (!u) return
  if (!u.startsWith('http')) {
    bus.emit('ui:toast', { kind: 'warn', message: 'URL 必须 http(s) 开头', ttl_ms: 3000 })
    return
  }
  customInstalling.value = true
  await window.api.online.installCustom({ url: u, kind: subTab.value })
  bus.emit('ui:toast', { kind: 'info', message: `开始下载 ${u.split('/').pop()}`, ttl_ms: 3000 })
  customUrl.value = ''
  setTimeout(() => (customInstalling.value = false), 2000)
}

function openBrowse(url: string): void {
  void window.api.system.openExternal(url)
}

function displayName(asset: OnlineAsset): string {
  return asset.path.split('/').pop() ?? asset.path
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
</script>

<template>
  <div class="online-tab">
    <!-- 子 tab -->
    <div class="sub-tabs">
      <button :class="['sub', { active: subTab === 'rvc' }]" @click="switchSubTab('rvc')">
        🎙️ RVC 音色
      </button>
      <button :class="['sub', { active: subTab === 'live2d' }]" @click="switchSubTab('live2d')">
        🎭 Live2D 立绘
      </button>
    </div>

    <div class="body">
      <!-- 左：repo 列表 -->
      <aside class="repo-list">
        <h4>推荐源</h4>
        <button
          v-for="(r, i) in repos"
          :key="`${r.id}_${r.asset_path ?? ''}`"
          v-show="r.kind === subTab"
          :class="['repo-card', { active: selectedRepoIdx === i }]"
          @click="selectRepo(i)"
        >
          <div class="rc-name">{{ r.name }}</div>
          <div class="rc-desc">{{ r.description }}</div>
          <div class="rc-id">{{ r.id }}{{ r.asset_path ? ' · ' + r.asset_path : '' }}</div>
        </button>
        <div v-if="filteredRepos.length === 0" class="empty">
          该类型暂无推荐 repo
        </div>
      </aside>

      <!-- 右：选中 repo 的可装资源 -->
      <main class="assets">
        <div v-if="!selectedRepo" class="placeholder">
          <p>👈 左侧选一个推荐源开始浏览</p>
        </div>
        <div v-else>
          <div class="ph-head">
            <div>
              <h3>{{ selectedRepo.name }}</h3>
              <a
                v-if="selectedRepo.source === 'huggingface'"
                href="#"
                @click.prevent="openBrowse(`https://huggingface.co/${selectedRepo.id}`)"
                class="hf-link"
              >
                🤗 {{ selectedRepo.id }} →
              </a>
              <a
                v-else
                href="#"
                @click.prevent="openBrowse(selectedRepo.browse_url || `https://github.com/${selectedRepo.id}`)"
                class="hf-link"
              >
                💻 {{ selectedRepo.id }} →
              </a>
            </div>
            <button
              v-if="selectedRepo.source === 'huggingface'"
              class="ghost"
              @click="loadAssets"
              :disabled="assetsLoading"
            >
              {{ assetsLoading ? '加载中…' : '↻ 刷新' }}
            </button>
          </div>
          <p v-if="selectedRepo.hint" class="hint">{{ selectedRepo.hint }}</p>

          <!-- browse_only repo: 只显示「打开浏览器」+ git clone 命令 -->
          <div v-if="selectedRepo.source === 'browse_only'" class="browse-only">
            <div class="bo-card">
              <div class="bo-icon">📂</div>
              <div class="bo-title">该资源仓库过大或非标准 zip，不支持一键装</div>
              <p class="bo-desc">推荐方式：</p>
              <ol class="bo-list">
                <li>点 <strong>「📂 在浏览器打开」</strong> 查看仓库结构</li>
                <li>找感兴趣的角色目录</li>
                <li>用 git clone / svn export / 直接下载 zip 取那部分</li>
                <li>放到 <code>electron/models-library/&lt;IP&gt;/</code> 下，rescan 即可</li>
              </ol>
              <button
                class="ac-install"
                @click="openBrowse(selectedRepo.browse_url || `https://github.com/${selectedRepo.id}`)"
              >
                📂 在浏览器打开
              </button>
              <p class="bo-cmd">
                或在终端跑：<br />
                <code>git clone https://github.com/{{ selectedRepo.id }}.git electron/models-library/{{ selectedRepo.id.split('/').pop() }}</code>
              </p>
            </div>
          </div>

          <!-- HuggingFace 一键装 -->
          <div v-else-if="assetsLoading && assets.length === 0" class="placeholder">
            <p>📦 列资源中…</p>
          </div>
          <div v-else-if="assets.length === 0" class="placeholder">
            <p>暂无可装资源（HF API 无返回或全 < 1MB）</p>
          </div>
          <div v-else class="asset-grid">
            <div
              v-for="a in assets"
              :key="a.path"
              class="asset-card"
              :class="{ installed: installedCache[a.path] }"
            >
              <div class="ac-name" :title="displayName(a)">{{ displayName(a) }}</div>
              <div class="ac-size">{{ formatBytes(a.size) }}</div>

              <div v-if="progressForAsset(a.path)" class="ac-progress">
                <div
                  class="ac-bar"
                  :style="{ width: progressForAsset(a.path)!.percent + '%' }"
                />
                <span class="ac-stage">
                  {{ progressForAsset(a.path)!.stage }} {{ progressForAsset(a.path)!.percent }}%
                </span>
                <button class="cancel" @click="cancelInstall(a.path)">✕</button>
              </div>

              <div v-else-if="installedCache[a.path]" class="ac-done">
                ✓ 已安装
              </div>
              <button v-else class="ac-install" @click="installOne(a)">
                ⬇ 安装
              </button>
            </div>
          </div>
        </div>

        <!-- 永远显示底部：自定义 URL 安装入口 -->
        <div class="custom-url">
          <h4>📥 自定义 URL 安装</h4>
          <p class="hint">
            从 booth.pm / huggingface 任意 repo / 个人服务器 拷一个 .zip 链接进来直接装。
            {{ subTab === 'rvc' ? '需含 .pth + .index' : '需含 .model3.json' }}
          </p>
          <div class="cu-row">
            <input
              v-model="customUrl"
              type="text"
              placeholder="https://hf-mirror.com/.../something.zip"
              class="cu-input"
              @keydown.enter="installCustom"
            />
            <button class="cu-btn" :disabled="!customUrl || customInstalling" @click="installCustom">
              ⬇ 装
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.online-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.sub-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 24px;
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
}
.sub {
  padding: 7px 16px;
  border-radius: 999px;
  background: oklch(96% 0.01 250 / 0.5);
  font-size: 12px; font-weight: 500;
  color: oklch(45% 0.05 250);
  transition: all 150ms;
}
.sub:hover { background: oklch(93% 0.025 250 / 0.7); }
.sub.active {
  background: oklch(55% 0.2 250);
  color: white;
}

.body {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 14px;
  padding: 14px 24px 24px;
  overflow: hidden;
}

.repo-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.repo-list h4 {
  margin: 0 0 4px;
  font-size: 12px;
  color: oklch(50% 0.05 250);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.repo-card {
  padding: 10px 12px;
  border-radius: 10px;
  background: oklch(97% 0.01 250 / 0.6);
  border: 1.5px solid oklch(90% 0.01 250 / 0.4);
  text-align: left;
  cursor: pointer;
  transition: all 150ms;
}
.repo-card:hover {
  background: oklch(95% 0.02 250 / 0.7);
}
.repo-card.active {
  background: linear-gradient(135deg, oklch(95% 0.04 250 / 0.8), oklch(93% 0.05 280 / 0.7));
  border-color: oklch(55% 0.2 250);
}
.rc-name {
  font-size: 13px; font-weight: 600;
  color: oklch(25% 0.08 250);
  margin-bottom: 4px;
}
.rc-desc {
  font-size: 11px;
  color: oklch(45% 0.05 250);
  line-height: 1.4;
  margin-bottom: 4px;
}
.rc-id {
  font-size: 10px;
  font-family: monospace;
  color: oklch(55% 0.04 250);
  opacity: 0.7;
}
.empty {
  padding: 20px;
  text-align: center;
  color: oklch(55% 0.04 250);
  font-size: 12px;
}

.assets {
  overflow-y: auto;
  padding-right: 4px;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: oklch(55% 0.04 250);
  font-size: 13px;
}
.ph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ph-head h3 { margin: 0; font-size: 16px; }
.hf-link {
  font-size: 11px;
  color: oklch(55% 0.18 250);
  text-decoration: none;
  font-family: monospace;
}
.hf-link:hover { text-decoration: underline; }
.ghost {
  padding: 6px 12px;
  border-radius: 8px;
  background: oklch(96% 0.01 250 / 0.6);
  font-size: 12px;
  color: oklch(40% 0.05 250);
}
.hint {
  font-size: 11px;
  color: oklch(50% 0.05 250);
  padding: 6px 10px;
  background: oklch(96% 0.025 80 / 0.4);
  border-radius: 6px;
  border-left: 3px solid oklch(70% 0.1 80);
  margin: 8px 0 14px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.asset-card {
  padding: 12px;
  border-radius: 10px;
  background: oklch(98% 0.005 250 / 0.6);
  border: 1.5px solid oklch(90% 0.01 250 / 0.4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asset-card.installed {
  background: linear-gradient(135deg, oklch(95% 0.04 145 / 0.3), oklch(94% 0.03 180 / 0.3));
  border-color: oklch(55% 0.15 145);
}
.ac-name {
  font-size: 12px;
  font-weight: 500;
  color: oklch(25% 0.08 250);
  word-break: break-all;
  line-height: 1.3;
  flex: 1;
}
.ac-size {
  font-size: 10px;
  font-family: monospace;
  color: oklch(55% 0.04 250);
}

.ac-install {
  padding: 6px 12px;
  background: oklch(55% 0.2 250);
  color: white;
  border-radius: 6px;
  font-size: 12px; font-weight: 600;
  margin-top: 4px;
}
.ac-install:hover { background: oklch(50% 0.22 250); }
.ac-done {
  padding: 6px 12px;
  background: oklch(94% 0.06 145 / 0.5);
  color: oklch(40% 0.18 145);
  border-radius: 6px;
  font-size: 12px; font-weight: 600;
  text-align: center;
}

.ac-progress {
  position: relative;
  margin-top: 4px;
  height: 26px;
  background: oklch(94% 0.02 250 / 0.5);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  font-size: 10px;
}
.ac-bar {
  position: absolute; left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, oklch(70% 0.15 250 / 0.5), oklch(65% 0.18 280 / 0.6));
  transition: width 300ms ease;
}
.ac-stage {
  position: relative; z-index: 1;
  color: oklch(35% 0.08 250);
  font-family: monospace;
}
.cancel {
  position: relative; z-index: 1;
  width: 18px; height: 18px; border-radius: 999px;
  font-size: 11px;
  color: oklch(50% 0.15 25);
  background: oklch(100% 0 0 / 0.7);
}
.cancel:hover { background: oklch(94% 0.1 25 / 0.8); }

/* browse_only 卡片 */
.browse-only { margin-top: 12px; }
.bo-card {
  padding: 18px 22px;
  background: oklch(96% 0.025 80 / 0.4);
  border: 1px solid oklch(85% 0.05 80 / 0.5);
  border-radius: 12px;
}
.bo-icon { font-size: 32px; margin-bottom: 8px; }
.bo-title {
  font-size: 14px; font-weight: 600;
  color: oklch(35% 0.1 80);
  margin-bottom: 8px;
}
.bo-desc { font-size: 12px; color: oklch(40% 0.05 250); margin: 8px 0 4px; }
.bo-list {
  margin: 0 0 14px 18px;
  padding: 0;
  font-size: 12px;
  line-height: 1.7;
  color: oklch(35% 0.04 250);
}
.bo-list code {
  font-family: monospace;
  padding: 1px 6px;
  background: oklch(94% 0.02 250 / 0.6);
  border-radius: 4px;
}
.bo-cmd {
  margin-top: 10px;
  font-size: 11px;
  color: oklch(50% 0.04 250);
}
.bo-cmd code {
  display: inline-block;
  padding: 6px 10px;
  background: oklch(20% 0.02 250 / 0.85);
  color: oklch(95% 0.005 250);
  border-radius: 6px;
  font-family: monospace;
  margin-top: 4px;
  user-select: text;
  word-break: break-all;
}

/* 自定义 URL */
.custom-url {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px dashed oklch(85% 0.01 250 / 0.5);
}
.custom-url h4 {
  margin: 0 0 4px;
  font-size: 13px;
  color: oklch(30% 0.08 250);
}
.cu-row { display: flex; gap: 8px; margin-top: 8px; }
.cu-input {
  flex: 1;
  padding: 7px 12px;
  border: 1px solid oklch(85% 0.02 250 / 0.5);
  border-radius: 8px;
  background: oklch(99% 0.002 250);
  font-size: 12px;
  font-family: monospace;
}
.cu-btn {
  padding: 7px 18px;
  background: oklch(55% 0.2 250);
  color: white;
  border-radius: 8px;
  font-size: 12px; font-weight: 600;
}
.cu-btn:disabled {
  background: oklch(80% 0.05 250);
  cursor: not-allowed;
}
</style>
