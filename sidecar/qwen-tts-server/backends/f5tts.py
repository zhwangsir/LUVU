"""F5-TTS backend: SOTA zero-shot voice cloning (Apache 2.0, 2024).

加载逻辑：
  - 首次 synthesize 时延迟 load F5TTS 模型
  - HuggingFace 自动从 SWivid/F5-TTS 拉权重（默认 F5TTS_v1_Base）

调用：
  - infer(ref_file, ref_text, gen_text) → (audio_np, sample_rate, _)
  - ref_text 留空时 F5-TTS 自动 ASR 抽取参考文本
"""

from __future__ import annotations

import io
import logging
import os
from typing import Optional

import numpy as np
import soundfile as sf

log = logging.getLogger("luvu-tts.f5tts")


def _patch_torchaudio_load() -> None:
    """torchaudio nightly 2.11+ 强制走 torchcodec → Windows 上 ffmpeg DLL 不兼容。
    Monkey-patch torchaudio.load 改用 soundfile 解码，彻底绕开 torchcodec/ffmpeg 地狱。
    """
    try:
        import torch
        import torchaudio

        def _load_with_soundfile(path, *args, **kwargs):
            arr, sr = sf.read(str(path), dtype="float32")
            if arr.ndim == 1:
                arr = arr[None, :]
            else:
                arr = arr.T  # (frames, ch) → (ch, frames)
            return torch.from_numpy(arr), sr

        torchaudio.load = _load_with_soundfile  # type: ignore[assignment]
        log.info("torchaudio.load patched → soundfile (bypass torchcodec)")
    except Exception as e:
        log.warning(f"failed to patch torchaudio.load: {e}")


class F5TTSBackend:
    name = "f5tts"

    def __init__(self) -> None:
        self._model = None
        self._sample_rate = 24000
        self._ready_err: Optional[str] = None

    @property
    def is_ready(self) -> bool:
        return self._model is not None

    @property
    def last_error(self) -> Optional[str]:
        return self._ready_err

    def ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        try:
            self._load()
            return True
        except Exception as e:
            log.warning(f"F5TTS load failed: {e}")
            self._ready_err = str(e)
            return False

    def _load(self) -> None:
        log.info("loading F5-TTS (first call may download model from HuggingFace ~1.5GB)...")
        # 必须在 import F5TTS 之前 patch（F5-TTS 内部用 torchaudio.load 读 ref audio）
        _patch_torchaudio_load()
        from f5_tts.api import F5TTS  # type: ignore

        # 允许通过 LUVU_F5_DEVICE 强制 device (cpu/cuda/mps)
        # 默认 auto: cuda if avail else mps else cpu (torch nightly cu128 已支持 sm_120)
        device = os.environ.get("LUVU_F5_DEVICE", "").strip().lower()
        if not device:
            import torch  # type: ignore
            if torch.cuda.is_available():
                # 先实际跑一个小 op 验 GPU 真能用（避免 sm_120 等编译时未包含的情况）
                try:
                    _ = torch.zeros(2, device="cuda") + 1
                    device = "cuda"
                except RuntimeError as e:
                    log.warning(f"CUDA op test fail ({e}), fallback CPU")
                    device = "cpu"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        log.info(f"F5-TTS device={device}")
        self._model = F5TTS(device=device)
        log.info("F5-TTS ready.")

    async def synthesize(
        self,
        text: str,
        voice,  # VoiceEntry
        emotion: str = "neutral",
    ) -> bytes:
        if not self.ensure_loaded():
            raise RuntimeError(f"F5TTS 未就绪：{self._ready_err}")
        assert self._model is not None

        ref_path = getattr(voice, "sample_path", None)
        if not ref_path or not os.path.exists(ref_path):
            raise RuntimeError(f"F5TTS 需要 ref audio path: voice={voice}")

        # F5-TTS 用 ref_text 对齐 prosody — 必须是 ref audio 实际说的话才合成清晰
        # voice.note 是"来自 xxx" 这种 metadata，传进去会让合成完全崩
        # 优先用真实 ref_text 字段；否则传空让 F5-TTS Whisper ASR 自动转写
        ref_text = (getattr(voice, "ref_text", None) or "").strip()
        # ref_text="" 会触发 F5-TTS 内部 Whisper-large-v3-turbo 转写
        # 首次下 1.6GB Whisper，后续从 HF cache 复用

        # F5TTS.infer 是 sync (not async)，在线程池跑避免阻塞 event loop
        import asyncio

        loop = asyncio.get_event_loop()
        # nfe_step=32 是 F5-TTS 默认（质量最佳）；降到 16 速度 2x 质量略降，mac MPS 上必要
        # cfg_strength=2.0 是默认
        nfe_step = int(os.environ.get("LUVU_F5_NFE", "16"))
        wav, sr, _spec = await loop.run_in_executor(
            None,
            lambda: self._model.infer(
                ref_file=ref_path,
                ref_text=ref_text,
                gen_text=text,
                nfe_step=nfe_step,
                show_info=lambda _msg: None,  # 静默
            ),
        )

        # wav 是 numpy float32 [N]
        if isinstance(wav, np.ndarray):
            if wav.ndim == 1:
                wav = wav[np.newaxis, :]
        else:
            wav = np.asarray(wav).reshape(1, -1)

        # 转 WAV bytes (PCM 16-bit)
        buf = io.BytesIO()
        sf.write(buf, wav.T, sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()
