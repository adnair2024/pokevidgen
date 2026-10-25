import { z } from 'zod';
import type { Generation } from '@pkmn/data';
import { BossPlanSchema, type BossPlan } from '../ingame/bosses.js';
import type { PlannerData } from '../ingame/data.js';
import type { Boss } from '../games/bosses-schema.js';
import type { Member, Team } from '../types.js';

/**
 * A fact is the only material a narration line may use. Facts come from the team and the damage calcs,
 * never from a model or from memory. `text` is for humans auditing a line; the typed fields are what
 * templates read. `mentions` lists every Pokémon, move and number a line citing this fact may name.
 */
const Mentions = z.object({ pokemon: z.array(z.string()), moves: z.array(z.string()), numbers: z.array(z.number()) });

const Base = { id: z.string(), species: z.string(), text: z.string(), mentions: Mentions };

export const FactSchema = z.discriminatedUnion('kind', [
  z.object({
    ...Base, kind: z.literal('matchup'),
    bossId: z.string(), boss: z.string(), bossKind: z.string(), bossMon: z.string(), bossMonLevel: z.number().int(),
  }),
  z.object({
    ...Base, kind: z.literal('calc'),
    bossId: z.string(), boss: z.string(), bossKind: z.string(), bossMon: z.string(),
    move: z.string(), minPercent: z.number(), maxPercent: z.number(), ko: z.string(),
  }),
  z.object({
    ...Base, kind: z.literal('move'),
    move: z.string(), how: z.enum(['level', 'tm', 'hm', 'start']),
    level: z.number().int().optional(), number: z.number().int().optional(), location: z.string().optional(),
    /** Power x accuracy, with STAB: how much of a headline this move is. */
    weight: z.number(),
  }),
  z.object({
    ...Base, kind: z.literal('availability'),
    how: z.string(), where: z.string(), stage: z.number().int(), firstSpecies: z.string(),
    evolution: z.object({ how: z.enum(['level', 'stone', 'trade']), item: z.string().optional(), level: z.number().int().optional() }).optional(),
    price: z.number().int().optional(), coins: z.number().int().optional(),
  }),
  z.object({ ...Base, kind: z.literal('role'), role: z.string() }),
]);
export type Fact = z.infer<typeof FactSchema>;

/** Narration priority when choosing what to say: boss matchup > calc > key move > availability. */
export const FACT_PRIORITY: Record<Fact['kind'], number> = { matchup: 4, calc: 3, move: 2, role: 1.5, availability: 1 };

const BOSS_IMPORTANCE: Record<Boss['kind'], number> = { gymLeader: 1, eliteFour: 1, rival: 0.7, villain: 0.6 };

/** How good a boss fact is for storytelling: important boss, big damage. */
export const bossFactScore = (kind: Boss['kind'], maxPercent: number): number =>
  BOSS_IMPORTANCE[kind] * (0.5 + Math.min(maxPercent, 100) / 200);

export const roundPercent = (n: number): number => Math.round(n / 5) * 5;

const nameOf = (gen: Generation, id: string): string => gen.species.get(id)?.name ?? id;
const moveNameOf = (gen: Generation, id: string): string => gen.moves.get(id)?.name ?? id;

/**
 * How narration refers to a boss. A name shared by several fights (Giovanni is met three times) says which one,
 * since "Giovanni" alone sounds like the first time you meet him; the rival stays "your rival".
 */
export const spokenBossName = (boss: Boss, all: readonly Boss[]): string => {
  if (boss.name === 'Rival') return 'your rival';
  if (all.filter((b) => b.name === boss.name).length < 2) return boss.name;
  return boss.kind === 'gymLeader' ? `${boss.name} at the ${boss.location.replace(/ City$/, '')} Gym` : `${boss.name} at ${boss.location}`;
};

const bossFacts = (data: PlannerData, member: Member, plans: BossPlan[]): Fact[] => {
  const { gen } = data;
  const species = member.set.species;
  const out: Fact[] = [];
  for (const plan of plans) {
    const boss = data.bosses.bosses.find((b) => b.id === plan.boss)!;
    // Only the final form: the pick's name must match the Pokémon the calc is about.
    const mine = plan.matchups.filter((m) => m.answer?.member === species && m.answer.form === species);
    if (mine.length === 0) continue;
    const best = mine.reduce((a, b) => (b.answer!.maxPercent > a.answer!.maxPercent ? b : a));
    const a = best.answer!;
    if (a.maxPercent < 40) continue; // not worth bragging about
    const bossName = spokenBossName(boss, data.bosses.bosses);
    const common = {
      species, bossId: plan.boss, boss: bossName, bossKind: boss.kind, bossMon: best.bossMon.species,
    };
    out.push({
      id: `${species}.vs-${plan.boss}`, kind: 'matchup', ...common, bossMonLevel: best.bossMon.level,
      text: `${nameOf(gen, species)} is the best answer to ${bossName}'s ${nameOf(gen, best.bossMon.species)} (level ${best.bossMon.level})`,
      mentions: { pokemon: [species, best.bossMon.species], moves: [], numbers: [best.bossMon.level] },
    });
    out.push({
      id: `${species}.calc-${plan.boss}`, kind: 'calc', ...common, move: a.move,
      minPercent: a.minPercent, maxPercent: a.maxPercent, ko: a.ko,
      text: `${moveNameOf(gen, a.move)} does ${a.minPercent}-${a.maxPercent}% to ${bossName}'s ${nameOf(gen, best.bossMon.species)} (${a.ko})`,
      mentions: {
        pokemon: [species, best.bossMon.species], moves: [a.move],
        numbers: [a.minPercent, a.maxPercent, roundPercent((a.minPercent + a.maxPercent) / 2), ...(a.ko.match(/\d+/g) ?? []).map(Number)],
      },
    });
  }
  return out;
};

const moveFacts = (gen: Generation, member: Member): Fact[] => {
  const species = member.set.species;
  const types = gen.species.get(species)!.types as string[];
  return member.acquisition!.moves.map((x) => {
    const mv = gen.moves.get(x.move)!;
    const accuracy = mv.accuracy === true ? 1 : mv.accuracy / 100;
    const weight = Math.max(0, mv.basePower - 1) * accuracy * (types.includes(mv.type as string) ? 1.5 : 1);
    const s = x.source;
    const how = s.kind;
    const number = s.kind === 'tm' || s.kind === 'hm' ? s.number : undefined;
    const level = s.kind === 'level' ? s.level : undefined;
    return {
      id: `${species}.move-${x.move}`, kind: 'move' as const, species, move: x.move, how, level, number,
      location: s.kind === 'tm' || s.kind === 'hm' ? s.location : undefined, weight,
      text: `${nameOf(gen, species)} learns ${mv.name} ${s.kind === 'level' ? `at level ${s.level}` : s.kind === 'start' ? 'when caught' : `from ${s.kind.toUpperCase()}${s.number} (${s.location})`}`,
      mentions: { pokemon: [species], moves: [x.move], numbers: [level ?? number].filter((n): n is number => n !== undefined) },
    };
  });
};

const availabilityFact = (gen: Generation, member: Member): Fact => {
  const species = member.set.species;
  const steps = member.acquisition!.steps;
  const first = steps[0]!;
  const evolution = steps.find((s) => s.how === 'evolution')?.evolution;
  return {
    id: `${species}.get`, kind: 'availability', species, how: first.how, where: first.place ?? first.where, stage: first.stage,
    firstSpecies: first.species,
    evolution: evolution ? { how: evolution.how, item: evolution.item, level: evolution.level } : undefined,
    price: first.price, coins: first.coins,
    text: `${nameOf(gen, first.species)}: ${first.where}${steps.length > 1 ? `; then ${steps[steps.length - 1]!.where}` : ''}`,
    mentions: {
      pokemon: [species, first.species],
      moves: [],
      // Digits inside a place name ("Route 12", "Rock Tunnel B1F") are part of the name, so a line may say them.
      numbers: [first.minLevel, first.maxLevel, first.price, first.coins, evolution?.level, ...((first.place ?? '').match(/\d+/g) ?? []).map(Number)].filter((n): n is number => n !== undefined),
    },
  };
};

const roleFacts = (member: Member): Fact[] =>
  member.roles.filter((r) => ['sleep', 'paralysis', 'recovery'].includes(r)).map((role) => ({
    id: `${member.set.species}.role-${role}`, kind: 'role' as const, species: member.set.species, role,
    text: `${member.set.species} fills the ${role} role for the team`,
    mentions: { pokemon: [member.set.species], moves: [], numbers: [] },
  }));

/** Citable facts for every member of the team, keyed by species. */
export const buildFacts = (data: PlannerData, team: Team): Map<string, Fact[]> => {
  const plans = ((team.analysis['bosses'] as unknown[]) ?? []).map((p) => BossPlanSchema.parse(p));
  return new Map(
    team.members.map((m) => [
      m.set.species,
      [...bossFacts(data, m, plans), ...moveFacts(data.gen, m), availabilityFact(data.gen, m), ...roleFacts(m)].map((f) => FactSchema.parse(f)),
    ]),
  );
};
