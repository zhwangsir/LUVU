#!/usr/bin/env bash
# LUVU sidecar 一键安装：venv + pip + CosyVoice repo + 模型下载。
#
# 用法：
#   bash sidecar/install.sh             # 完整安装（含 CosyVoice）
#   bash sidecar/install.sh --minimal   # 只装 edge-tts（不要 CosyVoice）
#   bash sidecar/install.sh --reset     # 删除 venv 重装
#
# 进度行用 "[STEP]" / "[OK]" / "[FAIL]" 前缀打印，主程序可解析显示。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/qwen-tts-server"
VENV_DIR="$SIDECAR_DIR/.venv"
COSYVOICE_DIR="$HOME/.luvu/cosyvoice-repo"
MODELS_DIR="$HOME/.luvu/models-tts"
LOG_FILE="$HOME/.luvu/install.log"

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

MODE="full"
for arg in "$@"; do
  case "$arg" in
    --minimal) MODE="minimal" ;;
    --reset)
      echo "[STEP] 删除旧 venv..."
      rm -rf "$VENV_DIR"
      ;;
  esac
done

echo "[STEP] LUVU sidecar 安装开始（mode=$MODE）"
echo "[STEP] sidecar dir: $SIDECAR_DIR"

# 1. 检测 python3.10+
PY=""
for cand in python3.12 python3.11 python3.10 python3; do
  if command -v $cand >/dev/null 2>&1; then
    ver=$($cand -c "import sys; print('%d.%d'%sys.version_info[:2])")
    major=${ver%%.*}
    minor=${ver##*.}
    if [ "$major" -eq 3 ] && [ "$minor" -ge 10 ]; then
      PY=$cand
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "[FAIL] 需要 Python 3.10+。请先安装：brew install python@3.11"
  exit 1
fi
echo "[OK] 使用 $PY ($(${PY} --version))"

# 2. 创建 venv
if [ ! -d "$VENV_DIR" ]; then
  echo "[STEP] 创建 virtualenv..."
  $PY -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel >/dev/null
echo "[OK] venv 就绪"

# 3. 装基础依赖（edge-tts / FastAPI）
echo "[STEP] 安装 sidecar 基础依赖..."
pip install -q -r "$SIDECAR_DIR/requirements.txt"
echo "[OK] 基础依赖完成"

if [ "$MODE" = "minimal" ]; then
  echo "[OK] minimal 模式完成。Sidecar 仅 edge-tts 可用。"
  echo "[OK] 启动：cd $SIDECAR_DIR && source .venv/bin/activate && uvicorn main:app --port 5050"
  exit 0
fi

# 4. CosyVoice：装依赖 + clone 仓库 + 下载模型
echo "[STEP] 安装 PyTorch（MPS 支持）..."
pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
  || pip install -q torch torchaudio

echo "[STEP] 安装 CosyVoice 运行依赖..."
pip install -q modelscope soundfile librosa transformers accelerate huggingface_hub onnxruntime || true

# 5. clone CosyVoice 仓库
if [ ! -d "$COSYVOICE_DIR/.git" ]; then
  echo "[STEP] clone CosyVoice 仓库到 $COSYVOICE_DIR..."
  git clone --depth=1 https://github.com/FunAudioLLM/CosyVoice.git "$COSYVOICE_DIR" || {
    echo "[FAIL] git clone CosyVoice 失败（网络问题？）"
    echo "[STEP] 你也可以用国内镜像：GITHUB_PROXY=https://ghproxy.com bash sidecar/install.sh"
    exit 1
  }
else
  echo "[OK] CosyVoice 仓库已存在，跳过 clone"
fi
echo "[OK] CosyVoice 仓库就绪"

# 6. 下载 CosyVoice 2 0.5B 模型
echo "[STEP] 下载 CosyVoice2-0.5B 模型（约 1.1 GB，首次需 5-15 分钟）..."
mkdir -p "$MODELS_DIR"
$PY -c "
import os
from huggingface_hub import snapshot_download
target = os.path.expanduser('~/.luvu/models-tts/cosyvoice2-0.5b')
os.makedirs(target, exist_ok=True)
try:
    snapshot_download(repo_id='FunAudioLLM/CosyVoice2-0.5B', local_dir=target)
    print('[OK] 模型下载完成', target)
except Exception as e:
    print('[FAIL] huggingface 下载失败：', e)
    print('[STEP] 尝试用 modelscope（国内镜像）...')
    try:
        from modelscope import snapshot_download as ms_dl
        ms_dl('iic/CosyVoice2-0.5B', cache_dir=target)
        print('[OK] modelscope 下载完成')
    except Exception as e2:
        print('[FAIL] modelscope 也失败：', e2)
        raise
"

echo "[OK] CosyVoice 全部就绪。模型：$MODELS_DIR/cosyvoice2-0.5b"
echo "[OK] 启动 sidecar：cd $SIDECAR_DIR && source .venv/bin/activate && uvicorn main:app --port 5050"
echo "[OK] 或者 LUVU 主程序会自动拉起 sidecar"
echo "[OK] 全部完成"
