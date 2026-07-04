"""CosyVoice 2 backend：zero-shot voice clone + 情感控制。

加载逻辑：
  1. 把 ~/.luvu/cosyvoice-repo 加入 sys.path
  2. 导入 cosyvoice.cli.cosyvoice.CosyVoice2
  3. 用 ~/.luvu/models-tts/cosyvoice2-0.5b 加载模型

情感控制：CosyVoice 2 用 instruct text 控制风格。我们把 emotion 翻成中文指令。
例：emotion='shy' → "用害羞的语气说"
"""

from __future__ import annotations

import io
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

import torchaudio  # type: ignore

log = logging.getLogger("luvu-tts.cosyvoice")


_EMOTION_INSTRUCT = {
    "neutral": "用平静自然的语气说",
    "happy": "用开心、笑着的语气说",
    "shy": "用害羞、轻声的语气说",
    "angry": "用生气、责备的语气说",
    "sad": "用伤心、低落的语气说",
    "sleepy": "用困倦、慵懒的语气说",
    "possessive": "用占有欲强、压低声音的语气说",
}


class CosyVoiceBackend:
    name = "cosyvoice"

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
            log.warning(f"CosyVoice load failed: {e}")
            self._ready_err = str(e)
            return False

    def _load(self) -> None:
        repo_dir = Path.home() / ".luvu" / "cosyvoice-repo"
        model_dir = Path.home() / ".luvu" / "models-tts" / "cosyvoice2-0.5b"
        if not repo_dir.exists():
            raise FileNotFoundError(
                f"CosyVoice 仓库不存在：{repo_dir}。运行 bash sidecar/install.sh"
            )
        if not model_dir.exists():
            raise FileNotFoundError(
                f"CosyVoice2-0.5B 模型不存在：{model_dir}。运行 bash sidecar/install.sh"
            )

        # 把 repo dir 与 third_party/Matcha-TTS 加入 sys.path
        for sub in (repo_dir, repo_dir / "third_party" / "Matcha-TTS"):
            p = str(sub)
            if p not in sys.path:
                sys.path.insert(0, p)

        # 延迟导入：依赖只在首次加载时校验
        from cosyvoice.cli.cosyvoice import CosyVoice2  # type: ignore

        log.info(f"loading CosyVoice2 from {model_dir}...")
        # 当前 CosyVoice2.__init__ 签名 (model_dir, load_jit, load_trt, load_vllm, fp16, trt_concurrent)
        # 不再有 load_onnx 参数 (跟随上游 API 演变)
        self._model = CosyVoice2(
            str(model_dir), load_jit=False, load_trt=False, load_vllm=False, fp16=False
        )
        self._sample_rate = getattr(self._model, "sample_rate", 24000)
        log.info(f"CosyVoice2 ready. sample_rate={self._sample_rate}")

    def synthesize(self, text: str, ref_audio_path: str, ref_text: str, emotion: str) -> bytes:
        if not self.ensure_loaded():
            raise RuntimeError(f"CosyVoice 未就绪：{self._ready_err}")
        assert self._model is not None

        # 用 instruct 控制风格：CosyVoice2 接受 instruct_text 控制语气
        instruct = _EMOTION_INSTRUCT.get(emotion, _EMOTION_INSTRUCT["neutral"])

        # 当前 CosyVoice2 API 接受 prompt_wav 为「文件路径」(str)，不是 tensor
        # 内部会自己 load + resample 到 16k
        chunks = []
        try:
            # 优先用 instruct 接口（情感控制）
            it = self._model.inference_instruct2(
                tts_text=text,
                instruct_text=instruct,
                prompt_wav=ref_audio_path,
                stream=False,
            )
        except AttributeError:
            # 老版本只有 inference_zero_shot
            it = self._model.inference_zero_shot(
                tts_text=text,
                prompt_text=ref_text or instruct,
                prompt_wav=ref_audio_path,
                stream=False,
            )

        for part in it:
            chunks.append(part["tts_speech"])

        if not chunks:
            raise RuntimeError("CosyVoice 未产出音频")

        import torch  # type: ignore

        audio = torch.cat(chunks, dim=-1) if len(chunks) > 1 else chunks[0]

        # 写到内存 buffer → WAV bytes
        buf = io.BytesIO()
        torchaudio.save(buf, audio, self._sample_rate, format="wav")
        return buf.getvalue()
