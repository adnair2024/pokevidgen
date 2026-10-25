import { describe, expect, it } from 'vitest';
import { forGen } from '../data/gens.js';
import {
  bestEffectiveness, defensiveProfile, effectiveness, offensiveCoverage, sharedWeaknesses, stabMatchup,
  teamDefense, typeNames,
} from './coverage.js';

const gen1 = forGen(1);
const gen2 = forGen(2);
const gen6 = forGen(6);

describe('type lists per generation', () => {
  it('gen 1 has 15 types: no Dark, Steel or Fairy', () => {
    expect(typeNames(gen1)).toHaveLength(15);
    expect(typeNames(gen1)).not.toContain('Dark');
    expect(typeNames(gen1)).not.toContain('Steel');
    expect(typeNames(gen1)).not.toContain('Fairy');
  });
  it('gen 2 adds Dark and Steel, but no Fairy', () => {
    expect(typeNames(gen2)).toEqual(expect.arrayContaining(['Dark', 'Steel']));
    expect(typeNames(gen2)).not.toContain('Fairy');
  });
  it('gen 6 adds Fairy', () => {
    expect(typeNames(gen6)).toContain('Fairy');
  });
});

describe('gen-specific matchups', () => {
  it('gen 1: Ghost does nothing to Psychic (bug); Ghost and Normal are mutually immune', () => {
    expect(effectiveness(gen1, 'Ghost', ['Psychic'])).toBe(0);
    expect(effectiveness(gen1, 'Normal', ['Ghost'])).toBe(0);
    expect(effectiveness(gen1, 'Ghost', ['Normal'])).toBe(0);
  });
  it('gen 2+: Ghost is super effective on Psychic', () => {
    expect(effectiveness(gen2, 'Ghost', ['Psychic'])).toBe(2);
  });
  it('gen 1: Poison and Bug are super effective on each other; Ice is neutral on Fire', () => {
    expect(effectiveness(gen1, 'Poison', ['Bug'])).toBe(2);
    expect(effectiveness(gen1, 'Bug', ['Poison'])).toBe(2);
    expect(effectiveness(gen1, 'Ice', ['Fire'])).toBe(1);
  });
  it('gen 2: Ice is resisted by Fire; Bug no longer beats Poison', () => {
    expect(effectiveness(gen2, 'Ice', ['Fire'])).toBe(0.5);
    expect(effectiveness(gen2, 'Bug', ['Poison'])).toBe(0.5);
  });
  it('Steel resists Ghost and Dark in gen 2 but not in gen 6', () => {
    expect(effectiveness(gen2, 'Ghost', ['Steel'])).toBe(0.5);
    expect(effectiveness(gen2, 'Dark', ['Steel'])).toBe(0.5);
    expect(effectiveness(gen6, 'Ghost', ['Steel'])).toBe(1);
    expect(effectiveness(gen6, 'Dark', ['Steel'])).toBe(1);
  });
  it('dual types multiply, including 4x and immunity', () => {
    expect(effectiveness(gen1, 'Rock', ['Fire', 'Flying'])).toBe(4);
    expect(effectiveness(gen1, 'Ground', ['Water', 'Flying'])).toBe(0);
    expect(effectiveness(gen1, 'Electric', ['Water', 'Flying'])).toBe(4);
  });
});

describe('defensive and offensive analysis', () => {
  it('builds a full profile for every attacking type of the generation', () => {
    const profile = defensiveProfile(gen1, ['Water', 'Ice']);
    expect(Object.keys(profile)).toHaveLength(15);
    expect(profile['Electric']).toBe(2);
    expect(profile['Water']).toBe(0.5);
  });

  it('counts team weaknesses and flags shared ones', () => {
    // Pidgeot, Raichu... three Flying-weak Grass/Bug mons all fear Fire and Flying.
    const team = [['Grass', 'Poison'], ['Bug', 'Grass'], ['Grass'], ['Water']];
    const defense = teamDefense(gen1, team);
    expect(defense['Fire']!.weak).toBe(3);
    expect(sharedWeaknesses(gen1, team, 3)).toContain('Fire');
    expect(sharedWeaknesses(gen1, team, 3)).not.toContain('Water');
  });

  it('offensive coverage lists what is hit and what is not', () => {
    const { superEffective, gaps } = offensiveCoverage(gen1, ['Ground', 'Ice']);
    expect(superEffective).toEqual(expect.arrayContaining(['Fire', 'Electric', 'Rock', 'Flying', 'Dragon']));
    expect(gaps).toContain('Water');
    // Ghost only hits Ghost super effectively, so a Ghost-only team has huge gaps in gen 1.
    expect(offensiveCoverage(gen1, ['Ghost']).superEffective).toEqual(['Ghost']);
  });

  it('best effectiveness and STAB matchup use the best of several types', () => {
    expect(bestEffectiveness(gen1, ['Fire', 'Ground'], ['Rock', 'Electric'])).toBe(4);
    expect(bestEffectiveness(gen1, ['Fire', 'Ground'], ['Water'])).toBe(1);
    // Gen 1 Gengar (Ghost/Poison) vs a Psychic: Ghost does nothing and Poison is neutral, while Psychic hits Poison super effectively.
    expect(stabMatchup(gen1, ['Ghost', 'Poison'], ['Psychic'])).toBeLessThan(0);
    expect(stabMatchup(gen1, ['Psychic'], ['Ghost', 'Poison'])).toBeGreaterThan(0);
  });
});
