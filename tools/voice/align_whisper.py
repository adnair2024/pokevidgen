"""Word timestamps with faster-whisper (CPU, int8).

Request:  {"modelDir", "model", "files": [{"key", "path"}]}
Response: {"files": [{"key", "words": [{"word", "startMs", "endMs"}]}]}

These are Whisper's words, which are often wrong for Pokemon names. The caller matches them back
onto the script's own words; Whisper's text is never used for captions.
"""
import os

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

from protocol import run


WHISPER_RATE = 16000


def load_audio(path: str) -> np.ndarray:
    """Read a WAV as mono float32 at 16 kHz. Done here so Whisper never has to decode files itself."""
    samples, rate = sf.read(path, dtype="float32", always_2d=True)
    mono = samples.mean(axis=1)
    if rate != WHISPER_RATE:
        divisor = np.gcd(rate, WHISPER_RATE)
        mono = resample_poly(mono, WHISPER_RATE // divisor, rate // divisor).astype(np.float32)
    return mono


def handle(request):
    model = WhisperModel(
        request.get("model", "base.en"),
        device="cpu",
        compute_type="int8",
        download_root=os.path.join(request["modelDir"], "whisper"),
    )
    out = []
    for file in request["files"]:
        segments, _info = model.transcribe(load_audio(file["path"]), word_timestamps=True, language="en", beam_size=1, vad_filter=False)
        words = [
            {"word": w.word.strip(), "startMs": round(w.start * 1000), "endMs": round(w.end * 1000)}
            for segment in segments
            for w in (segment.words or [])
            if w.word.strip()
        ]
        out.append({"key": file["key"], "words": words})
    return {"files": out}


if __name__ == "__main__":
    run(handle)
