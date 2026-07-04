#!/usr/bin/env python3
"""
把 Top 推荐的官方示例模型装进 electron/models-library/，让 LUVU 扫描发现。

- 从 public/live2d/samples/<id>/ 找 .model3.json 所在的 runtime 子树
- 复制到 electron/models-library/Live2D官方-<DisplayName>/
- 顺手补全 model3.json 的 Expressions 引用（很多官方模型默认没配）

跳过已存在的目标，幂等可重跑。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "public" / "live2d" / "samples"
DEST = ROOT / "electron" / "models-library"

RECOMMENDED = [
    ("haru_pro",      "Live2D官方-Haru"),
    ("tsumiki_pro",   "Live2D官方-Tsumiki"),
    ("natori_pro",    "Live2D官方-Natori"),
    ("mao_pro",       "Live2D官方-Mao"),
    ("epsilon_pro",   "Live2D官方-Epsilon"),
    ("hiyori_pro",    "Live2D官方-Hiyori"),
    ("kei",           "Live2D官方-Kei"),
    ("nito_pro",      "Live2D官方-Nito"),
]


def find_runtime_dir(model_id: str) -> Path | None:
    src = SAMPLES / model_id
    if not src.exists():
        return None
    candidates = list(src.rglob("*.model3.json"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: (len(p.parts), len(p.name)))
    return candidates[0].parent


def patch_expressions(model3_path: Path) -> int:
    data = json.loads(model3_path.read_text(encoding="utf-8"))
    fr = data.setdefault("FileReferences", {})
    if fr.get("Expressions"):
        return 0  # already configured
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
    model3_path.write_text(
        json.dumps(data, indent="\t", ensure_ascii=False),
        encoding="utf-8",
    )
    return len(exps)


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []
    skipped: list[str] = []
    missing: list[str] = []

    for model_id, display in RECOMMENDED:
        target = DEST / display
        if target.exists():
            skipped.append(display)
            continue
        src = find_runtime_dir(model_id)
        if not src:
            missing.append(model_id)
            continue
        shutil.copytree(src, target)
        # patch expressions if needed
        m3 = next(target.glob("*.model3.json"), None)
        added = patch_expressions(m3) if m3 else 0
        suffix = f" (+{added} expressions patched)" if added else ""
        installed.append(f"{display} ← {model_id}{suffix}")

    print("✅ 安装完成")
    if installed:
        print(f"\n新安装 ({len(installed)}):")
        for i in installed: print(f"  + {i}")
    if skipped:
        print(f"\n已存在跳过 ({len(skipped)}):")
        for s in skipped: print(f"  ~ {s}")
    if missing:
        print(f"\n源缺失 ({len(missing)}):")
        for m in missing: print(f"  ✗ {m}")

    print(f"\n下一步: 重启 dev 或在 UI 触发模型库刷新，应能看到 {len(installed) + len(skipped)} 个新候选")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
