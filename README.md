# LUVU

硅基生命容器：Electron 桌面端。版本 0.21.0。维护中。

> 路径：ALLProject/LUVU；最后更新：2026-08-27

## 身份与远程

- origin: gitee.com/Winery_z/LUVU
- github backup: github.com/zhwangsir/LUVU

集群真相源：../ToIV/AGENTS.md

## 文档五件套

README / AGENTS / DEVELOPMENT / STATE.json / TEST_LOG。

旧 docs 与 CONTRIBUTING 等已归档到 ALLProject/.archive/docs-legacy-20260827/LUVU/。不要再点旧 README 里的 docs/*.md 链接。

## 四大支柱（0.21 口径，保留原 README 事实）

1. 灵魂可换：多角色 memory / 历史 / 立绘 / 语音；三层人格；跨机迁移；多灵魂并行（M8 partial）
2. 真控计算机：Planner → nut-js 鼠键 + vision + agent loop + 全局熔断
3. 创造：ComfyUI 出图/视频 → 桌面 sticker（t2i/i2i；t2v/i2v IPC 在但 workflow 未完全跑通，见 DEVELOPMENT）
4. 主体性：5 sensor → AttentionScheduler → BehaviorPlanner → BehaviorAction

## 五大域

avatar（Live2D + 透明置顶）/ brain（多 LLM provider + RAG）/ presence（TTS sidecar + RVC）/ hands（MotionFactory + agent + Comfy）/ attention（PerceptionBus）

## 启动

前置：Node >= 20，pnpm >= 9。可选 Python 3.10+ 给 TTS sidecar。

pnpm install 后 pnpm dev。根脚本还有 build / typecheck / test / package:mac|win|linux。

首次配本地 LLM；可选 Live2D 与 sidecar。默认灵魂在 soul/。LICENSE：MIT。

## 注意

默认无遥测。LLM/TTS/vision 走用户自配 endpoint。不分发角色资产。端口规划 36XX。push 时 origin 与 github 都推。

## 用户接触面（原 README 仍成立的部分）

- 资源商店：Live2D / RVC / 在线 repo 浏览安装
- 角色 picker：切灵魂；M8 mount 多灵魂并行入口
- 创作工坊（M7）：ComfyUI 出图 / 图生图 / 文生视频 / 图生视频（后两者 workflow 未完全跑通）
- 动作工坊：prompt → LLM 生成 motion3.json
- Spotlight、设置面板（LLM / TTS / RVC / vision / attention）

## 架构摘要

Renderer：Vue 3 + Pinia + PixiJS Live2D。Main：LLM 路由、SQLite per-character、PerceptionBus、ComfyUI client、agent loop。Sidecar（可选 Python）：edge-tts / CosyVoice / F5-TTS / RVC。

## 版本路线（DEVELOPMENT / 原 README）

M0-M6 完成；M7 创造完成；M8 灵魂社会 partial（后端+UI，Live2D 同框 GUI deferred）；M9/M10 规划中。

## 资源占用（原 README）

electron/models-library 可达数 GB；~/.luvu/chars 每角色 memory/history；sidecar venv 可选数 GB。

