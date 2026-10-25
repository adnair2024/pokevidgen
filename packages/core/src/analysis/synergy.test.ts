import { describe, expect, it } from 'vitest';
import { forGen } from '../data/gens.js';
import { effectiveness } from './coverage.js';
import { SYNERGY, reachOf, teamSynergy, type SynergyMember } from './synergy.js';

const gen = forGen(1);
const member = (types: string[], attacks: string[] = types): SynergyMember => ({ types, reach: reachOf(gen, attacks) });

describe('teamSynergy', () => {
  it('flags three members weak to one type as severe, and counts each one beyond two', () => {
    const rockies = [member(['Rock', 'Ground']), member(['Rock', 'Ground']), member(['Rock', 'Ground']), member(['Water'])];
    const r = teamSynergy(gen, rockies);
    expect(r.severe).toEqual(expect.arrayContaining(['Water', 'Grass']));
    expect(r.defense['Water']!.weak).toBe(3); // the three Rock/Ground members; the Water member is not weak to Water
    expect(r.holes).toContain('Water');
  });

  it('finds a hole when two are weak and nothing resists, and not once something does (types found from the chart)', () => {
    const types = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon'];
    let checked = false;
    for (const attack of types) {
      const weak = types.filter((t) => effectiveness(gen, attack, [t]) > 1);
      const neutral = types.filter((t) => effectiveness(gen, attack, [t]) === 1);
      const resists = types.filter((t) => effectiveness(gen, attack, [t]) < 1);
      if (weak.length < 2 || neutral.length < 1 || resists.length < 1) continue;
      const hole = teamSynergy(gen, [member([weak[0]!]), member([weak[1]!]), member([neutral[0]!])]);
      expect(hole.holes, `${attack}: ${weak[0]} and ${weak[1]} weak, ${neutral[0]} neutral`).toContain(attack);
      const answered = teamSynergy(gen, [member([weak[0]!]), member([weak[1]!]), member([resists[0]!])]);
      expect(answered.defense[attack]!.cover).toBeGreaterThanOrEqual(1);
      expect(answered.holes).not.toContain(attack);
      expect(answered.score).toBeGreaterThan(hole.score - 100); // sanity: both are finite numbers
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('rewards a team that resists what its other members fear', () => {
    const fear = [member(['Grass']), member(['Bug']), member(['Ice'])]; // all weak to Fire
    const fixed = [member(['Grass']), member(['Bug']), member(['Water'])]; // Water resists Fire
    expect(teamSynergy(gen, fear).defense['Fire']).toEqual({ weak: 3, cover: 0 });
    expect(teamSynergy(gen, fixed).defense['Fire']!.cover).toBeGreaterThanOrEqual(1);
    expect(teamSynergy(gen, fixed).score).toBeGreaterThan(teamSynergy(gen, fear).score);
  });

  it('counts offensive reach from what each member hits super effectively, and lists the types nobody hits', () => {
    const r = teamSynergy(gen, [member(['Water'], ['Water', 'Ice']), member(['Electric'], ['Electric', 'Ground'])]);
    expect(r.uncovered).toContain('Psychic'); // none of Water, Ice, Electric, Ground hit it
    expect(r.uncovered).not.toContain('Fire'); // Water hits Fire
    expect(r.uncovered).not.toContain('Flying'); // Electric and Ice hit Flying
  });

  it('penalizes shared primary types and extra Normal-type filler, and rewards variety', () => {
    const varied = teamSynergy(gen, [member(['Fire']), member(['Water']), member(['Grass']), member(['Electric']), member(['Psychic']), member(['Ground'])]);
    const same = teamSynergy(gen, [member(['Normal']), member(['Normal']), member(['Normal']), member(['Water', 'Psychic']), member(['Water']), member(['Water'])]);
    expect(varied.duplicatePrimary).toBe(0);
    expect(same.duplicatePrimary).toBe(4);
    expect(same.normalMembers).toBe(3);
    expect(varied.distinctTypes).toBeGreaterThan(same.distinctTypes);
    expect(varied.score).toBeGreaterThan(same.score);
    expect(SYNERGY.extraNormal).toBeLessThan(0);
  });

  it('is gen-aware: a gen 2 team sees Dark and Steel, a gen 1 team never does', () => {
    expect(Object.keys(teamSynergy(gen, [member(['Fire'])]).defense)).not.toContain('Dark');
    const g2 = forGen(2);
    expect(Object.keys(teamSynergy(g2, [{ types: ['Steel'], reach: reachOf(g2, ['Steel']) }]).defense)).toContain('Dark');
  });
});
