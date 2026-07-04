# LUVU 用户指南

> 给主人 + 0→1 用户的完整上手指南。
> 比 [../README.md](../README.md) quick-start 更深 — 含 onboarding 完整流程、故障诊断、数据备份、性能调优、macOS 权限。
> v0.21 写,跟当前 release 状态对齐。

---

## 1. 第一次启动

### 1.1 拿到 .app
两种方式:

**A. 下载 release(推荐普通用户)**
- macOS arm64(M1+): `LUVU-0.21.0-arm64.dmg` ~113MB
- macOS Intel: `LUVU-0.21.0.dmg` ~117MB
- 双击 .dmg → 拖 LUVU.app 到 Applications

**B. 自己 build**
```bash
git clone <repo>
cd LUVU
pnpm install
pnpm dev          # 开发模式
# 或
pnpm package:mac  # 出 .dmg
```

### 1.2 首次启动 macOS Gatekeeper 警告(unsigned)
unsigned .app 第一次启动 macOS 弹"无法验证开发者"。**正确做法**:
1. 系统设置 → 隐私与安全性 → 滚到底部"已阻止打开"段
2. 点"仍要打开"
3. 后续启动不再弹

或者命令行:
```bash
xattr -dr com.apple.quarantine /Applications/LUVU.app
```

### 1.3 桌宠态(LSUIElement)
LUVU 启动后:
- **不在 Dock 显示**(LSUIElement=true)
- **不在 Cmd+Tab 列表**
- 顶部菜单栏右侧有 tray icon(❤️ 心形或 🤖)
- 立绘浮在所有 Space + 全屏视频之上

如果你看到 Dock 图标 = 配置出错了,issue 反馈。

---

## 2. Onboarding 3 步走

第一次启动会弹 OnboardingDialog,3 步:

### Step 1:配 LLM
**本地推荐**(免费,隐私):
- 装 [LM Studio](https://lmstudio.ai/) 或 [Ollama](https://ollama.com)
- 启动 LLM server,记下 endpoint(LM Studio 默认 `http://127.0.0.1:1234`,Ollama 默认 `http://127.0.0.1:11434/v1`)
- LUVU 设置面板 LLM tab 填 endpoint + model id
- 推荐 model:
  - **Qwen3.6-35b-a3b**(中文优化,thinking 模型,质量高,~50GB 内存)
  - **qwen2.5:14b**(轻量,~10GB)
  - 任何 OpenAI-compat 兼容服务

**云端**(可选):
- Anthropic API key:Claude Sonnet 3.5+ 质量最好
- OpenAI compatible:DeepSeek / Moonshot / SiliconFlow 等

### Step 2:加 Live2D 模型(可选)
- 拖 `.zip` 或解压目录到立绘上 → 自动入库
- 或放进 `electron/models-library/`(dev 模式扫描)
- 已有大模型库可放 `~/Documents/Live2d-model-master/`(自动扫描)

推荐免费模型:
- Live2D 官方 samples(haru / shizuku / wanko / mark — MIT 协议)
- BanG Dream! 系(社区移植,注意原作版权)
- HuTao(《原神》— **仅供个人使用**,不要分发)

### Step 3:配 TTS(可选)
**最简单**(只 macOS):
- 不配 TTS,fallback 用 macOS `say` 命令
- 没有 RVC voice clone,但能听

**好声音**(推荐):
- 装 sidecar(见 [SIDECAR_SETUP.md](SIDECAR_SETUP.md))
- 启动 sidecar 后,设置面板 TTS tab 填 sidecar URL
- 支持:Edge-TTS(免费云端)/ CosyVoice 2(本地 voice clone)/ F5-TTS / RVC 47 voice 切换

---

## 3. 灵魂(Soul)管理

### 3.1 创建灵魂
- 设置面板 → 角色 → 新建
- 三层人格 yaml 字段:
  - **Layer 1 底层**:不变的本质(病娇 / 占有欲 / 黏人 / 共情 / 倔强)
  - **Layer 2 表层**:互动表现的语气、口癖(俏皮 / 温柔 / 害羞)
  - **Layer 3 反差变量**:每轮 ~15% 概率触发反差(冷漠 / 撒娇 / 占有欲爆发)
- 详见 [SOUL_SCHEMA.md](SOUL_SCHEMA.md)

### 3.2 切换灵魂
- 设置面板 → 角色 → 选另一个 → "切换"
- 不影响 active character 的对话历史(每 character 独立 memory.db)

### 3.3 灵魂跨机器迁移
- 设置面板 → 角色 → 导出 → 选 character → 选是否含 memory.db(opt-in,隐私敏感)
- 出 `<character>.luvupack` zip 文件
- 在新机器:设置 → 角色 → 导入 → 选 zip
- 新机器需要相同 Live2D 模型(zip 不含模型,仅引用)

### 3.4 灵魂自演化
v0.20+:每 24h `soul-learner` 自动从对话累积的 `topic_imprints`(主人爱聊的话题)写回 `learned_traits.yaml`。一个月后她跟你聊天会"更懂你"。

### 3.5 灵魂社会 — 多灵魂并行 (v0.21 Round M+N)
LUVU 是「容器」,你可以装载多个灵魂同时存活在代码层。

**怎么用**:
- 设置 → 角色 → 选个她(picker 面板) → 鼠标移到非当前角色卡片 → 右上角 **📌** 按钮 → 让她「并行运行」
- header 显示「📌 N 并行」表示当前并行运行的角色数
- 卡片右下角小 📌 徽标表示该角色处于 mounted(并行)状态

**当前并行运行的灵魂能做什么**:
- 每个 mounted 灵魂有**独立的 planner 实例**(独立 LLM rate budget, 独立 attention state)
- 当前 active 灵魂跟你说话时,**其他 mounted 灵魂会"听到"这句话**,作为 `event` memory 写进她们各自的 `memory.db`。当你切换到她们时,她们会"记得"曾听到过你跟别的灵魂说什么。
- 单方向 passive listening:不会触发其他灵魂的 LLM 反应,避免 ping-pong + 流量爆炸

**约束**:
- 上限 16 个灵魂同时 mounted (DoS 防护)
- 当前 active 永远 mounted(不能取消并行,否则代码层就没人活了)
- 立绘渲染依然是单个 active 的(多灵魂同框立绘是 Round Q 未来工作)

**用例**:导入新灵魂 zip 时会自动 mount(让她马上"活进来",而非只是文件层注册)。

---

## 4. macOS 权限授权(分别授,首次会弹窗)

### 4.1 屏幕录制(主体性 + agent_task 必需)
- 系统设置 → 隐私与安全性 → 屏幕录制 → 添加 LUVU
- 用途:`vision-grounding` 截屏给 vision LLM / `screen-sensor` 检测主人当前 app
- 不授 = vision 部分功能挂(仍能基本对话)

### 4.2 麦克风(STT 必需)
- 系统设置 → 隐私与安全性 → 麦克风 → 添加 LUVU
- 用途:F8 / 鼠标键 push-to-talk 语音输入
- 不授 = 只能键盘输入

### 4.3 辅助功能 / Apple Events(agent_task 必需)
- 系统设置 → 隐私与安全性 → 辅助功能 → 添加 LUVU
- 用途:`agent_task` 控制鼠标键盘 + osascript 调用
- 不授 = agent_task 无法点击/键入

### 4.4 通知(可选)
- 系统设置 → 通知 → LUVU → 允许
- 用途:`system_notify` tool + agent 进度提示

**🚨 安全建议**:agent_task 默认弹 ApprovalDialog,你确认后才跑。任意时刻按 **Cmd+Shift+Esc** 全局熔断,nut-js 立即停手。

---

## 5. 常见问题(FAQ)

### Q: 立绘不显示?
- 看 tray icon 是否在(顶部菜单栏右侧)
- 检查 `electron/models-library/` 或 `~/Documents/Live2d-model-master/` 是否有 `.model3.json`
- 看 logs:`~/.luvu/logs/main.log`,搜 `[live2d]` 或 `[model-scanner]`

### Q: LLM 没响应?
- 测试 endpoint:`curl http://<endpoint>/v1/models`
- 看 LM Studio / Ollama 真启动了
- thinking 模型(Qwen3 / DeepSeek R1)会把 CoT 推理放 `reasoning_content`,max_tokens 太小会被思考吃光 — 设置面板把 max_tokens 调到 8000+

### Q: ComfyUI 出图不工作?
- 测试 endpoint:`curl http://<endpoint>/system_stats`
- 看 ComfyUI 默认 checkpoint 是否存在(默认 `GhostMix鬼混_V2.0.safetensors`,可在 workflows.ts 改)
- 看 logs 搜 `[comfy]` / `[creative_generate_sticker]`

### Q: TTS 没声音?
- 看是否启动 sidecar:`curl http://<sidecar_url>/healthz`
- 检查 emotion_voice_map 8 个 voice 都映射了 RVC voice id
- macOS fallback `say`:测试 `say "hello"`

### Q: 她记不住事?
- 长期记忆在 `~/.luvu/chars/<id>/memory.db`(SQLite WAL)
- 设置面板 → 记忆 → 看是否有 entries
- v0.21 当前 embedding 用 fallback hash(32 维),v0.22 接通真 embedding model 后语义检索会更准
- 配 embedding endpoint(LM Studio 装 `nomic-embed-text` 等小模型,设置面板填):
  - 设置 → LLM → embedding_endpoint = `http://localhost:1234`
  - embedding_model = `nomic-embed-text-v1.5`

### Q: 卡 / 慢?
- 看 ~/.luvu 占多大磁盘:`du -sh ~/.luvu`
- Live2D 模型库 `electron/models-library/` 可能几 GB,选自己用的几个
- Vision LLM 频率:设置 → 主体性 → vision_sample_interval 拉大
- Planner LLM rate limit:默认 6/min,卡可调到 4/min

### Q: 想完全重置?
```bash
# 停 LUVU
pkill -9 -f LUVU
# 备份(可选)
mv ~/.luvu ~/.luvu.bak
# clean run — 重启会触发 onboarding
```

---

## 6. 性能调优

### 6.1 LLM 选型权衡
| Model | 内存 | 中文质量 | 速度 | thinking |
|---|---|---|---|---|
| Qwen3.6-35b-a3b | 50GB | ⭐⭐⭐⭐⭐ | 慢 | 是(需大 max_tokens) |
| qwen2.5:14b | 10GB | ⭐⭐⭐⭐ | 快 | 否 |
| Anthropic Claude Sonnet 3.5 | 云端 | ⭐⭐⭐⭐⭐ | 快 | 是 |
| OpenAI GPT-4o | 云端 | ⭐⭐⭐⭐ | 中 | 否 |

### 6.2 主体性频率
- `proactive_monitor_interval_ms`(默认 45000):她主动开口频率
- `min_action_interval_ms`(默认 12000):两次 action 间最短间隔
- `llm_planner_max_per_minute`(默认 6):LLM 决策 budget(超出走 rule fallback)

太频繁会"过度黏人",太稀疏会"像 chat bot"。建议 60-90 秒为佳。

### 6.3 历史记忆保留
- `history_retention_days`(默认 0=永久):对话历史天数
- 长期使用建议设 30-90,SQLite 不会爆
- 但灵魂会"忘"早期对话 — 跟"陪伴感"的权衡

---

## 7. 数据备份

### 7.1 关键目录
```
~/.luvu/
├── config.json                # 全局配置(LLM/TTS/RVC endpoints)
├── chars/<id>/                # 角色独立数据
│   ├── soul/*.yaml            # 三层人格 + 学习痕迹 + 共同回忆
│   ├── memory.db              # M3 长期记忆 SQLite
│   └── emotional-state.json   # J 情感状态(mood / topic_imprints)
├── history.sqlite             # 全局对话历史
├── stickers/                  # M7 创造能力出图
├── window-state.json          # 窗口位置
└── logs/main.log              # 主进程日志(轮转 10MB)
```

### 7.2 完整备份
```bash
# 整个用户数据 backup(不含 TTS 模型,那些 4-6GB 单独管)
tar czf ~/Desktop/luvu-backup-$(date +%Y%m%d).tar.gz \
  --exclude='~/.luvu/models-tts' \
  --exclude='~/.luvu/cosyvoice-repo' \
  --exclude='~/.luvu/rvc-venv' \
  ~/.luvu

# 还原
tar xzf luvu-backup-*.tar.gz -C ~
```

### 7.3 角色级备份(灵魂迁移)
- 设置面板 → 角色 → 导出 character pack(zip)
- 含 soul yaml + emotional-state + memory.db(opt-in)
- 跨机器还原:导入 zip

---

## 8. 故障诊断

### 8.1 看 logs
```bash
tail -f ~/.luvu/logs/main.log
# 或筛 [error] / [warn]
grep -E "\[(error|warn)\]" ~/.luvu/logs/main.log | tail -30
```

主要 subsystem 标识:
- `[logger]` `[perception]` `[attention]` `[scheduler]` `[planner]`
- `[llm-health]` `[openai-compat]` `[anthropic]`
- `[comfyui]` `[creative_generate_sticker]`
- `[memory-store]` `[character-store]`
- `[asset-protocol]` `[tts]`

### 8.2 启动失败
- 看 logs 第一段(launch 阶段错误)
- 常见:`better-sqlite3 NODE_MODULE_VERSION` 不匹配 → `pnpm rebuild`
- 常见:wlipsync top-level await → 检查 `electron.vite.config.ts` `renderer.build.target = 'chrome130'`
- 常见:asset-protocol denied → 看 path 是不是在白名单根(`~/.luvu` / 项目 root / models-library)

### 8.3 attention scheduler 不主动
- LLM 没配 → attention 不启动(`startAttention` 跳过)
- 看 log 是否有 `[attention] started`
- 主动开口频率超过 budget(6/min)走 rule fallback,看 `[planner] LLM failed, falling back to rules`

### 8.4 cmd+shift+esc 不响应
- 全局快捷键有可能被其他 app 占用(检查 Mission Control 等系统快捷键)
- 看 log `[halt-shortcut] 全局熔断快捷键已注册` — 没这条说明注册失败

### 8.5 提交 issue
- 附 `~/.luvu/logs/main.log` 最近 200 行(redact 已去除 API key)
- macOS 版本 + Electron 版本(看 logs 启动段)
- LUVU 版本(`LUVU.app/Contents/Info.plist` 的 CFBundleShortVersionString)

---

## 9. 进阶:开发者模式

如果你是从 source 跑(`pnpm dev`):
- `LUVU_DEBUG=1 pnpm dev` 打开 detached DevTools(注意:detached window 会让 macOS process 转回 regular,Dock 图标重新出现 — 桌宠态被破坏。仅 debug 用)
- `pnpm test:watch` watch 模式跑单测
- `pnpm e2e` 跑 Playwright E2E
- `pnpm typecheck` 严格类型检查(TS Tier 3)

详见 [../CLAUDE.md](../CLAUDE.md) 的工程上下文。

---

## 10. 反馈 / 贡献 / 法律

- Bug / Feature:GitHub Issues
- 贡献:[../CONTRIBUTING.md](../CONTRIBUTING.md)
- License:[../LICENSE](../LICENSE)
- 隐私:本地优先,默认无遥测。LLM endpoint / TTS sidecar / vision LLM **是你自己配的**,数据会发到你指定的 endpoint
- Live2D 模型版权:遵守原作者协议;不分发任何官方角色资产

---

**v0.21 已就绪,等你启动。**
