# TTS Sidecar 安装与配置

> LUVU TTS Sidecar 的完整安装文档 — 各 backend(edge-tts / CosyVoice 2 / F5-TTS / RVC)的依赖、坑、启动。
> 不装 sidecar 也能用 LUVU(macOS `say` 兜底),但**没有 voice clone 和 嘴型动得不准**。
> v0.21 写,跟当前 `sidecar/qwen-tts-server` 真实状态对齐。

---

## 1. 环境要求

| 项 | 最低 | 推荐 |
|---|---|---|
| 操作系统 | macOS 11+ / Linux / Windows(WSL) | macOS 13+ Apple Silicon |
| Python | 3.10+ | 3.11 |
| 磁盘空间 | 1 GB(minimal) | **6-8 GB**(完整含 CosyVoice 模型) |
| 内存 | 4 GB | 8 GB+ |
| 网络 | 首次安装需联网下模型 | 同 |

**Apple Silicon(M1/M2/M3/M4)**:CosyVoice 用 MPS 后端,比 CPU 快 3-5x。

---

## 2. 一键安装

### 2.1 三种模式

| 命令 | 模式 | 装什么 | 时间 |
|---|---|---|---|
| `bash sidecar/install.sh` | 完整 | edge-tts + CosyVoice 2 + 模型 | 5-15 min |
| `bash sidecar/install.sh --minimal` | 最简 | 只 edge-tts(云端,无 GPU 推理) | 1-2 min |
| `bash sidecar/install.sh --reset` | 重置 | 删 venv 重装 | 同上 |

### 2.2 6 个 stages(install.sh 内部)

1. **检测 python3.10+** — 系统装的 python 必须 >=3.10
2. **创建 venv** — 在 `sidecar/qwen-tts-server/.venv/`(不污染系统 python)
3. **基础依赖** — `pip install -r requirements.txt`(FastAPI + uvicorn + edge-tts + faster-whisper)
4. **PyTorch + CosyVoice 依赖**(只完整模式)— modelscope / soundfile / librosa / transformers / onnxruntime
5. **clone CosyVoice 仓库** — `git clone --depth=1 https://github.com/FunAudioLLM/CosyVoice.git ~/.luvu/cosyvoice-repo`
6. **下载 CosyVoice2-0.5B 模型** — 从 modelscope 拉到 `~/.luvu/models-tts/cosyvoice2-0.5b`(~1.1 GB)

进度行解析:
- `[STEP]` 当前步骤
- `[OK]` 步骤完成
- `[FAIL]` 步骤失败 — 看 `~/.luvu/install.log` 全文

### 2.3 install.log 在哪
```bash
tail -f ~/.luvu/install.log
```

---

## 3. 启动 Sidecar

### 3.1 手动启动(开发)
```bash
cd sidecar/qwen-tts-server
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 5050
```

启动后看:
```
INFO:     Uvicorn running on http://127.0.0.1:5050
```

### 3.2 探活
```bash
curl http://127.0.0.1:5050/healthz
# 应返 {"ok": true, ...}
```

### 3.3 LUVU 设置面板填 URL
- 设置 → TTS → `tts_sidecar_url`(可填数组,自动 fallback):
  ```json
  ["http://127.0.0.1:5050"]
  ```
- 或多 endpoint:
  ```json
  ["http://192.168.71.100:5050", "http://127.0.0.1:5050"]
  ```

---

## 4. Backend 详解

### 4.1 edge-tts(默认 / 推荐)
- **优点**:免费云端 / 质量高 / 无 GPU 要求 / 中英文都好
- **缺点**:需联网 / 不是真 voice clone(选 voice 而非克隆样本)
- **可用 voice**:数百个,中文如 `zh-CN-XiaoxiaoNeural` / `zh-CN-YunyangNeural` / `zh-CN-XiaoyiNeural`

LUVU 用法:
- 设置 → TTS → `tts_provider` = `sidecar`(走 sidecar)或 `edge`(直接调 edge-tts)
- `emotion_voice_map` 8 情绪映射 8 个 voice id

### 4.2 CosyVoice 2(本地 voice clone)
- **优点**:本地推理(隐私)/ 真 voice clone(给一段样本就能克隆)
- **缺点**:首次 5-15 min 下载 / GPU 推理 / 1.1GB 模型 / 不能模拟所有口音
- **样本要求**:6-15 秒清晰人声 wav,中性情绪

LUVU 用法:
```bash
# 1. 启动 sidecar 后,通过 API 注册 voice 样本
curl -X POST http://127.0.0.1:5050/v1/audio/clone \
  -F "name=master-girlfriend" \
  -F "sample=@/path/to/sample.wav"

# 2. 设置 → RVC → rvc_voice 选 master-girlfriend
```

batch 注册整个目录:
```bash
curl -X POST http://127.0.0.1:5050/v1/audio/register-batch \
  -d '{"dir": "/path/to/voices"}'
```

每个子目录被识别为一个 voice。

### 4.3 F5-TTS(实验性)
- 速度快,zero-shot voice clone
- v0.21 当前 sidecar 提供了 backend slot,但默认未装 — 需要手动:
```bash
cd ~/.luvu
git clone https://github.com/SWivid/F5-TTS.git f5-tts-repo
cd f5-tts-repo && pip install -e .
```
然后修 sidecar `main.py` enable F5 backend。

### 4.4 RVC(声音转换 + 47 预训练 voice)
- v0.11 集成,47 个已训练 voice 可直接用
- 工作流:CosyVoice / Edge-TTS 出基础音 → RVC 转换音色

LUVU 用法:
- 设置 → RVC tab → 选 voice id(下拉 47 项)
- f0_up_key:音调升降(男声 → 女声通常 +12,女声 → 男声 -12)
- index_rate / protect / rms_mix_rate:微调参数,默认值通常够用

---

## 5. 嘴型同步

v0.21 用 **wlipsync**(AudioWorklet + 5 元音 AEIOU 权重),比 RMS 准。

TTS 出音频后:
1. renderer 解码 → Web Audio API
2. wlipsync AudioWorklet 实时分析 → 5 个元音权重
3. Live2D `ParamMouthOpenY` + `ParamMouthA/E/I/O/U` 联动
4. 嘴型真的"在说"而不是机械张合

如果嘴不动:
- 看 logs `[lipsync]`
- 看 `electron.vite.config.ts` renderer.build.target = 'chrome130'(wlipsync top-level await 需要)
- 看 audio context 状态(用户点击后才允许播,Chromium AudioContext autoplay policy)

---

## 6. STT(语音输入)

v0.21 用 **Web Speech API**(浏览器原生)+ **faster-whisper**(sidecar fallback)。

### 6.1 Web Speech API(推荐,无需 sidecar)
- macOS Safari engine 自带,免费云端识别
- 按 F8 或鼠标侧键 push-to-talk
- 中英文都支持
- 隐私:发到 Apple/Google 云,**不在本地**

### 6.2 faster-whisper(本地 sidecar)
- 完全本地,隐私
- sidecar v0.21 装了 `faster-whisper`,但 UI 路径还在 Web Speech 上
- 切换需在 settings.json 加 `stt_provider: 'sidecar'`(v0.22 计划)

---

## 7. 常见问题

### Q: install.sh 卡在 "下载 CosyVoice2-0.5B 模型"?
- modelscope 国内一般快,国外可能要科学上网
- 看 `~/.luvu/install.log` 实时进度
- 中断可重跑 `bash install.sh` 续传

### Q: sidecar 启动报 ImportError?
- venv 没激活:`source .venv/bin/activate`
- pip 版本旧:`pip install --upgrade pip setuptools wheel`
- requirements 没装全:`pip install -r requirements.txt`

### Q: TTS 出"没声音"或 "audio not playing"?
- macOS:看系统输出设备是不是对的
- Chromium AudioContext autoplay:第一次需要用户交互(点对话气泡或别处)激活
- 看 sidecar log:`curl http://127.0.0.1:5050/v1/audio/speech -d '{"text":"hello"}' --output test.mp3 && afplay test.mp3`

### Q: voice clone 不像?
- 样本质量:6-15s 清晰人声 / 单人 / 中性情绪 / 无背景音
- 样本太短(<5s)或太长(>30s)效果都差
- CosyVoice 训练数据中文为主,日韩英效果次之

### Q: 关 sidecar 后 LUVU 还能说话?
- macOS:fallback 用系统 `say` 命令(单一声音,不带感情)
- Windows/Linux:fallback 是 edge-tts(需要联网)

### Q: 怎么停 sidecar?
```bash
# 找 uvicorn 进程
ps aux | grep uvicorn | grep -v grep
# 或
lsof -i :5050
# kill
pkill -f "uvicorn main:app"
```

### Q: 怎么完全卸载?
```bash
# 停 sidecar
pkill -f "uvicorn main:app"
# 删 venv
rm -rf sidecar/qwen-tts-server/.venv
# 删 CosyVoice 仓库 + 模型(5-7 GB)
rm -rf ~/.luvu/cosyvoice-repo
rm -rf ~/.luvu/models-tts
```

---

## 8. embedding(M3 长期记忆,v0.22 计划)

v0.21 用 32 维 hash fallback embedding(可工作但语义不准)。
v0.22 计划接通真 embedding endpoint:

### 8.1 LM Studio 装 embedding model
- LM Studio v0.3+ 支持 embedding
- 推荐:`nomic-embed-text-v1.5`(~270MB)/ `BAAI/bge-small-zh-v1.5`(中文)
- LM Studio Developer 页 → load → 启用 server

### 8.2 LUVU 配
- 设置 → LLM → embedding_endpoint:
  ```
  http://127.0.0.1:1234
  ```
- embedding_model: `nomic-embed-text-v1.5`(LM Studio 模型 id)

### 8.3 验证
```bash
curl -X POST http://127.0.0.1:1234/v1/embeddings \
  -H "content-type: application/json" \
  -d '{"input": "测试", "model": "nomic-embed-text-v1.5"}'
# 应返 {"data": [{"embedding": [0.1, ...768 dim], ...}]}
```

v0.22 升级路径:[memory-extractor.ts:fallbackEmbedding](../electron/src/main/services/memory-extractor.ts) 实现替换,creative tool / soul-learner / dialog RAG 所有写入路径自动用真 embedding,RAG 检索语义化。

---

## 9. 性能基准(workstation 实测)

| 任务 | 硬件 | 耗时 |
|---|---|---|
| edge-tts 中文 50 字 | 任意(云端) | ~1.5s 含网络 |
| CosyVoice 2 中文 50 字 | M1 Max MPS | ~3s |
| CosyVoice 2 中文 50 字 | RTX 4090 CUDA | ~1s |
| RVC 转换 5s 音频 | M1 Max | ~0.5s |
| faster-whisper 中文 10s | M1 Max | ~2s |

---

## 10. 反馈

sidecar 是独立子项目,bug / 建议:
- 看 `sidecar/qwen-tts-server/README.md` 了解 API
- 提 issue 时附 `~/.luvu/install.log` 最后 200 行

---

**完整 TTS 链路:LLM 出 emotion → emotion_voice_map → sidecar TTS → RVC 转换 → 流式音频 → wlipsync 嘴型同步。**
