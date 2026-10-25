import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WhisperWord } from './align.js';
import type { SynthRequest, SynthResult, TtsEngine } from './engine.js';

type Fetch = typeof fetch;

type Timestamped = {
  audio_base64: string;
  alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
};

/** Character-level timings → words (split on whitespace), in the shape Whisper words have. */
export const wordsFromCharacters = (a: Timestamped['alignment']): WhisperWord[] => {
  const words: WhisperWord[] = [];
  let current = '';
  let start = 0;
  let end = 0;
  const flush = () => {
    if (current) words.push({ word: current, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
    current = '';
  };
  for (const [i, ch] of a.characters.entries()) {
    if (/\s/.test(ch)) { flush(); continue; }
    if (!current) start = a.character_start_times_seconds[i]!;
    current += ch;
    end = a.character_end_times_seconds[i]!;
  }
  flush();
  return words;
};

/**
 * ElevenLabs: optional and paid. It reports its own word timings, so Whisper is skipped. Licensing: free-plan
 * output is non-commercial and needs attribution; commercial use needs a paid plan. Never clone someone's voice.
 * Untested against the live API; request and response handling are covered with a mocked `fetch`.
 */
export const createElevenLabsEngine = (opts: { apiKey?: string; voiceId?: string; speed?: number; model?: string; fetchImpl?: Fetch } = {}): TtsEngine => {
  const apiKey = opts.apiKey ?? process.env['ELEVENLABS_API_KEY'];
  const voiceId = opts.voiceId ?? process.env['ELEVENLABS_VOICE_ID'];
  if (!apiKey) throw new Error('ElevenLabs needs ELEVENLABS_API_KEY.');
  if (!voiceId) throw new Error('ElevenLabs needs ELEVENLABS_VOICE_ID (a voice you are allowed to use).');
  const model = opts.model ?? 'eleven_multilingual_v2';
  const speed = opts.speed ?? 1.1;
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: 'elevenlabs',
    model,
    voice: voiceId,
    speed,
    extension: 'mp3',
    describeCost: (characters) => `${characters} characters will be billed by ElevenLabs. Free-plan audio is non-commercial and needs attribution.`,
    async synthesize(requests: SynthRequest[]): Promise<SynthResult[]> {
      const out: SynthResult[] = [];
      for (const r of requests) {
        const res = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: r.text, model_id: model, voice_settings: { speed } }),
        });
        if (!res.ok) throw new Error(`ElevenLabs returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as Timestamped;
        await mkdir(dirname(r.outPath), { recursive: true });
        await writeFile(r.outPath, Buffer.from(body.audio_base64, 'base64'));
        const heard = wordsFromCharacters(body.alignment);
        const last = body.alignment.character_end_times_seconds.at(-1) ?? 0;
        out.push({ key: r.key, audioPath: r.outPath, durationMs: Math.round(last * 1000), heard });
      }
      return out;
    },
  };
};
