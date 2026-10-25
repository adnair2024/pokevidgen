import {
  BossesFileSchema, LearnsetsFileSchema, curatedDir, forGen, movesAtLevel, readCache, toID, writeCache, type Boss,
} from '@pokevidgen/core';
import { throttledFetch } from '../sync/http.js';

/** Pinned so the curated file is reproducible. */
const COMMIT = '171e2c204f9c1ff8e577ca387a4bbb009e130843';
const PATH = 'data/trainers/parties.asm';

const raw = async (path: string): Promise<string> =>
  (await throttledFetch(`https://raw.githubusercontent.com/pret/pokered/${COMMIT}/${path}`)).text();

const text = await raw(PATH);
// Run `import-gen1-learnsets.ts` first: boss moves use the same learnset data as the planner.
const learnsets = await readCache(curatedDir('gen1', 'learnsets.json'), LearnsetsFileSchema);
const specialMoves = await raw('data/trainers/special_moves.asm');

type Row = { comment: string; values: string[] };

/** Rows of `db ...` under `<Label>Data:`, each with the comment line that precedes it. */
const rowsOf = (label: string): Row[] => {
  const start = text.indexOf(`\n${label}Data:`);
  if (start < 0) throw new Error(`missing ${label}Data`);
  const rows: Row[] = [];
  let comment = '';
  for (const raw of text.slice(start + 1).split('\n').slice(1)) {
    const line = raw.trim();
    if (/^\w+Data:/.test(line)) break;
    if (line.startsWith(';')) comment = line.slice(1).trim();
    else if (line.startsWith('db ')) {
      rows.push({ comment, values: line.slice(3).split(',').map((v) => v.trim()) });
    }
  }
  return rows;
};

const gen1 = forGen(1);

/** Move constants are SHOUTY_SNAKE; the only one that isn't its own ID is Psychic (PSYCHIC_M). */
const moveId = (constant: string): string => {
  const move = gen1.moves.get(constant === 'PSYCHIC_M' ? 'psychic' : toID(constant));
  if (!move?.exists) throw new Error(`Unknown gen 1 move "${constant}"`);
  return move.id; // canonical: the Dex resolves aliases (hijumpkick), but other libraries don't
};

const dbLines = (block: string): string[][] =>
  block
    .split('\n')
    .map((l) => l.split(';')[0]!.trim())
    .filter((l) => l.startsWith('db '))
    .map((l) => l.slice(3).split(',').map((v) => v.trim()));

type RawMon = { level: number; constant: string };

/** `$FF, lvl, MON, lvl, MON, ..., 0` → team. Only the $FF format is used for bosses. */
const parseRaw = (row: Row): RawMon[] => {
  const v = row.values.slice(1, -1);
  const team: RawMon[] = [];
  for (let i = 0; i < v.length; i += 2) team.push({ level: Number(v[i]), constant: v[i + 1] ?? '' });
  return team;
};

/** Special moves overwrite the third move slot of one team member. */
type Special = { mon: number; move: string };

const loneMoves = dbLines(specialMoves.slice(specialMoves.indexOf('LoneMoves:'), specialMoves.indexOf('TeamMoves:')))
  .map(([mon, move]) => ({ mon: Number(mon), move: move! }));
const teamMoves = Object.fromEntries(
  dbLines(specialMoves.slice(specialMoves.indexOf('TeamMoves:')))
    .filter((r) => r.length === 2)
    .map(([trainer, move]) => [toID(trainer!), move!]),
);

const build = (raws: RawMon[], special?: Special[]) => {
  const team = [];
  for (const [i, m] of raws.entries()) {
    const species = gen1.species.get(toID(m.constant))!.id;
    const entry = learnsets.species[species];
    if (!entry) throw new Error(`no learnset for ${species}`);
    const moves = movesAtLevel(entry, m.level);
    const sp = special?.find((s) => s.mon === i);
    if (sp) moves[2] = sp.move;
    team.push({ species: gen1.species.get(toID(m.constant))!.id, level: m.level, moves: moves.filter(Boolean).map(moveId) });
  }
  return team;
};

/** `wGymLeaderNo` as set by each gym script (verified in pokered/scripts/*Gym.asm), 1-8 in badge order. */
const GYM_NUMBER: Record<string, number> = {
  brock: 1, misty: 2, ltsurge: 3, erika: 4, koga: 5, sabrina: 6, blaine: 7, 'giovanni-gym': 8,
};

const specialFor = (id: string): Special[] | undefined => {
  const gym = GYM_NUMBER[id];
  if (gym) {
    const lone = loneMoves[gym - 1];
    if (!lone) throw new Error(`no lone move ${gym}`);
    return [{ mon: lone.mon, move: lone.move }];
  }
  // Elite Four: every member of the class gets one team move on their 5th Pokémon.
  const team = teamMoves[id];
  return team ? [{ mon: 4, move: team }] : undefined;
};

const single = async (
  label: string, name: string, kind: Boss['kind'], location: string, order: number, badge?: string, id = toID(name),
): Promise<Boss> => {
  const [row] = rowsOf(label);
  if (!row) throw new Error(`no team for ${label}`);
  return { id, name, kind, location, badge, order, variants: [{ team: await build(parseRaw(row), specialFor(id)) }] };
};

const STARTERS = ['squirtle', 'bulbasaur', 'charmander'] as const;

/** The champion's Pidgeot gets Sky Attack and his starter gets a signature move (read_trainer_party.asm). */
const championSpecial = (starter: (typeof STARTERS)[number]): Special[] => [
  { mon: 0, move: 'SKY_ATTACK' },
  { mon: 5, move: { bulbasaur: 'MEGA_DRAIN', charmander: 'FIRE_BLAST', squirtle: 'BLIZZARD' }[starter] },
];

/** Rival fights come in groups of 3 rows (rival starter order: Squirtle, Bulbasaur, Charmander). */
const rival = async (comment: string, order: number, id: string, rows: Row[]): Promise<Boss> => ({
  id,
  name: 'Rival',
  kind: 'rival',
  location: comment,
  order,
  variants: await Promise.all(
    STARTERS.map(async (rivalStarter, i) => {
      const row = rows[i];
      if (!row) throw new Error(`rival ${id} missing variant ${rivalStarter}`);
      return {
        rivalStarter,
        team: await build(parseRaw(row), id === 'rival-champion' ? championSpecial(rivalStarter) : undefined),
      };
    }),
  ),
});

const rival1 = rowsOf('Rival1').filter((r) => r.values[0] === '$FF');
const rival2 = rowsOf('Rival2');
const giovanni = rowsOf('Giovanni');

const group = (rows: Row[], start: number) => rows.slice(start, start + 3);

const giovanniBoss = async (i: number, location: string, order: number, id: string, badge?: string): Promise<Boss> => {
  const row = giovanni[i];
  if (!row) throw new Error(`giovanni row ${i}`);
  return {
    id, name: 'Giovanni', kind: badge ? 'gymLeader' : 'villain', location, badge, order,
    variants: [{ team: await build(parseRaw(row), specialFor(id)) }],
  };
};

const bosses: Boss[] = [
  await rival('Route 22', 1, 'rival-route22-early', group(rival1, 0)),
  await rival('Cerulean City', 2, 'rival-cerulean', group(rival1, 3)),
  await single('Brock', 'Brock', 'gymLeader', 'Pewter City', 3, 'Boulder'),
  await single('Misty', 'Misty', 'gymLeader', 'Cerulean City', 4, 'Cascade'),
  await rival('SS Anne 2F', 5, 'rival-ssanne', group(rival2, 0)),
  await single('LtSurge', 'Lt. Surge', 'gymLeader', 'Vermilion City', 6, 'Thunder', 'ltsurge'),
  await rival('Pokémon Tower 2F', 7, 'rival-pokemontower', group(rival2, 3)),
  await single('Erika', 'Erika', 'gymLeader', 'Celadon City', 8, 'Rainbow'),
  await giovanniBoss(0, 'Rocket Hideout B4F', 9, 'giovanni-hideout'),
  await single('Koga', 'Koga', 'gymLeader', 'Fuchsia City', 10, 'Soul'),
  await rival('Silph Co. 7F', 11, 'rival-silph', group(rival2, 6)),
  await giovanniBoss(1, 'Silph Co. 11F', 12, 'giovanni-silph'),
  await single('Sabrina', 'Sabrina', 'gymLeader', 'Saffron City', 13, 'Marsh'),
  await single('Blaine', 'Blaine', 'gymLeader', 'Cinnabar Island', 14, 'Volcano'),
  await giovanniBoss(2, 'Viridian City', 15, 'giovanni-gym', 'Earth'),
  await rival('Route 22', 16, 'rival-route22-late', group(rival2, 9)),
  await single('Lorelei', 'Lorelei', 'eliteFour', 'Indigo Plateau', 17),
  await single('Bruno', 'Bruno', 'eliteFour', 'Indigo Plateau', 18),
  await single('Agatha', 'Agatha', 'eliteFour', 'Indigo Plateau', 19),
  await single('Lance', 'Lance', 'eliteFour', 'Indigo Plateau', 20),
  await rival('Indigo Plateau (Champion)', 21, 'rival-champion', rowsOf('Rival3')),
];

const file = BossesFileSchema.parse({
  source: {
    repo: 'https://github.com/pret/pokered',
    commit: COMMIT,
    paths: [PATH, 'data/pokemon/evos_moves.asm', 'data/pokemon/base_stats/*.asm', 'data/trainers/special_moves.asm', 'engine/battle/read_trainer_party.asm'],
    note:
      'Parties from the pokered disassembly (identical in Red and Blue). Moves follow the game: level 1 moves, ' +
      'then learnset moves up to the trainer Pokémon\'s level (WriteMonMoves), then special moves written to the ' +
      'third slot (gym leader LoneMoves, Elite Four TeamMoves, the champion rival). ' +
      'Order is the typical story order; gym leaders can be fought out of order.',
  },
  // OaksLab.asm: the rival takes the starter that beats yours (STARTER1 Charmander, STARTER2 Squirtle, STARTER3 Bulbasaur).
  rivalStarterFor: { charmander: 'squirtle', squirtle: 'bulbasaur', bulbasaur: 'charmander' },
  bosses,
});

await writeCache(curatedDir('gen1', 'bosses.json'), file);
console.log(`wrote ${file.bosses.length} bosses`);
