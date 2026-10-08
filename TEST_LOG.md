# TEST_LOG.md — LUVU

> 最后更新：2026-10-09

- 2026-08-27 项目管家文档治理：项目根目录收敛为 5 件套，旧文档归档。
- 2026-10-09 **M8 收口批（v0.22.0）**，全量验证在 Windows 工作机（Node 24.20）：

  **单测（vitest）**
  - 全量 `pnpm -r test`：**683 passed / 7 skipped / 0 failed**（52 文件；skip 为 SMOKE_TEST=1 门控的闭环/集成 smoke）
  - 新增 `avatar/layout.test.ts` Q3 视觉强调 4 例（active 满强度 / 非 active 后退档 / N=1 等价 / 数值合理域）
  - 新增 `services/comfyui/workflows.test.ts` 10 例（t2v DynamicCombo 点号键 + seed INT32 钳制 + SaveVideo 结构；i2v 节点链 + euler_ancestral 默认锁定；t2i/i2i/sticker/background 回归保护）
  - 新增 `services/comfyui/client.test.ts` 3 例（fetch 打桩：SaveVideo 输出收集、「完成但 0 输出」富错误、submit node_errors 快速失败）

  **typecheck**：`tsc -p tsconfig.node.json` + `vue-tsc -p tsconfig.web.json` 全绿。

  **E2E（Playwright，真 Electron）**
  - `launch.spec.ts` 2/2 passed（既有回归）
  - 新增 `e2e/multi-soul.spec.ts` passed：真 IPC 建 2 角色 → switch/setMounted → reload boot → 舞台多实例同框 → Q3 视觉档位断言 → active 热切换翻转 → 不崩（2.4s）
  - 备注：e2e 需要 `pnpm build` 先产出 out/；曾因 build 实际未执行（子进程 pnpm 不在 PATH 的假成功）误判「Electron exit 1」，与代码无关

  **真机 smoke（workstation ComfyUI LB `100.68.100.90:8188` 经 Tailscale，单后端 gpu0-alt / RTX PRO 6000 Blackwell 102GB；低强度单发，未动 LB 池配置）**
  - **i2v 端到端 PASS**：LUVU 真 builder 产物（CheckpointLoaderSimple wan2.2-i2v-rapid-aio-v10 + WanImageToVideo + KSampler(euler_ancestral) + SaveAnimatedWEBP）→ status success，出片 `luvu_i2v_*.webp`（animated，输出落 history 的 images 键，extractImages 可收）
  - i2v 关键发现：**uni_pc 采样器三次复现 cusolver INTERNAL_ERROR**（KSampler 阶段，显存充足仍崩，Blackwell sm_120 + 新 torch 栈上游问题）；euler_ancestral 同参数通过 → workflow 默认采样器已改并单测锁定
  - **t2v 验证到执行层**：DynamicCombo v1 点号键格式修复后通过全部校验（此前 400 required_input_missing model.duration/resolution/ratio；seed 超 INT32 也已修），提交后执行报 `Unauthorized: Please login first`——集群 ComfyUI 未登录 Comfy 账号（API 节点要求），属账号/成本决策非代码问题
  - 定位过程产物（/tmp 临时脚本，不入库）：最小 PNG 上传 + 真 builder TS 直跑（Node 24 type-stripping）
