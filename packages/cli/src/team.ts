import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  PlannerError, TeamSchema, getGame, loadPlannerData, planIngameTeam, repoDir, writeCache, type Team,
} from '@pokevidgen/core';

const list = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const summary = (team: Team): string => {
  const lines = [`${team.id}  (seed ${team.seed}, ${team.target}, level ${team.analysis['plannedLevel']})`];
  for (const m of team.members) {
    const a = m.acquisition!;
    lines.push(
      `  ${m.set.species.padEnd(12)} ${a.steps.map((s) => `${s.where}${s.how === 'evolution' ? '' : ` [stage ${s.stage}]`}`).join(' → ')}`,
      `  ${''.padEnd(12)} ${m.set.moves.join(', ')}   roles: ${m.roles.join(', ') || '-'}`,
    );
  }
  const shared = team.analysis['sharedWeaknesses'] as string[];
  lines.push(`  shared weaknesses (3+): ${shared.length ? shared.join(', ') : 'none'}`);
  return lines.join('\n');
};

const [command, ...rest] = process.argv.slice(2);

if (command !== 'ingame') {
  console.error('Usage: pnpm team ingame --game <red|blue> [--seed N] [--must a,b] [--ban a,b] [--no-trades] [--no-legendaries] [--nuzlocke]');
  process.exit(command ? 1 : 0);
}

const { values } = parseArgs({
  args: rest,
  options: {
    game: { type: 'string' },
    style: { type: 'string', default: 'balanced' },
    seed: { type: 'string' },
    must: { type: 'string' },
    ban: { type: 'string' },
    'no-trades': { type: 'boolean', default: false },
    'no-legendaries': { type: 'boolean', default: false },
    nuzlocke: { type: 'boolean', default: false },
  },
});

if (!values.game) {
  console.error('--game is required (red or blue)');
  process.exit(1);
}
if (values.style !== 'balanced') {
  console.error(`Unknown style "${values.style}". Only "balanced" exists so far.`);
  process.exit(1);
}

const seed = values.seed !== undefined ? Number(values.seed) : randomInt(1, 2 ** 31);
if (!Number.isInteger(seed)) {
  console.error('--seed must be an integer');
  process.exit(1);
}
if (values.seed === undefined) console.log(`seed: ${seed} (pass --seed ${seed} to reproduce this team)`);

try {
  const data = await loadPlannerData(getGame(values.game));
  const team = TeamSchema.parse(
    await planIngameTeam(data, {
      seed,
      must: list(values.must),
      ban: list(values.ban),
      noTrades: values['no-trades'],
      noLegendaries: values['no-legendaries'],
      nuzlocke: values.nuzlocke,
    }),
  );
  await writeCache(repoDir('teams', `${team.id}.json`), team);
  console.log(summary(team));
  console.log(`wrote teams/${team.id}.json`);
} catch (err) {
  if (err instanceof PlannerError) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
