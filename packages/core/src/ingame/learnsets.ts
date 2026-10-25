import type { Generation } from '@pkmn/data';
import { toID } from '../data/ids.js';
import type { LearnsetsFile, SpeciesLearnset } from '../games/learnsets-schema.js';
import type { TmsFile } from '../games/tms-schema.js';
import type { MoveLearn } from '../types.js';
import { chainOf, evolutionInto } from './families.js';

/**
 * The game's `WriteMonMoves` for a Pokémon created at `level`: start with its level 1 moves, apply
 * every level-up move up to `level`, skipping known moves, filling empty slots, else dropping the oldest.
 */
export const movesAtLevel = (entry: SpeciesLearnset, level: number): string[] => {
  const moves = [...entry.start];
  for (const { level: lvl, move } of entry.levelUp) {
    if (lvl > level) break;
    if (moves.includes(move)) continue;
    if (moves.length >= 4) moves.shift();
    moves.push(move);
  }
  return moves;
};

export type LearnContext = {
  gen: Generation;
  tms: TmsFile;
  learnsets: LearnsetsFile;
  /** The route actually taken, first obtained form first, ending at the form being taught. */
  chain: string[];
  /** Level the first form is obtained at (wild catch level, gift level, ...). */
  acquiredLevel: number;
  /** The member's level. */
  level: number;
  /** Badges held (9 = after the Elite Four). Gates TM and HM availability. */
  stage: number;
};

const entryOf = (learnsets: LearnsetsFile, id: string): SpeciesLearnset => {
  const entry = learnsets.species[id];
  if (!entry) throw new Error(`No learnset for "${id}"`);
  return entry;
};

/**
 * Moves the final form of `chain` can know at `level` with `stage` badges, and how each is learned.
 *
 * The first form starts with the game's moves for a Pokémon created at `acquiredLevel` (start moves
 * plus learnset, last four), then learns higher-level moves as it levels. A pre-evolution can learn
 * moves up to the level it evolves at (or up to `level` if it evolves by item or trade, since you can
 * hold off). Each evolved form learns its own level-up moves. TMs and HMs are taught to the final
 * form from any source reachable by `stage`. Moves a Pokémon forgets are not modelled.
 */
export const learnableMoves = (ctx: LearnContext): Map<string, MoveLearn> => {
  const { gen, tms, learnsets, chain, acquiredLevel, level, stage } = ctx;
  const out = new Map<string, MoveLearn>();
  const keep = (learn: MoveLearn) => {
    const cur = out.get(learn.move);
    // Prefer free, immediate sources: known on capture, then the earliest level-up, then TMs.
    const rank = (l: MoveLearn) => (l.source.kind === 'start' ? 0 : l.source.kind === 'level' ? 1 + l.source.level / 1000 : 2);
    if (!cur || rank(learn) < rank(cur)) out.set(learn.move, learn);
  };

  for (const [i, species] of chain.entries()) {
    const next = chain[i + 1];
    const evo = next ? evolutionInto(gen, next) : undefined;
    const cap = next && evo?.how === 'level' ? Math.min(level, evo.level ?? level) : level;
    const entry = entryOf(learnsets, species);
    if (i === 0) {
      for (const move of movesAtLevel(entry, acquiredLevel)) keep({ move, source: { kind: 'start', from: species }, stage: 0 });
    }
    // Later forms don't get start moves; levels already passed when first obtained are gone.
    const floor = i === 0 ? acquiredLevel : 0;
    for (const { level: lvl, move } of entry.levelUp) {
      if (lvl > floor && lvl <= cap) keep({ move, source: { kind: 'level', level: lvl, from: species }, stage: 0 });
    }
  }

  const final = entryOf(learnsets, chain[chain.length - 1]!);
  for (const tm of tms.tms) {
    if (!final.tmhm.includes(tm.move)) continue;
    const reachable = tm.sources.filter((s) => s.stage <= stage).sort((a, b) => a.stage - b.stage)[0];
    if (!reachable) continue;
    keep({ move: tm.move, source: { kind: tm.kind, number: tm.number, location: reachable.location }, stage: reachable.stage });
  }
  return out;
};

/** The most evolved form this route has reached at this level and stage (e.g. Charmeleon at Brock's gym). */
export const formAt = (gen: Generation, stoneStage: (item: string) => number, chain: string[], level: number, stage: number): string => {
  let form = chain[0]!;
  for (const next of chain.slice(1)) {
    const evo = evolutionInto(gen, next);
    if (!evo) break;
    const ready =
      evo.how === 'level' ? level >= (evo.level ?? 0)
      : evo.how === 'stone' ? stage >= stoneStage(evo.item!)
      : true;
    if (!ready) break;
    form = next;
  }
  return form;
};

export const chainFor = (gen: Generation, id: string): string[] => chainOf(gen, toID(id));
