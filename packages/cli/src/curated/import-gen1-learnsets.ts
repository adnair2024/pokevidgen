import { LearnsetsFileSchema, curatedDir, forGen, toID, writeCache, type SpeciesLearnset } from '@pokevidgen/core';
import { throttledFetch } from '../sync/http.js';

/** Pinned so the curated file is reproducible. */
const COMMIT = '171e2c204f9c1ff8e577ca387a4bbb009e130843';
const raw = async (path: string): Promise<string> =>
  (await throttledFetch(`https://raw.githubusercontent.com/pret/pokered/${COMMIT}/${path}`)).text();

const gen1 = forGen(1);

/** Canonical Dex ID for a pokered move constant (PSYCHIC_M is the only one that isn't its own ID). */
const moveId = (constant: string): string => {
  const move = gen1.moves.get(constant === 'PSYCHIC_M' ? 'psychic' : toID(constant));
  if (!move?.exists) throw new Error(`Unknown gen 1 move "${constant}"`);
  return move.id;
};

const camel = (constant: string): string =>
  constant.split('_').map((w) => w[0]! + w.slice(1).toLowerCase()).join('');

const dbLines = (block: string): string[][] =>
  block.split('\n').map((l) => l.split(';')[0]!.trim()).filter((l) => l.startsWith('db ')).map((l) => l.slice(3).split(',').map((v) => v.trim()));

const evosMoves = await raw('data/pokemon/evos_moves.asm');

/** [level, move constant] pairs after the evolution list. */
const levelUp = (constant: string): Array<[number, string]> => {
  const start = evosMoves.indexOf(`\n${camel(constant)}EvosMoves:`);
  if (start < 0) throw new Error(`no evos/moves for ${constant}`);
  const rest = evosMoves.slice(start + 1).split('\n').slice(1);
  const end = rest.findIndex((l) => /^\w+EvosMoves:/.test(l));
  const rows = dbLines((end < 0 ? rest : rest.slice(0, end)).join('\n'));
  const evolutionsEnd = rows.findIndex((r) => r.length === 1 && r[0] === '0');
  const out: Array<[number, string]> = [];
  for (const r of rows.slice(evolutionsEnd + 1)) {
    if (r.length === 1) break;
    out.push([Number(r[0]), r[1]!]);
  }
  return out;
};

/** `tmhm A, B, \` continuation lines up to the first line that doesn't end in a backslash. */
const tmhm = (file: string): string[] => {
  const lines = file.split('\n');
  const i = lines.findIndex((l) => l.trim().startsWith('tmhm'));
  if (i < 0) throw new Error('no tmhm line');
  const names: string[] = [];
  for (let j = i; j < lines.length; j++) {
    const line = lines[j]!.split(';')[0]!;
    names.push(...line.replace(/^\s*tmhm/, '').replace(/\\/g, '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'UNUSED'));
    if (!line.trimEnd().endsWith('\\')) break;
  }
  return names;
};

const species: Record<string, SpeciesLearnset> = {};
for (const sp of gen1.species) {
  if (sp.num < 1 || sp.num > 151) continue;
  const constant = sp.id === 'nidoranf' ? 'NIDORAN_F' : sp.id === 'nidoranm' ? 'NIDORAN_M' : sp.id === 'mrmime' ? 'MR_MIME' : sp.id.toUpperCase();
  const file = await raw(`data/pokemon/base_stats/${sp.id}.asm`);
  const startLine = file.split('\n').find((l) => l.includes('level 1 learnset'));
  if (!startLine) throw new Error(`no level 1 learnset for ${sp.id}`);
  species[sp.id] = {
    start: dbLines(startLine)[0]!.filter((m) => m !== 'NO_MOVE').map(moveId),
    levelUp: levelUp(constant).map(([level, move]) => ({ level, move: moveId(move) })),
    tmhm: tmhm(file).map(moveId),
  };
}

const file = LearnsetsFileSchema.parse({
  source: {
    repo: 'https://github.com/pret/pokered',
    commit: COMMIT,
    note:
      'Level-up moves from data/pokemon/evos_moves.asm, starting moves and TM/HM compatibility from ' +
      'data/pokemon/base_stats/*.asm. Identical in Red and Blue. Pokemon Showdown / @pkmn learnset codes are not used: ' +
      'they encode entries like "1L1" that do not reflect the games.',
  },
  species,
});

await writeCache(curatedDir('gen1', 'learnsets.json'), file);
console.log(`wrote ${Object.keys(file.species).length} species`);
