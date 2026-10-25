import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createElevenLabsEngine, wordsFromCharacters } from './elevenlabs.js';
import type { SynthRequest, SynthResult, TtsEngine, WordAligner } from './engine.js';
import { concatPreview, generateVoice, lineHash, type VoiceRun } from './generate.js';
import { ManifestSchema } from './manifest.js';
import { createPiperEngine } from './piper.js';
import { wavDurationMs } from './wav.js';
import type { WhisperWord } from './align.js';

/** A valid 16-bit mono WAV of the given length, so durations can be read back from real files. */
const wav = (ms: number, rate = 24000): Buffer => {
  const samples = Math.round((ms / 1000) * rate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples * 2, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
};

const MS_PER_TOKEN = 300;
const tokens = (text: string) => text.split(/[^A-Za-z0-9]+/).filter(Boolean);

type Calls = { synth: string[][]; align: string[][] };
const mockEngine = (calls: Calls, over: Partial<TtsEngine> & { withHeard?: boolean } = {}): TtsEngine => ({
  name: 'mock', model: 'm1', voice: 'v1', speed: 1.1, extension: 'wav',
  async synthesize(requests: SynthRequest[]): Promise<SynthResult[]> {
    calls.synth.push(requests.map((r) => r.text));
    const out: SynthResult[] = [];
    for (const r of requests) {
      const durationMs = tokens(r.text).length * MS_PER_TOKEN;
      await mkdir(join(r.outPath, '..'), { recursive: true });
      await writeFile(r.outPath, wav(durationMs));
      out.push({ key: r.key, audioPath: r.outPath, durationMs, heard: over.withHeard ? heardFor(r.text) : undefined });
    }
    return out;
  },
  ...over,
});

/** What a perfect Whisper would hear for a text. */
const heardFor = (text: string): WhisperWord[] => tokens(text).map((word, i) => ({ word, startMs: i * MS_PER_TOKEN, endMs: (i + 1) * MS_PER_TOKEN }));

const mockAligner = (calls: Calls): WordAligner => ({
  async align(files) {
    calls.align.push(files.map((f) => f.key));
    return Promise.all(files.map(async (f) => {
      const ms = wavDurationMs(await readFile(f.path));
      const n = ms / MS_PER_TOKEN;
      return { key: f.key, words: Array.from({ length: n }, (_, i) => ({ word: `w${i}`, startMs: i * MS_PER_TOKEN, endMs: (i + 1) * MS_PER_TOKEN })) };
    }));
  },
});

const RUN: VoiceRun = {
  id: 'test-run',
  voiceover: { hook: 'Can this team beat the Elite Four?', outro: 'Would you run it?' },
  picks: [
    { pokemon: 'nidoqueen', name: 'Nidoqueen', line: { text: 'For Agatha, we need an answer, and Nidoqueen is it. Dig comes from TM28.' } },
    { pokemon: 'raichu', name: 'Raichu', line: { text: 'Raichu is how we deal with Lance.' } },
    { pokemon: 'snorlax', name: 'Snorlax', line: { text: 'Snorlax joins the team next.' } },
  ],
};
const RESPELL = { nidoqueen: 'NEE-doh-kween', agatha: 'AG-uh-thuh' };

let root: string;
let calls: Calls;
const opts = (over: Record<string, unknown> = {}) => ({
  run: RUN, engine: mockEngine(calls), aligner: mockAligner(calls), respellings: RESPELL,
  cacheDir: join(root, 'cache'), outDir: join(root, 'out', RUN.id), ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pokevidgen-voice-'));
  calls = { synth: [], align: [] };
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('generateVoice caching', () => {
  it('synthesizes every line once, then does zero synthesis and zero alignment on an unchanged run', async () => {
    const first = await generateVoice(opts());
    expect(first.generated).toHaveLength(5); // hook + 3 picks + outro
    expect(calls.synth).toHaveLength(1); // one batch
    expect(calls.synth[0]).toHaveLength(5);
    expect(calls.align[0]).toHaveLength(5);

    calls.synth.length = 0; calls.align.length = 0;
    const second = await generateVoice(opts());
    expect(calls.synth).toHaveLength(0);
    expect(calls.align).toHaveLength(0);
    expect(second.cached).toHaveLength(5);
    expect(second.manifest).toEqual(first.manifest);
  });

  it('regenerates only the line that was edited', async () => {
    await generateVoice(opts());
    calls.synth.length = 0; calls.align.length = 0;
    const edited: VoiceRun = { ...RUN, picks: RUN.picks.map((p) => (p.pokemon === 'raichu' ? { ...p, line: { text: 'Raichu is a great pick for Lance.' } } : p)) };
    const result = await generateVoice(opts({ run: edited }));
    expect(result.generated).toEqual(['raichu']);
    expect(calls.synth).toEqual([['Raichu is a great pick for Lance.']]);
    expect(calls.align).toEqual([['raichu']]);
  });

  it('regenerates everything when the voice or speed changes, because they are part of the cache key', async () => {
    await generateVoice(opts());
    calls.synth.length = 0;
    expect((await generateVoice(opts({ engine: mockEngine(calls, { voice: 'v2' }) }))).generated).toHaveLength(5);
    expect((await generateVoice(opts({ engine: mockEngine(calls, { speed: 1.3 }) }))).generated).toHaveLength(5);
    expect((await generateVoice(opts({ engine: mockEngine(calls, { model: 'm2' }) }))).generated).toHaveLength(5);
  });

  it('keys the cache on the text after pronunciation: a new respelling regenerates only lines with that word', async () => {
    await generateVoice(opts());
    calls.synth.length = 0;
    const result = await generateVoice(opts({ respellings: { ...RESPELL, nidoqueen: 'NID-oh-kween' } }));
    expect(result.generated).toEqual(['nidoqueen']);
    expect(lineHash(mockEngine(calls), 'a')).not.toBe(lineHash(mockEngine(calls), 'b'));
  });

  it('turning respelling off changes the speech text, so affected lines regenerate', async () => {
    await generateVoice(opts());
    const off = await generateVoice(opts({ respell: false }));
    expect(off.generated.sort()).toEqual(['nidoqueen']); // only the line with respelled words differs
  });
});

describe('generateVoice output', () => {
  it('sends respelled text to the engine but keeps the script\'s own words in the manifest', async () => {
    const { manifest } = await generateVoice(opts());
    const sent = calls.synth.flat().join(' | ');
    expect(sent).toContain('Nee-doh-kween');
    expect(sent).toContain('Ag-uh-thuh');
    expect(sent).toContain('T M 28'); // codes are read letter by letter
    const line = manifest!.lines.find((l) => l.key === 'nidoqueen')!;
    expect(line.words.map((w) => w.word)).toEqual(RUN.picks[0]!.line.text.split(/\s+/));
    expect(line.words.map((w) => w.word).join(' ')).not.toMatch(/nee-doh/i);
  });

  it('writes one file per line and a valid manifest the video can read', async () => {
    await generateVoice(opts());
    const files = (await readdir(join(root, 'out', RUN.id))).sort();
    expect(files).toEqual(['hook.wav', 'manifest.json', 'nidoqueen.wav', 'outro.wav', 'raichu.wav', 'snorlax.wav']);
    const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(root, 'out', RUN.id, 'manifest.json'), 'utf8')));
    expect(manifest.settings).toMatchObject({ engine: 'mock', voice: 'v1', speed: 1.1, respell: true });
    expect(manifest.lines.map((l) => l.key)).toEqual(['hook', 'nidoqueen', 'raichu', 'snorlax', 'outro']);
    for (const l of manifest.lines) {
      expect(l.file).toBe(`voice/${RUN.id}/${l.key}.wav`); // relative to the video's public folder
      expect(l.durationMs).toBeGreaterThan(0);
      expect(l.words.at(-1)!.endMs).toBeLessThanOrEqual(l.durationMs);
    }
  });

  it('measures duration from the audio the engine produced', async () => {
    const { manifest } = await generateVoice(opts());
    const raichu = manifest!.lines.find((l) => l.key === 'raichu')!;
    expect(raichu.durationMs).toBe(tokens('Raichu is how we deal with Lance.').length * MS_PER_TOKEN);
  });

  it('skips Whisper for engines that report their own word timings', async () => {
    await generateVoice(opts({ engine: mockEngine(calls, { withHeard: true }) }));
    expect(calls.align).toHaveLength(0);
  });

  it('fails clearly if the engine drops a line', async () => {
    const broken: TtsEngine = { ...mockEngine(calls), synthesize: async () => [] };
    await expect(generateVoice(opts({ engine: broken }))).rejects.toThrow(/returned nothing for "hook"/);
  });
});

describe('dry run', () => {
  it('reports what would be generated and the characters, without calling the engine or writing anything', async () => {
    const result = await generateVoice(opts({ dryRun: true }));
    expect(calls.synth).toHaveLength(0);
    expect(calls.align).toHaveLength(0);
    expect(result.generated).toHaveLength(5);
    expect(result.characters).toBe(result.lines.reduce((s, l) => s + l.spoken.length, 0));
    expect(result.manifest).toBeUndefined();
    await expect(readdir(join(root, 'out'))).rejects.toThrow();
  });

  it('counts only the lines that are not cached', async () => {
    await generateVoice(opts());
    const edited: VoiceRun = { ...RUN, voiceover: { ...RUN.voiceover, outro: 'A brand new outro line.' } };
    const result = await generateVoice(opts({ run: edited, dryRun: true }));
    expect(result.generated).toEqual(['outro']);
    expect(result.characters).toBe('A brand new outro line.'.length);
  });
});

describe('wavDurationMs', () => {
  it('reads the duration from a WAV header', () => {
    expect(wavDurationMs(wav(1500))).toBe(1500);
    expect(wavDurationMs(wav(250, 16000))).toBe(250);
    expect(() => wavDurationMs(Buffer.from('not a wav file at all, sorry'))).toThrow(/Not a WAV/);
  });
});

describe('ElevenLabs (mocked HTTP)', () => {
  const alignment = { characters: [...'Hi you'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.7] };

  it('turns character timings into words', () => {
    expect(wordsFromCharacters(alignment)).toEqual([{ word: 'Hi', startMs: 0, endMs: 200 }, { word: 'you', startMs: 300, endMs: 700 }]);
  });

  it('posts the text with the key and voice, writes the audio, and returns its own word timings', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ audio_base64: Buffer.from('mp3-bytes').toString('base64'), alignment }), { status: 200 });
    }) as unknown as typeof fetch;
    const engine = createElevenLabsEngine({ apiKey: 'k', voiceId: 'voice123', speed: 1.1, fetchImpl });
    expect(engine.extension).toBe('mp3');
    expect(engine.describeCost!(1234)).toMatch(/1234 characters.*non-commercial/);
    const out = join(root, 'e', 'a.mp3');
    const [result] = await engine.synthesize([{ key: 'a', text: 'Hi you', outPath: out }]);
    expect(seen[0]!.url).toContain('/v1/text-to-speech/voice123/with-timestamps');
    expect((seen[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ text: 'Hi you', voice_settings: { speed: 1.1 } });
    expect(await readFile(out, 'utf8')).toBe('mp3-bytes');
    expect(result).toMatchObject({ key: 'a', durationMs: 700 });
    expect(result!.heard).toHaveLength(2);
  });

  it('reports API errors and refuses to start without a key or voice', async () => {
    const fail = (async () => new Response('quota exceeded', { status: 401 })) as unknown as typeof fetch;
    const engine = createElevenLabsEngine({ apiKey: 'k', voiceId: 'v', fetchImpl: fail });
    await expect(engine.synthesize([{ key: 'a', text: 'x', outPath: join(root, 'x.mp3') }])).rejects.toThrow(/401.*quota exceeded/);
    const saved = process.env['ELEVENLABS_API_KEY'];
    delete process.env['ELEVENLABS_API_KEY'];
    expect(() => createElevenLabsEngine({ voiceId: 'v' })).toThrow(/ELEVENLABS_API_KEY/);
    expect(() => createElevenLabsEngine({ apiKey: 'k' })).toThrow(/ELEVENLABS_VOICE_ID/);
    if (saved) process.env['ELEVENLABS_API_KEY'] = saved;
  });
});

describe('Piper', () => {
  it('needs a voice model', () => {
    const saved = process.env['PIPER_MODEL'];
    delete process.env['PIPER_MODEL'];
    expect(() => createPiperEngine()).toThrow(/PIPER_MODEL/);
    if (saved) process.env['PIPER_MODEL'] = saved;
  });

  it('runs the command with the model and a length scale from the speed, feeds text on stdin, and reads the duration', async () => {
    const script = join(root, 'fake-piper.sh');
    // Writes a 500 ms WAV to the --output_file argument and records its arguments and stdin.
    await writeFile(script, `#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "--output_file" ]; then out="$2"; fi; echo "$1" >> "${root}/args.txt"; shift; done\ncat > "${root}/stdin.txt"\ncp "${root}/half-second.wav" "$out"\n`, { mode: 0o755 });
    await writeFile(join(root, 'half-second.wav'), wav(500));
    const engine = createPiperEngine({ model: '/models/voice.onnx', speed: 2, command: script });
    const [r] = await engine.synthesize([{ key: 'k', text: 'Hello there', outPath: join(root, 'p.wav') }]);
    expect(r).toMatchObject({ key: 'k', durationMs: 500 });
    expect(await readFile(join(root, 'stdin.txt'), 'utf8')).toBe('Hello there\n');
    const args = (await readFile(join(root, 'args.txt'), 'utf8')).split('\n');
    expect(args).toEqual(expect.arrayContaining(['--model', '/models/voice.onnx', '--length_scale', '0.5']));
  });
});

describe('concatPreview (real ffmpeg)', () => {
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  it.skipIf(!hasFfmpeg)('joins lines with a gap between them', async () => {
    await writeFile(join(root, 'a.wav'), wav(1000));
    await writeFile(join(root, 'b.wav'), wav(2000));
    const out = join(root, 'preview.wav');
    await concatPreview([join(root, 'a.wav'), join(root, 'b.wav')], out, 0.25);
    expect(wavDurationMs(await readFile(out))).toBeGreaterThanOrEqual(3400);
    expect(wavDurationMs(await readFile(out))).toBeLessThanOrEqual(3600);
    await expect(concatPreview([], out)).rejects.toThrow(/No audio/);
  });
});
