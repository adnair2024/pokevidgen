import type { Generation } from '@pkmn/data';
import { effectiveness, typeNames } from './coverage.js';

/** What synergy needs to know about a team member. */
export type SynergyMember = {
  types: readonly string[];
  /** Defending types this member's attacks hit super effectively (its STAB plus its best coverage moves). */
  reach: ReadonlySet<string>;
};

/**
 * Weights for the team score. Defensive holes dominate: a team with two members weak to the same type and
 * nothing that resists it loses a whole matchup, while offensive reach and variety separate good teams from
 * interesting ones.
 */
export const SYNERGY = {
  /** Three or more weak to one type, per member beyond two. */
  severeWeakness: -1.0,
  /** Two weak and nothing on the team resists or is immune: a hole. */
  hole: -0.6,
  /** Two weak but exactly one answer. */
  thinCover: -0.15,
  /** Two or more members resist or are immune to a type. */
  wellCovered: 0.05,
  /** Per defending type some member hits super effectively. */
  reach: 0.1,
  /** Per extra member sharing a primary type. */
  duplicatePrimary: -0.35,
  /** Per Normal-type member beyond the first (Normal has no offensive reach: it is the filler slot). */
  extraNormal: -0.45,
  /** Per distinct type on the team. */
  distinctType: 0.04,
} as const;

export type DefenseCell = { weak: number; cover: number };

export type SynergyReport = {
  defense: Record<string, DefenseCell>;
  /** Types that two or more members are weak to with no resist or immunity on the team (or three or more weak). */
  holes: string[];
  severe: string[];
  /** Defending types nobody on the team can hit super effectively. */
  uncovered: string[];
  duplicatePrimary: number;
  normalMembers: number;
  distinctTypes: number;
  score: number;
};

/** Defensive balance, offensive reach and variety of a team, as a number and as the facts behind it. */
export const teamSynergy = (gen: Generation, members: readonly SynergyMember[]): SynergyReport => {
  const types = typeNames(gen);
  const defense: Record<string, DefenseCell> = {};
  const holes: string[] = [];
  const severe: string[] = [];
  let score = 0;

  for (const atk of types) {
    let weak = 0;
    let cover = 0;
    for (const m of members) {
      const e = effectiveness(gen, atk, m.types);
      if (e > 1) weak++;
      else if (e < 1) cover++;
    }
    defense[atk] = { weak, cover };
    if (weak >= 3) { severe.push(atk); holes.push(atk); score += SYNERGY.severeWeakness * (weak - 2); }
    else if (weak === 2 && cover === 0) { holes.push(atk); score += SYNERGY.hole; }
    else if (weak === 2 && cover === 1) score += SYNERGY.thinCover;
    if (cover >= 2) score += SYNERGY.wellCovered;
  }

  const uncovered = types.filter((d) => !members.some((m) => m.reach.has(d)));
  score += SYNERGY.reach * (types.length - uncovered.length);

  const primaries = members.map((m) => m.types[0]);
  const duplicatePrimary = primaries.length - new Set(primaries).size;
  const normalMembers = members.filter((m) => m.types.includes('Normal')).length;
  const distinctTypes = new Set(members.flatMap((m) => m.types)).size;
  score += SYNERGY.duplicatePrimary * duplicatePrimary + SYNERGY.extraNormal * Math.max(0, normalMembers - 1) + SYNERGY.distinctType * distinctTypes;

  return { defense, holes, severe, uncovered, duplicatePrimary, normalMembers, distinctTypes, score };
};

/** Defending types hit super effectively by at least one of these attacking types. */
export const reachOf = (gen: Generation, attackTypes: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const atk of attackTypes) for (const def of typeNames(gen)) if (effectiveness(gen, atk, [def]) > 1) out.add(def);
  return out;
};
