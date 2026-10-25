"""Download the models: Kokoro (Apache 2.0) and the faster-whisper alignment model. Skips what is already there.

Request:  {"modelDir", "whisperModel"}
Response: {"kokoro": [...files], "whisper": "<model>"}
"""
import os
import sys
import urllib.request

from protocol import run

KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_FILES = {"kokoro-v1.0.onnx": 300_000_000, "voices-v1.0.bin": 20_000_000}  # rough minimum sizes, to catch a truncated download


def download(url: str, dest: str, min_size: int) -> None:
    if os.path.exists(dest) and os.path.getsize(dest) >= min_size:
        return
    tmp = dest + ".part"
    print(f"downloading {os.path.basename(dest)}", file=sys.stderr)
    urllib.request.urlretrieve(url, tmp)
    if os.path.getsize(tmp) < min_size:
        raise RuntimeError(f"{os.path.basename(dest)} downloaded too small ({os.path.getsize(tmp)} bytes)")
    os.replace(tmp, dest)


def handle(request):
    kokoro_dir = os.path.join(request["modelDir"], "kokoro")
    os.makedirs(kokoro_dir, exist_ok=True)
    for name, min_size in KOKORO_FILES.items():
        download(f"{KOKORO_BASE}/{name}", os.path.join(kokoro_dir, name), min_size)

    from faster_whisper import WhisperModel  # imported late: it is only needed here to trigger the download

    WhisperModel(request.get("whisperModel", "base.en"), device="cpu", compute_type="int8", download_root=os.path.join(request["modelDir"], "whisper"))
    return {"kokoro": sorted(KOKORO_FILES), "whisper": request.get("whisperModel", "base.en")}


if __name__ == "__main__":
    run(handle)
