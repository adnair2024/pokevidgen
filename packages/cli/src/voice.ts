import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  MODEL_DIR, RunSchema, TeamSchema, buildRun, cacheDir, concatPreview, createEngine, createWhisperAligner, generateVoice, getGame, isEngineName,
  lintRun, loadDictionary, loadEnv, loadPlannerData, loadPronunciationWords, loadPronunciations, repoDir, voicePublicDir, voiceReady, type Run,
} from '@pokevidgen/core';

await loadEnv();

const [command, ...rest] = process.argv.slice(2);
const USAGE = `Usage:
  pnpm voice setup
  pnpm voice script   runs/<id>.json [--seed N]
  pnpm voice lint     runs/<id>.json [--speed 1.1]
  pnpm voice generate runs/<id>.json [--engine kokoro|piper|elevenlabs] [--voice name] [--speed 1.1] [--dry-run] [--no-respell]
  pnpm voice preview  runs/<id>.json
  pnpm voice tune     [--apply] [--reuse] [--min-raw 0.95] [--voice name] [--speed 1.1]
                      score respellings with Whisper (slow; --reuse reads the last scores). --apply drops a respelling only when
                      the plain spelling was transcribed at least --min-raw exactly and scored better.`;

if (!command || !['setup', 'script', 'lint', 'generate', 'preview', 'tune'].includes(command)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}

const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    engine: { type: 'string' }, voice: { type: 'string' }, speed: { type: 'string' }, seed: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, 'no-respell': { type: 'boolean', default: false }, apply: { type: 'boolean', default: false }, reuse: { type: 'boolean', default: false }, 'min-raw': { type: 'string' },
  },
});

const abs = (p: string) => (isAbsolute(p) ? p : resolve(repoDir(), p));
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const run = (cmd: string, args: string[], cwd: string, input?: string): Promise<void> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))));
    if (input) child.stdin!.end(input);
  });

const readRun = async (path: string): Promise<Run> => RunSchema.parse(JSON.parse(await readFile(abs(path), 'utf8')));

const speedOf = (): number | undefined => {
  if (values.speed === undefined) return undefined;
  const n = Number(values.speed);
  if (!Number.isFinite(n) || n < 0.5 || n > 2) fail('--speed must be a number between 0.5 and 2');
  return n;
};

try {
  if (command === 'setup') {
    await run('uv', ['sync'], repoDir('tools', 'voice'));
    // The model script is a sidecar like the others: one JSON request on stdin.
    await run(join(repoDir('tools', 'voice'), '.venv', 'bin', 'python'), ['setup_models.py'], repoDir('tools', 'voice'), JSON.stringify({ modelDir: MODEL_DIR, whisperModel: 'base.en' }));
    const state = await voiceReady();
    if (!state.ready) fail(`Still missing: ${state.missing.join(', ')}`);
    console.log('Voice is ready.');
  } else if (command === 'tune') {
    const file = repoDir('data', 'curated', 'pronunciations.json');
    const doc = JSON.parse(await readFile(file, 'utf8')) as { source: { note: string }; words: Record<string, string> };
    // Only real words: codes and abbreviations (tm, f, lt.) aren't spoken names.
    const entries = Object.entries(doc.words).filter(([w]) => /^[a-z]{3,}$/.test(w)).map(([word, respelling]) => ({ word, respelling }));
    const voice = values.voice ?? process.env['KOKORO_VOICE'] ?? 'af_heart';
    const speed = speedOf() ?? Number(process.env['KOKORO_SPEED'] ?? 1.1);
    const saved = cacheDir('voice', `tune-${voice}-${speed}.json`);
    type Scored = { word: string; respelling: string; rawHeard: string; respelledHeard: string; rawScore: number; respelledScore: number };
    let results: Scored[];
    if (values.reuse) {
      results = JSON.parse(await readFile(saved, 'utf8')) as Scored[];
      console.log(`Using ${results.length} saved scores from ${saved}`);
    } else {
      console.log(`Scoring ${entries.length} respellings with voice ${voice} at speed ${speed} (this takes a while)…`);
      const stdout = await new Promise<string>((resolveRun, reject) => {
        const child = spawn(join(repoDir('tools', 'voice'), '.venv', 'bin', 'python'), ['tune_pronunciations.py'], { cwd: repoDir('tools', 'voice'), stdio: ['pipe', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolveRun(out) : reject(new Error(`tune exited with code ${code}`))));
        child.stdin.end(JSON.stringify({ modelDir: MODEL_DIR, voice, speed, entries }));
      });
      results = (JSON.parse(stdout.trim().split('\n').at(-1)!) as { results: Scored[] }).results;
      await writeFile(saved, JSON.stringify(results, null, 2));
    }
    const minRaw = values['min-raw'] !== undefined ? Number(values['min-raw']) : 0.95;
    // Whisper rewards the spelling, not the sound, so a respelling "losing" can just mean it doesn't know a rare name.
    // Only drop one when the plain spelling was heard essentially exactly.
    const worse = results.filter((r) => r.respelledScore < r.rawScore && r.rawScore >= minRaw);
    for (const r of results) console.log(`${(worse.includes(r) ? 'drop' : 'keep').padEnd(5)} ${r.word.padEnd(12)} raw ${r.rawScore.toFixed(2)} ${JSON.stringify(r.rawHeard).slice(0, 40).padEnd(42)} respelled ${r.respelledScore.toFixed(2)} ${JSON.stringify(r.respelledHeard).slice(0, 40)}`);
    console.log(`\n${worse.length} of ${results.length} respellings are not needed: the plain spelling was heard at ${minRaw} or better and beat them.`);
    if (values.apply) {
      for (const r of worse) doc.words[r.word] = ''; // empty = checked, speak as written (so the lint knows it was not forgotten)
      doc.source.note += ` Tuned with Whisper on ${voice} at speed ${speed}: ${worse.length} respellings were set to plain (empty) because the plain spelling was transcribed at ${minRaw} or better and scored higher (${worse.map((r) => r.word).join(', ')}). Whisper rewards the spelling rather than the sound, so the rest were kept pending a listen.`;
      await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
      console.log(`Marked ${worse.length} entries as plain in pronunciations.json.`);
    } else {
      console.log('Run again with --apply to remove them.');
    }
  } else {
    const path = positionals[0];
    if (!path) fail(USAGE);
    const runFile = await readRun(path!);

    if (command === 'script') {
      const team = TeamSchema.parse(JSON.parse(await readFile(repoDir('teams', `${runFile.teamId}.json`), 'utf8')));
      const fresh = await buildRun(await loadPlannerData(getGame(team.target)), team, values.seed ? { seed: Number(values.seed) } : {});
      await writeFile(abs(path!), JSON.stringify(fresh, null, 2) + '\n');
      console.log(`Wrote ${fresh.picks.length} lines to ${path}`);
    }

    if (command === 'lint') {
      const data = await loadPlannerData(getGame(runFile.game));
      const result = lintRun(runFile, { gen: data.gen, dictionary: await loadDictionary(), pronunciations: await loadPronunciationWords(), speed: speedOf() });
      for (const i of result.issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.where}: ${i.message}`);
      console.log(`${result.stats.words} words, about ${result.stats.estimatedSeconds.toFixed(1)} s`);
      if (!result.ok) process.exit(1);
    }

    if (command === 'generate') {
      const name = values.engine ?? 'kokoro';
      if (!isEngineName(name)) fail(`Unknown engine "${name}"`);
      if (name === 'kokoro') {
        const state = await voiceReady();
        if (!state.ready) fail(`Voice is not set up (missing: ${state.missing.join(', ')}). Run \`pnpm voice setup\`.`);
      }
      const engine = createEngine(name as 'kokoro', { voice: values.voice, speed: speedOf() });
      const result = await generateVoice({
        run: runFile, engine, aligner: createWhisperAligner(), respellings: (await loadPronunciations()).words,
        respell: !values['no-respell'], cacheDir: cacheDir('voice'), outDir: voicePublicDir(runFile.id), dryRun: values['dry-run'], onLog: (l) => console.log(l),
      });
      if (values['dry-run']) {
        console.log(`${result.generated.length} of ${result.lines.length} lines would be generated (${result.characters} characters).`);
        if (engine.describeCost) console.log(engine.describeCost(result.characters));
      } else {
        const total = result.manifest!.lines.reduce((s, l) => s + l.durationMs, 0) / 1000;
        console.log(`Generated ${result.generated.length}, cached ${result.cached.length}. Narration is ${total.toFixed(1)} s.`);
      }
    }

    if (command === 'preview') {
      const manifest = JSON.parse(await readFile(join(voicePublicDir(runFile.id), 'manifest.json'), 'utf8')) as { lines: Array<{ file: string }> };
      const out = repoDir('out', `${runFile.id}-voice.wav`);
      await concatPreview(manifest.lines.map((l) => repoDir('packages', 'video', 'public', l.file)), out);
      console.log(`Wrote ${out}`);
    }
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
