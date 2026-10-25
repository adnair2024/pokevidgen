import { calculate, Generations, Move, Pokemon, type State } from '@smogon/calc';
import { toID } from '../data/ids.js';

/**
 * Gen 1-2 stats come from DVs (0-15) and stat exp (0-65535) instead of IVs/EVs. `@smogon/calc`
 * hardcodes max stat exp for these gens, so we compute the stats ourselves and override them.
 * HP's DV is derived from the others, and gen 1 has a single Special DV.
 */
export type StatProfile = {
  dvs: { atk: number; def: number; spe: number; spc: number };
  statExp: number;
};

/** What the game gives trainer Pokémon: pokered `ATKDEFDV_TRAINER` $98 and `SPDSPCDV_TRAINER` $88, no stat exp. */
export const TRAINER_PROFILE: StatProfile = { dvs: { atk: 9, def: 8, spe: 8, spc: 8 }, statExp: 0 };

/** A floor for a caught Pokémon: average DVs, no stat exp. Real ones only get better as they battle. */
export const BASELINE_PLAYER_PROFILE: StatProfile = { dvs: { atk: 8, def: 8, spe: 8, spc: 8 }, statExp: 0 };

/** Perfect DVs and max stat exp: what `@smogon/calc` assumes and what competitive gen 1/2 uses. */
export const MAX_PROFILE: StatProfile = { dvs: { atk: 15, def: 15, spe: 15, spc: 15 }, statExp: 65535 };

const hpDv = ({ atk, def, spe, spc }: StatProfile['dvs']): number =>
  (atk % 2) * 8 + (def % 2) * 4 + (spe % 2) * 2 + (spc % 2);

export const gen12Stat = (stat: 'hp' | 'other', base: number, dv: number, level: number, statExp: number): number => {
  // The game caps the square-root term at 255, so max stat exp adds 63, not 64.
  const expBonus = Math.floor(Math.min(255, Math.ceil(Math.sqrt(statExp))) / 4);
  const core = Math.floor((((base + dv) * 2 + expBonus) * level) / 100);
  return stat === 'hp' ? core + level + 10 : core + 5;
};

export type CalcMon = {
  species: string;
  level: number;
  /** Gen 1-2 only. Defaults to `TRAINER_PROFILE`. */
  profile?: StatProfile;
  /** Stat stages, e.g. { atk: 2 }. */
  boosts?: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  status?: State.Pokemon['status'];
  /** Gens 3+: ivs, evs, nature, item, ability, teraType... passed straight to `@smogon/calc`. */
  options?: Partial<State.Pokemon>;
};

export type DamageResult = {
  min: number;
  max: number;
  /** Percent of the defender's max HP, one decimal. */
  minPercent: number;
  maxPercent: number;
  defenderHp: number;
  /** e.g. "guaranteed 2HKO", from `@smogon/calc`. */
  ko: string;
  /** Standard `@smogon/calc` description line. */
  description: string;
};

const buildMon = (genNum: number, mon: CalcMon): Pokemon => {
  const gen = Generations.get(genNum as Parameters<typeof Generations.get>[0]);
  const species = gen.species.get(toID(mon.species) as Parameters<typeof gen.species.get>[0]);
  if (!species) throw new Error(`Unknown species "${mon.species}" in gen ${genNum}`);
  const name = species.name; // display name, so descriptions read in the standard calc format
  if (genNum > 2) {
    return new Pokemon(gen, name, {
      level: mon.level, boosts: mon.boosts, status: mon.status, ...mon.options,
    });
  }
  const profile = mon.profile ?? TRAINER_PROFILE;
  const { dvs } = profile;
  const iv = (dv: number) => dv * 2;
  const built = new Pokemon(gen, name, {
    level: mon.level,
    boosts: mon.boosts,
    status: mon.status,
    ivs: { hp: iv(hpDv(dvs)), atk: iv(dvs.atk), def: iv(dvs.def), spa: iv(dvs.spc), spd: iv(dvs.spc), spe: iv(dvs.spe) },
  });
  const base = built.species.baseStats;
  const calc = (kind: 'hp' | 'other', baseStat: number, dv: number) =>
    gen12Stat(kind, baseStat, dv, mon.level, profile.statExp);
  const stats = {
    hp: calc('hp', base.hp, hpDv(dvs)),
    atk: calc('other', base.atk, dvs.atk),
    def: calc('other', base.def, dvs.def),
    spa: calc('other', base.spa, dvs.spc),
    spd: calc('other', base.spd, dvs.spc),
    spe: calc('other', base.spe, dvs.spe),
  };
  built.rawStats = { ...stats };
  built.stats = { ...stats };
  built.originalCurHP = stats.hp;
  return built;
};

export type CalcOptions = { crit?: boolean };

export const calcDamage = (
  genNum: number,
  attacker: CalcMon,
  defender: CalcMon,
  move: string,
  options: CalcOptions = {},
): DamageResult => {
  const gen = Generations.get(genNum as Parameters<typeof Generations.get>[0]);
  const atk = buildMon(genNum, attacker);
  const def = buildMon(genNum, defender);
  let result: ReturnType<typeof calculate>;
  try {
    result = calculate(gen, atk, def, new Move(gen, toID(move), { isCrit: options.crit }));
  } catch (err) {
    throw new Error(`calc failed: ${attacker.species} ${move} vs ${defender.species} (gen ${genNum}): ${(err as Error).message}`, { cause: err });
  }
  const range = result.range();
  const [min, max] = Array.isArray(range) ? [range[0], range[1]] : [range, range];
  const hp = def.maxHP();
  const pct = (n: number) => Math.round((n / hp) * 1000) / 10;
  return {
    min,
    max,
    minPercent: pct(min),
    maxPercent: pct(max),
    defenderHp: hp,
    // @smogon/calc throws computing a KO chance when every roll is 0.
    ko: max === 0 ? 'does no damage' : result.kochance().text,
    description:
      max === 0
        ? `${atk.name} ${result.move.name} vs. ${def.name}: 0-0 (0 - 0%) -- does no damage`
        : result.desc(),
  };
};
