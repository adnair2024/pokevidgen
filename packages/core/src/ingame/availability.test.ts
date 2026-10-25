import { beforeAll, describe, expect, it } from 'vitest';
import { cacheDir, exists } from '../data/cache.js';
import { forGen } from '../data/gens.js';
import { toID } from '../data/ids.js';
import { loadBosses, loadEncounters, loadProgression } from '../data/loaders.js';
import type { EncountersFile } from '../data/schemas.js';
import { getGame } from '../games/index.js';
import type { ProgressionFile } from '../games/progression-schema.js';
import { buildAvailability, type Obtainable } from './availability.js';

const hasCache = await exists(cacheDir('pokeapi', 'encounters'));
const gen = forGen(1);
const red = getGame('red');
const blue = getGame('blue');

/** Species with a plain wild/water source in the cache for a version. */
const wildIn = (files: EncountersFile[], version: string): Set<string> =>
  new Set(
    files
      .filter((f) => f.areas.some((a) => a.version === version && a.details.some((d) => ['walk', 'surf'].includes(d.method) || d.method.endsWith('-rod'))))
      .map((f) => toID(f.species)),
  );

describe.skipIf(!hasCache)('availability (needs `pnpm data:sync`)', () => {
  let files: EncountersFile[];
  let progression: ProgressionFile;
  let redAvail: Map<string, Obtainable>;
  let blueAvail: Map<string, Obtainable>;

  beforeAll(async () => {
    files = await loadEncounters();
    progression = await loadProgression(red);
    redAvail = buildAvailability(gen, files, red.pokeApiVersion, progression);
    blueAvail = buildAvailability(gen, files, blue.pokeApiVersion, progression);
  });

  it('has a progression stage for every area in the cache', () => {
    const unknown = new Set<string>();
    for (const f of files) for (const a of f.areas) if (['red', 'blue'].includes(a.version) && !progression.areas[a.area]) unknown.add(a.area);
    expect([...unknown]).toEqual([]);
  });

  it('keeps version exclusives out of the other game as direct catches', () => {
    const r = wildIn(files, 'red');
    const b = wildIn(files, 'blue');
    const redOnly = [...r].filter((s) => !b.has(s));
    const blueOnly = [...b].filter((s) => !r.has(s));
    expect(redOnly.length).toBeGreaterThan(0);
    expect(blueOnly.length).toBeGreaterThan(0);
    for (const s of redOnly) expect(blueAvail.get(s)?.all.some((x) => ['wild', 'surf', 'rod'].includes(x.kind))).toBeFalsy();
    for (const s of blueOnly) expect(redAvail.get(s)?.all.some((x) => ['wild', 'surf', 'rod'].includes(x.kind))).toBeFalsy();
  });

  it('never makes Mew obtainable (no in-game source)', () => {
    expect(redAvail.has('mew')).toBe(false);
    expect(blueAvail.has('mew')).toBe(false);
  });

  it('only returns gen 1 species', () => {
    for (const id of redAvail.keys()) expect(gen.species.get(id)?.num).toBeLessThanOrEqual(151);
  });

  it('--no-trades drops trade-evolution-only species but keeps level evolutions', () => {
    const noTrades = buildAvailability(gen, files, red.pokeApiVersion, progression, { noTrades: true });
    expect(redAvail.get('alakazam')?.best).toMatchObject({ kind: 'evolution', how: 'trade' });
    expect(noTrades.has('alakazam')).toBe(false);
    expect(noTrades.has('kadabra')).toBe(true);
    for (const o of noTrades.values()) {
      expect(o.all.some((s) => s.kind === 'trade' || (s.kind === 'evolution' && s.how === 'trade'))).toBe(false);
    }
  });

  it('--no-legendaries drops the static legendaries', () => {
    const noLeg = buildAvailability(gen, files, red.pokeApiVersion, progression, { noLegendaries: true });
    for (const id of ['articuno', 'zapdos', 'moltres', 'mewtwo']) {
      expect(redAvail.has(id)).toBe(true);
      expect(noLeg.has(id)).toBe(false);
    }
  });

  it('gates fishing and surfing behind the rod/HM stage', () => {
    for (const o of redAvail.values()) {
      for (const s of o.all) {
        if (s.kind === 'rod' || s.kind === 'surf') expect(s.stage).toBeGreaterThanOrEqual(progression.methods[s.method] ?? 0);
      }
    }
  });

  it('gates stone evolutions on the stone, and an evolution is never earlier than its pre-evolution', () => {
    for (const o of redAvail.values()) {
      if (o.best.kind !== 'evolution') continue;
      expect(o.stage).toBeGreaterThanOrEqual(redAvail.get(o.best.from)!.stage);
      if (o.best.how === 'stone') expect(o.stage).toBeGreaterThanOrEqual(progression.items[o.best.item!]!.stage);
    }
  });

  it('models the Magikarp salesman as a 500 yen purchase and drops PokeAPI\'s duplicate Route 3 one', () => {
    const magikarp = redAvail.get('magikarp')!;
    const sources = magikarp.all.filter((s) => s.kind !== 'evolution') as Array<{ kind: string; area: string; price?: number; minLevel?: number }>;
    expect(sources.some((s) => s.kind === 'purchase' && s.area === 'kanto-route-4-pokemon-center' && s.price === 500 && s.minLevel === 5)).toBe(true);
    expect(sources.some((s) => s.area === 'kanto-route-3-pokemon-center')).toBe(false);
  });

  it('does not treat Pikachu as an evolution (later-gen friendship data must not leak)', () => {
    expect(redAvail.get('pikachu')?.best.kind).not.toBe('evolution');
  });
});

describe('gen 1 bosses (curated)', () => {
  it('validates, has unique ordered ids, and every species is a real gen 1 species', async () => {
    const { bosses } = await loadBosses(red);
    expect(new Set(bosses.map((b) => b.id)).size).toBe(bosses.length);
    expect(bosses.map((b) => b.order)).toEqual([...bosses.map((b) => b.order)].sort((a, b) => a - b));
    for (const boss of bosses) {
      for (const v of boss.variants) {
        for (const m of v.team) expect(gen.species.get(m.species)?.id, `${boss.id}: ${m.species} is not a canonical species id`).toBe(m.species);
      }
    }
  });

  it('rival fights have one variant per rival starter; everyone else has one', async () => {
    const { bosses } = await loadBosses(red);
    for (const b of bosses) {
      if (b.kind === 'rival') expect(b.variants.map((v) => v.rivalStarter).sort()).toEqual(['bulbasaur', 'charmander', 'squirtle']);
      else expect(b.variants).toHaveLength(1);
    }
  });

  it('gives every boss Pokémon 1-4 distinct, real gen 1 moves', async () => {
    const { bosses } = await loadBosses(red);
    for (const b of bosses) {
      for (const v of b.variants) {
        for (const m of v.team) {
          expect(m.moves.length, `${b.id} ${m.species}`).toBeLessThanOrEqual(4);
          expect(new Set(m.moves).size, `${b.id} ${m.species}`).toBe(m.moves.length);
          for (const move of m.moves) expect(gen.moves.get(move)?.id, `${b.id} ${m.species}: ${move} is not a canonical move id`).toBe(move);
        }
      }
    }
  });

  it('applies the game\'s special-move rules (gym lone moves, Elite Four team moves, champion rival)', async () => {
    const { bosses } = await loadBosses(red);
    const team = (id: string, starter?: string) =>
      bosses.find((b) => b.id === id)!.variants.find((v) => !starter || v.rivalStarter === starter)!.team;
    const mon = (id: string, species: string, starter?: string) => team(id, starter).find((m) => m.species === species)!;
    expect(mon('brock', 'onix').moves).toContain('bide');
    expect(mon('misty', 'starmie').moves).toContain('bubblebeam');
    expect(mon('giovanni-gym', 'rhydon').moves).toContain('fissure');
    expect(mon('lorelei', 'lapras').moves).toContain('blizzard');
    expect(mon('lance', 'dragonite').moves).toContain('barrier');
    expect(mon('rival-champion', 'pidgeot', 'squirtle').moves).toContain('skyattack');
    expect(mon('rival-champion', 'venusaur', 'bulbasaur').moves).toContain('megadrain');
    expect(mon('rival-champion', 'charizard', 'charmander').moves).toContain('fireblast');
    expect(mon('rival-champion', 'blastoise', 'squirtle').moves).toContain('blizzard');
    // Only the special slot changes: other gym teams do not get the move.
    expect(mon('giovanni-hideout', 'onix').moves).not.toContain('bide');
  });

  it('has all 8 gym badges and the Elite Four', async () => {
    const { bosses } = await loadBosses(red);
    const progression = await loadProgression(red);
    expect(bosses.filter((b) => b.badge).map((b) => b.badge).sort()).toEqual([...progression.badgeOrder].sort());
    expect(bosses.filter((b) => b.kind === 'eliteFour')).toHaveLength(4);
  });
});
