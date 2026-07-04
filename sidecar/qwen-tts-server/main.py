"""LUVU TTS Sidecar — v0.2

多 backend HTTP 服务：
  - edge-tts (默认，无需 GPU，质量高，需联网)
  - openai-compat（转发到任意 OpenAI-compatible /v1/audio/speech）
  - qwen3-tts / cosyvoice / gpt-sovits 预留槽位（v0.2.3+）

接口：
  GET  /healthz
  GET  /v1/voices                    -> 已注册音色列表
  POST /v1/audio/speech              { text, voice?, emotion?, backend? } -> audio bytes
  POST /v1/audio/clone (multipart)   name=<id>, sample=<file>             -> 注册一个音色样本
  POST /v1/audio/register-batch      { dir } -> 扫描目录把每个子目录注册为一个 voice

启动：
  cd sidecar/qwen-tts-server
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn main:app --host 127.0.0.1 --port 5050
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import sys
import wave
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

# 配置
HOME = Path.home()
VOICE_DIR = HOME / ".luvu" / "voice_clones"
VOICE_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_FILE = VOICE_DIR / "registry.json"
DEFAULT_BACKEND = os.environ.get("LUVU_TTS_BACKEND", "edge_tts")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("luvu-tts")

app = FastAPI(title="LUVU TTS Sidecar", version="0.2.1")


# ---------- 音色注册表 ----------


class VoiceEntry(BaseModel):
    """注册的音色：可以是 edge_tts 的内置 voice，也可以是用户上传的样本路径。"""

    id: str
    kind: str  # "edge" | "sample" | "openai"
    edge_voice: Optional[str] = None  # 当 kind=edge 时
    sample_path: Optional[str] = None  # 当 kind=sample 时
    note: Optional[str] = None  # 显示用


def _load_registry() -> Dict[str, VoiceEntry]:
    if REGISTRY_FILE.exists():
        try:
            data = json.loads(REGISTRY_FILE.read_text("utf-8"))
            return {k: VoiceEntry(**v) for k, v in data.items()}
        except Exception as e:
            log.warning(f"registry parse failed: {e}")
    return {}


def _save_registry(reg: Dict[str, VoiceEntry]) -> None:
    REGISTRY_FILE.write_text(
        json.dumps({k: v.model_dump() for k, v in reg.items()}, ensure_ascii=False, indent=2),
        "utf-8",
    )


# 启动时填充内置 edge_tts 音色（中文常用）
_BUILTIN_EDGE = {
    "edge_xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "edge_xiaoyi": "zh-CN-XiaoyiNeural",
    "edge_yunxia": "zh-CN-YunxiaNeural",
    "edge_xiaomeng": "zh-CN-XiaomengNeural",
}

REGISTRY: Dict[str, VoiceEntry] = _load_registry()
for vid, edge in _BUILTIN_EDGE.items():
    if vid not in REGISTRY:
        REGISTRY[vid] = VoiceEntry(id=vid, kind="edge", edge_voice=edge, note="内置中文女声")


# ---------- TTS Backend ----------


class Backend:
    name: str = "noop"

    async def synthesize(self, text: str, voice: VoiceEntry) -> bytes:
        raise NotImplementedError


class EdgeTtsBackend(Backend):
    """微软 edge-tts。质量稳定、覆盖中文多种音色，但需联网。"""

    name = "edge_tts"

    async def synthesize(
        self,
        text: str,
        voice: VoiceEntry,
        *,
        rate: Optional[str] = None,
        volume: Optional[str] = None,
        pitch: Optional[str] = None,
    ) -> bytes:
        try:
            import edge_tts  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "edge-tts 未安装。请在 sidecar 目录运行 pip install edge-tts"
            ) from e

        edge_voice = (
            voice.edge_voice if voice.kind == "edge" and voice.edge_voice else "zh-CN-XiaoxiaoNeural"
        )
        # edge-tts SSML 参数：rate/volume 形如 "+20%" "-10%"; pitch 形如 "+5Hz" "-50Hz"
        kwargs: dict = {"voice": edge_voice}
        if rate:
            kwargs["rate"] = rate
        if volume:
            kwargs["volume"] = volume
        if pitch:
            kwargs["pitch"] = pitch
        communicate = edge_tts.Communicate(text, **kwargs)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()


class OpenAiCompatBackend(Backend):
    """转发到 OpenAI-compatible TTS 端点（如 fish-speech / coqui-tts 等）。"""

    name = "openai_compat"

    def __init__(self) -> None:
        self.endpoint = os.environ.get(
            "LUVU_TTS_OPENAI_ENDPOINT", "http://127.0.0.1:8080/v1/audio/speech"
        )
        self.model = os.environ.get("LUVU_TTS_OPENAI_MODEL", "tts-1")

    async def synthesize(self, text: str, voice: VoiceEntry) -> bytes:
        import httpx  # type: ignore

        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                self.endpoint,
                json={
                    "model": self.model,
                    "input": text,
                    "voice": voice.id,
                    "response_format": "mp3",
                },
            )
            r.raise_for_status()
            return r.content


class CosyVoiceWrapper(Backend):
    """CosyVoice 2 voice clone + 情感控制。"""

    name = "cosyvoice"

    def __init__(self) -> None:
        self._impl = None

    async def synthesize(self, text: str, voice: VoiceEntry, emotion: str = "neutral") -> bytes:
        if voice.kind != "sample" or not voice.sample_path:
            raise RuntimeError("cosyvoice 需要 sample 类型的音色（含参考音频路径）")

        # 延迟加载
        if self._impl is None:
            try:
                from backends.cosyvoice import CosyVoiceBackend  # type: ignore

                self._impl = CosyVoiceBackend()
            except Exception as e:
                raise RuntimeError(f"CosyVoice backend 不可用: {e}")

        ref_text = (voice.note or "").strip() or "请用这段声音作为参考"
        # 在事件循环中跑同步推理（CosyVoice 是同步的）
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._impl.synthesize,
            text,
            voice.sample_path,
            ref_text,
            emotion,
        )


class F5TtsWrapper(Backend):
    """F5-TTS 2024 SOTA zero-shot voice clone (Apache 2.0, Windows 友好)."""

    name = "f5tts"

    def __init__(self) -> None:
        self._impl = None

    async def synthesize(self, text: str, voice: VoiceEntry, emotion: str = "neutral") -> bytes:
        if voice.kind != "sample" or not voice.sample_path:
            raise RuntimeError("f5tts 需要 sample 类型的音色（含参考音频路径）")
        if self._impl is None:
            try:
                from backends.f5tts import F5TTSBackend  # type: ignore

                self._impl = F5TTSBackend()
            except Exception as e:
                raise RuntimeError(f"F5-TTS backend 不可用: {e}")
        # F5TTSBackend.synthesize 是 async — 自己内部跑 executor
        return await self._impl.synthesize(text, voice, emotion)  # type: ignore[arg-type]


BACKENDS: Dict[str, Backend] = {
    "edge_tts": EdgeTtsBackend(),
    "openai_compat": OpenAiCompatBackend(),
    "cosyvoice": CosyVoiceWrapper(),
    "f5tts": F5TtsWrapper(),
}


# ---------- RVC pipeline ----------
# RVC 是 voice conversion，不是 voice synthesis。当用户选 engine=rvc 时：
#   1. 先用某个底座 TTS 生成 wav (默认 edge_tts，因为快 + 稳定)
#   2. 再把 wav 喂给 RvcBackend 转音色
# 全局只 init 一次，避免冷启动开销
_RVC_BACKEND = None
_RVC_AVAILABLE: Optional[bool] = None


def _get_rvc() -> Optional[object]:
    """延迟初始化 RVC backend。第一次失败后缓存 None，不再重试（避免每次请求都炸）。"""
    global _RVC_BACKEND, _RVC_AVAILABLE
    if _RVC_AVAILABLE is False:
        return None
    if _RVC_BACKEND is not None:
        return _RVC_BACKEND
    try:
        from backends.rvc import RvcBackend  # type: ignore

        _RVC_BACKEND = RvcBackend()
        _RVC_AVAILABLE = True
        log.info("RVC backend available")
        return _RVC_BACKEND
    except Exception as e:
        _RVC_AVAILABLE = False
        log.warning("RVC backend 不可用: %s — 后续 voice clone 请求会 fallback 到底座 TTS", e)
        return None


# RVC 用的底座 TTS — 把文字变成 wav 之后让 RVC 转音色
RVC_BASE_TTS = os.environ.get("RVC_BASE_TTS", "edge_tts")  # 推荐 edge_tts（快）


def _pick_backend(name: Optional[str], voice: VoiceEntry) -> Backend:
    # voice.kind=edge 强制走 edge_tts
    if voice.kind == "edge":
        return BACKENDS["edge_tts"]
    # voice.kind=sample → 根据 DEFAULT_BACKEND 选 voice-clone 后端（cosyvoice or f5tts）
    if voice.kind == "sample":
        if DEFAULT_BACKEND in ("f5tts", "cosyvoice"):
            return BACKENDS[DEFAULT_BACKEND]
        return BACKENDS["f5tts"]  # 默认 voice clone 走 f5tts (workstation 推荐)
    if name and name in BACKENDS:
        return BACKENDS[name]
    return BACKENDS[DEFAULT_BACKEND]


# ---------- HTTP 接口 ----------


class SpeakRequest(BaseModel):
    text: str
    voice: str = "edge_xiaoxiao"
    emotion: str = "neutral"
    backend: Optional[str] = None
    # v0.3: RVC 选项 — 当 rvc_voice 非空时，先用 backend 生成 wav，再喂给 RVC 转音色
    rvc_voice: Optional[str] = None  # 训练好的 RVC voice_id，对应 assets/weights/<id>.pth
    rvc_f0_up_key: int = 0  # 半音偏移，男→女 +12，女→男 -12
    rvc_index_rate: float = 0.75  # 0~1 索引权重
    rvc_f0_method: str = "rmvpe"  # rmvpe / harvest / pm
    # v0.11: RVC 高级参数
    rvc_protect: float = 0.33  # 清音/呼吸保护 0~0.5
    rvc_filter_radius: int = 3  # F0 中值滤波半径 0~7
    rvc_rms_mix_rate: float = 1.0  # 音量包络混合 0~1
    rvc_resample_sr: int = 0  # 输出采样率，0=保持
    # v0.11: 底座 TTS (edge_tts) 语速/音量/音调（SSML 格式）
    rate: Optional[str] = None  # e.g. "+20%" / "-10%"
    volume: Optional[str] = None  # e.g. "+0%"
    pitch: Optional[str] = None  # e.g. "+5Hz"


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "version": app.version,
        "default_backend": DEFAULT_BACKEND,
        "voice_count": len(REGISTRY),
    }


@app.get("/v1/voices")
def list_voices() -> dict:
    return {"voices": [v.model_dump() for v in REGISTRY.values()]}


@app.post("/v1/audio/speech")
async def speak(req: SpeakRequest) -> Response:
    if not req.text.strip():
        return Response(content=_silent_wav(0.15), media_type="audio/wav")

    voice = REGISTRY.get(req.voice)
    if voice is None:
        # 未注册音色，降级到默认
        log.warning(f"voice not found: {req.voice}, falling back to edge_xiaoxiao")
        voice = REGISTRY.get("edge_xiaoxiao") or VoiceEntry(
            id="default", kind="edge", edge_voice="zh-CN-XiaoxiaoNeural"
        )

    # v0.3: RVC pipeline — 先生成中性 wav，再转音色
    if req.rvc_voice:
        rvc = _get_rvc()
        if rvc is None:
            log.warning("RVC 请求但 backend 不可用 — fallback 到底座 TTS（无音色转换）")
        else:
            # 1) 强制用底座 TTS（edge_tts 最快最稳）— 不论 voice.kind 是什么
            base_backend = BACKENDS.get(RVC_BASE_TTS) or BACKENDS["edge_tts"]
            # edge_tts 需要 voice 有 edge_voice 字段；强行临时构一个默认中性 voice
            base_voice = REGISTRY.get("edge_xiaoxiao") or VoiceEntry(
                id="_rvc_base", kind="edge", edge_voice="zh-CN-XiaoxiaoNeural"
            )
            try:
                # edge_tts 返回 mp3，RVC 要 wav — 先转 wav；底座 TTS 也吃 rate/volume/pitch
                if base_backend.name == "edge_tts":
                    base_audio = await base_backend.synthesize(  # type: ignore[call-arg]
                        req.text, base_voice,
                        rate=req.rate, volume=req.volume, pitch=req.pitch,
                    )
                else:
                    base_audio = await base_backend.synthesize(req.text, base_voice)
                wav_bytes = _to_wav(base_audio, source_type=base_backend.name)
                # 2) RVC 转音色（同步推理，跑 executor 不阻塞）
                converted = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: rvc.convert(  # type: ignore[union-attr]
                        wav_bytes,
                        req.rvc_voice,
                        f0_up_key=req.rvc_f0_up_key,
                        index_rate=req.rvc_index_rate,
                        f0_method=req.rvc_f0_method,
                        protect=req.rvc_protect,
                        filter_radius=req.rvc_filter_radius,
                        rms_mix_rate=req.rvc_rms_mix_rate,
                        resample_sr=req.rvc_resample_sr,
                    ),
                )
                return Response(content=converted, media_type="audio/wav")
            except FileNotFoundError as e:
                # 没训练好的模型 — 透传原 wav 不要 500
                log.warning("RVC 模型未找到: %s — fallback 到底座 TTS", e)
                wav_bytes = _to_wav(base_audio, source_type=base_backend.name)
                return Response(content=wav_bytes, media_type="audio/wav")
            except Exception as e:
                log.error("RVC 转换失败: %s — fallback 到底座 TTS", e)
                # 不抛 500，给前端原始 wav
                return Response(
                    content=_to_wav(base_audio, source_type=base_backend.name),
                    media_type="audio/wav",
                )

    backend = _pick_backend(req.backend, voice)
    try:
        # CosyVoice 接受 emotion 第三参；edge_tts 接 rate/volume/pitch；其他忽略
        if backend.name == "cosyvoice":
            audio = await backend.synthesize(req.text, voice, req.emotion)  # type: ignore[call-arg]
        elif backend.name == "edge_tts":
            audio = await backend.synthesize(  # type: ignore[call-arg]
                req.text, voice,
                rate=req.rate, volume=req.volume, pitch=req.pitch,
            )
        else:
            audio = await backend.synthesize(req.text, voice)
        media_type = "audio/mpeg" if backend.name in ("edge_tts", "openai_compat") else "audio/wav"
        return Response(content=audio, media_type=media_type)
    except Exception as e:
        log.error(f"synthesize failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/rvc/voices")
def rvc_voices() -> dict:
    """列出 workstation 上已训练好的 RVC 音色（assets/weights/*.pth）。"""
    rvc = _get_rvc()
    if rvc is None:
        return {"available": False, "voices": [], "reason": "RVC backend 不可用"}
    return {"available": True, "voices": rvc.health()["trained_voices"], "health": rvc.health()}  # type: ignore[union-attr]


def _to_wav(audio_bytes: bytes, source_type: str) -> bytes:
    """edge_tts/openai_compat 返回 mp3，RVC 要 wav。用 soundfile 转。"""
    if source_type not in ("edge_tts", "openai_compat"):
        return audio_bytes  # 已是 wav
    try:
        import soundfile as sf  # 已是 sidecar 依赖
        import io as _io

        # mp3 → ndarray → wav；soundfile 不直接读 mp3 — 用 audioread
        try:
            data, sr = sf.read(_io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
        except Exception:
            # mp3 — 用 librosa（已被 RVC 拉进来作为依赖）
            import librosa  # type: ignore

            data, sr = librosa.load(_io.BytesIO(audio_bytes), sr=None, mono=True)
        buf = _io.BytesIO()
        sf.write(buf, data, sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()
    except Exception as e:
        log.warning("mp3→wav 转换失败: %s — 把 mp3 原样传给 RVC（可能 RVC 也能读）", e)
        return audio_bytes


@app.post("/v1/audio/clone")
async def clone_voice(
    name: str = Form(...),
    note: Optional[str] = Form(None),
    sample: UploadFile = None,
) -> dict:
    """注册用户上传的样本作为一个 voice。"""
    if sample is None:
        raise HTTPException(status_code=400, detail="sample required")
    suffix = Path(sample.filename or "sample.wav").suffix or ".wav"
    target = VOICE_DIR / f"{name}{suffix}"
    target.write_bytes(await sample.read())
    REGISTRY[name] = VoiceEntry(
        id=name, kind="sample", sample_path=str(target), note=note or "用户样本"
    )
    _save_registry(REGISTRY)
    return REGISTRY[name].model_dump()


# ---------- STT (whisper) ----------

_whisper_model = None
_whisper_size = os.environ.get("LUVU_WHISPER_MODEL", "small")


def _get_whisper():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel  # type: ignore

        _whisper_model = (
            "faster_whisper",
            WhisperModel(_whisper_size, device="cpu", compute_type="int8"),
        )
        return _whisper_model
    except ImportError:
        pass
    try:
        import whisper  # type: ignore

        _whisper_model = ("openai_whisper", whisper.load_model(_whisper_size))
        return _whisper_model
    except ImportError:
        return None


@app.post("/v1/audio/transcribe")
async def transcribe(file: UploadFile) -> dict:
    """接受 WAV 文件，返回 {text: ...}。"""
    if file is None:
        raise HTTPException(status_code=400, detail="file required")
    data = await file.read()
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(data)
        path = f.name

    handle = _get_whisper()
    if handle is None:
        raise HTTPException(
            status_code=500,
            detail="whisper 未安装。运行：bash sidecar/install.sh 或 pip install faster-whisper",
        )
    kind, model = handle
    try:
        if kind == "faster_whisper":
            segments, _ = model.transcribe(path, language="zh", beam_size=1)
            text = "".join(s.text for s in segments).strip()
        else:
            result = model.transcribe(path, language="zh")
            text = (result.get("text") or "").strip()
    except Exception as e:
        log.error(f"whisper failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass

    return {"text": text}


class RegisterBatchRequest(BaseModel):
    dir: str
    """目录下每个子目录会被注册为一个 voice，子目录名做 voice id。"""


@app.post("/v1/audio/register-batch")
def register_batch(req: RegisterBatchRequest) -> dict:
    root = Path(req.dir).expanduser()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=400, detail=f"dir not found: {root}")

    registered: List[str] = []
    for sub in root.iterdir():
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        # 找第一个音频文件
        audio = next(
            (f for f in sub.iterdir() if f.suffix.lower() in {".wav", ".mp3", ".m4a", ".aac", ".ogg"}),
            None,
        )
        if audio is None:
            continue
        vid = f"clone_{sub.name}"
        REGISTRY[vid] = VoiceEntry(
            id=vid, kind="sample", sample_path=str(audio), note=f"来自 {sub.name}"
        )
        registered.append(vid)
    _save_registry(REGISTRY)
    return {"registered": registered, "total": len(REGISTRY)}


# ---------- 工具 ----------


def _silent_wav(duration_sec: float, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n_samples)
    return buf.getvalue()


@app.on_event("startup")
async def on_start() -> None:
    log.info(f"LUVU TTS sidecar v{app.version} started. backend={DEFAULT_BACKEND}")
    log.info(f"registered voices: {list(REGISTRY.keys())}")
