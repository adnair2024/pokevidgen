import { describe, expect, it } from 'vitest';
import {
  BASELINE_PLAYER_PROFILE, MAX_PROFILE, TRAINER_PROFILE, calcDamage, gen12Stat,
} from './calc.js';

describe('gen 1-2 stat formula', () => {
  it('matches the values @smogon/calc computes with max DVs and stat exp (Pikachu, level 50)', () => {
    // From the library's own defaults for this exact mon; HP base 35, Speed base 90.
    expect(gen12Stat('hp', 35, 15, 50, 65535)).toBe(141);
    expect(gen12Stat('other', 90, 15, 50, 65535)).toBe(141);
  });
  it('drops by the stat exp term when there is none', () => {
    expect(gen12Stat('hp', 35, 15, 50, 0)).toBeLessThan(gen12Stat('hp', 35, 15, 50, 65535));
  });
});

describe('calcDamage in gen 1', () => {
  const pikachu = { species: 'pikachu', level: 50 };
  const gyarados = { species: 'gyarados', level: 50 };

  it('with max profiles reproduces the library default result for Thunderbolt', () => {
    const r = calcDamage(1, { ...pikachu, profile: MAX_PROFILE }, { ...gyarados, profile: MAX_PROFILE }, 'Thunderbolt');
    expect([r.min, r.max]).toEqual([146, 172]);
    // ((95 + 15) * 2 + 63) * 50 / 100 + 50 + 10
    expect(r.defenderHp).toBe(201);
    expect(r.description).toContain('Pikachu Thunderbolt vs. Gyarados');
  });

  it('trainer Pokémon (no stat exp) take more damage than max-stat ones', () => {
    const max = calcDamage(1, { ...pikachu, profile: MAX_PROFILE }, { ...gyarados, profile: MAX_PROFILE }, 'Thunderbolt');
    const trainer = calcDamage(1, { ...pikachu, profile: BASELINE_PLAYER_PROFILE }, { ...gyarados, profile: TRAINER_PROFILE }, 'Thunderbolt');
    expect(trainer.defenderHp).toBeLessThan(max.defenderHp);
    expect(trainer.maxPercent).toBeGreaterThan(0);
  });

  it('defaults the defender to the trainer profile, and immunities do 0', () => {
    const r = calcDamage(1, { species: 'gengar', level: 50 }, { species: 'alakazam', level: 50 }, 'Lick');
    expect(r.max).toBe(0);
  });
});
