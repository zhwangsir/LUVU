# Live2D 官方示例模型清单

> 自动生成 — 由 `scripts/live2d-inventory.py` 扫描 `public/live2d/samples/`
> 模型总数：**30**

## LUVU 身体候选推荐 Top 5

挑选标准：motion >= 3 且 expression >= 3 且配齐 physics。

| 模型 | motions | expressions | physics | pose | 参数数 | moc3 |
|---|---:|---:|:---:|:---:|---:|---:|
| **tsumiki_pro** | 23 | 10 | ✓ | - | 46 | 0.33 MB |
| **haru_pro** | 23 | 8 | ✓ | ✓ | 33 | 0.22 MB |
| **epsilon_pro** | 15 | 8 | ✓ | - | 37 | 0.2 MB |
| **epsilon_free** | 15 | 8 | ✓ | - | 30 | 0.18 MB |
| **natori_pro** | 8 | 11 | ✓ | ✓ | 96 | 0.74 MB |

## 运行时模型详情（可 Web 加载，共 27 个）

| 模型 | kind | moc3 | tex | motions | exp | physics | pose | cdi | 参数 | HitAreas |
|---|---|---:|---:|---:|---:|:---:|:---:|:---:|---:|---|
| `chitose_pro` | runtime+editor | 0.25 MB | 1 | 4 | 7 | ✓ | ✓ | ✓ | 33 | - |
| `epsilon_free` | runtime+editor | 0.18 MB | 1 | 15 | 8 | ✓ | - | ✓ | 30 | - |
| `epsilon_pro` | runtime+editor | 0.2 MB | 3 | 15 | 8 | ✓ | - | ✓ | 37 | - |
| `gantzert_felixander_pro` | runtime+editor | 1.21 MB | 7 | 6 | 0 | - | - | ✓ | 74 | - |
| `haru_greeter_pro` | runtime+editor | 0.37 MB | 2 | 27 | 0 | ✓ | ✓ | ✓ | 42 |  |
| `haru_pro` | runtime+editor | 0.22 MB | 3 | 23 | 8 | ✓ | ✓ | ✓ | 33 | - |
| `hibiki_free` | runtime+editor | 0.16 MB | 1 | 5 | 6 | ✓ | - | ✓ | 25 | - |
| `hiyori_free` | runtime+editor | 0.23 MB | 1 | 8 | 0 | ✓ | - | ✓ | 29 | Body |
| `hiyori_pro` | runtime+editor | 0.42 MB | 2 | 10 | 0 | ✓ | ✓ | ✓ | 70 | Body |
| `izumi_pro` | runtime+editor | 0.2 MB | 4 | 10 | 7 | ✓ | - | ✓ | 30 | - |
| `kei` | runtime+editor | 0.24 MB | 1 | 4 | 0 | ✓ | - | ✓ | 27 | Head |
| `koharu_haruto_pro` | runtime+editor | 0.27 MB | 1 | 11 | 0 | ✓ | - | ✓ | 51 | - |
| `mao_pro` | runtime+editor | 0.83 MB | 1 | 7 | 8 | ✓ | ✓ | ✓ | 128 |  |
| `mark_free` | runtime+editor | 0.12 MB | 1 | 6 | 0 | ✓ | - | ✓ | 21 | - |
| `miara_pro` | runtime+editor | 0.52 MB | 1 | 3 | 0 | ✓ | - | ✓ | 138 | - |
| `miku_cubism2_free` | runtime+editor | 0.2 MB | 1 | 8 | 0 | ✓ | - | ✓ | 30 | - |
| `miku_pro` | runtime+editor | 0.28 MB | 1 | 8 | 0 | ✓ | - | ✓ | 59 | - |
| `natori_pro` | runtime+editor | 0.74 MB | 1 | 8 | 11 | ✓ | ✓ | ✓ | 96 |  |
| `nito_pro` | runtime+editor | 0.23 MB | 2 | 21 | 0 | - | ✓ | ✓ | 66 | - |
| `ren_pro` | runtime+editor | 0.87 MB | 1 | 3 | 5 | ✓ | - | ✓ | 73 | Body,Head |
| `rice_pro` | runtime+editor | 0.46 MB | 2 | 4 | 0 | ✓ | - | ✓ | 96 |  |
| `shizuku_pro` | runtime+editor | 0.73 MB | 5 | 4 | 0 | ✓ | ✓ | ✓ | 45 | - |
| `simple_free` | runtime+editor | 0.02 MB | 1 | 1 | 0 | - | - | ✓ | 24 | - |
| `tororohijiki_pro` | runtime+editor | 0.2 MB | 1 | 9 | 0 | ✓ | ✓ | ✓ | 31 | - |
| `tsumiki_pro` | runtime+editor | 0.33 MB | 2 | 23 | 10 | ✓ | - | ✓ | 46 | - |
| `unitychan_pro` | runtime+editor | 0.18 MB | 1 | 16 | 0 | ✓ | - | ✓ | 39 | - |
| `wanko_pro` | runtime+editor | 0.1 MB | 1 | 12 | 0 | ✓ | - | ✓ | 25 | - |

## Editor 工程包（共 3 个 — 仅含 .cmo3，需 Editor 打开学习）

- `cubism4_hiyori_pro` — public/live2d/samples/cubism4_hiyori_pro
- `cubism4_mark_pro` — public/live2d/samples/cubism4_mark_pro
- `param_ctrl_pro` — public/live2d/samples/param_ctrl_pro

## Motion Group 分布

- **chitose_pro** (4 motions): `Flick`×1, `Idle`×1, `Tap`×2
- **epsilon_free** (15 motions): `Idle`×1, `FlickUp`×2, `Flick`×2, `Tap`×4, `Flick3`×2, `FlickDown`×2, `Shake`×2
- **epsilon_pro** (15 motions): `Idle`×1, `Tap`×4, `Flick3`×2, `FlickUp`×2, `FlickDown`×2, `Flick`×2, `Shake`×2
- **gantzert_felixander_pro** (6 motions): `Idle`×3, `Tap`×1, `FlickUp`×1, `FlickRight`×1
- **haru_greeter_pro** (27 motions): `(default)`×27
- **haru_pro** (23 motions): `Idle`×3, `Flick`×3, `Tap`×6, `FlickRight`×3, `Flick3`×3, `FlickLeft`×3, `Shake`×2
- **hibiki_free** (5 motions): `Idle`×3, `Flick`×1, `Tap`×1
- **hiyori_free** (8 motions): `Idle`×3, `Flick`×1, `FlickDown`×1, `Tap`×1, `Tap@Body`×1, `Flick@Body`×1
- **hiyori_pro** (10 motions): `Idle`×3, `Flick`×1, `FlickDown`×1, `FlickUp`×1, `Tap`×2, `Tap@Body`×1, `Flick@Body`×1
- **izumi_pro** (10 motions): `FlickRight`×2, `Tap`×3, `Idle`×3, `FlickLeft`×1, `Shake`×1
- **kei** (4 motions): `(default)`×4
- **koharu_haruto_pro** (11 motions): `Tap`×4, `FlickLeft`×1, `Idle`×3, `FlickUp`×1, `FlickDown`×1, `FlickRight`×1
- **mao_pro** (7 motions): `Idle`×1, `(default)`×6
- **mark_free** (6 motions): `Idle`×1, `Tap`×3, `FlickDown`×1, `FlickUp`×1
- **miara_pro** (3 motions): `Idle`×1, `Tap`×1, `Flick`×1
- **miku_cubism2_free** (8 motions): `Tap`×3, `Flick`×3, `Flick3`×1, `Idle`×1
- **miku_pro** (8 motions): `Idle`×3, `Tap`×2, `Flick`×2, `FlickUp`×1
- **natori_pro** (8 motions): `Idle`×3, `Tap`×1, `FlickUp@Head`×1, `Flick@Body`×1, `FlickDown@Body`×1, `Tap@Head`×1
- **nito_pro** (21 motions): `Idle`×4, `FlickUp`×3, `Tap`×5, `FlickDown`×2, `FlickRight`×1, `Flick3`×2, `FlickLeft`×2, `Shake`×2
- **ren_pro** (3 motions): `Idle`×1, `(default)`×2
- **rice_pro** (4 motions): `Idle`×1, `FlickLeft`×1, `Tap@Body`×1, `FlickUp`×1
- **shizuku_pro** (4 motions): `FlickUp`×1, `Tap`×1, `Flick3`×1, `Idle`×1
- **simple_free** (1 motions): `Tap`×1
- **tororohijiki_pro** (9 motions): `Idle`×3, `FlickUp`×1, `FlickDown`×1, `Tap`×3, `Flick`×1
- **tsumiki_pro** (23 motions): `Flick3`×4, `FlickDown`×3, `FlickUp`×3, `Tap`×5, `FlickRight`×2, `FlickLeft`×2, `Idle`×3, `Shake`×1
- **unitychan_pro** (16 motions): `Idle`×3, `FlickDown`×2, `FlickLeft`×1, `FlickRight`×1, `FlickUp`×3, `Shake`×1, `Flick3`×2, `Tap`×3
- **wanko_pro** (12 motions): `Idle`×3, `Flick3`×2, `Shake`×1, `FlickUp`×1, `Tap`×2, `Flick`×2, `FlickLeft`×1

## 备注与异常

- `cubism4_hiyori_pro`: 仅含 .cmo3 工程源 — 用 Cubism Editor 打开学习，无法直接 Web 加载
- `cubism4_mark_pro`: 仅含 .cmo3 工程源 — 用 Cubism Editor 打开学习，无法直接 Web 加载
- `haru_pro`: model3.json 未配 Expressions，但目录下有 exp3 文件
- `param_ctrl_pro`: 仅含 .cmo3 工程源 — 用 Cubism Editor 打开学习，无法直接 Web 加载

## 统计

- 模型总数：30 个（运行时 27 + Editor 工程 3）
- kind 分布：{'runtime+editor': 27, 'editor_project': 3}
- 运行时模型中配齐 physics：24 / 27
- 运行时模型中有 expression：10 / 27
- 运行时模型中有 motion：27 / 27
- 运行时平均 motion 数：10.0
- 运行时平均 expression 数：2.9
