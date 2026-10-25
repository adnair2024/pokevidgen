"""Score pronunciation respellings: speak each word raw and respelled, transcribe with Whisper, compare to the name.

Request:  {"modelDir", "voice", "speed", "entries": [{"word", "respelling"}]}
Response: {"results": [{"word", "respelling", "rawHeard", "respelledHeard", "rawScore", "respelledScore"}]}

Whisper is a proxy for "a listener understands the name", not ground truth, so scores guide a choice; they do not
replace listening. Progress goes to stderr.
"""
import os
import re
import sys
from difflib import SequenceMatcher

import numpy as np
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly

from protocol import run

FRAME = "Next up is {}, and it is great."


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def score(word: str, heard: str) -> float:
    match = re.search(r"next up is (.*?),? and it is great", heard, re.I)
    return SequenceMatcher(None, norm(word), norm(match.group(1) if match else heard)).ratio()


def handle(request):
    model_dir = request["modelDir"]
    kokoro = Kokoro(os.path.join(model_dir, "kokoro", "kokoro-v1.0.onnx"), os.path.join(model_dir, "kokoro", "voices-v1.0.bin"))
    whisper = WhisperModel("base.en", device="cpu", compute_type="int8", download_root=os.path.join(model_dir, "whisper"))

    def heard(text: str) -> str:
        samples, rate = kokoro.create(FRAME.format(text), voice=request["voice"], speed=float(request["speed"]), lang="en-us")
        audio = resample_poly(np.asarray(samples, dtype=np.float32), 16000 // np.gcd(rate, 16000), rate // np.gcd(rate, 16000)).astype(np.float32)
        segments, _ = whisper.transcribe(audio, language="en", beam_size=1)
        return " ".join(s.text.strip() for s in segments)

    results = []
    entries = request["entries"]
    for i, entry in enumerate(entries):
        word = entry["word"]
        raw = word[0].upper() + word[1:]
        spoken = entry["respelling"].lower()
        spoken = spoken[0].upper() + spoken[1:]
        raw_heard, resp_heard = heard(raw), heard(spoken)
        results.append({
            "word": word, "respelling": entry["respelling"], "rawHeard": raw_heard, "respelledHeard": resp_heard,
            "rawScore": round(score(word, raw_heard), 3), "respelledScore": round(score(word, resp_heard), 3),
        })
        print(f"[{i + 1}/{len(entries)}] {word}: raw {results[-1]['rawScore']} / respelled {results[-1]['respelledScore']}", file=sys.stderr, flush=True)
    return {"results": results}


if __name__ == "__main__":
    run(handle)
