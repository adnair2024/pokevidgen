import { describe, expect, it } from 'vitest';
import { forGen } from '../data/gens.js';
import { missingRoles, potentialRoles, rolesOfSet } from './roles.js';

const gen1 = forGen(1);

describe('roles', () => {
  it('derives roles from a gen 1 set (moves and base stats)', () => {
    const roles = rolesOfSet(gen1, 'Alakazam', ['Psychic', 'Recover', 'Thunder Wave', 'Seismic Toss']);
    expect(roles).toEqual(expect.arrayContaining(['recovery', 'paralysis', 'fast']));
    expect(roles).not.toContain('sleep');
  });

  it('finds role potential from the learnset', async () => {
    expect(await potentialRoles(gen1, 'Gengar')).toContain('sleep');
    expect(await potentialRoles(gen1, 'Snorlax')).toEqual(expect.arrayContaining(['bulky', 'recovery']));
  });

  it('refuses a generation with no role definitions instead of applying gen 1 rules', () => {
    expect(() => rolesOfSet(forGen(2), 'Alakazam', ['Psychic'])).toThrow(/generation 2/);
  });

  it('reports roles a team is missing', () => {
    expect(missingRoles([['fast'], ['sleep']], ['sleep', 'paralysis', 'recovery'])).toEqual(['paralysis', 'recovery']);
  });
});
