# RFC 0001 — TypeScript Tier 3 严格化

**作者**: LUVU ralphinho pipeline · 2026-05-18
**Tier**: 2（multi-file behavior preservation）
**状态**: ACTIVE

---

## Goal

让 `electron/` 项目通过 TypeScript Tier 3 严格模式编译，**保证**所有现有行为不变。

### 量化指标

| 指标 | 当前 | 目标 |
|------|----|-----|
| `: any` + `as any` 用量 | 15 | **0** |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | 6 | **0** |
| `strict: true` | ✓ | ✓（保持） |
| `noUncheckedIndexedAccess` | ❌ | **✓** |
| `exactOptionalPropertyTypes` | ❌ | **✓** |
| `noImplicitReturns` | ❌ | **✓** |
| `noImplicitOverride` | ❌ | **✓** |
| `pnpm typecheck` | ✓ | ✓ |
| `pnpm build` | ✓ | ✓ |

## Non-Goals

- 不重构业务逻辑
- 不改运行时行为（npm test / E2E 通过）
- sidecar Python 不在范围
- 不动 `node_modules` / 第三方 .d.ts

## Constraints

- 每个 work unit 必须 `pnpm typecheck` + `pnpm build` 通过才算 DONE
- Final 必须通过 santa-loop 双 reviewer NICE
- 不动 linter / tsconfig rule 来"绕过"问题（plankton 风险）— 只改业务代码
- 用 `unknown` + type narrowing 替 `any`，不允许换写法但语义等价的"灰色 any"

## Risk

| 风险 | 等级 | 缓解 |
|------|------|------|
| 严格选项打开后炸出 100+ 错误 | 高 | U1 先 dry-run 收集清单，按文件维度拆 unit 不并行 |
| 修 type 改变运行时（如 narrow 过头） | 中 | 每 unit `pnpm build` 验证；santa-loop 重点查行为保持 |
| 拼写改动引入 typo（如 rename field） | 中 | 不准 rename，只准加 type / 改 cast |
| 流式 IPC handler 的 `evt.sender.send` 类型签名变 | 低 | shared/api.ts 集中改 |

## Rollback Plan

`git checkout main -- electron/tsconfig*.json electron/src/`
按 unit 粒度的 commit 可单独 revert。

---

## DAG (Decomposition)

```
U1 (config) ─┬─→ U2 (shared/types & api)
             ├─→ U3 (main/services)
             ├─→ U4 (main/ipc)
             ├─→ U5 (preload)
             └─→ U6 (renderer/avatar + brain + presence + infra)
                    │
                    └─→ U7 (final integration + santa-loop)
```

**串行依赖**：U1 → 所有；U2-U6 内部可并行但都依赖 U1；U7 等所有完成。

实际跑：U1 → U2 → U3 → U4 → U5 → U6 → U7（保险串行，避免相邻 unit 改同一文件冲突）。

---

## Work Units

### U1: tsconfig 严格化 + 收集错误清单
- **scope**: 改 `tsconfig.node.json` + `tsconfig.web.json` 加 4 个严格选项
- **acceptance_tests**:
  - `pnpm typecheck` 失败（预期）
  - 错误清单存到 `docs/rfcs/0001-error-baseline.txt`，按文件分组统计
- **risk_level**: Tier 1（只改 config）
- **rollback_plan**: `git checkout -- electron/tsconfig*.json`

### U2: shared/ 修复
- **depends_on**: U1
- **scope**: `electron/src/shared/` 下所有 `.ts`
- **acceptance_tests**:
  - 该路径 0 个 `any`/`@ts-ignore`
  - 该路径所有 typecheck 错误清零
  - `pnpm typecheck` 在 shared/ 范围 0 错误

### U3: main/services/ 修复
- **depends_on**: U1, U2
- **scope**: `electron/src/main/services/` 下所有 `.ts`
- **acceptance_tests**: 同 U2

### U4: main/ipc/ + main/index 修复
- **depends_on**: U1, U2, U3
- **scope**: `electron/src/main/ipc/` + `main/index.ts` + `main/windows/`
- **acceptance_tests**: 同 U2

### U5: preload 修复
- **depends_on**: U1, U2
- **scope**: `electron/src/preload/`
- **acceptance_tests**: 同 U2

### U6: renderer 修复
- **depends_on**: U1-U5
- **scope**: `electron/src/renderer/` 全部 `.ts` + `.vue`
- **acceptance_tests**: 同 U2

### U7: 集成 + santa-loop
- **depends_on**: U1-U6
- **scope**: 全项目最终验证
- **acceptance_tests**:
  - `pnpm typecheck` ✓
  - `pnpm build` ✓
  - 全项目 `: any` 出现 ≤ shared/types 里被 `unknown` cast 必要场景（< 3 处可解释的）
  - `@ts-ignore` = 0
  - **santa-loop 双 reviewer 都 NICE**

---

## Quality Pipeline per Unit

按 ralphinho SKILL 阶段：

1. **research** — `grep` 该路径下 `any` / `@ts-ignore` / new error
2. **implementation plan** — 列改动 file:line 清单
3. **implementation** — 改代码（每个 file 一组）
4. **tests** — `pnpm typecheck` + `pnpm build`
5. **review** — `code-reviewer` agent 看本 unit diff
6. **merge-ready report** — 简短 commit message

---

## Merge Queue

- 不并行 — U1→U7 顺序
- 每 unit 完成跑 typecheck + build 才进下个
- 失败：止步当前 unit，规约错误重新拆，**不进下个**

---

## Final Verification (U7)

```bash
# 量化指标全数验证
pnpm typecheck                                      # ✓
pnpm build                                          # ✓
grep -rEn ":\s*any\b|as\s+any\b" electron/src      # ≤ 3 + 解释
grep -rEn "@ts-ignore|@ts-expect-error" electron/src # 0
```

然后 `/santa-loop` 双 reviewer 审最终 diff，都 NICE 后 commit + push。
