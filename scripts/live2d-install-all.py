#!/usr/bin/env python3
"""
把 public/live2d/samples/ 下所有 30 个官方模型集中安装到 electron/models-library/。
- 命名：Live2D官方-<英文显示名>
- 自动补全 expressions 引用
- 幂等：已存在则跳过
- 最后输出绝对路径清单
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "public" / "live2d" / "samples"
DEST = ROOT / "electron" / "models-library"

# model_id → DisplayName
DISPLAY = {
    "chitose_pro":            "Chitose",
    "cubism4_hiyori_pro":     "Hiyori-MovieSrc",  # 工程源
    "cubism4_mark_pro":       "Mark-MovieSrc",    # 工程源
    "epsilon_free":           "Epsilon-free",
    "epsilon_pro":            "Epsilon",
    "gantzert_felixander_pro":"Gantzert-Felixander",
    "haru_greeter_pro":       "Haru-Greeter",
    "haru_pro":               "Haru",
    "hibiki_free":            "Hibiki",
    "hiyori_free":            "Hiyori-free",
    "hiyori_pro":             "Hiyori",
    "izumi_pro":              "Izumi",
    "kei":                    "Kei",
    "koharu_haruto_pro":      "Koharu-Haruto",
    "mao_pro":                "Mao",
    "mark_free":              "Mark",
    "miara_pro":              "Miara",
    "miku_cubism2_free":      "Miku-Cubism2",
    "miku_pro":               "Miku",
    "natori_pro":             "Natori",
    "nito_pro":               "Nito",
    "param_ctrl_pro":         "ParamCtrl-Demo",   # 工程源
    "ren_pro":                "Ren",
    "rice_pro":               "Rice",
    "shizuku_pro":            "Shizuku",
    "simple_free":            "Simple",
    "tororohijiki_pro":       "Tororo-Hijiki",
    "tsumiki_pro":            "Tsumiki",
    "unitychan_pro":          "Unitychan",
    "wanko_pro":              "Wanko",
}


def find_runtime_dir(model_id: str) -> Path | None:
    """优先返回含 .model3.json 的目录；找不到则返回任意包含 .cmo3 的（工程源）"""
    src = SAMPLES / model_id
    if not src.exists():
        return None
    runtime = list(src.rglob("*.model3.json"))
    if runtime:
        runtime.sort(key=lambda p: (len(p.parts), len(p.name)))
        return runtime[0].parent
    # 工程源（只有 .cmo3）
    cmo = list(src.rglob("*.cmo3"))
    if cmo:
        cmo.sort(key=lambda p: (len(p.parts), len(p.name)))
        return cmo[0].parent
    return None


def patch_expressions(model3_path: Path) -> int:
    data = json.loads(model3_path.read_text(encoding="utf-8"))
    fr = data.setdefault("FileReferences", {})
    if fr.get("Expressions"):
        return 0
    exp_dir = model3_path.parent / "expressions"
    if not exp_dir.exists():
        return 0
    exps = sorted([f.name for f in exp_dir.glob("*.exp3.json")])
    if not exps:
        return 0
    fr["Expressions"] = [
        {"Name": f.replace(".exp3.json", ""), "File": f"expressions/{f}"}
        for f in exps
    ]
    model3_path.write_text(json.dumps(data, indent="\t", ensure_ascii=False), encoding="utf-8")
    return len(exps)


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    installed: list[tuple[str, Path]] = []
    skipped: list[tuple[str, Path]] = []
    missing: list[str] = []
    is_editor_project: list[str] = []

    for model_id, display in DISPLAY.items():
        target = DEST / f"Live2D官方-{display}"
        src = find_runtime_dir(model_id)
        if not src:
            missing.append(model_id)
            continue
        if target.exists():
            skipped.append((f"Live2D官方-{display}", target))
            continue
        shutil.copytree(src, target)
        m3 = next(target.glob("*.model3.json"), None)
        if m3 is None:
            is_editor_project.append(f"Live2D官方-{display}")
        else:
            patch_expressions(m3)
        installed.append((f"Live2D官方-{display}", target))

    print(f"✅ 安装完成：{len(installed)} 新装 + {len(skipped)} 已存在")

    # 所有官方模型的最终绝对路径
    print(f"\n=== 全部 {len(installed) + len(skipped)} 个官方模型路径 ===\n")
    all_items = sorted(installed + skipped, key=lambda x: x[0])
    for name, path in all_items:
        m3 = next(path.glob("*.model3.json"), None)
        kind = "runtime" if m3 else "editor-project (.cmo3)"
        print(f"  {name}  [{kind}]")
        print(f"    {path}")

    if is_editor_project:
        print(f"\n⚠ Editor 工程包（仅 .cmo3，需 Cubism Editor 打开）: {is_editor_project}")

    if missing:
        print(f"\n✗ 源未找到: {missing}")

    print(f"\n📂 主目录: {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
