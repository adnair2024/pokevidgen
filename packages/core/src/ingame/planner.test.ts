import { beforeAll, describe, expect, it } from 'vitest';
import { cacheDir, exists } from '../data/cache.js';
import { getGame } from '../games/index.js';
import { TeamSchema, type Team } from '../types.js';
import type { PlannerData } from './data.js';
import { loadPlannerData } from './data.js';
import { reachOf, teamSynergy } from '../analysis/synergy.js';
import { learnableMoves, movesAtLevel } from './learnsets.js';
import { BossPlanSchema, typicalLevelAt } from './bosses.js';
import { PlannerError, planIngameTeam, type PlannerInput } from './planner.js';

const hasCache = await exists(cacheDir('pokeapi', 'encounters'));

describe.skipIf(!hasCache)('in-game planner (needs `pnpm data:sync`)', () => {
  let red: PlannerData;
  let blue: PlannerData;
  let team: Team;
  const plan = (input: Partial<PlannerInput> = {}, data = red) => planIngameTeam(data, { seed: 1, ...input });

  beforeAll(async () => {
    red = await loadPlannerData(getGame('red'));
    blue = await loadPlannerData(getGame('blue'));
    team = await plan();
  });

  it('produces a valid team without any API key', () => {
    expect(() => TeamSchema.parse(team)).not.toThrow();
    expect(team.members.length).toBeGreaterThan(0);
    expect(team.members.length).toBeLessThanOrEqual(6);
    expect(team.seed).toBe(1);
    expect(team.target).toBe('red');
  });

  it('is deterministic for a given seed and seed-sensitive overall', async () => {
    expect(await plan()).toEqual(team);
    const species = (t: Team) => t.members.map((m) => m.set.species).join();
    const others = await Promise.all([2, 3, 4, 5, 6].map((seed) => plan({ seed })));
    expect(new Set([species(team), ...others.map(species)]).size).toBeGreaterThan(1);
  });

  it('never repeats a species line, takes at most one starter, and respects the Moon Stone supply', () => {
    const roots = team.members.map((m) => m.acquisition!.steps[0]!.species);
    expect(new Set(roots).size).toBe(roots.length);
    const starters = roots.filter((r) => ['bulbasaur', 'charmander', 'squirtle'].includes(r));
    expect(starters.length).toBeLessThanOrEqual(1);
    const moonStones = team.members.flatMap((m) => m.acquisition!.steps).filter((s) => s.how === 'evolution' && /Moon Stone/.test(s.where));
    expect(moonStones.length).toBeLessThanOrEqual(red.progression.items['moonstone']!.quantity!);
  });

  it('only teaches moves the game says that line can learn, each with a source', () => {
    for (const m of team.members) {
      const a = m.acquisition!;
      expect(a.moves.map((x) => x.move).sort()).toEqual([...m.set.moves].sort());
      const final = red.learnsets.species[m.set.species]!;
      for (const x of a.moves) {
        if (x.source.kind === 'level') {
          const from = red.learnsets.species[x.source.from]!;
          expect(from.levelUp.some((l) => l.level === (x.source as { level: number }).level && l.move === x.move), `${m.set.species} ${x.move}`).toBe(true);
          expect(x.source.level).toBeLessThanOrEqual(m.set.level);
        } else if (x.source.kind === 'start') {
          expect(red.learnsets.species[x.source.from]!.start.concat(movesAtLevel(red.learnsets.species[x.source.from]!, a.steps[0]!.minLevel ?? 1))).toContain(x.move);
        } else {
          const src = x.source;
          expect(final.tmhm, `${m.set.species} ${x.move}`).toContain(x.move);
          expect(red.tms.tms.find((t) => t.number === src.number && t.kind === src.kind)!.move).toBe(x.move);
        }
        expect(x.stage).toBeLessThanOrEqual(8);
      }
    }
  });

  it('does not reuse a single-copy TM', () => {
    const uses = new Map<number, number>();
    for (const m of team.members) {
      for (const x of m.acquisition!.moves) if (x.source.kind === 'tm') uses.set(x.source.number, (uses.get(x.source.number) ?? 0) + 1);
    }
    for (const [n, count] of uses) {
      const tm = red.tms.tms.find((t) => t.kind === 'tm' && t.number === n)!;
      const unlimited = tm.sources.some((s) => s.kind === 'shop' || s.kind === 'prize');
      if (!unlimited) expect(count, `TM${n}`).toBeLessThanOrEqual(tm.sources.length);
    }
  });

  it('honours --must and --ban, and reports impossible requests instead of dropping them', async () => {
    const withMust = await plan({ must: ['snorlax', 'pikachu'] });
    expect(withMust.members.map((m) => m.set.species)).toEqual(expect.arrayContaining(['snorlax', 'pikachu']));
    const banned = await plan({ ban: team.members.map((m) => m.set.species) });
    for (const m of team.members) expect(banned.members.map((x) => x.set.species)).not.toContain(m.set.species);
    await expect(plan({ must: ['mew'] })).rejects.toThrow(PlannerError);
    await expect(plan({ must: ['charizard', 'venusaur'] })).rejects.toThrow(/mutually exclusive/);
    await expect(plan({ must: ['eevee', 'jolteon'] })).rejects.toThrow(PlannerError);
    await expect(plan({ must: ['pikachu'], ban: ['pikachu'] })).rejects.toThrow(/both required and banned/);
  });

  it('respects version exclusives', async () => {
    await expect(plan({ must: ['sandshrew'] }, red)).rejects.toThrow(/not obtainable/);
    expect((await plan({ must: ['sandshrew'] }, blue)).members.map((m) => m.set.species)).toContain('sandshrew');
  });

  it('--no-trades avoids NPC trades and trade evolutions; --no-legendaries avoids legendary birds and Mewtwo', async () => {
    for (const seed of [1, 2, 3]) {
      const t = await plan({ seed, noTrades: true, noLegendaries: true });
      for (const m of t.members) {
        for (const s of m.acquisition!.steps) {
          expect(s.how).not.toBe('trade');
          expect(s.where).not.toMatch(/Trade-evolve/);
        }
        expect(['articuno', 'zapdos', 'moltres', 'mewtwo']).not.toContain(m.set.species);
      }
    }
    await expect(plan({ must: ['alakazam'], noTrades: true })).rejects.toThrow(/not obtainable/);
  });

  it('--nuzlocke never starts two members in the same area', async () => {
    const t = await plan({ nuzlocke: true });
    const wheres = t.members.map((m) => m.acquisition!.steps[0]!.where);
    expect(new Set(wheres).size).toBe(wheres.length);
  });

  it('uses display names and real prices in the acquisition text, never raw ids', async () => {
    const t = await plan({ must: ['gyarados', 'nidoqueen', 'raichu'] });
    const gyarados = t.members.find((m) => m.set.species === 'gyarados')!;
    expect(gyarados.acquisition!.steps[0]).toMatchObject({ how: 'purchase' });
    expect(gyarados.acquisition!.steps[0]!.where).toContain('¥500');
    for (const m of t.members) {
      for (const s of m.acquisition!.steps) expect(s.where, s.where).not.toMatch(/(from|Evolve|Trade-evolve|give) [a-z]/);
    }
  });

  it('tells you to hold off evolving when an item or trade evolution would cost a late move', async () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const t = await plan({ seed, must: ['raichu'] });
      for (const m of t.members) {
        const a = m.acquisition!;
        const route = a.steps.map((s) => s.species);
        const late = a.moves.filter((x) => {
          if (x.source.kind !== 'level' || x.source.from === m.set.species) return false;
          const idx = route.indexOf(x.source.from);
          const next = a.steps[idx + 1];
          if (!next || next.how !== 'evolution' || /^Evolves from/.test(next.where)) return false; // level evolutions cap by themselves
          return x.source.level > typicalLevelAt(red, next.stage);
        });
        if (late.length > 0) {
          checked++;
          expect(a.notes.some((n) => /^Hold off evolving/.test(n)), `${m.set.species}: ${late.map((x) => x.move)}`).toBe(true);
        }
        for (const n of a.notes) expect(n).toMatch(/^Hold off evolving [A-Z]/);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('names the lead as the form you actually have then (Pikachu at Brock, not Raichu)', () => {
    const plans = (team.analysis['bosses'] as unknown[]).map((p) => BossPlanSchema.parse(p));
    for (const p of plans) if (p.lead) expect(p.usable.map((u) => u.form)).toContain(p.lead);
    for (const p of plans) for (const w of p.warnings) expect(w).not.toMatch(/(against|^) [a-z]+[:.]/);
  });

  describe('team synergy', () => {
    const report = async (data: PlannerData, input: Partial<PlannerInput>) => {
      const t = await planIngameTeam(data, { seed: 1, ...input });
      const gen = data.gen;
      const members = t.members.map((m) => ({
        types: gen.species.get(m.set.species)!.types as string[],
        reach: reachOf(gen, m.set.moves.map((id) => gen.moves.get(id)!).filter((mv) => mv.basePower > 1).map((mv) => mv.type as string)),
      }));
      return { team: t, ...teamSynergy(gen, members) };
    };

    it('never builds a team with a defensive hole (two weak to a type nothing resists) or three weak to one type', async () => {
      for (const data of [red, blue]) {
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
          const r = await report(data, { seed });
          expect(r.holes, `${data.game.id} seed ${seed}: ${r.team.members.map((m) => m.set.species).join()}`).toEqual([]);
        }
      }
    });

    it('keeps variety on the team: no shared primary type, at most one Hyper Beam, at most one extra Normal-type', async () => {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const r = await report(red, { seed });
        expect(r.duplicatePrimary, `seed ${seed}`).toBe(0);
        expect(r.team.members.filter((m) => m.set.moves.includes('hyperbeam')).length).toBeLessThanOrEqual(1);
        expect(r.normalMembers).toBeLessThanOrEqual(2);
      }
    });

    it('reaches most types: on average the team hits at least 11 of 15 types super effectively', async () => {
      let uncovered = 0;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) uncovered += (await report(red, { seed })).uncovered.length;
      expect(uncovered / 10).toBeLessThanOrEqual(4);
    });

    it('still gives different teams for different seeds (not the same core every time)', async () => {
      const seen = new Map<string, number>();
      for (let seed = 1; seed <= 30; seed++) {
        for (const m of (await planIngameTeam(red, { seed })).members) seen.set(m.set.species, (seen.get(m.set.species) ?? 0) + 1);
      }
      expect(seen.size).toBeGreaterThanOrEqual(35);
      expect(Math.max(...seen.values())).toBeLessThanOrEqual(18); // no Pokémon on more than 60% of 30 teams
    });

    it('repairs holes without touching required Pokémon, and records the synergy report on the team', async () => {
      const r = await report(red, { seed: 3, must: ['raichu', 'jolteon'] });
      expect(r.team.members.map((m) => m.set.species)).toEqual(expect.arrayContaining(['raichu', 'jolteon']));
      const recorded = r.team.analysis['synergy'] as { holes: string[]; score: number };
      expect(recorded.score).toBeCloseTo(r.score, 6);
      expect(recorded.holes).toEqual(r.holes);
    });
  });

  describe('favorite Pokémon', () => {
    it('is on the team, marks the theme, and gets its own id', async () => {
      const t = await plan({ seed: 3, favorite: 'Charizard' });
      expect(t.members.map((m) => m.set.species)).toContain('charizard');
      expect(t.theme).toEqual({ kind: 'favorite', species: 'charizard' });
      expect(t.id).toBe('red-fav-charizard-s3');
      expect(() => TeamSchema.parse(t)).not.toThrow();
    });

    it('is not counted twice when it is also required, and other required Pokémon are kept', async () => {
      const t = await plan({ seed: 3, favorite: 'charizard', must: ['charizard', 'pikachu'] });
      const species = t.members.map((m) => m.set.species);
      expect(species.filter((s) => s === 'charizard')).toHaveLength(1);
      expect(species).toContain('pikachu');
    });

    it('reports a favorite that cannot be obtained instead of dropping it', async () => {
      await expect(plan({ favorite: 'mew' })).rejects.toThrow(PlannerError);
    });

    it('does not mark ordinary teams with a theme', () => {
      expect(team.theme).toBeUndefined();
      expect(team.id).toBe('red-s1');
    });
  });

  it('picks the rival starter that beats the player starter', () => {
    const s = team.analysis['starter'] as { player: string; rival: string };
    expect(red.bosses.rivalStarterFor[s.player]).toBe(s.rival);
  });

  it('plans every boss with calcs, and only uses members that are obtainable by then', () => {
    const plans = (team.analysis['bosses'] as unknown[]).map((p) => BossPlanSchema.parse(p));
    expect(plans).toHaveLength(red.bosses.bosses.length);
    for (const p of plans) {
      const byMember = new Map(team.members.map((m) => [m.set.species, m]));
      for (const u of p.usable) expect(byMember.get(u.member)!.acquisition!.steps[0]!.stage).toBeLessThanOrEqual(p.stage);
      for (const id of p.notYet) expect(byMember.get(id)!.acquisition!.steps[0]!.stage).toBeGreaterThan(p.stage);
      for (const m of p.matchups) if (m.answer) expect(m.answer.description).toMatch(/ vs\. /);
    }
  });
});

describe.skipIf(!hasCache)('learnsets from the game data', () => {
  it('a Magikarp that evolves learns Gyarados moves by level, not as start moves; a Gyarados created at 58 has them', async () => {
    const data = await loadPlannerData(getGame('red'));
    const evolved = learnableMoves({ gen: data.gen, tms: data.tms, learnsets: data.learnsets, chain: ['magikarp', 'gyarados'], acquiredLevel: 5, level: 56, stage: 8 });
    expect(evolved.get('hydropump')?.source).toMatchObject({ kind: 'level', level: 41, from: 'gyarados' });
    expect(evolved.get('splash')?.source.kind).toBe('start');
    const wild = movesAtLevel(data.learnsets.species['gyarados']!, 58);
    expect(wild).toEqual(expect.arrayContaining(['hydropump', 'hyperbeam']));
    expect(wild.length).toBeLessThanOrEqual(4);
  });

  it('keeps at most the last four moves when created above its learn levels', async () => {
    const data = await loadPlannerData(getGame('red'));
    const entry = data.learnsets.species['snorlax']!;
    const known = movesAtLevel(entry, 30);
    expect(known.length).toBeLessThanOrEqual(4);
    const all = [...entry.start, ...entry.levelUp.filter((l) => l.level <= 30).map((l) => l.move)];
    for (const m of known) expect(all).toContain(m);
  });
});
