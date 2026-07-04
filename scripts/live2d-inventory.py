#!/usr/bin/env python3
"""
扫描 public/live2d/samples/ 下所有已解压模型，输出 inventory markdown。

为每个模型识别：
  - 主 .model3.json 文件
  - 模型版本（基于 .moc3 / .moc 后缀）
  - 贴图数量、motion 数量（按 group 分）、expression 数量、physics/pose/cdi/userdata 是否存在
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "public" / "live2d" / "samples"
OUT = ROOT / "docs" / "live2d" / "SAMPLES_INVENTORY.md"


def find_model3(model_dir: Path) -> Path | None:
    candidates = list(model_dir.rglob("*.model3.json"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: (len(p.parts), len(p.name)))
    return candidates[0]


def find_legacy_model(model_dir: Path) -> tuple[str, Path] | None:
    """识别 Cubism 2.x .model.json。"""
    for p in model_dir.rglob("*.model.json"):
        return ("cubism2", p)
    return None


def scan_model(model_id: str, model_dir: Path) -> dict:
    info: dict = {
        "id": model_id,
        "dir": str(model_dir.relative_to(ROOT)),
        "kind": "unknown",
        "model3_json": None,
        "version": "unknown",
        "moc3_size_mb": 0.0,
        "textures": 0,
        "motion_groups": {},
        "motions_total": 0,
        "expressions": 0,
        "has_physics": False,
        "has_pose": False,
        "has_cdi": False,
        "has_userdata": False,
        "param_count": 0,
        "hit_areas": [],
        "notes": [],
    }

    has_cmo3 = any(model_dir.rglob("*.cmo3"))
    m3 = find_model3(model_dir)
    legacy = None

    if m3:
        info["model3_json"] = str(m3.relative_to(ROOT))
        info["version"] = "cubism4+"
        info["kind"] = "runtime+editor" if has_cmo3 else "runtime"
    else:
        legacy = find_legacy_model(model_dir)
        if legacy:
            info["version"] = legacy[0]
            info["model3_json"] = str(legacy[1].relative_to(ROOT))
            info["kind"] = "runtime_legacy"
        elif has_cmo3:
            info["kind"] = "editor_project"
            info["notes"].append("仅含 .cmo3 工程源 — 用 Cubism Editor 打开学习，无法直接 Web 加载")
            return info
        else:
            info["notes"].append("空目录或非标准结构")
            return info

    model_root = (m3 if m3 else legacy[1]).parent

    try:
        if m3:
            data = json.loads(m3.read_text(encoding="utf-8"))
            file_refs = data.get("FileReferences", {})
            moc_rel = file_refs.get("Moc")
            if moc_rel:
                moc_path = (model_root / moc_rel)
                if moc_path.exists():
                    info["moc3_size_mb"] = round(moc_path.stat().st_size / 1024 / 1024, 2)
            info["textures"] = len(file_refs.get("Textures") or [])
            motions = file_refs.get("Motions") or {}
            for group, arr in motions.items():
                info["motion_groups"][group] = len(arr)
            info["motions_total"] = sum(info["motion_groups"].values())
            info["expressions"] = len(file_refs.get("Expressions") or [])
            info["has_physics"] = "Physics" in file_refs
            info["has_pose"] = "Pose" in file_refs
            info["has_cdi"] = "DisplayInfo" in file_refs
            info["has_userdata"] = "UserData" in file_refs
            hit_areas = data.get("HitAreas") or []
            info["hit_areas"] = [h.get("Name", "?") for h in hit_areas]
            # 参数数量需要从 cdi3.json 或运行时获取；这里查 cdi3.json
            cdi_rel = file_refs.get("DisplayInfo")
            if cdi_rel:
                cdi_path = model_root / cdi_rel
                if cdi_path.exists():
                    try:
                        cdi = json.loads(cdi_path.read_text(encoding="utf-8"))
                        info["param_count"] = len(cdi.get("Parameters") or [])
                    except Exception:
                        pass
    except Exception as e:
        info["notes"].append(f"解析 model3.json 失败: {e}")

    # 兜底：直接数 .motion3.json / .exp3.json 文件
    if info["motions_total"] == 0:
        motion_files = list(model_root.rglob("*.motion3.json"))
        info["motions_total"] = len(motion_files)
        if motion_files:
            info["notes"].append("model3.json 未配 Motions，但目录下有 motion3 文件")
    if info["expressions"] == 0:
        exp_files = list(model_root.rglob("*.exp3.json"))
        if exp_files:
            info["expressions"] = len(exp_files)
            info["notes"].append("model3.json 未配 Expressions，但目录下有 exp3 文件")

    return info


def main() -> None:
    if not SAMPLES.exists():
        print(f"❌ {SAMPLES} 不存在")
        return

    models = []
    for sub in sorted(SAMPLES.iterdir()):
        if not sub.is_dir() or sub.name.startswith("_"):
            continue
        models.append(scan_model(sub.name, sub))

    lines: list[str] = []
    lines.append("# Live2D 官方示例模型清单")
    lines.append("")
    lines.append("> 自动生成 — 由 `scripts/live2d-inventory.py` 扫描 `public/live2d/samples/`")
    lines.append(f"> 模型总数：**{len(models)}**")
    lines.append("")

    runtime_models = [m for m in models if m["kind"] != "editor_project"]
    editor_only = [m for m in models if m["kind"] == "editor_project"]

    # 推荐区
    recs = sorted(
        [m for m in runtime_models if m["motions_total"] >= 3 and m["expressions"] >= 3 and m["has_physics"]],
        key=lambda m: (-m["motions_total"] - m["expressions"], -m["param_count"]),
    )[:5]
    if recs:
        lines.append("## LUVU 身体候选推荐 Top 5")
        lines.append("")
        lines.append("挑选标准：motion >= 3 且 expression >= 3 且配齐 physics。")
        lines.append("")
        lines.append("| 模型 | motions | expressions | physics | pose | 参数数 | moc3 |")
        lines.append("|---|---:|---:|:---:|:---:|---:|---:|")
        for m in recs:
            lines.append(
                f"| **{m['id']}** | {m['motions_total']} | {m['expressions']} | "
                f"{'✓' if m['has_physics'] else '-'} | {'✓' if m['has_pose'] else '-'} | "
                f"{m['param_count']} | {m['moc3_size_mb']} MB |"
            )
        lines.append("")

    # 运行时可加载模型详情
    lines.append(f"## 运行时模型详情（可 Web 加载，共 {len(runtime_models)} 个）")
    lines.append("")
    lines.append("| 模型 | kind | moc3 | tex | motions | exp | physics | pose | cdi | 参数 | HitAreas |")
    lines.append("|---|---|---:|---:|---:|---:|:---:|:---:|:---:|---:|---|")
    for m in runtime_models:
        ha = ",".join(h for h in m["hit_areas"] if h) if m["hit_areas"] else "-"
        lines.append(
            f"| `{m['id']}` | {m['kind']} | {m['moc3_size_mb']} MB | {m['textures']} | "
            f"{m['motions_total']} | {m['expressions']} | "
            f"{'✓' if m['has_physics'] else '-'} | {'✓' if m['has_pose'] else '-'} | "
            f"{'✓' if m['has_cdi'] else '-'} | "
            f"{m['param_count']} | {ha} |"
        )
    lines.append("")

    # Editor 工程包
    if editor_only:
        lines.append(f"## Editor 工程包（共 {len(editor_only)} 个 — 仅含 .cmo3，需 Editor 打开学习）")
        lines.append("")
        for m in editor_only:
            lines.append(f"- `{m['id']}` — {m['dir']}")
        lines.append("")

    # 每个模型的 motion group 细节
    lines.append("## Motion Group 分布")
    lines.append("")
    for m in runtime_models:
        if not m["motion_groups"]:
            continue
        groups_str = ", ".join(
            f"`{g or '(default)'}`×{n}" for g, n in m["motion_groups"].items()
        )
        lines.append(f"- **{m['id']}** ({m['motions_total']} motions): {groups_str}")
    lines.append("")

    # 异常与备注
    notes_models = [m for m in models if m["notes"]]
    if notes_models:
        lines.append("## 备注与异常")
        lines.append("")
        for m in notes_models:
            for n in m["notes"]:
                lines.append(f"- `{m['id']}`: {n}")
        lines.append("")

    # 统计
    kind_counts = Counter(m["kind"] for m in models)
    n = max(len(runtime_models), 1)
    lines.append("## 统计")
    lines.append("")
    lines.append(f"- 模型总数：{len(models)} 个（运行时 {len(runtime_models)} + Editor 工程 {len(editor_only)}）")
    lines.append(f"- kind 分布：{dict(kind_counts)}")
    lines.append(f"- 运行时模型中配齐 physics：{sum(1 for m in runtime_models if m['has_physics'])} / {n}")
    lines.append(f"- 运行时模型中有 expression：{sum(1 for m in runtime_models if m['expressions'] > 0)} / {n}")
    lines.append(f"- 运行时模型中有 motion：{sum(1 for m in runtime_models if m['motions_total'] > 0)} / {n}")
    lines.append(f"- 运行时平均 motion 数：{sum(m['motions_total'] for m in runtime_models) / n:.1f}")
    lines.append(f"- 运行时平均 expression 数：{sum(m['expressions'] for m in runtime_models) / n:.1f}")
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ Inventory 写入 {OUT}")


if __name__ == "__main__":
    main()
