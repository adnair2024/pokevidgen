import type { Generation } from '@pkmn/data';

/** Multiplier of one attacking type against a defender's (one or two) types, in this generation. */
export const effectiveness = (gen: Generation, attack: string, defend: readonly string[]): number =>
  defend.reduce((mult, def) => {
    // damageTaken codes: 0 neutral, 1 super effective, 2 resisted, 3 immune
    const code = gen.dex.types.get(def).damageTaken[attack];
    return mult * (code === 1 ? 2 : code === 2 ? 0.5 : code === 3 ? 0 : 1);
  }, 1);

export const typeNames = (gen: Generation): string[] => [...gen.types].map((t) => t.name);

/** Damage multiplier taken from every attacking type of this generation. */
export const defensiveProfile = (gen: Generation, types: readonly string[]): Record<string, number> =>
  Object.fromEntries(typeNames(gen).map((atk) => [atk, effectiveness(gen, atk, types)]));

export type TeamDefenseEntry = { weak: number; resist: number; immune: number; neutral: number };

/** For each attacking type, how many team members are weak / resist / immune / neutral to it. */
export const teamDefense = (
  gen: Generation,
  members: ReadonlyArray<readonly string[]>,
): Record<string, TeamDefenseEntry> => {
  const out: Record<string, TeamDefenseEntry> = {};
  for (const atk of typeNames(gen)) {
    const entry: TeamDefenseEntry = { weak: 0, resist: 0, immune: 0, neutral: 0 };
    for (const types of members) {
      const m = effectiveness(gen, atk, types);
      if (m === 0) entry.immune++;
      else if (m > 1) entry.weak++;
      else if (m < 1) entry.resist++;
      else entry.neutral++;
    }
    out[atk] = entry;
  }
  return out;
};

/** Attacking types that at least `min` members are weak to (the "avoid six teammates that share a weakness" check). */
export const sharedWeaknesses = (
  gen: Generation,
  members: ReadonlyArray<readonly string[]>,
  min = 3,
): string[] =>
  Object.entries(teamDefense(gen, members))
    .filter(([, e]) => e.weak >= min)
    .map(([type]) => type);

/** Best multiplier any of these attacking types gets against a defender. */
export const bestEffectiveness = (
  gen: Generation,
  attackTypes: readonly string[],
  defend: readonly string[],
): number => attackTypes.reduce((best, atk) => Math.max(best, effectiveness(gen, atk, defend)), 0);

export type OffensiveCoverage = {
  /** Single defending types hit super effectively by at least one attacking type. */
  superEffective: string[];
  /** Single defending types nothing here hits super effectively. */
  gaps: string[];
};

/** Offensive coverage of a set of attacking types against single types. */
export const offensiveCoverage = (gen: Generation, attackTypes: readonly string[]): OffensiveCoverage => {
  const superEffective: string[] = [];
  const gaps: string[] = [];
  for (const def of typeNames(gen)) {
    (bestEffectiveness(gen, attackTypes, [def]) > 1 ? superEffective : gaps).push(def);
  }
  return { superEffective, gaps };
};

/**
 * STAB-only matchup of one Pokémon against another: its best STAB multiplier against the opponent
 * minus the opponent's best STAB multiplier against it. Positive favours `mine`.
 */
export const stabMatchup = (gen: Generation, mine: readonly string[], theirs: readonly string[]): number =>
  bestEffectiveness(gen, mine, theirs) - bestEffectiveness(gen, theirs, mine);
