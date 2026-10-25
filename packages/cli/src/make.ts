import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  PlannerError, RunSchema, getGame, lintRun, loadDictionary, loadEnv, loadPlannerData, loadPronunciationWords, makeSteps, prepareMake, repoDir,
  voiceReady, writeCache, type Run,
} from '@pokevidgen/core';

await loadEnv();

const USAGE = `Usage:
  pnpm make --game <red|blue> [--seed N] [--favorite pokemon] [--mono type] [--must a,b] [--ban a,b] [--no-trades] [--no-legendaries] [--nuzlocke] [--preview] [--review]
  pnpm make --resume <id> [--preview]
A new team gets a random seed unless --seed is given; the seed is printed and stored, so the same command reproduces the same team.
--review stops after the script so you can edit runs/<id>.json (or use the dashboard), then continue with --resume <id>.
--preview renders at half size.`;

const { values } = parseArgs({
  options: {
    game: { type: 'string' }, seed: { type: 'string' }, favorite: { type: 'string' }, mono: { type: 'string' }, must: { type: 'string' }, ban: { type: 'string' },
    'no-trades': { type: 'boolean', default: false }, 'no-legendaries': { type: 'boolean', default: false }, nuzlocke: { type: 'boolean', default: false },
    random: { type: 'boolean', default: false }, preview: { type: 'boolean', default: false }, review: { type: 'boolean', default: false },
    resume: { type: 'string' }, help: { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const exec = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    console.log(`\n$ pnpm ${args.join(' ')}`);
    const child = spawn('pnpm', args, { cwd: repoDir(), stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} exited with code ${code}`))));
  });

const checkScript = async (run: Run): Promise<void> => {
  const data = await loadPlannerData(getGame(run.game));
  const result = lintRun(run, { gen: data.gen, dictionary: await loadDictionary(), pronunciations: await loadPronunciationWords() });
  for (const i of result.issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.where}: ${i.message}`);
  if (!result.ok) fail('The script has lint errors; fix them in the run file or on the dashboard, then use --resume.');
};

try {
  let run: Run;
  if (values.resume) {
    if (!/^[a-z0-9-]+$/.test(values.resume)) fail('--resume takes a run id such as red-s42');
    run = RunSchema.parse(JSON.parse(await readFile(repoDir('runs', `${values.resume}.json`), 'utf8')));
  } else {
    if (!values.game) fail(USAGE);
    const seed = values.seed !== undefined ? Number(values.seed) : undefined;
    if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 1)) fail('--seed must be a whole number of 1 or more');
    const made = await prepareMake(await loadPlannerData(getGame(values.game!)), {
      seed, favorite: values.favorite, mono: values.mono, must: list(values.must), ban: list(values.ban), noTrades: values['no-trades'], noLegendaries: values['no-legendaries'], nuzlocke: values.nuzlocke,
    });
    if (seed === undefined) console.log(`seed: ${made.seed} (pass --seed ${made.seed} to reproduce this team)`);
    await writeCache(repoDir('teams', `${made.team.id}.json`), made.team);
    await writeFile(repoDir('runs', `${made.run.id}.json`), JSON.stringify(made.run, null, 2) + '\n');
    console.log(`team: ${made.team.members.map((m) => m.set.species).join(', ')}\nwrote teams/${made.team.id}.json and runs/${made.run.id}.json`);
    run = made.run;
  }

  await checkScript(run);
  if (values.review) {
    console.log(`\nScript written. Edit runs/${run.id}.json, then: pnpm make --resume ${run.id}`);
    process.exit(0);
  }
  const state = await voiceReady();
  if (!state.ready) fail(`Voice is not set up (missing: ${state.missing.join(', ')}). Run \`pnpm voice setup\`.`);

  const voice = { engine: 'kokoro', voice: process.env['KOKORO_VOICE'] ?? 'af_heart', speed: Number(process.env['KOKORO_SPEED'] ?? 1.1), respell: true };
  for (const step of makeSteps(run.id, voice, values.preview ? 'preview' : 'full')) await exec(step);
  console.log(`\nDone: out/${run.id}${values.preview ? '-preview' : ''}.mp4`);
} catch (err) {
  if (err instanceof PlannerError) fail(`error: ${err.message}`);
  throw err;
}
