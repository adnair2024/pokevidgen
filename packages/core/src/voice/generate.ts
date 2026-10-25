import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, repoDir } from '../data/cache.js';
import { alignWords, type WhisperWord } from './align.js';
import type { SynthRequest, TtsEngine, WordAligner } from './engine.js';
import { ManifestSchema, type Manifest } from './manifest.js';
import { toSpoken } from './pronounce.js';

/** The narration of a run: what is said, in order. */
export type VoiceRun = {
  id: string;
  voiceover: { hook: string; outro: string };
  picks: Array<{ pokemon: string; name: string; line: { text: string } }>;
};

/** Where a run's audio and manifest go: the video reads them through `staticFile()`. */
export const voicePublicDir = (runId: string): string => repoDir('packages', 'video', 'public', 'voice', runId);

export type LineStatus = { key: string; text: string; spoken: string; hash: string; cached: boolean };

export type GenerateOptions = {
  run: VoiceRun;
  engine: TtsEngine;
  aligner: WordAligner;
  respellings: Readonly<Record<string, string>>;
  /** Apply pronunciation respellings to the speech text (captions are never affected). Default true. */
  respell?: boolean;
  /** Content-addressed cache: the same line is never synthesized twice. */
  cacheDir: string;
  /** Where the per-line audio and manifest.json are written. */
  outDir: string;
  /** Report what would be generated and its cost, without touching the engine. */
  dryRun?: boolean;
  onLog?: (line: string) => void;
};

export type GenerateResult = {
  manifest?: Manifest;
  lines: LineStatus[];
  generated: string[];
  cached: string[];
  /** Characters that would be (or were) sent to the engine for lines that were not cached. */
  characters: number;
};

type CacheMeta = { durationMs: number; heard?: WhisperWord[] };

/** hash(engine, model, voice, speed, text after pronunciation) */
export const lineHash = (engine: Pick<TtsEngine, 'name' | 'model' | 'voice' | 'speed'>, spokenText: string): string =>
  createHash('sha256').update(JSON.stringify([engine.name, engine.model, engine.voice, engine.speed, spokenText])).digest('hex').slice(0, 24);

const narration = (run: VoiceRun): Array<{ key: string; text: string }> => [
  { key: 'hook', text: run.voiceover.hook },
  ...run.picks.map((p) => ({ key: p.pokemon, text: p.line.text })),
  { key: 'outro', text: run.voiceover.outro },
];

const readMeta = async (path: string): Promise<CacheMeta | undefined> => ((await exists(path)) ? (JSON.parse(await readFile(path, 'utf8')) as CacheMeta) : undefined);

/**
 * script → audio → timing. One file per line, so editing a line regenerates only that line; word timings
 * are recomputed every time from the cached Whisper words, so improving the matcher needs no re-synthesis.
 */
export const generateVoice = async (opts: GenerateOptions): Promise<GenerateResult> => {
  const { run, engine, aligner, cacheDir: cache, outDir } = opts;
  const log = opts.onLog ?? (() => {});
  const respell = opts.respell ?? true;
  await mkdir(cache, { recursive: true });

  const plan = await Promise.all(
    narration(run).map(async ({ key, text }) => {
      const spoken = toSpoken(text, opts.respellings, respell);
      const hash = lineHash(engine, spoken.text);
      const audio = join(cache, `${hash}.${engine.extension}`);
      const cached = (await exists(audio)) && (await exists(join(cache, `${hash}.json`)));
      return { key, text, spoken, hash, audio, meta: join(cache, `${hash}.json`), cached };
    }),
  );
  const status: LineStatus[] = plan.map((p) => ({ key: p.key, text: p.text, spoken: p.spoken.text, hash: p.hash, cached: p.cached }));
  const todo = plan.filter((p) => !p.cached);
  const characters = todo.reduce((s, p) => s + p.spoken.text.length, 0);
  const base = { lines: status, generated: todo.map((p) => p.key), cached: plan.filter((p) => p.cached).map((p) => p.key), characters };
  if (opts.dryRun) return base;

  if (todo.length > 0) {
    log(`Synthesizing ${todo.length} of ${plan.length} lines (${plan.length - todo.length} cached)…`);
    const requests: SynthRequest[] = todo.map((p) => ({ key: p.key, text: p.spoken.text, outPath: p.audio }));
    const results = await engine.synthesize(requests);
    for (const p of todo) {
      const r = results.find((x) => x.key === p.key);
      if (!r) throw new Error(`The engine returned nothing for "${p.key}".`);
      await writeFile(p.meta, JSON.stringify({ durationMs: r.durationMs, heard: r.heard } satisfies CacheMeta));
    }
  } else {
    log('Every line is cached; nothing to synthesize.');
  }

  // Any line without Whisper words yet (new, or from an engine with no timestamps) gets aligned in one batch.
  const metas = new Map<string, CacheMeta>();
  for (const p of plan) metas.set(p.key, (await readMeta(p.meta))!);
  const needAlign = plan.filter((p) => !metas.get(p.key)!.heard);
  if (needAlign.length > 0) {
    log(`Aligning ${needAlign.length} line(s) with Whisper…`);
    const aligned = await aligner.align(needAlign.map((p) => ({ key: p.key, path: p.audio })));
    for (const p of needAlign) {
      const heard = aligned.find((a) => a.key === p.key)?.words ?? [];
      const meta = { ...metas.get(p.key)!, heard };
      metas.set(p.key, meta);
      await writeFile(p.meta, JSON.stringify(meta));
    }
  }

  await mkdir(outDir, { recursive: true });
  const lines: Manifest['lines'] = [];
  for (const p of plan) {
    const meta = metas.get(p.key)!;
    const file = `${p.key}.${engine.extension}`;
    await copyFile(p.audio, join(outDir, file));
    lines.push({
      key: p.key,
      file: `voice/${run.id}/${file}`,
      durationMs: meta.durationMs,
      words: alignWords(p.spoken.words, p.spoken.spoken, meta.heard ?? [], meta.durationMs),
    });
  }
  const manifest = ManifestSchema.parse({ settings: { engine: engine.name, model: engine.model, voice: engine.voice, speed: engine.speed, respell }, lines });
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`Wrote ${lines.length} lines and manifest.json`);
  return { ...base, manifest };
};

/** Join every line into one audio file with 250 ms between lines, to listen to the pacing. Needs ffmpeg. */
export const concatPreview = async (files: string[], outPath: string, gapSeconds = 0.25): Promise<void> => {
  if (files.length === 0) throw new Error('No audio to join.');
  const inputs = files.flatMap((f) => ['-i', f]);
  const filters = files.map((_, i) => `[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono,apad=pad_dur=${gapSeconds}[a${i}]`).join(';');
  const chain = files.map((_, i) => `[a${i}]`).join('');
  const args = ['-v', 'error', '-y', ...inputs, '-filter_complex', `${filters};${chain}concat=n=${files.length}:v=0:a=1[out]`, '-map', '[out]', outPath];
  await mkdir(join(outPath, '..'), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`Could not run ffmpeg: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().slice(-300)}`))));
  });
};

/**
 * Does the saved manifest still match the script? True only if every line is already in the cache for the
 * settings the manifest was made with, so audio from an older script is never played under new captions.
 */
export const manifestIsFresh = async (run: VoiceRun, manifest: Manifest, respellings: Readonly<Record<string, string>>, cache: string): Promise<boolean> => {
  const s = manifest.settings;
  if (!s) return false;
  const engine = { name: s.engine, model: s.model, voice: s.voice, speed: s.speed };
  const ext = manifest.lines[0]?.file.split('.').pop() ?? 'wav';
  const lines = narration(run);
  if (manifest.lines.length !== lines.length) return false;
  for (const { key, text } of lines) {
    const hash = lineHash(engine, toSpoken(text, respellings, s.respell).text);
    const entry = manifest.lines.find((l) => l.key === key);
    if (!entry || !(await exists(join(cache, `${hash}.${ext}`)))) return false;
  }
  return true;
};
