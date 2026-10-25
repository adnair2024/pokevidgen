import { TmsFileSchema, curatedDir, forGen, toID, writeCache, type TmEntry } from '@pokevidgen/core';
import { throttledFetch } from '../sync/http.js';

/** Pinned so the curated file is reproducible. */
const COMMIT = '171e2c204f9c1ff8e577ca387a4bbb009e130843';
const raw = async (path: string): Promise<string> =>
  (await throttledFetch(`https://raw.githubusercontent.com/pret/pokered/${COMMIT}/${path}`)).text();

/**
 * Display name and typical stage for each pokered map that hands out a TM or HM. Hand-assigned
 * (badges typically held when you first get it); unknown maps fail the import so none is missed.
 */
const MAPS: Record<string, { location: string; stage: number }> = {
  PewterGym: { location: 'Pewter Gym (Brock)', stage: 1 },
  CeruleanGym: { location: 'Cerulean Gym (Misty)', stage: 2 },
  VermilionGym: { location: 'Vermilion Gym (Lt. Surge)', stage: 3 },
  CeladonGym: { location: 'Celadon Gym (Erika)', stage: 4 },
  FuchsiaGym: { location: 'Fuchsia Gym (Koga)', stage: 5 },
  SaffronGym: { location: 'Saffron Gym (Sabrina)', stage: 6 },
  CinnabarGym: { location: 'Cinnabar Gym (Blaine)', stage: 7 },
  ViridianGym: { location: 'Viridian Gym (Giovanni)', stage: 8 },
  MtMoon1F: { location: 'Mt. Moon 1F', stage: 1 },
  MtMoonB2F: { location: 'Mt. Moon B2F', stage: 1 },
  Route4: { location: 'Route 4', stage: 1 },
  Route24: { location: 'Route 24 (Nugget Bridge)', stage: 1 },
  Route25: { location: 'Route 25', stage: 1 },
  CeruleanCity: { location: 'Cerulean City', stage: 1 },
  CeruleanTrashedHouse: { location: 'Cerulean City (trashed house)', stage: 1 },
  Route2Gate: { location: 'Route 2 gate (Oak\'s aide)', stage: 1 },
  SSAnne1FRooms: { location: 'S.S. Anne 1F rooms', stage: 2 },
  SSAnneB1FRooms: { location: 'S.S. Anne B1F rooms', stage: 2 },
  SSAnneCaptainsRoom: { location: 'S.S. Anne captain\'s room', stage: 2 },
  Route9: { location: 'Route 9', stage: 3 },
  ViridianCity: { location: 'Viridian City', stage: 3 },
  CeladonCity: { location: 'Celadon City', stage: 3 },
  CeladonMart2F: { location: 'Celadon Dept. Store 2F', stage: 3 },
  CeladonMart3F: { location: 'Celadon Dept. Store 3F', stage: 3 },
  CeladonMartRoof: { location: 'Celadon Dept. Store roof', stage: 3 },
  GameCorner: { location: 'Celadon Game Corner prize counter', stage: 3 },
  RocketHideoutB2F: { location: 'Rocket Hideout B2F', stage: 4 },
  RocketHideoutB3F: { location: 'Rocket Hideout B3F', stage: 4 },
  RocketHideoutB4F: { location: 'Rocket Hideout B4F', stage: 4 },
  Route12: { location: 'Route 12', stage: 4 },
  Route12Gate2F: { location: 'Route 12 gate 2F', stage: 4 },
  Route15: { location: 'Route 15', stage: 4 },
  Route16FlyHouse: { location: 'Route 16 house', stage: 4 },
  SafariZoneEast: { location: 'Safari Zone East', stage: 4 },
  SafariZoneNorth: { location: 'Safari Zone North', stage: 4 },
  SafariZoneWest: { location: 'Safari Zone West', stage: 4 },
  SafariZoneSecretHouse: { location: 'Safari Zone secret house', stage: 4 },
  WardensHouse: { location: 'Fuchsia City (Warden\'s house)', stage: 4 },
  PowerPlant: { location: 'Power Plant', stage: 5 },
  SilphCo2F: { location: 'Silph Co. 2F', stage: 5 },
  SilphCo5F: { location: 'Silph Co. 5F', stage: 5 },
  SilphCo7F: { location: 'Silph Co. 7F', stage: 5 },
  SilphCo10F: { location: 'Silph Co. 10F', stage: 5 },
  MrPsychicsHouse: { location: 'Saffron City (Mr. Psychic)', stage: 5 },
  CopycatsHouse2F: { location: 'Saffron City (Copycat\'s house)', stage: 5 },
  PokemonMansionB1F: { location: 'Pokémon Mansion B1F', stage: 6 },
  CinnabarLabMetronomeRoom: { location: 'Cinnabar Lab (Metronome room)', stage: 6 },
  VictoryRoad1F: { location: 'Victory Road 1F', stage: 8 },
  VictoryRoad2F: { location: 'Victory Road 2F', stage: 8 },
  VictoryRoad3F: { location: 'Victory Road 3F', stage: 8 },
};

const gen1 = forGen(1);
const moveId = (c: string): string => {
  const move = gen1.moves.get(c === 'PSYCHIC_M' ? 'psychic' : toID(c));
  if (!move?.exists) throw new Error(`Unknown gen 1 move "${c}"`);
  return move.id; // canonical: the Dex resolves aliases, other libraries don't
};

// TM01-TM50 and HM01-HM05 in definition order.
const items = await raw('constants/item_constants.asm');
const tmNames = [...items.matchAll(/^\tadd_tm (\w+)/gm)].map((m) => m[1]!);
const hmNames = [...items.matchAll(/^\tadd_hm (\w+)/gm)].map((m) => m[1]!);
if (tmNames.length !== 50 || hmNames.length !== 5) throw new Error(`expected 50 TMs and 5 HMs, got ${tmNames.length}/${hmNames.length}`);

const entries = new Map<string, TmEntry>();
for (const [i, c] of tmNames.entries()) entries.set(`TM_${c}`, { kind: 'tm', number: i + 1, move: moveId(c), sources: [] });
for (const [i, c] of hmNames.entries()) entries.set(`HM_${c}`, { kind: 'hm', number: i + 1, move: moveId(c), sources: [] });

const addSource = (item: string, map: string, kind: 'ground' | 'npc' | 'shop' | 'prize') => {
  const entry = entries.get(item);
  if (!entry) throw new Error(`unknown item ${item}`);
  const where = MAPS[map];
  if (!where) throw new Error(`Map "${map}" gives ${item} but has no entry in MAPS; curate it.`);
  if (entry.sources.some((s) => s.location === where.location)) return;
  entry.sources.push({ kind, location: where.location, stage: where.stage });
};

const tree = (await (await throttledFetch(`https://api.github.com/repos/pret/pokered/git/trees/${COMMIT}?recursive=1`)).json()) as {
  tree: Array<{ path: string }>;
};
const files = (dir: string) => tree.tree.map((t) => t.path).filter((p) => p.startsWith(`${dir}/`) && p.endsWith('.asm'));
const ITEM = /\b((?:TM|HM)_[A-Z0-9_]+)\b/g;

// Ground items first, so a script that only handles the pickup text doesn't add a duplicate "npc" source.
for (const path of files('data/maps/objects')) {
  const map = path.split('/').pop()!.replace('.asm', '');
  for (const line of (await raw(path)).split('\n')) {
    if (!line.includes('object_event')) continue;
    const item = line.split(',').pop()!.trim();
    if (entries.has(item)) addSource(item, map, 'ground');
  }
}
for (const path of files('scripts')) {
  const map = path.split('/').pop()!.replace('.asm', '');
  const text = (await raw(path)).split('\n').filter((l) => !l.trim().startsWith(';')).join('\n');
  for (const [, item] of text.matchAll(ITEM)) if (entries.has(item!)) addSource(item!, map, 'npc');
}

const marts = await raw('data/items/marts.asm');
const celadon2F = marts.split('\n').find((l) => l.includes('script_mart') && l.includes('TM_DOUBLE_TEAM'));
for (const [, item] of (celadon2F ?? '').matchAll(ITEM)) addSource(item!, 'CeladonMart2F', 'shop');

const prizes = await raw('data/events/prizes.asm');
const tmPrizes = prizes.slice(prizes.indexOf('PrizeMenuTMsEntries:'), prizes.indexOf('PrizeMenuTMsCost:'));
for (const [, item] of tmPrizes.matchAll(ITEM)) addSource(item!, 'GameCorner', 'prize');

const sourceless = [...entries].filter(([, e]) => e.sources.length === 0).map(([k]) => k);
if (sourceless.length) console.warn('No source found for:', sourceless.join(', '));

const file = TmsFileSchema.parse({
  source: {
    repo: 'https://github.com/pret/pokered',
    commit: COMMIT,
    note:
      'Locations come from pokered map objects, scripts, marts and prizes. `npc` means a character on that map gives it ' +
      '(reward, gift or trade); conditions are not modelled. Stages are hand-assigned (typical story order). ' +
      'TMs with no source here are not obtainable in the game.',
  },
  tms: [...entries.values()].filter((e) => e.sources.length > 0),
});

await writeCache(curatedDir('gen1', 'tms.json'), file);
console.log(`wrote ${file.tms.length} TMs/HMs; without a source: ${sourceless.join(', ') || 'none'}`);
