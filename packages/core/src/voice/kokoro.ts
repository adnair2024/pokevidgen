import { WhisperModelName } from './whisper.js';
import type { TtsEngine, SynthRequest, SynthResult, WordAligner } from './engine.js';
import { MODEL_DIR, callSidecar } from './sidecar.js';

export const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'] as const;

export const DEFAULT_KOKORO_VOICE = 'af_heart';
export const DEFAULT_KOKORO_SPEED = 1.1;

/** Kokoro (Apache 2.0, ONNX, CPU) through the Python sidecar. */
export const createKokoroEngine = (opts: { voice?: string; speed?: number } = {}): TtsEngine => {
  const voice = opts.voice ?? DEFAULT_KOKORO_VOICE;
  const speed = opts.speed ?? DEFAULT_KOKORO_SPEED;
  return {
    name: 'kokoro',
    model: 'kokoro-v1.0',
    voice,
    speed,
    extension: 'wav',
    async synthesize(requests: SynthRequest[]): Promise<SynthResult[]> {
      const res = await callSidecar<{ lines: Array<{ key: string; audioPath: string; durationMs: number }> }>('kokoro_tts.py', {
        modelDir: MODEL_DIR, voice, speed, lang: 'en-us',
        lines: requests.map((r) => ({ key: r.key, text: r.text, outPath: r.outPath })),
      });
      return res.lines;
    },
  };
};

/** faster-whisper through the sidecar. */
export const createWhisperAligner = (model: string = WhisperModelName): WordAligner => ({
  async align(files) {
    const res = await callSidecar<{ files: Array<{ key: string; words: Array<{ word: string; startMs: number; endMs: number }> }> }>('align_whisper.py', {
      modelDir: MODEL_DIR, model, files,
    });
    return res.files;
  },
});
