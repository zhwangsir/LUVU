"""RVC (Retrieval-based Voice Conversion) backend.

RVC 是 voice **conversion**，不是 voice **synthesis** — 它接收已有的 wav 输出 → 转换音色。
所以 RvcBackend 不能单独用作 TTS backend，必须级联在 TTS 之后：

    text → (edge_tts | f5tts | cosyvoice) → wav_a → RVC → wav_b

调用方（main.py 里的 RvcWrapper）负责先调一个 TTS 生成 wav_a，再交给本 backend 转换。

依赖：
  - RVC 仓库代码（C:\\LUVU-rvc 或 RVC_HOME 环境变量指向）
  - 用户已训练好的模型：assets/weights/<voice_id>.pth
  - 对应索引：logs/<voice_id>/added_*.index（可选，提高音质）
  - 预训练：assets/hubert/hubert_base.pt + assets/rmvpe/rmvpe.pt

环境变量：
  RVC_HOME              RVC 仓库根目录（默认 C:\\LUVU-rvc）
  RVC_DEVICE            cuda:0 / cpu（默认 cuda:0 if available）
  RVC_INDEX_RATE        0.0~1.0，特征检索权重（默认 0.75）
  RVC_F0_METHOD         rmvpe / harvest / pm（默认 rmvpe）
"""

from __future__ import annotations

import io
import logging
import os
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

log = logging.getLogger("luvu-tts.rvc")

RVC_HOME = Path(os.environ.get("RVC_HOME", r"C:\LUVU-rvc"))
RVC_DEVICE = os.environ.get("RVC_DEVICE", "")
DEFAULT_INDEX_RATE = float(os.environ.get("RVC_INDEX_RATE", "0.75"))
DEFAULT_F0_METHOD = os.environ.get("RVC_F0_METHOD", "rmvpe")


@dataclass(frozen=True)
class RvcModel:
    """指向用户训练好的一份 RVC 模型 + 可选 index 文件。"""

    voice_id: str
    pth_path: Path
    index_path: Optional[Path]


def _resolve_model(voice_id: str) -> Optional[RvcModel]:
    """按 voice_id 找训练好的模型文件。

    约定路径：
      <RVC_HOME>/assets/weights/<voice_id>.pth
      <RVC_HOME>/logs/<voice_id>/added_*.index   （可选）

    不存在返回 None — 上层会 fallback 到原 wav（不做转换，pass-through）。
    """
    pth = RVC_HOME / "assets" / "weights" / f"{voice_id}.pth"
    if not pth.exists():
        return None
    index_dir = RVC_HOME / "logs" / voice_id
    index_path: Optional[Path] = None
    if index_dir.exists():
        candidates = sorted(index_dir.glob("added_*.index"))
        if candidates:
            index_path = candidates[0]
    return RvcModel(voice_id=voice_id, pth_path=pth, index_path=index_path)


def list_trained_voices() -> list[str]:
    """列出 assets/weights/ 下所有 .pth 文件名（去后缀）。"""
    weights_dir = RVC_HOME / "assets" / "weights"
    if not weights_dir.exists():
        return []
    return sorted(p.stem for p in weights_dir.glob("*.pth"))


class RvcBackend:
    """RVC 推理封装。延迟加载 RVC 模块，避免冷启动开销。"""

    name = "rvc"

    def __init__(self) -> None:
        self._vc = None  # VC instance（RVC 推理类）
        self._loaded_voice: Optional[str] = None
        self._device: Optional[str] = None

    def _ensure_path(self) -> None:
        """把 RVC_HOME 加入 sys.path，让 `from infer.modules.vc import VC` 能 import。"""
        if str(RVC_HOME) not in sys.path:
            sys.path.insert(0, str(RVC_HOME))

    def _ensure_engine(self) -> None:
        """首次调用时延迟加载 VC + 检查 GPU。"""
        if self._vc is not None:
            return
        self._ensure_path()

        import torch

        if not RVC_DEVICE:
            self._device = "cuda:0" if torch.cuda.is_available() else "cpu"
        else:
            self._device = RVC_DEVICE
        log.info("RVC engine init: device=%s, home=%s", self._device, RVC_HOME)

        # 延迟 import — 让 import 错误只在第一次 synthesize 时暴露，不影响其他 backend
        # RVC Config / VC 内部用相对路径读 configs/*.json 和 assets/*，必须 chdir 到 RVC_HOME
        # 另外 RVC modules.py 用 os.getenv("weight_root") / os.getenv("index_root") 找 .pth 和 .index
        os.environ.setdefault("weight_root", "assets/weights")
        os.environ.setdefault("index_root", "logs")
        os.environ.setdefault("rmvpe_root", "assets/rmvpe")
        original_cwd = os.getcwd()
        # Config.__init__ 内部用 argparse 解析 sys.argv，sidecar 的 uvicorn --host 参数会让它 SystemExit
        # 临时清空 sys.argv 只留脚本名
        original_argv = sys.argv
        sys.argv = [sys.argv[0]]
        try:
            os.chdir(str(RVC_HOME))
            from configs.config import Config  # type: ignore
            from infer.modules.vc.modules import VC  # type: ignore

            cfg = Config()
            # 强制 device — Config 自己探测可能不准
            cfg.device = self._device
            cfg.is_half = self._device.startswith("cuda")  # cuda 用 fp16，cpu 必须 fp32
            self._vc = VC(cfg)
        finally:
            os.chdir(original_cwd)
            sys.argv = original_argv

    def _load_voice(self, voice_id: str) -> RvcModel:
        """切换/加载某个用户音色。重复调用同一 voice_id 不重复加载。"""
        if self._loaded_voice == voice_id and self._vc is not None:
            model = _resolve_model(voice_id)
            if model is None:
                raise RuntimeError(f"RVC 模型已卸载: {voice_id}")
            return model

        model = _resolve_model(voice_id)
        if model is None:
            raise FileNotFoundError(
                f"未找到 RVC 模型 {voice_id}.pth — 请先训练或确认 RVC_HOME"
            )

        self._ensure_engine()
        assert self._vc is not None
        # VC.get_vc 接收 .pth 文件名（不是绝对路径） — 它会去 weight_root 找
        # weight_root 由 Config 提供，默认 assets/weights
        self._vc.get_vc(model.pth_path.name)
        self._loaded_voice = voice_id
        log.info("RVC voice loaded: %s (index=%s)", voice_id, bool(model.index_path))
        return model

    def convert(
        self,
        wav_bytes: bytes,
        voice_id: str,
        *,
        f0_up_key: int = 0,
        index_rate: float = DEFAULT_INDEX_RATE,
        f0_method: str = DEFAULT_F0_METHOD,
        protect: float = 0.33,
        filter_radius: int = 3,
        rms_mix_rate: float = 1.0,
        resample_sr: int = 0,
    ) -> bytes:
        """转换音色 — 接收 wav bytes，返回转换后的 wav bytes。

        Args:
            wav_bytes: 输入 wav（任何采样率，自动 resample）
            voice_id: 训练好的音色 ID（对应 assets/weights/<voice_id>.pth）
            f0_up_key: 音调偏移，半音单位。男声→女声 +12，女声→男声 -12
            index_rate: 0~1，索引检索权重。越高音色越像、伪影也越多
            f0_method: rmvpe（推荐）/ harvest / pm
        """
        # RVC pipeline 内部用相对路径找 assets/hubert/*.pt 等，chdir 到 RVC_HOME 整个 convert 期间
        original_cwd = os.getcwd()
        try:
            os.chdir(str(RVC_HOME))
            return self._convert_inner(
                wav_bytes, voice_id, f0_up_key, index_rate, f0_method,
                protect, filter_radius, rms_mix_rate, resample_sr,
            )
        finally:
            os.chdir(original_cwd)

    def _convert_inner(
        self,
        wav_bytes: bytes,
        voice_id: str,
        f0_up_key: int,
        index_rate: float,
        f0_method: str,
        protect: float,
        filter_radius: int,
        rms_mix_rate: float,
        resample_sr: int,
    ) -> bytes:
        model = self._load_voice(voice_id)
        assert self._vc is not None

        # RVC 的 vc_single 接 numpy audio + 一堆参数；先 decode wav
        audio, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # 转单声道

        # RVC.vc_single 签名（参考 infer/modules/vc/modules.py）：
        # vc_single(sid, input_audio_path, f0_up_key, f0_file, f0_method,
        #           file_index, file_index2, index_rate, filter_radius,
        #           resample_sr, rms_mix_rate, protect)
        # 用 input_audio 直接传 numpy 时，RVC 要求 input_audio_path 是 (sr, np_audio) 元组
        # 但 RVC v2 的 load_audio 只接受路径字符串（会 .replace() 路径）— 写临时 wav 文件
        index_file = str(model.index_path) if model.index_path else ""
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, sr)
            tmp_path = tmp.name
        try:
            tgt_sr, audio_out = self._vc.vc_single(
                0,  # sid
                tmp_path,  # 文件路径（RVC v2 要求）
                f0_up_key,
                None,  # f0_file
                f0_method,
                index_file,  # file_index
                "",  # file_index2
                index_rate,
                filter_radius,
                resample_sr,
                rms_mix_rate,
                protect,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        # audio_out 可能是 (info_msg, (sr, audio)) 或直接 ndarray，看 RVC 版本
        if isinstance(audio_out, tuple) and len(audio_out) == 2:
            tgt_sr, audio_out = audio_out
        if not isinstance(audio_out, np.ndarray):
            raise RuntimeError(f"RVC 返回非 ndarray: {type(audio_out)}")

        # 输出 wav int16
        buf = io.BytesIO()
        if audio_out.dtype != np.int16:
            audio_out = np.clip(audio_out, -1.0, 1.0)
            audio_out = (audio_out * 32767).astype(np.int16)
        sf.write(buf, audio_out, tgt_sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    def health(self) -> dict:
        return {
            "rvc_home": str(RVC_HOME),
            "rvc_home_exists": RVC_HOME.exists(),
            "device": self._device or "(not initialized)",
            "loaded_voice": self._loaded_voice,
            "trained_voices": list_trained_voices(),
        }
