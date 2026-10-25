import type { Generation } from '@pkmn/data';
import { toID } from '../data/ids.js';

export type Role =
  | 'sleep'
  | 'paralysis'
  | 'trapping'
  | 'recovery'
  | 'screens'
  | 'explosion'
  | 'fast'
  | 'bulky';

/**
 * Moves that define a role, as move IDs. Gen 1 is what the in-game planner needs first: sleep and
 * paralysis dominate, partial trapping is strong, and there are no hazards, abilities or items.
 * Later gens add roles here (hazards, removal, pivoting, ...), so keep this per-generation.
 */
const MOVE_ROLES: Record<number, Partial<Record<Role, readonly string[]>>> = {
  1: {
    sleep: ['sing', 'sleeppowder', 'spore', 'hypnosis', 'lovelykiss'],
    paralysis: ['thunderwave', 'stunspore', 'glare'],
    trapping: ['wrap', 'bind', 'firespin', 'clamp'],
    recovery: ['recover', 'softboiled', 'rest'],
    screens: ['reflect', 'lightscreen'],
    explosion: ['explosion', 'selfdestruct'],
  },
};

/** Stat-based roles use base stats, with these (heuristic, not game-derived) thresholds. */
export const FAST_BASE_SPEED = 100;
export const BULKY_BASE_HP = 90;

const moveRolesFor = (gen: Generation) => {
  const table = MOVE_ROLES[gen.num];
  if (!table) throw new Error(`No role definitions for generation ${gen.num} yet`);
  return table;
};

const statRoles = (gen: Generation, species: string): Role[] => {
  const s = gen.species.get(species);
  if (!s) throw new Error(`Unknown species "${species}" in gen ${gen.num}`);
  const roles: Role[] = [];
  if (s.baseStats.spe >= FAST_BASE_SPEED) roles.push('fast');
  if (s.baseStats.hp >= BULKY_BASE_HP) roles.push('bulky');
  return roles;
};

const rolesOfMoves = (gen: Generation, moves: Iterable<string>): Role[] => {
  const have = new Set([...moves].map(toID));
  return (Object.entries(moveRolesFor(gen)) as Array<[Role, readonly string[]]>)
    .filter(([, defining]) => defining.some((m) => have.has(m)))
    .map(([role]) => role);
};

/** Roles a concrete set fills. */
export const rolesOfSet = (gen: Generation, species: string, moves: readonly string[]): Role[] => [
  ...new Set([...rolesOfMoves(gen, moves), ...statRoles(gen, toID(species))]),
];

/** Roles a species could fill given everything it can learn in this generation. */
export const potentialRoles = async (gen: Generation, species: string): Promise<Role[]> => {
  const learnset = await gen.learnsets.get(toID(species));
  return [
    ...new Set([...rolesOfMoves(gen, Object.keys(learnset?.learnset ?? {})), ...statRoles(gen, toID(species))]),
  ];
};

/** Roles in `wanted` that no team member fills. */
export const missingRoles = (team: ReadonlyArray<readonly Role[]>, wanted: readonly Role[]): Role[] => {
  const filled = new Set(team.flat());
  return wanted.filter((r) => !filled.has(r));
};
