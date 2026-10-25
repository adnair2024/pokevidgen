import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ManifestSchema, PronunciationsFileSchema, cacheDir, createKokoroEngine, curatedDir, engineStub, exists, generateVoice, loadPronunciations,
  manifestIsFresh, repoDir, voicePublicDir, voiceReady, type EngineName, type LineStatus, type Manifest, type PronunciationsFile, type Run,
} from '@pokevidgen/core';

export type VoiceSettings = { engine: EngineName; voice: string; speed: number; respell: boolean };

export type VoiceStatus = { lines: LineStatus[]; characters: number; needed: string[]; cost?: string };

/** Everything the dashboard needs from the voice layer, behind one interface so tests can replace it. */
export interface VoiceService {
  ready(): Promise<{ ready: boolean; missing: string[] }>;
  /** What generating with these settings would do, without calling any engine. */
  status(run: Run, settings: VoiceSettings): Promise<VoiceStatus>;
  manifest(runId: string): Promise<Manifest | undefined>;
  /** True only if the saved audio still matches the script. */
  fresh(run: Run, manifest: Manifest): Promise<boolean>;
  /** Speak "Next up is X." with a respelling, for tuning by ear. Returns a file name under /voice-audition/. */
  audition(word: string, respelling: string, settings: VoiceSettings): Promise<string>;
  pronunciations(): Promise<PronunciationsFile>;
  savePronunciations(file: PronunciationsFile): Promise<void>;
  /** Where a run's audio files live, and where audition clips live. */
  runDir(runId: string): string;
  auditionDir(): string;
}

export const createVoiceService = (): VoiceService => ({
  ready: () => voiceReady(),

  async status(run, settings) {
    const respellings = (await loadPronunciations()).words;
    const engine = engineStub(settings.engine, { voice: settings.voice, speed: settings.speed });
    const result = await generateVoice({
      run, engine, respellings, respell: settings.respell, cacheDir: cacheDir('voice'), outDir: voicePublicDir(run.id), dryRun: true,
      aligner: { align: async () => [] },
    });
    return { lines: result.lines, characters: result.characters, needed: result.generated, cost: engine.describeCost?.(result.characters) };
  },

  async manifest(runId) {
    const path = join(voicePublicDir(runId), 'manifest.json');
    return (await exists(path)) ? ManifestSchema.parse(JSON.parse(await readFile(path, 'utf8'))) : undefined;
  },

  async fresh(run, manifest) {
    return manifestIsFresh(run, manifest, (await loadPronunciations()).words, cacheDir('voice'));
  },

  async audition(word, respelling, settings) {
    const dir = cacheDir('voice', 'audition');
    const text = respelling.trim() ? respelling.trim().toLowerCase().replace(/^./, (c) => c.toUpperCase()) : word;
    const name = createHash('sha256').update(JSON.stringify([settings.voice, settings.speed, text])).digest('hex').slice(0, 20) + '.wav';
    if (!(await exists(join(dir, name)))) {
      await mkdir(dir, { recursive: true });
      await createKokoroEngine({ voice: settings.voice, speed: settings.speed }).synthesize([{ key: 'audition', text: `Next up is ${text}, and it is great.`, outPath: join(dir, name) }]);
    }
    return name;
  },

  pronunciations: () => loadPronunciations(),
  async savePronunciations(file) {
    await writeFile(curatedDir('pronunciations.json'), JSON.stringify(PronunciationsFileSchema.parse(file), null, 2) + '\n');
  },
  runDir: (runId) => voicePublicDir(runId),
  auditionDir: () => cacheDir('voice', 'audition'),
});

export const defaultSettings = (): VoiceSettings => ({
  engine: 'kokoro',
  voice: process.env['KOKORO_VOICE'] ?? 'af_heart',
  speed: process.env['KOKORO_SPEED'] ? Number(process.env['KOKORO_SPEED']) : 1.1,
  respell: true,
});

export const publicVoiceRoot = (): string => repoDir('packages', 'video', 'public', 'voice');
