import type { Generation } from '@pkmn/data';
import { bestEffectiveness, typeNames } from '../analysis/coverage.js';
import type { Role } from '../analysis/roles.js';
import { toID } from '../data/ids.js';
import type { MoveLearn } from '../types.js';

/** Utility moves worth a slot, best first (accuracy decides the order within a role). */
const UTILITY: Partial<Record<Role, readonly string[]>> = {
  sleep: ['spore', 'sleeppowder', 'lovelykiss', 'hypnosis', 'sing'],
  paralysis: ['thunderwave', 'stunspore', 'glare'],
  recovery: ['softboiled', 'recover', 'rest'],
};

/** Moves that need a charge turn: worth roughly half their power in practice. */
const TWO_TURN = new Set(['razorwind', 'skullbash', 'solarbeam', 'skyattack', 'fly', 'dig']);
/** Damaging moves we never pick on their own: faint the user, need a sleeping target, or hit back only. */
/** Relative to the strongest attack available, so low-level sets still get their basic moves. */
const MIN_STAB_SHARE = 0.45;
const MIN_FILL_SHARE = 0.35;
/** Hyper Beam is strong but costs a turn to recharge, and four copies on one team make every set the same. */
const HYPER_BEAM_FACTOR = 0.6;
const EXCLUDED = new Set(['selfdestruct', 'explosion', 'dreameater', 'counter', 'bide', 'mimic', 'metronome', 'struggle']);

export type MoveChoiceContext = {
  gen: Generation;
  species: string;
  level: number;
  learnable: Map<string, MoveLearn>;
  /** Utility roles the team already has; we prefer filling the ones it lacks. */
  teamRoles: ReadonlySet<Role>;
  /** Defending types teammates' moves already hit super effectively; this member prefers moves that cover the rest. */
  teamCovered?: ReadonlySet<string>;
  /** Moves teammates already have, with counts: duplicates are discounted so the team isn't samey. */
  teamMoves?: ReadonlyMap<string, number>;
  /** TMs already given to teammates, by TM number; single-copy TMs can't be reused. */
  tmUses: Map<number, number>;
  /** How many copies of a TM the player can get (Infinity if it is sold or a prize). */
  tmCopies: (number: number) => number;
};

const attackValue = (gen: Generation, ctx: MoveChoiceContext, id: string, stab: ReadonlySet<string>): number => {
  const m = gen.moves.get(id);
  if (!m || !m.exists || m.basePower <= 1 || EXCLUDED.has(id)) return 0;
  // One Hyper Beam per team.
  if (id === 'hyperbeam' && (ctx.teamMoves?.get(id) ?? 0) >= 1) return 0;
  const accuracy = m.accuracy === true ? 1 : m.accuracy / 100;
  const twoTurn = TWO_TURN.has(id) ? 0.5 : 1;
  const crit = (m.critRatio ?? 1) > 1 ? 1.25 : 1;
  const variety = 0.8 ** (ctx.teamMoves?.get(id) ?? 0);
  return m.basePower * accuracy * twoTurn * crit * variety * (id === 'hyperbeam' ? HYPER_BEAM_FACTOR : 1) * (stab.has(m.type) ? 1.5 : 1);
};

const tmFree = (ctx: MoveChoiceContext, learn: MoveLearn): boolean =>
  learn.source.kind !== 'tm' || (ctx.tmUses.get(learn.source.number) ?? 0) < ctx.tmCopies(learn.source.number);

/**
 * Picks up to 4 moves: the strongest STAB attack(s), one utility move the team lacks, then attacks
 * that add the most new super-effective coverage. Updates `tmUses` for TMs it spends.
 */
export const selectMoves = (ctx: MoveChoiceContext): MoveLearn[] => {
  const { gen, learnable } = ctx;
  const types = gen.species.get(ctx.species)!.types as string[];
  const stab = new Set(types);
  const usable = [...learnable.values()].filter((l) => tmFree(ctx, l));
  const chosen: MoveLearn[] = [];
  const pick = (l: MoveLearn) => {
    chosen.push(l);
    if (l.source.kind === 'tm') ctx.tmUses.set(l.source.number, (ctx.tmUses.get(l.source.number) ?? 0) + 1);
  };

  const attacks = usable
    .map((l) => ({ l, v: attackValue(gen, ctx, l.move, stab) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.l.move.localeCompare(b.l.move));

  const strongest = attacks[0]?.v ?? 0;

  // 1. Best attack of each STAB type, strongest first (at most two), if it is worth a slot.
  for (const t of types) {
    const best = attacks.find((x) => gen.moves.get(x.l.move)!.type === t && !chosen.includes(x.l));
    if (best && best.v >= MIN_STAB_SHARE * strongest && chosen.length < 2) pick(best.l);
  }
  // 2. If STAB gave nothing (all status or weak), take the strongest attack of any type.
  if (chosen.length === 0 && attacks[0]) pick(attacks[0].l);

  // 3. One utility move for a role the team lacks, else for any role the species can fill.
  const roles = Object.keys(UTILITY) as Role[];
  const wanted = [...roles.filter((r) => !ctx.teamRoles.has(r)), ...roles.filter((r) => ctx.teamRoles.has(r))];
  for (const role of wanted) {
    const move = UTILITY[role]!.map((id) => usable.find((l) => l.move === id)).find(Boolean);
    if (move && !chosen.includes(move) && chosen.length < 4 && !ctx.teamRoles.has(role)) {
      pick(move);
      break;
    }
  }

  // 4. Fill with the attack that adds the most newly super-effective types (ties: strongest).
  while (chosen.length < 4) {
    const have = chosen.map((l) => gen.moves.get(l.move)!.type as string);
    // A type nobody on the team hits yet counts double.
    const covered = (ts: string[]) => typeNames(gen).filter((d) => bestEffectiveness(gen, ts, [d]) > 1).reduce((n, d) => n + (ctx.teamCovered && !ctx.teamCovered.has(d) ? 2 : 1), 0);
    const base = covered(have);
    const next = attacks
      // Single-copy TMs are kept for members that use them as STAB; coverage can use plentiful ones.
      .filter((x) => x.v >= MIN_FILL_SHARE * strongest && !chosen.includes(x.l) && tmFree(ctx, x.l) && !(x.l.source.kind === 'tm' && ctx.tmCopies(x.l.source.number) === 1))
      .map((x) => ({ x, gain: covered([...have, gen.moves.get(x.l.move)!.type as string]) - base }))
      .sort((a, b) => b.gain - a.gain || b.x.v - a.x.v || a.x.l.move.localeCompare(b.x.l.move))[0];
    if (!next) break;
    pick(next.x.l);
  }
  return chosen;
};

/** Utility roles (sleep, paralysis, recovery) that a chosen move list fills. */
export const utilityRolesOf = (moves: readonly string[]): Role[] =>
  (Object.entries(UTILITY) as Array<[Role, readonly string[]]>)
    .filter(([, defining]) => defining.some((m) => moves.map(toID).includes(m)))
    .map(([role]) => role);
