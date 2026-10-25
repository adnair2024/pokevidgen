"""Synthesize narration lines with Kokoro (ONNX, CPU).

Request:  {"modelDir", "voice", "speed", "lang", "lines": [{"key", "text", "outPath"}]}
Response: {"lines": [{"key", "audioPath", "durationMs", "sampleRate"}]}

Leading and trailing silence is trimmed from every file, and durationMs is measured from the trimmed audio.
"""
import os

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

from protocol import run

SILENCE_THRESHOLD = 0.01  # amplitude below this counts as silence
PAD_SECONDS = 0.04  # keep a little air around the speech


def trim(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    loud = np.flatnonzero(np.abs(samples) > SILENCE_THRESHOLD)
    if loud.size == 0:
        return samples
    pad = int(PAD_SECONDS * sample_rate)
    return samples[max(0, loud[0] - pad) : min(len(samples), loud[-1] + pad + 1)]


def handle(request):
    model_dir = request["modelDir"]
    kokoro = Kokoro(os.path.join(model_dir, "kokoro", "kokoro-v1.0.onnx"), os.path.join(model_dir, "kokoro", "voices-v1.0.bin"))
    out = []
    for line in request["lines"]:
        samples, sample_rate = kokoro.create(line["text"], voice=request["voice"], speed=float(request["speed"]), lang=request.get("lang", "en-us"))
        samples = trim(np.asarray(samples, dtype=np.float32), sample_rate)
        os.makedirs(os.path.dirname(line["outPath"]), exist_ok=True)
        sf.write(line["outPath"], samples, sample_rate)
        out.append({"key": line["key"], "audioPath": line["outPath"], "durationMs": round(len(samples) / sample_rate * 1000), "sampleRate": sample_rate})
    return {"lines": out}


if __name__ == "__main__":
    run(handle)
