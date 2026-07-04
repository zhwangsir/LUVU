#!/usr/bin/env python3
"""
解析 Live2D 官方 sample-data download.js 并下载所有示例模型。

数据源：https://cubism.live2d.com/sample-data/js/download.js
本地缓存：/tmp/download.js（若不存在则自动下载）

下载策略：
  - 每个模型 ID 按 lang 优先级 zh > ja > en > ko 取最优版本
  - 下载到 public/live2d/samples/_zips/<filename>，跳过已存在
  - 解压到 public/live2d/samples/<model_id>/
  - 输出 manifest 到 docs/live2d/SAMPLES_MANIFEST.json
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD_JS_URL = "https://cubism.live2d.com/sample-data/js/download.js"
FILE_BASE_URL = "https://cubism.live2d.com/sample-data/bin/"
CACHE_JS = Path("/tmp/download.js")
SAMPLES_DIR = ROOT / "public" / "live2d" / "samples"
ZIPS_DIR = SAMPLES_DIR / "_zips"
MANIFEST_PATH = ROOT / "docs" / "live2d" / "SAMPLES_MANIFEST.json"

LANG_PRIORITY = ["zh", "ja", "en", "ko"]


def ensure_download_js() -> str:
    if not CACHE_JS.exists():
        req = Request(DOWNLOAD_JS_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req, timeout=30) as r:
            CACHE_JS.write_bytes(r.read())
    return CACHE_JS.read_text(encoding="utf-8")


# 匹配 model_id: { models: [ { lang: "..", date: "..", size: "..", url: ".." }, ... ] }
MODEL_BLOCK_RE = re.compile(
    r"(?P<id>[A-Za-z0-9_]+)\s*:\s*\{\s*models\s*:\s*\[(?P<body>.*?)\]\s*\}",
    re.DOTALL,
)
ENTRY_RE = re.compile(
    r"\{\s*lang:\s*\"(?P<lang>[^\"]+)\"\s*,\s*"
    r"date:\s*\"(?P<date>[^\"]+)\"\s*,\s*"
    r"size:\s*\"(?P<size>[^\"]+)\"\s*,\s*"
    r"url:\s*\"(?P<url>[^\"]+)\"\s*,?\s*\}",
    re.DOTALL,
)


def _extract_brace_block(text: str, start_idx: int) -> str:
    """从 start_idx（指向 '{'）开始按大括号平衡返回内层 body（不含外层 {}）。"""
    assert text[start_idx] == "{"
    depth = 0
    in_str = False
    str_ch = ""
    i = start_idx
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == str_ch:
                in_str = False
        else:
            if ch in ('"', "'"):
                in_str = True
                str_ch = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start_idx + 1 : i]
        i += 1
    raise RuntimeError("大括号未闭合")


def parse_models(js_text: str) -> dict[str, list[dict]]:
    """从 download.js 提取 {model_id: [entries...]}。"""
    m = re.search(r"fileDataArray\s*=\s*", js_text)
    if not m:
        raise RuntimeError("未找到 fileDataArray")
    brace_idx = js_text.find("{", m.end())
    if brace_idx < 0:
        raise RuntimeError("未找到 fileDataArray 起始 {")
    body = _extract_brace_block(js_text, brace_idx)
    out: dict[str, list[dict]] = {}
    for m in MODEL_BLOCK_RE.finditer(body):
        model_id = m.group("id")
        if model_id == "models":  # 防御：嵌套关键字
            continue
        entries = [e.groupdict() for e in ENTRY_RE.finditer(m.group("body"))]
        if entries:
            out[model_id] = entries
    return out


def pick_best(entries: list[dict]) -> dict:
    by_lang = {e["lang"]: e for e in entries}
    for lang in LANG_PRIORITY:
        if lang in by_lang:
            return by_lang[lang]
    return entries[0]


def curl_download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  ↓ {url}")
    rc = subprocess.call(
        ["curl", "-sSL", "--fail", "-A", "Mozilla/5.0", "-o", str(tmp), url]
    )
    if rc != 0:
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(f"curl 失败 rc={rc}: {url}")
    tmp.rename(dest)


def safe_extract(zip_path: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            # 防 Zip Slip
            name = member.filename
            if name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeError(f"危险路径: {name}")
        zf.extractall(target_dir)


def main() -> int:
    js_text = ensure_download_js()
    models = parse_models(js_text)
    print(f"📦 解析出 {len(models)} 个模型")

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    ZIPS_DIR.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    failed: list[str] = []

    for model_id in sorted(models):
        best = pick_best(models[model_id])
        url = FILE_BASE_URL + best["url"]
        zip_name = Path(best["url"]).name
        zip_path = ZIPS_DIR / zip_name
        extract_dir = SAMPLES_DIR / model_id

        record = {
            "id": model_id,
            "lang": best["lang"],
            "date": best["date"],
            "size": best["size"],
            "source_url": url,
            "zip_path": str(zip_path.relative_to(ROOT)),
            "extract_dir": str(extract_dir.relative_to(ROOT)),
            "all_langs": [e["lang"] for e in models[model_id]],
        }

        # 下载（跳过已存在）
        if not zip_path.exists():
            try:
                curl_download(url, zip_path)
            except Exception as e:
                print(f"  ✗ {model_id}: {e}")
                failed.append(model_id)
                record["status"] = "download_failed"
                manifest.append(record)
                continue
        else:
            print(f"  ✓ 已存在: {zip_name}")

        # 解压（若目录不存在或为空）
        if not extract_dir.exists() or not any(extract_dir.iterdir()):
            try:
                safe_extract(zip_path, extract_dir)
                record["status"] = "ok"
            except Exception as e:
                print(f"  ✗ {model_id} 解压: {e}")
                record["status"] = f"extract_failed: {e}"
                failed.append(model_id)
        else:
            record["status"] = "ok_cached"

        manifest.append(record)

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(
            {
                "base_url": FILE_BASE_URL,
                "model_count": len(manifest),
                "failed": failed,
                "models": manifest,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n✅ Manifest 写入 {MANIFEST_PATH}")
    print(f"   成功 {len(manifest) - len(failed)} / {len(manifest)}，失败 {len(failed)}")
    if failed:
        print(f"   失败列表: {failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
