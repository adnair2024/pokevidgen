import { z } from 'zod';
import { BASELINE_PLAYER_PROFILE, TRAINER_PROFILE, calcDamage, gen12Stat } from '../analysis/calc.js';
import { stabMatchup } from '../analysis/coverage.js';
import type { Role } from '../analysis/roles.js';
import { IdSchema, type Team } from '../types.js';
import type { Boss } from '../games/bosses-schema.js';
import type { PlannerData } from './data.js';
import { chainOf } from './families.js';
import { formAt, learnableMoves } from './learnsets.js';
import { selectMoves } from './moves.js';

const CalcLineSchema = z.object({
  move: IdSchema,
  minPercent: z.number(),
  maxPercent: z.number(),
  ko: z.string(),
  /** Standard `@smogon/calc` description line. */
  description: z.string(),
});

const MatchupSchema = z.object({
  bossMon: z.object({ species: IdSchema, level: z.number().int(), moves: z.array(IdSchema) }),
  /** Our best damage against it, and who deals it. */
  answer: CalcLineSchema.extend({ member: IdSchema, form: IdSchema, outspeeds: z.boolean() }).optional(),
  /** What it does to that answer. */
  threat: CalcLineSchema.optional(),
});

export const BossPlanSchema = z.object({
  boss: z.string(),
  name: z.string(),
  location: z.string(),
  /** Badges typically held when facing this boss. */
  stage: z.number().int(),
  /** Our level for these calcs: the boss's strongest Pokémon's level. */
  level: z.number().int(),
  rivalStarter: z.string().optional(),
  usable: z.array(z.object({ member: IdSchema, form: IdSchema, moves: z.array(IdSchema) })),
  /** Team members you can't use yet (not caught, or the stone/TM isn't available). */
  notYet: z.array(IdSchema),
  matchups: z.array(MatchupSchema),
  /** The form (not the final evolution) best against the boss's first Pokémon. */
  lead: IdSchema.optional(),
  warnings: z.array(z.string()),
});
export type BossPlan = z.infer<typeof BossPlanSchema>;

export type StarterChoice = { player: string; rival: string; onTeam: boolean };

const STARTERS = ['bulbasaur', 'charmander', 'squirtle'];

/** The starter you take: the one on the team if any, otherwise the best against the first gyms. */
export const chooseStarter = (data: PlannerData, team: Team): StarterChoice => {
  const { gen, bosses } = data;
  const fromTeam = team.members
    .map((m) => chainOf(gen, m.set.species)[0]!)
    .find((root) => STARTERS.includes(root));
  const early = bosses.bosses.filter((b) => b.kind === 'gymLeader').sort((a, b) => a.order - b.order).slice(0, 3);
  const early_fit = (starter: string): number =>
    early.reduce((sum, boss) => {
      const mons = boss.variants[0]!.team;
      return sum + mons.reduce((s, m) =>
        s + stabMatchup(gen, gen.species.get(starter)!.types as string[], gen.species.get(m.species)!.types as string[]), 0) / mons.length;
    }, 0);
  const player = fromTeam ?? [...STARTERS].sort((a, b) => early_fit(b) - early_fit(a) || a.localeCompare(b))[0]!;
  const rival = bosses.rivalStarterFor[player];
  if (!rival) throw new Error(`No rival starter rule for "${player}"`);
  return { player, rival, onTeam: !!fromTeam };
};

/** Gym badges typically held when you face a boss: gym leaders fought before it in story order (8 for the Elite Four on). */
export const stageFor = (data: PlannerData, boss: Boss): number =>
  data.bosses.bosses.filter((b) => b.badge && b.order < boss.order).length;

/** The level a player is typically at once they hold `stage` badges: the strongest boss met by then. */
export const typicalLevelAt = (data: PlannerData, stage: number): number =>
  Math.max(
    5,
    ...data.bosses.bosses
      .filter((b) => stageFor(data, b) <= stage)
      .flatMap((b) => b.variants.flatMap((v) => v.team.map((m) => m.level))),
  );

const lineOf = (c: z.infer<typeof CalcLineSchema>) => c;

export const analyseBosses = async (data: PlannerData, team: Team, starter: StarterChoice): Promise<BossPlan[]> => {
  const { gen, tms, progression } = data;
  const stoneStage = (item: string) => progression.items[item]?.stage ?? 99;
  const tmCopies = (n: number): number => {
    const tm = tms.tms.find((t) => t.kind === 'tm' && t.number === n);
    return tm && tm.sources.some((s) => s.kind === 'shop' || s.kind === 'prize') ? Infinity : (tm?.sources.length ?? 1);
  };
  const plans: BossPlan[] = [];

  for (const boss of [...data.bosses.bosses].sort((a, b) => a.order - b.order)) {
    const stage = stageFor(data, boss);
    const variant = boss.kind === 'rival'
      ? boss.variants.find((v) => v.rivalStarter === starter.rival)!
      : boss.variants[0]!;
    const level = Math.max(...variant.team.map((m) => m.level));

    const usable: BossPlan['usable'] = [];
    const notYet: string[] = [];
    const teamRoles = new Set<Role>();
    const tmUses = new Map<number, number>();
    for (const member of team.members) {
      const steps = member.acquisition!.steps;
      const chain = steps.map((st) => st.species);
      const acquiredLevel = steps[0]!.minLevel ?? 1;
      // A line is usable once its earliest route is reachable; the final form's stage gates evolutions.
      const firstStage = steps[0]!.stage;
      if (firstStage > stage) { notYet.push(member.set.species); continue; }
      const form = formAt(gen, stoneStage, chain, level, stage);
      const learnable = learnableMoves({
        gen, tms, learnsets: data.learnsets, chain: chain.slice(0, chain.indexOf(form) + 1), acquiredLevel, level, stage,
      });
      const moves = selectMoves({ gen, species: form, level, learnable, teamRoles, tmUses, tmCopies }).map((l) => l.move);
      usable.push({ member: member.set.species, form, moves });
    }

    const matchups: BossPlan['matchups'] = [];
    const warnings: string[] = [];
    for (const mon of variant.team) {
      let answer: BossPlan['matchups'][number]['answer'];
      for (const u of usable) {
        for (const move of u.moves) {
          if (!gen.moves.get(move)?.basePower || gen.moves.get(move)!.basePower <= 1) continue;
          const r = calcDamage(
            gen.num,
            { species: u.form, level, profile: BASELINE_PLAYER_PROFILE },
            { species: mon.species, level: mon.level, profile: TRAINER_PROFILE },
            move,
          );
          if (!answer || r.maxPercent > answer.maxPercent) {
            const speed = (id: string, lvl: number, p: typeof TRAINER_PROFILE) =>
              gen12Stat('other', gen.species.get(id)!.baseStats.spe, p.dvs.spe, lvl, p.statExp);
            answer = {
              move, member: u.member, form: u.form, minPercent: r.minPercent, maxPercent: r.maxPercent,
              ko: r.ko, description: r.description,
              outspeeds: speed(u.form, level, BASELINE_PLAYER_PROFILE) > speed(mon.species, mon.level, TRAINER_PROFILE),
            };
          }
        }
      }
      let threat: BossPlan['matchups'][number]['threat'];
      if (answer) {
        for (const move of mon.moves) {
          if (!gen.moves.get(move)?.basePower || gen.moves.get(move)!.basePower <= 1) continue;
          const r = calcDamage(
            gen.num,
            { species: mon.species, level: mon.level, profile: TRAINER_PROFILE },
            { species: answer.form, level, profile: BASELINE_PLAYER_PROFILE },
            move,
          );
          if (!threat || r.maxPercent > threat.maxPercent) {
            threat = lineOf({ move, minPercent: r.minPercent, maxPercent: r.maxPercent, ko: r.ko, description: r.description });
          }
        }
      }
      matchups.push({ bossMon: { species: mon.species, level: mon.level, moves: mon.moves }, answer, threat });
      const theirName = gen.species.get(mon.species)?.name ?? mon.species;
      if (!answer) warnings.push(`No usable damaging move against ${theirName}.`);
      else if (answer.maxPercent < 50) warnings.push(`Weak against ${theirName}: best is ${answer.description}.`);
      if (threat && threat.maxPercent >= 100) {
        warnings.push(`${theirName} can KO ${gen.species.get(answer!.form)?.name ?? answer!.form} with ${gen.moves.get(threat.move)?.name ?? threat.move}.`);
      }
    }

    plans.push({
      boss: boss.id, name: boss.name, location: boss.location, stage, level,
      rivalStarter: boss.kind === 'rival' ? starter.rival : undefined,
      usable, notYet, matchups, lead: matchups[0]?.answer?.form, warnings,
    });
  }
  return plans;
};
